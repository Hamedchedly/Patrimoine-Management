-- ═══════════════════════════════════════════════════════════════════════════════
-- PSP V7 — PÉRIMÈTRE PATRIMOINE + ENVELOPPES + STATUT/PRIORITÉ
--
-- Objectif (V7 — préparation utilisable) :
--  · `psp_ligne_patrimoine` : associer à une ligne PSP un périmètre patrimonial
--    structuré (tranche / rue / adresse / lot). Une ligne = UNE seule tranche.
--  · `psp_enveloppes` : enveloppes GE/GT/CP par année, PROPRE à la programmation.
--  · `psp_lignes.statut` / `psp_lignes.priorite` : champs structurés par ligne.
--
-- Principes (non destructif, idempotent) :
--  · aucune table existante recréée, aucun DROP ;
--  · aucune donnée patrimoniale recopiée (adresse/ville/CC restent dans
--    tranches/lots/occupants — enrichies à l'affichage) ;
--  · gel étendu : programmation figée → aucun INSERT/UPDATE/DELETE de périmètre
--    ni d'enveloppe ; la suppression d'une psp_ligne cascade son périmètre ;
--  · RLS : SELECT authenticated · écritures service_role (pattern existant).
--
-- À exécuter dans Supabase SQL Editor APRÈS validation du modèle V7.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. PSP_LIGNE_PATRIMOINE — périmètre patrimonial d'une ligne PSP
-- ═══════════════════════════════════════════════════════════════════════════════
-- niveau :
--  · 'tranche'  → toute la tranche (rue/numero/lot_id NULL) ;
--  · 'rue'      → une rue entière (numero/lot_id NULL) ;
--  · 'adresse'  → un numéro précis d'une rue (lot_id NULL) ;
--  · 'lot'      → un lot précis (lot_id renseigné, rue/numero NULL).
-- tranche_code TOUJOURS renseigné ; la cohérence lot↔tranche et ligne↔tranche est
-- vérifiée par trigger (§3).
create table if not exists public.psp_ligne_patrimoine (
  id uuid primary key default gen_random_uuid(),
  psp_ligne_id uuid not null references public.psp_lignes(id) on delete cascade,
  tranche_code text not null references public.tranches(code),
  niveau text not null
    check (niveau in ('tranche', 'rue', 'adresse', 'lot')),
  rue text,
  numero text,
  lot_id uuid references public.lots(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (niveau = 'tranche' and rue is null and numero is null and lot_id is null)
    or (niveau = 'rue' and rue is not null and numero is null and lot_id is null)
    or (niveau = 'adresse' and rue is not null and numero is not null and lot_id is null)
    or (niveau = 'lot' and lot_id is not null and rue is null and numero is null)
  )
);

comment on table public.psp_ligne_patrimoine is
  'Périmètre patrimonial d''une ligne PSP (tranche / rue / adresse / lot). Une ligne = une seule tranche.';
comment on column public.psp_ligne_patrimoine.niveau is
  'Niveau du périmètre : tranche | rue | adresse | lot.';

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. PSP_ENVELOPPES — enveloppes GE/GT/CP par année (propres à la programmation)
-- ═══════════════════════════════════════════════════════════════════════════════
-- UNIQUE(programmation_id, annee, categorie) ; montant jamais négatif ;
-- l'année doit appartenir à la période de la programmation (trigger §3).
-- Aucun total stocké : programmé/restant/pourcentage sont TOUJOURS calculés.
create table if not exists public.psp_enveloppes (
  id uuid primary key default gen_random_uuid(),
  programmation_id uuid not null references public.psp_programmations(id) on delete cascade,
  annee integer not null check (annee between 2000 and 2100),
  categorie text not null check (categorie in ('GE', 'GT', 'CP')),
  montant numeric not null default 0 check (montant >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (programmation_id, annee, categorie)
);

comment on table public.psp_enveloppes is
  'Enveloppes budgétaires GE/GT/CP par année, propres à la programmation. BUDGET_SOURCE reste MOCK tant que la dotation officielle n''est pas définie.';

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. ALTER PSP_LIGNES — statut + priorité structurés
-- ═══════════════════════════════════════════════════════════════════════════════
alter table public.psp_lignes
  add column if not exists statut text not null default 'a_definir'
    check (statut in ('a_definir', 'attente_agence', 'attente_confirmation')),
  add column if not exists priorite text not null default 'normale'
    check (priorite in ('prioritaire', 'normale', 'non_prioritaire'));

comment on column public.psp_lignes.statut is
  'Statut structuré : a_definir | attente_agence | attente_confirmation.';
comment on column public.psp_lignes.priorite is
  'Priorité : prioritaire | normale | non_prioritaire (distincte du statut).';

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. TRIGGERS — gel, cohérence tranche, période d'enveloppe
-- ═══════════════════════════════════════════════════════════════════════════════

-- 4.1 updated_at automatique
drop trigger if exists psp_ligne_patrimoine_updated_at on public.psp_ligne_patrimoine;
create trigger psp_ligne_patrimoine_updated_at before update on public.psp_ligne_patrimoine
  for each row execute function public.set_psp_updated_at();

drop trigger if exists psp_enveloppes_updated_at on public.psp_enveloppes;
create trigger psp_enveloppes_updated_at before update on public.psp_enveloppes
  for each row execute function public.set_psp_updated_at();

-- 4.2 GEL périmètre patrimoine : aucun INSERT/UPDATE/DELETE si la programmation
-- de la ligne est figée.
create or replace function public.prevent_psp_patrimoine_mutation_if_figee()
returns trigger language plpgsql as $$
declare
  pid uuid;
begin
  select l.programmation_id into pid
  from public.psp_lignes l where l.id = coalesce(new.psp_ligne_id, old.psp_ligne_id);
  if pid is not null and public.psp_programmation_est_figee(pid) then
    raise exception 'Programmation figée : modification du périmètre patrimoine interdite (ligne %)', coalesce(new.psp_ligne_id, old.psp_ligne_id);
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists prevent_psp_patrimoine_mutation_if_figee on public.psp_ligne_patrimoine;
create trigger prevent_psp_patrimoine_mutation_if_figee before insert or update or delete
  on public.psp_ligne_patrimoine
  for each row execute function public.prevent_psp_patrimoine_mutation_if_figee();

-- 4.3 GEL enveloppes : aucun INSERT/UPDATE/DELETE si la programmation est figée.
create or replace function public.prevent_psp_enveloppe_mutation_if_figee()
returns trigger language plpgsql as $$
declare
  pid uuid;
begin
  pid := coalesce(new.programmation_id, old.programmation_id);
  if pid is not null and public.psp_programmation_est_figee(pid) then
    raise exception 'Programmation figée : modification d''enveloppe interdite (programmation %)', pid;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists prevent_psp_enveloppe_mutation_if_figee on public.psp_enveloppes;
create trigger prevent_psp_enveloppe_mutation_if_figee before insert or update or delete
  on public.psp_enveloppes
  for each row execute function public.prevent_psp_enveloppe_mutation_if_figee();

-- 4.4 Cohérence du périmètre :
--  · lot_id doit appartenir à tranche_code (lots.tranche_code) ;
--  · tranche_code doit correspondre à psp_lignes.tranche_code (une ligne = une tranche).
create or replace function public.check_psp_patrimoine_coherence()
returns trigger language plpgsql as $$
declare
  lot_tranche text;
  ligne_tranche text;
begin
  if new.lot_id is not null then
    select l.tranche_code into lot_tranche from public.lots l where l.id = new.lot_id;
    if lot_tranche is distinct from new.tranche_code then
      raise exception 'Lot % n''appartient pas à la tranche %', new.lot_id, new.tranche_code;
    end if;
  end if;
  select l.tranche_code into ligne_tranche from public.psp_lignes l where l.id = new.psp_ligne_id;
  if ligne_tranche is distinct from new.tranche_code then
    raise exception 'Périmètre tranche % incohérent avec la ligne % (tranche %)', new.tranche_code, new.psp_ligne_id, ligne_tranche;
  end if;
  return new;
end $$;

drop trigger if exists check_psp_patrimoine_coherence on public.psp_ligne_patrimoine;
create trigger check_psp_patrimoine_coherence before insert or update
  on public.psp_ligne_patrimoine
  for each row execute function public.check_psp_patrimoine_coherence();

-- 4.5 L'année d'une enveloppe doit appartenir à la période de la programmation.
create or replace function public.check_psp_enveloppe_periode()
returns trigger language plpgsql as $$
declare
  debut integer;
  fin integer;
begin
  select p.annee_debut, p.annee_fin into debut, fin
  from public.psp_programmations p where p.id = new.programmation_id;
  if debut is not null and (new.annee < debut or new.annee > fin) then
    raise exception 'Année % hors période %-% de la programmation', new.annee, debut, fin;
  end if;
  return new;
end $$;

drop trigger if exists check_psp_enveloppe_periode on public.psp_enveloppes;
create trigger check_psp_enveloppe_periode before insert or update
  on public.psp_enveloppes
  for each row execute function public.check_psp_enveloppe_periode();

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. INDEX
-- ═══════════════════════════════════════════════════════════════════════════════
create index if not exists psp_ligne_patrimoine_ligne_idx
  on public.psp_ligne_patrimoine (psp_ligne_id);
create index if not exists psp_ligne_patrimoine_tranche_idx
  on public.psp_ligne_patrimoine (tranche_code);
create index if not exists psp_ligne_patrimoine_lot_idx
  on public.psp_ligne_patrimoine (lot_id);
create index if not exists psp_enveloppes_programmation_idx
  on public.psp_enveloppes (programmation_id, annee);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 6. RLS — pattern existant (SELECT authenticated · écritures service_role)
-- ═══════════════════════════════════════════════════════════════════════════════
alter table public.psp_ligne_patrimoine enable row level security;
alter table public.psp_enveloppes enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'psp_ligne_patrimoine'
      and policyname = 'lecture périmètre patrimoine psp'
  ) then
    create policy "lecture périmètre patrimoine psp"
      on public.psp_ligne_patrimoine for select to authenticated using (true);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'psp_enveloppes'
      and policyname = 'lecture enveloppes psp'
  ) then
    create policy "lecture enveloppes psp"
      on public.psp_enveloppes for select to authenticated using (true);
  end if;
