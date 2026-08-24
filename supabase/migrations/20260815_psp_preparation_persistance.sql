-- ═══════════════════════════════════════════════════════════════════════════════
-- PSP V6 — PERSISTANCE DU PRÉPARATEUR PSP (PREMIÈRE MIGRATION RÉELLE)
--
-- Objectif : rendre le Préparateur PSP persistant dans Supabase (brouillons,
-- lignes, historique, reports, devis, décisions, rattachement commandes).
--
-- Principes (V6) :
--   · aucune suppression destructive, aucune donnée existante supprimée ;
--   · aucune table existante recréée (CREATE IF NOT EXISTS) ;
--   · psp_programmations : ABSENTE de la base live (vérifié) → CRÉÉE ;
--   · psp_command_links : EXISTE → GÉNÉRALISÉE (ajout psp_ligne_id) ;
--   · psp_decisions    : EXISTE → GÉNÉRALISÉE (ajouts psp_ligne_id, annee_cible,
--     montant + extension du domaine type_decision) ;
--   · psp_rules        : EXISTE, CONSERVÉE (règles générales, aucune concurrence) ;
--   · gel : une programmation figée ne peut plus être modifiée (triggers) ;
--   · imports annuels : ne modifient jamais directement une programmation figée.
--
-- État live vérifié en lecture seule (2026-08-15, service role / OpenAPI) :
--   · psp_programmations : ABSENTE (PGRST205) — création pure ;
--   · psp_command_links : PRÉSENTE, 0 ligne — colonnes réelles : id, commande_id,
--     import_row_id, type_relation, methode, confiance, statut, justification,
--     created_at, updated_at ;
--   · psp_decisions : PRÉSENTE, 0 ligne — colonnes réelles : id, type_decision,
--     cible_type, cible_id, cle_metier, source_historique, source_suivi_annuel,
--     proposition_initiale, decision_utilisateur, valeur_retenue, motif, statut,
--     created_at, updated_at ;
--   · psp_rules : PRÉSENTE, 0 ligne (conserve son rôle de règles générales) ;
--   · tranches.code : 120 valeurs, toutes uniques (FK sûre) ;
--   · travaux_commandes.numero_commande : 187 valeurs, toutes uniques.
--
-- Exécution : copier/coller INTÉGRALEMENT dans Supabase → SQL Editor → Run.
-- Le fichier est idempotent (ré-exécutable sans effet destructif).
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 0. Pré-vol (informations) ───────────────────────────────────────────────────
do $$
begin
  raise notice 'PSP V6 — tables à créer : psp_programmations, psp_lignes, psp_ligne_historique, psp_reports, psp_devis.';
  raise notice 'PSP V6 — tables à généraliser : psp_command_links, psp_decisions.';
end $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. PSP_PROGRAMMATIONS — racine des versions PSP (période, type, statut, gel)
-- ═══════════════════════════════════════════════════════════════════════════════
-- « type » sépare officielle / simulation ; « statut » pilote le cycle de vie
-- (brouillon → a_valider → validee → figee → archivee ; 'simulation' réservé
-- aux simulations de type=simulation).
-- `parent_id` relie une version/simulation à sa version d'origine (V2 dérive de V1).
-- UNIQUE(annee_debut, version) : une seule version par période et par numéro.
create table if not exists public.psp_programmations (
  id uuid primary key default gen_random_uuid(),
  annee_debut integer not null check (annee_debut between 2000 and 2100),
  annee_fin integer not null check (annee_fin >= annee_debut),
  version integer not null default 1 check (version >= 1),
  type text not null default 'officielle' check (type in ('officielle', 'simulation')),
  statut text not null default 'brouillon'
    check (statut in ('brouillon', 'a_valider', 'validee', 'figee', 'archivee', 'simulation')),
  parent_id uuid references public.psp_programmations(id) on delete set null,
  auteur uuid references auth.users(id),
  remarques text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  validated_at timestamptz,
  validated_by uuid references auth.users(id),
  frozen_at timestamptz,
  frozen_by uuid references auth.users(id),
  unique (annee_debut, version)
);

comment on table public.psp_programmations is
  'Racine des versions PSP : une programmation (période) a N versions ;
