-- ═══════════════════════════════════════════════════════════════════════════════
-- PSP V7.3 — UNE TRANCHE PEUT PORTER PLUSIEURS OPÉRATIONS + CRÉATION ATOMIQUE
--
-- Objectifs :
--  · supprimer la contrainte UNIQUE (programmation_id, tranche_code, categorie)
--    de psp_lignes : une même tranche peut légitimement contenir plusieurs
--    opérations (même catégorie ou non) sur des natures différentes. L'unique
--    identité nécessaire reste `id` (uuid technique).
--  · garantir une programmation sur AU MOINS une année (montant > 0) ;
--  · rendre ATOMIQUE la création / la modification d'une opération
--    (ligne + périmètre + devis) via deux fonctions RPC : succès = tout est
--    créé, échec = rien ne reste (rollback implicite d'une fonction plpgsql).
--
-- Non destructif : aucune donnée existante supprimée ni modifiée ; les triggers
-- de gel et l'historique (log_psp_ligne_history) restent inchangés.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. SUPPRIMER L'UNIQUE (programmation_id, tranche_code, categorie) ──────────
-- Une tranche peut avoir plusieurs opérations (même catégorie). L'unicité
-- technique reste `id`. Aucune donnée ne dépend de cette contrainte : la
-- « ligne budgétaire » (ligne_budget) est une colonne, pas une clé.
alter table public.psp_lignes
  drop constraint if exists psp_lignes_programmation_id_tranche_code_categorie_key;

comment on table public.psp_lignes is
  'Lignes programmées d''une version PSP. Plusieurs opérations par tranche et par catégorie autorisées (unicité technique = id).';

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. CREATE_PSP_OPERATION — création ATOMIQUE (ligne + périmètre + devis)
-- ═══════════════════════════════════════════════════════════════════════════════
-- Règles :
--  · au moins une année > 0 (sinon exception explicite) ;
--  · périmètre : tableau jsonb [{niveau, rue, numero, lot_id}] — contraintes
--    CHECK + cohérence tranche de psp_ligne_patrimoine vérifiées en base ;
--  · devis : tableau jsonb optionnel [{fournisseur_id, entreprise, date_devis,
--    montant, statut, commentaire, document_reference}] ;
--  · gel (programmation figée) : les triggers existants lèvent une exception →
--    tout est annulé (aucun résidu) ;
--  · historique : le trigger log_psp_ligne_history enregistre la création.
create or replace function public.create_psp_operation(
  p_programmation_id uuid,
  p_tranche_code text,
  p_categorie text,
  p_corps_etat_code text,
  p_corps_etat text,
  p_nature_travaux text,
  p_programme jsonb,
  p_ligne_budget text,
  p_remarques text,
  p_statut text,
  p_priorite text,
  p_origine text,
  p_perimetres jsonb,
  p_devis jsonb
) returns public.psp_lignes
language plpgsql security definer as $$
declare
  v_ligne public.psp_lignes;
  v_annee_ok boolean;
  v_p jsonb;
  v_d jsonb;
begin
  select bool_or((value)::numeric > 0)
    into v_annee_ok
    from jsonb_each(p_programme);
  if v_annee_ok is distinct from true then
    raise exception 'Une opération doit avoir au moins une année de programmation avec un montant supérieur à 0.';
  end if;

  insert into public.psp_lignes (
    programmation_id, tranche_code, categorie, corps_etat_code, corps_etat,
    nature_travaux, programme, ligne_budget, remarques, statut, priorite, origine
  ) values (
    p_programmation_id, p_tranche_code, p_categorie, p_corps_etat_code, p_corps_etat,
    p_nature_travaux, coalesce(p_programme, '{}'::jsonb), p_ligne_budget, p_remarques,
    coalesce(p_statut, 'a_definir'), coalesce(p_priorite, 'normale'),
    coalesce(p_origine, 'preparation')
  )
  returning * into v_ligne;

  if p_perimetres is not null and jsonb_typeof(p_perimetres) = 'array' then
    for v_p in select * from jsonb_array_elements(p_perimetres) loop
      insert into public.psp_ligne_patrimoine (psp_ligne_id, tranche_code, niveau, rue, numero, lot_id)
      values (
        v_ligne.id, p_tranche_code,
        v_p ->> 'niveau',
        v_p ->> 'rue',
        v_p ->> 'numero',
        nullif(v_p ->> 'lot_id', '')::uuid
      );
    end loop;
  end if;

  if p_devis is not null and jsonb_typeof(p_devis) = 'array' then
    for v_d in select * from jsonb_array_elements(p_devis) loop
      insert into public.psp_devis (
        psp_ligne_id, fournisseur_id, entreprise, date_devis, montant, statut,
        commentaire, document_reference
      ) values (
        v_ligne.id,
        nullif(v_d ->> 'fournisseur_id', '')::uuid,
        v_d ->> 'entreprise',
        nullif(v_d ->> 'date_devis', '')::date,
        nullif(v_d ->> 'montant', '')::numeric,
        coalesce(v_d ->> 'statut', 'recu'),
        v_d ->> 'commentaire',
        v_d ->> 'document_reference'
      );
    end loop;
  end if;

  return v_ligne;
end;
$$;

revoke all on function public.create_psp_operation(
  uuid, text, text, text, text, text, jsonb, text, text, text, text, text, jsonb, jsonb
) from public;

comment on function public.create_psp_operation is
  'V7.3 — Création atomique d''une opération PSP (ligne + périmètre + devis). Échec → aucun résidu.';


-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. UPDATE_PSP_OPERATION — modification ATOMIQUE (ligne + remplacement périmètre)
-- ═══════════════════════════════════════════════════════════════════════════════
create or replace function public.update_psp_operation(
  p_id uuid,
  p_tranche_code text,
  p_categorie text,
  p_corps_etat_code text,
  p_corps_etat text,
  p_nature_travaux text,
  p_programme jsonb,
  p_remarques text,
  p_statut text,
  p_priorite text,
  p_perimetres jsonb
) returns public.psp_lignes
language plpgsql security definer as $$
declare
  v_ligne public.psp_lignes;
  v_annee_ok boolean;
  v_p jsonb;
begin
  select bool_or((value)::numeric > 0)
    into v_annee_ok
    from jsonb_each(p_programme);
  if v_annee_ok is distinct from true then
    raise exception 'Une opération doit avoir au moins une année de programmation avec un montant supérieur à 0.';
  end if;

  update public.psp_lignes
     set tranche_code = p_tranche_code,
         categorie = p_categorie,
         corps_etat_code = p_corps_etat_code,
         corps_etat = p_corps_etat,
         nature_travaux = p_nature_travaux,
         programme = coalesce(p_programme, '{}'::jsonb),
         remarques = p_remarques,
         statut = coalesce(p_statut, statut),
         priorite = coalesce(p_priorite, priorite),
         updated_at = now()
   where id = p_id
   returning * into v_ligne;

  if v_ligne.id is null then
    raise exception 'Ligne introuvable.';
  end if;

  -- Périmètre patrimonial : remplacement (l'UI fournit l'ensemble retenu).
  delete from public.psp_ligne_patrimoine where psp_ligne_id = p_id;
  if p_perimetres is not null and jsonb_typeof(p_perimetres) = 'array' then
    for v_p in select * from jsonb_array_elements(p_perimetres) loop
      insert into public.psp_ligne_patrimoine (psp_ligne_id, tranche_code, niveau, rue, numero, lot_id)
      values (
        p_id, p_tranche_code,
        v_p ->> 'niveau',
        v_p ->> 'rue',
        v_p ->> 'numero',
        nullif(v_p ->> 'lot_id', '')::uuid
      );
    end loop;
  end if;

  return v_ligne;
end;
$$;

revoke all on function public.update_psp_operation(
  uuid, text, text, text, text, text, jsonb, text, text, text, jsonb
) from public;

comment on function public.update_psp_operation is
  'V7.3 — Modification atomique d''une opération PSP (ligne + périmètre). Échec → aucun résidu.';

-- ═══════════════════════════════════════════════════════════════════════════════
-- Vérifications après exécution :
--  1. contrainte supprimée :
--     select conname from pg_constraint
--      where conrelid = 'public.psp_lignes'::regclass
--        and contype = 'u';
--  2. plusieurs lignes même tranche + même catégorie :
--     insert 2 lignes (TR 1976 / GT) puis select count(*) -> 2 ;
--  3. RPC : select * from public.create_psp_operation(...) ;
--  4. gel : programmation figée → create_psp_operation échoue sans résidu.
-- ═══════════════════════════════════════════════════════════════════════════════

