-- ═══════════════════════════════════════════════════════════════════════════════
-- PSP V7.6 — BROUILLON + RÉFÉRENTIEL CORPS D'ÉTAT
--
--  1. MODE BROUILLON : le préparateur PSP est un OUTIL DE BROUILLON.
--     Une ligne « TR seule » (sans corps d'état, sans montant, sans année
--     programmée) est ENREGISTRABLE. La validation stricte (corps d'état,
--     nature, adresse/périmètre, au moins une année > 0) est faite AU MOMENT
--     DE L'EXPORT, jamais pendant la saisie.
--     Les données structurellement incohérentes restent bloquées (TR
--     inexistante via FK, périmètre d'une autre TR via le RPC, FK invalides).
--
--  2. RÉFÉRENTIEL CORPS D'ÉTAT : table dédiée `psp_corps_etats`
--     (code → libellé → GE/GT/CP → actif), indépendante des commandes.
--     L'historique des commandes sert UNIQUEMENT à INITIALISER les valeurs
--     existantes (seed unique, idempotent) ; ensuite le référentiel vit seul.
--
-- Non destructif : aucune donnée existante modifiée, aucune commande touchée.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. MODE BROUILLON : retrait du blocage « au moins une année > 0 » ──────────
-- Le contrôle est déplacé vers l'export (analyse de complétude, V7.6).
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
  v_p jsonb;
  v_d jsonb;
begin
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
  'V7.6 — Création atomique d''une opération PSP (brouillon : TR seule suffit, corps d''état/montant/année facultatifs). Échec → aucun résidu.';

-- ── UPDATE_PSP_OPERATION (brouillon : mêmes règles) ───────────────────────────
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
  v_p jsonb;
begin
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
  'V7.6 — Modification atomique d''une opération PSP (brouillon : champs métier facultatifs). Échec → aucun résidu.';

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. RÉFÉRENTIEL CORPS D'ÉTAT (psp_corps_etats)
--    code → libellé → GE/GT/CP → actif
--    Source d'initialisation : travaux_commandes.corps_etat + psp_lignes.corps_etat
--    (valeurs DISTINCTES réelles — jamais le référentiel vivant).
-- ═══════════════════════════════════════════════════════════════════════════════
create table if not exists public.psp_corps_etats (
  id uuid primary key default gen_random_uuid(),
  code text,
  libelle text not null unique,
  categorie text not null check (categorie in ('GE', 'GT', 'CP')),
  actif boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.psp_corps_etats is
  'V7.6 — Référentiel corps d''état : code → libellé → catégorie GE/GT/CP → actif. Autorité des corps disponibles (plus jamais les seules commandes historiques).';
comment on column public.psp_corps_etats.code is
  'Code lettre du corps d''état (ex. (d)) — dérivé du libellé, modifiable.';
comment on column public.psp_corps_etats.categorie is
  'Catégorie budgétaire GE / GT / CP — détermine automatiquement C à la saisie.';

alter table public.psp_corps_etats enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'psp_corps_etats' and policyname = 'lecture corps etats'
  ) then
    create policy "lecture corps etats"
      on public.psp_corps_etats for select to authenticated using (true);
  end if;
end $$;

create index if not exists psp_corps_etats_actif_idx on public.psp_corps_etats (actif);

-- Seed UNIQUE (idempotent) : initialise le référentiel depuis les valeurs
-- réellement présentes dans les commandes historiques et les lignes PSP.
-- La catégorie suit la règle connue (dérivée du fichier de programmation réel) ;
-- tout code inconnu est rattaché à GT par défaut (modifiable ensuite).
with sources as (
  select distinct trim(corps_etat) as libelle
    from public.travaux_commandes
   where corps_etat is not null and trim(corps_etat) <> ''
  union
  select distinct trim(corps_etat)
    from public.psp_lignes
   where corps_etat is not null and trim(corps_etat) <> ''
)
insert into public.psp_corps_etats (code, libelle, categorie, actif)
select
  (regexp_match(libelle, '\(([A-Za-zÀ-ÿ]+)\)'))[1] as code,
  libelle,
  case
    when lower((regexp_match(libelle, '\(([A-Za-zÀ-ÿ]+)\)'))[1]) in ('c', 'd', 'e') then 'GT'
    when lower((regexp_match(libelle, '\(([A-Za-zÀ-ÿ]+)\)'))[1]) in ('f', 'g', 'h', 'j') then 'GE'
    when lower((regexp_match(libelle, '\(([A-Za-zÀ-ÿ]+)\)'))[1]) in ('m', 'o', 'p', 'q', 'r', 'u', 'w', 'y', 'z') then 'CP'
    else 'GT'
  end as categorie,
  true
from sources
on conflict (libelle) do nothing;

-- Vérifications :
--   select code, libelle, categorie, actif from public.psp_corps_etats order by libelle;
--   select count(*) from public.psp_corps_etats;