une simulation est une version de type simulation, jamais officielle.
Gel : statut=figee => aucune modification (triggers).';

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. PSP_LIGNES — lignes programmées d'une version
-- ═══════════════════════════════════════════════════════════════════════════════
-- Identité métier : TR + C (GE/GT/CP), UNIQUE au sein d'une version.
-- `programme` est un JSONB {"2027":35000,"2028":0,…} (Option A validée V5.1) :
-- années extensibles (2032…) sans migration de colonnes ; diff entre versions trivial.
-- `ligne_budget` est acquise au premier import du suivi annuel (jamais inventée).
-- Enrichissement patrimoine (adresse, ville, logements…) : lu à l'affichage via
-- tranches/lots, JAMAIS recopié ici (règle V6 §22).
create table if not exists public.psp_lignes (
  id uuid primary key default gen_random_uuid(),
  programmation_id uuid not null references public.psp_programmations(id) on delete cascade,
  tranche_code text not null references public.tranches(code),
  categorie text not null check (categorie in ('GE', 'GT', 'CP')),
  corps_etat_code text,
  corps_etat text,
  nature_travaux text,
  programme jsonb not null default '{}'::jsonb,
  ligne_budget text,
  remarques text,
  origine text not null default 'preparation'
    check (origine in ('preparation', 'report', 'esquisse', 'suivi')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (programmation_id, tranche_code, categorie)
);

comment on table public.psp_lignes is
  'Lignes programmées d''une version PSP. Identité : programmation_id + tranche_code +
categorie (TR+C). programme : JSONB années -> montants (Option A V5.1).';
comment on column public.psp_lignes.programme is
  'JSONB {"2027":35000,"2028":0,…} — montants programmés par exercice (Option A).';
comment on column public.psp_lignes.ligne_budget is
  'Ligne budgétaire acquise au 1er import du suivi annuel (ex. 526) — jamais inventée.';
comment on column public.psp_lignes.origine is
  'Origine de la ligne : preparation, report (ligne issue d''un report), esquisse, suivi.';

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. PSP_LIGNE_HISTORIQUE — historique des changements importants d'une ligne
-- ═══════════════════════════════════════════════════════════════════════════════
-- Pattern delta JSONB validé (même mécanisme que travaux_commandes_historique) :
-- « quoi » (operation) · « avant » / « après » (avant jsonb, apres jsonb) ·
-- « quand » (created_at) · « par qui » (utilisateur) · « pourquoi » (motif).
-- Le trigger psp_lignes_history alimente automatiquement creation/modification.
-- Les opérations sémantiques (report, annulation, conflit_categorie) sont écrites
-- par les server functions de l'application.
create table if not exists public.psp_ligne_historique (
  id uuid primary key default gen_random_uuid(),
  ligne_id uuid not null references public.psp_lignes(id) on delete cascade,
  operation text not null default 'modification'
    check (operation in ('creation', 'modification', 'report', 'annulation', 'conflit_categorie')),
  avant jsonb,
  apres jsonb,
  resolu boolean not null default false,
  motif text,
  utilisateur uuid references auth.users(id),
  created_at timestamptz not null default now()
);

comment on table public.psp_ligne_historique is
  'Historique des changements d''une ligne PSP (delta JSONB, pattern travaux_commandes_historique).';

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. PSP_REPORTS — reports d'une ligne vers l'exercice suivant
-- ═══════════════════════════════════════════════════════════════════════════════
-- Un report conserve la relation source → cible (2026/ligne A/35 000 → 2027/ligne B).
-- La ligne cible porte origine='report' ; la référence source vit ici (jamais
-- orpheline). FK en NO ACTION : la suppression d'une ligne portant des reports
-- exige la suppression préalable des reports (gérée côté application, conforme
-- à la non-orphanité validée V5.1).
create table if not exists public.psp_reports (
  id uuid primary key default gen_random_uuid(),
  source_ligne_id uuid not null references public.psp_lignes(id),
  source_annee integer not null check (source_annee between 2000 and 2100),
  cible_ligne_id uuid not null references public.psp_lignes(id),
  cible_annee integer not null check (cible_annee between 2000 and 2100),
  montant numeric not null default 0 check (montant >= 0),
  motif text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

comment on table public.psp_reports is
  'Reports de lignes d''un exercice vers le suivant : relation source_ligne → cible_ligne.';

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. PSP_DEVIS — devis 1..N par ligne PSP
-- ═══════════════════════════════════════════════════════════════════════════════
-- Le devis alimente estimation / min / moyenne / max / écart budget–devis ;
-- il ne calcule JAMAIS le budget programmé (règle V6 §14).
-- fournisseur_id réutilise le référentiel fournisseurs existant (libellé repli).
create table if not exists public.psp_devis (
  id uuid primary key default gen_random_uuid(),
  psp_ligne_id uuid not null references public.psp_lignes(id) on delete cascade,
  fournisseur_id uuid references public.fournisseurs(id),
  entreprise text,
  date_devis date,
  montant numeric check (montant >= 0),
  statut text not null default 'a_demander'
    check (statut in ('a_demander', 'demande_envoyee', 'recu', 'a_analyser', 'retenu', 'non_retenu', 'expire', 'annule')),
  commentaire text,
  document_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.psp_devis is
  'Devis saisis pour une ligne PSP (1..N). N''alimente pas le budget programmé.';

-- ═══════════════════════════════════════════════════════════════════════════════
-- 6. PSP_COMMAND_LINKS — GÉNÉRALISATION (table existante, PAS de recréation)
-- ═══════════════════════════════════════════════════════════════════════════════
-- Ajout additif : psp_ligne_id (FK optionnelle) relie une ligne PSP à une commande
-- existante (travaux_commandes). Aucune colonne existante supprimée, aucune donnée
-- touchée. Les colonnes existantes (commande_id, import_row_id, type_relation,
-- methode, confiance, statut, justification, created_at, updated_at) sont conservées.
-- Le domaine type_relation est élargi (validé V5.1) : 'commande' (usage historique
-- du rapprochement source), 'rattachement_ligne' (ligne PSP ↔ commande),
-- 'rapprochement_historique' (rapprochement source commande ↔ psp_import_rows).
alter table public.psp_command_links
  add column if not exists psp_ligne_id uuid references public.psp_lignes(id) on delete set null;

comment on column public.psp_command_links.psp_ligne_id is
  'Ligne PSP rattachée (optionnelle) : relie psp_lignes → psp_command_links → travaux_commandes.';

-- Retire toute contrainte CHECK existante sur type_relation (nom quelconque),
-- puis recrée un domaine élargi. Idempotent : une table vide, aucune donnée perdue.
do $$
declare
  r record;
begin
  for r in
    select conname
    from pg_constraint
    where conrelid = 'public.psp_command_links'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%type_relation%'
  loop
    execute format('alter table public.psp_command_links drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.psp_command_links
  add constraint psp_command_links_type_relation_check
  check (type_relation in ('commande', 'rattachement_ligne', 'rapprochement_historique'));

-- ═══════════════════════════════════════════════════════════════════════════════
-- 7. PSP_DECISIONS — GÉNÉRALISATION (table existante, PAS de recréation)
-- ═══════════════════════════════════════════════════════════════════════════════
-- Ajouts additifs pour porter les arbitrages PSP : psp_ligne_id (ligne concernée),
-- annee_cible (exercice arbitré), montant (montant arbitré).
-- Le domaine type_decision est élargi aux arbitrages PSP :
--   existants : nature, corps_etat, perimetre_psp, rapprochement
--   ajoutés   : report, annulation, conservation, reevaluation, conflit_categorie
-- Aucune colonne existante supprimée (les colonnes existantes sont conservées).
alter table public.psp_decisions
  add column if not exists psp_ligne_id uuid references public.psp_lignes(id) on delete set null,
  add column if not exists annee_cible integer check (annee_cible between 2000 and 2100),
  add column if not exists montant numeric check (montant >= 0);

comment on column public.psp_decisions.psp_ligne_id is
  'Ligne PSP concernée par l''arbitrage (optionnelle — décisions métier existantes sans ligne).';
comment on column public.psp_decisions.annee_cible is
  'Exercice cible de l''arbitrage (ex. report 2026 → 2027).';
comment on column public.psp_decisions.montant is
  'Montant arbitré (optionnel).';

-- Retire toute contrainte CHECK existante sur type_decision puis recrée le domaine
-- élargi. La table est vide (vérifié) : aucune donnée perdue. Idempotent.
do $$
declare
  r record;
begin
  for r in
    select conname
    from pg_constraint
    where conrelid = 'public.psp_decisions'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%type_decision%'
  loop
    execute format('alter table public.psp_decisions drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.psp_decisions
  add constraint psp_decisions_type_decision_check
  check (type_decision in (
    'nature', 'corps_etat', 'perimetre_psp', 'rapprochement',
    'report', 'annulation', 'conservation', 'reevaluation', 'conflit_categorie'
  ));

-- ── 8. INDEX ───────────────────────────────────────────────────────────────────
-- Psp_lignes : accès par version + catégorie (KPIs) et ligne budgétaire.
create index if not exists psp_lignes_programmation_idx
  on public.psp_lignes (programmation_id);
create index if not exists psp_lignes_programmation_categorie_idx
  on public.psp_lignes (programmation_id, categorie);
create index if not exists psp_lignes_tranche_idx
  on public.psp_lignes (tranche_code);
create index if not exists psp_lignes_ligne_budget_idx
  on public.psp_lignes (ligne_budget);
-- Historique : parcours chronologique par ligne.
create index if not exists psp_ligne_historique_ligne_idx
  on public.psp_ligne_historique (ligne_id, created_at desc);
-- Reports : recherche source et cible.
create index if not exists psp_reports_source_idx
  on public.psp_reports (source_ligne_id);
create index if not exists psp_reports_cible_idx
  on public.psp_reports (cible_ligne_id);
-- Devis par ligne.
create index if not exists psp_devis_ligne_idx
  on public.psp_devis (psp_ligne_id);
-- Rattachement commandes (nouvelle colonne) et arbitrages (nouvelle colonne).
create index if not exists psp_command_links_ligne_idx
  on public.psp_command_links (psp_ligne_id);
create index if not exists psp_decisions_ligne_idx
  on public.psp_decisions (psp_ligne_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 9. TRIGGERS — gel des versions figées + updated_at + historique automatique
-- ═══════════════════════════════════════════════════════════════════════════════

-- 9.1 updated_at automatique (même modèle que les tables existantes)
create or replace function public.set_psp_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists psp_programmations_updated_at on public.psp_programmations;
create trigger psp_programmations_updated_at before update on public.psp_programmations
  for each row execute function public.set_psp_updated_at();

drop trigger if exists psp_lignes_updated_at on public.psp_lignes;
create trigger psp_lignes_updated_at before update on public.psp_lignes
  for each row execute function public.set_psp_updated_at();

drop trigger if exists psp_reports_updated_at on public.psp_reports;
create trigger psp_reports_updated_at before update on public.psp_reports
  for each row execute function public.set_psp_updated_at();

drop trigger if exists psp_devis_updated_at on public.psp_devis;
create trigger psp_devis_updated_at before update on public.psp_devis
  for each row execute function public.set_psp_updated_at();

-- 9.2 helpers de gel (réutilisés par les gardes ci-dessous)
create or replace function public.psp_programmation_est_figee(pid uuid)
returns boolean language sql stable as $$
  select exists (
    select 1 from public.psp_programmations p
    where p.id = pid and p.statut = 'figee'
  );
$$;

create or replace function public.psp_ligne_est_figee(ligne_id uuid)
returns boolean language sql stable as $$
  select exists (
    select 1 from public.psp_lignes l
    join public.psp_programmations p on p.id = l.programmation_id
    where l.id = ligne_id and p.statut = 'figee'
  );
$$;

-- 9.3 garde racine : une programmation figée ne peut être ni modifiée ni
-- supprimée ; la seule modification autorisée est un changement de statut
-- (ex. figee → archivee). Les imports annuels passent par des écritures
-- service_role : cette garde s'applique à TOUTES les voies, sans exception.
create or replace function public.prevent_update_if_figee()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.statut = 'figee' then
      raise exception 'Programmation figée : suppression interdite (id %)', old.id;
    end if;
    return old;
  end if;
  -- UPDATE
  if old.statut = 'figee' and new.statut = old.statut then
    raise exception 'Programmation figée : modification interdite (id %)', old.id;
  end if;
  return new;
end $$;

drop trigger if exists prevent_update_if_figee on public.psp_programmations;
create trigger prevent_update_if_figee before update or delete
  on public.psp_programmations
  for each row execute function public.prevent_update_if_figee();

-- 9.4 garde lignes : aucune création/modification/suppression de ligne
-- sur une programmation figée.
create or replace function public.prevent_psp_ligne_mutation_if_figee()
returns trigger language plpgsql as $$
declare
  pid uuid;
begin
  if tg_op = 'INSERT' then
    pid := new.programmation_id;
  else
    pid := old.programmation_id;
  end if;
  if public.psp_programmation_est_figee(pid) then
    raise exception 'Programmation figée : création/modification/suppression de ligne interdite (id %)', pid;
  end if;
  return new;
end $$;

drop trigger if exists prevent_psp_ligne_mutation_if_figee on public.psp_lignes;
create trigger prevent_psp_ligne_mutation_if_figee before insert or update or delete
  on public.psp_lignes
  for each row execute function public.prevent_psp_ligne_mutation_if_figee();

-- 9.5 garde devis : les devis d'une ligne figée ne peuvent pas être modifiés.
create or replace function public.prevent_psp_devis_mutation_if_figee()
returns trigger language plpgsql as $$
declare
  pid uuid;
begin
  if tg_op = 'INSERT' then
    pid := new.psp_ligne_id;
  else
    pid := old.psp_ligne_id;
  end if;
  if public.psp_ligne_est_figee(pid) then
    raise exception 'Programmation figée : création/modification/suppression de devis interdite (ligne %)', pid;
  end if;
  return new;
end $$;

drop trigger if exists prevent_psp_devis_mutation_if_figee on public.psp_devis;
create trigger prevent_psp_devis_mutation_if_figee before insert or update or delete
  on public.psp_devis
  for each row execute function public.prevent_psp_devis_mutation_if_figee();

-- 9.6 garde reports : les reports impliquant une ligne figée ne peuvent pas
-- être modifiés (source OU cible).
create or replace function public.prevent_psp_report_mutation_if_figee()
returns trigger language plpgsql as $$
declare
  src uuid;
  cible uuid;
begin
  if tg_op = 'INSERT' then
    src := new.source_ligne_id;
    cible := new.cible_ligne_id;
  else
    src := old.source_ligne_id;
    cible := old.cible_ligne_id;
  end if;
  if public.psp_ligne_est_figee(src) or public.psp_ligne_est_figee(cible) then
    raise exception 'Programmation figée : création/modification/suppression de report interdite';
  end if;
  return new;
end $$;

drop trigger if exists prevent_psp_report_mutation_if_figee on public.psp_reports;
create trigger prevent_psp_report_mutation_if_figee before insert or update or delete
  on public.psp_reports
  for each row execute function public.prevent_psp_report_mutation_if_figee();

-- 9.7 garde historique : l'historique d'une ligne figée est immuable.
create or replace function public.prevent_psp_historique_mutation_if_figee()
returns trigger language plpgsql as $$
declare
  pid uuid;
begin
  if tg_op = 'INSERT' then
    pid := new.ligne_id;
  else
    pid := old.ligne_id;
  end if;
  if public.psp_ligne_est_figee(pid) then
    raise exception 'Programmation figée : modification de l''historique interdite (ligne %)', pid;
  end if;
  return new;
end $$;

drop trigger if exists prevent_psp_historique_mutation_if_figee on public.psp_ligne_historique;
create trigger prevent_psp_historique_mutation_if_figee before insert or update or delete
  on public.psp_ligne_historique
  for each row execute function public.prevent_psp_historique_mutation_if_figee();

-- 9.8 historique automatique des lignes (delta JSONB, pattern validé) :
-- toute création/modification d'une ligne écrit une entrée dans
-- psp_ligne_historique (operation creation/modification, avant/apres, resolu=false).
create or replace function public.log_psp_ligne_history()
returns trigger language plpgsql as $$
declare
  avant_json jsonb;
  apres_json jsonb;
  operation_text text;
begin
  if tg_op = 'INSERT' then
    operation_text := 'creation';
    avant_json := null;
    apres_json := to_jsonb(new.*) - 'created_at' - 'updated_at';
  else
    operation_text := 'modification';
    avant_json := to_jsonb(old.*) - 'created_at' - 'updated_at';
    apres_json := to_jsonb(new.*) - 'created_at' - 'updated_at';
    if avant_json = apres_json then return new; end if;
  end if;
  insert into public.psp_ligne_historique (ligne_id, operation, avant, apres, resolu, utilisateur)
  values (new.id, operation_text, avant_json, apres_json, false, auth.uid());
  return new;
end $$;

drop trigger if exists psp_lignes_history on public.psp_lignes;
create trigger psp_lignes_history after insert or update
  on public.psp_lignes
  for each row execute function public.log_psp_ligne_history();

-- ═══════════════════════════════════════════════════════════════════════════════
-- 10. RLS & DROITS — pattern existant du projet (fournisseurs, commandes)
-- ═══════════════════════════════════════════════════════════════════════════════
--  · SELECT : authenticated (lecture) ;
--  · INSERT/UPDATE/DELETE : service_role UNIQUEMENT (server functions, BYPASS RLS)
--    → authenticated n'a AUCUN privilège d'écriture (REVOKE explicite) ;
--  · les écritures (validation, gel, report, arbitrage, devis) passent par les
--    server functions service_role ; le frontend n'expose jamais service_role.
alter table public.psp_programmations enable row level security;
alter table public.psp_lignes enable row level security;
alter table public.psp_ligne_historique enable row level security;
alter table public.psp_reports enable row level security;
alter table public.psp_devis enable row level security;

-- Policies RLS SELECT pour authenticated (création idempotente via pg_policies —
-- CREATE POLICY IF NOT EXISTS n'existe qu'à partir de PG15 ; ce bloc est valide
-- sur toutes les versions de PostgreSQL).
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'psp_programmations'
      and policyname = 'lecture programmations psp'
  ) then
    create policy "lecture programmations psp"
      on public.psp_programmations for select to authenticated using (true);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'psp_lignes'
      and policyname = 'lecture lignes psp'
  ) then
    create policy "lecture lignes psp"
      on public.psp_lignes for select to authenticated using (true);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'psp_ligne_historique'
      and policyname = 'lecture historique lignes psp'
  ) then
    create policy "lecture historique lignes psp"
      on public.psp_ligne_historique for select to authenticated using (true);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'psp_reports'
      and policyname = 'lecture reports psp'
  ) then
    create policy "lecture reports psp"
      on public.psp_reports for select to authenticated using (true);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'psp_devis'
      and policyname = 'lecture devis psp'
  ) then
    create policy "lecture devis psp"
      on public.psp_devis for select to authenticated using (true);
  end if;
end $$;

grant select on
  public.psp_programmations,
  public.psp_lignes,
  public.psp_ligne_historique,
  public.psp_reports,
  public.psp_devis
  to authenticated;

revoke insert, update, delete, truncate, references, trigger on
  public.psp_programmations,
  public.psp_lignes,
  public.psp_ligne_historique,
  public.psp_reports,
  public.psp_devis
  from authenticated;

grant all on
  public.psp_programmations,
  public.psp_lignes,
  public.psp_ligne_historique,
  public.psp_reports,
  public.psp_devis
  to service_role;

-- NB : psp_command_links et psp_decisions CONSERVENT leur RLS et leurs droits
-- existants (aucune modification — simple ajout de colonnes).

-- ═══════════════════════════════════════════════════════════════════════════════
-- 11. VÉRIFICATIONS POST-MIGRATION (à relancer après exécution)
-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. Tables :
--    select tablename from pg_tables
--    where schemaname = 'public'
--      and tablename in ('psp_programmations','psp_lignes','psp_ligne_historique',
--                        'psp_reports','psp_devis') order by tablename;
-- 2. Colonnes de psp_command_links / psp_decisions :
--    select table_name, column_name
--    from information_schema.columns
--    where table_schema = 'public'
--      and table_name in ('psp_command_links','psp_decisions')
--      and column_name in ('psp_ligne_id','annee_cible','montant') order by 1, 2;
-- 3. Contraintes :
--    select conrelid::regclass as table, conname, contype
--    from pg_constraint
--    where conrelid::regclass::text like 'public.psp_%' order by 1, 2;
-- 4. Index :
--    select tablename, indexname from pg_indexes
--    where schemaname = 'public' and tablename like 'psp_%' order by 1, 2;
-- 5. Triggers :
--    select event_object_table, trigger_name, action_timing, event_manipulation
--    from information_schema.triggers
--    where event_object_table like 'psp_%' order by 1, 2;
-- 6. RLS :
--    select tablename, rowsecurity from pg_tables
--    where schemaname = 'public' and tablename like 'psp_%' order by 1;
-- 7. Tests des gardes de gel (après création d'un brouillon test) :
--    update public.psp_programmations set statut = 'figee' where <brouillon>;
--    update public.psp_lignes set remarques = 'x' where <ligne>; -- → doit échouer
--    delete from public.psp_lignes where <ligne>;                -- → doit échouer
--    update public.psp_programmations set statut = 'archivee' where <brouillon>; -- → OK

-- ═══════════════════════════════════════════════════════════════════════════════
-- FIN DE LA MIGRATION V6 — préparation PSP persistante
-- ═══════════════════════════════════════════════════════════════════════════════