end $$;

grant select on public.psp_ligne_patrimoine, public.psp_enveloppes to authenticated;
revoke insert, update, delete, truncate, references, trigger
  on public.psp_ligne_patrimoine, public.psp_enveloppes from authenticated;
grant all on public.psp_ligne_patrimoine, public.psp_enveloppes to service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 7. VÉRIFICATIONS POST-MIGRATION
-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. Tables :
--    select tablename from pg_tables where schemaname='public'
--      and tablename in ('psp_ligne_patrimoine','psp_enveloppes') order by 1;
-- 2. Colonnes psp_lignes :
--    select column_name from information_schema.columns
--      where table_schema='public' and table_name='psp_lignes'
--      and column_name in ('statut','priorite') order by 1;
-- 3. Tests gel (après création d'un brouillon + ligne + périmètre) :
--    update public.psp_programmations set statut='figee' where <id>;
--    insert into public.psp_ligne_patrimoine(...) ...;   → doit échouer
--    insert into public.psp_enveloppes(...) ...;          → doit échouer
--    update public.psp_programmations set statut='brouillon' where <id>; -- dégel
-- 4. Cohérence tranche (lot d'une autre tranche) :
--    insert ... niveau='lot', lot_id=<lot d'une autre tranche> → doit échouer.
-- 5. Période enveloppe :
--    insert ... annee=2032 (hors 2027-2031) → doit échouer.

-- ═══════════════════════════════════════════════════════════════════════════════
-- FIN DE LA MIGRATION V7 — à valider avant exécution
-- ═══════════════════════════════════════════════════════════════════════════════