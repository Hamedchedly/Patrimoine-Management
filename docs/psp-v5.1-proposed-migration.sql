-- ═══════════════════════════════════════════════════════════════════════════════
-- PSP — MIGRATION PROPOSÉE (DOCUMENTAIRE — NE PAS EXÉCUTER)
--
-- V5.1 — Finalisation du modèle métier Préparation PSP.
-- Ce fichier est une PROPOSITION de migration Supabase. Il n'a PAS vocation à
-- être exécuté tel quel : il sera revu et validé avant toute écriture en base.
--
-- Contexte vérifié dans la base live (lecture seule, service role) :
--  · `psp_programmations` : ABSENTE (erreur PGRST205) → aucune table à ALTER/DROP,
--    la racine des versions PSP sera CRÉÉE.
--  · `psp_command_links` : EXISTE (vide) — liaison commande ↔ psp_import_rows
--    (rapprochement). On la GÉNÉRALISE pour y rattacher aussi les lignes PSP
--    (pas de nouvelle table `psp_ligne_commandes`).
--  · `psp_decisions` : EXISTE (vide) — couche de décisions humaines
--    (type_decision : nature, corps_etat, perimetre_psp, rapprochement).
--    On la GÉNÉRALISE pour porter les ARBITRAGES PSP (pas de `psp_arbitrages`).
--  · `psp_rules` : EXISTE (vide) — peut porter des règles PSP (ex. « conflit de
--    catégorie → validation humaine »).
--  · `travaux_commandes` / `fournisseurs` : références, JAMAIS dupliquées.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. PSP_PROGRAMMATIONS — racine des versions PSP (période 2027-2031)
-- ═══════════════════════════════════════════════════════════════════════════════
-- « type » sépare officielle / simulation ; « statut » pilote le cycle de vie.
-- `parent_id` relie une version/simulation à sa version d'origine (ex. V2 dérive de V1).
-- UNIQUE(annee_debut, version) : une seule version par période et par numéro.
create table if not exists public.psp_programmations (
  id uuid primary key default gen_random_uuid(),
  annee_debut integer not null check (annee_debut between 2000 and 2100),
  annee_fin integer not null check (annee_fin >= annee_debut),
  version integer not null check (version >= 1),
  type text not null default 'officielle' check (type in ('officielle', 'simulation')),
  statut text not null default 'brouillon'
    check (statut in ('brouillon', 'a_valider', 'validee', 'figee', 'archivee', 'simulation')),
  parent_id uuid references public.psp_programmations(id),
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
  'Racine des versions PSP : une programmation (période) a N versions ; '
  || 'une simulation est une version de type simulation, jamais officielle.';

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. PSP_LIGNES — lignes programmées d'une version
-- ═══════════════════════════════════════════════════════════════════════════════
-- Identité métier : TR + C (GE/GT/CP), UNIQUE au sein d'une version.
-- `programme` est un JSONB {"2027":35000,"2028":0,…} (Option A retenue) :
--  · cohérent avec le prototype (PspOperation.programme) et les fichiers
--    pluriannuels réels (années variables selon la période) ;
--  · aucune migration de colonnes si la période s'étend (2032…) ;
--  · le diff entre versions est trivial (jsonb) et les totaux annuels sont déjà
--    calculés côté application (server functions / frontend).
-- `ligne_budget` est acquise au PREMIER import du suivi annuel (jamais inventée).
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
  origine text not null default 'preparation'
    check (origine in ('preparation', 'report', 'esquisse', 'suivi')),
  remarques text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (programmation_id, tranche_code, categorie)
);

comment on column public.psp_lignes.programme is
  'Montants par année, ex. {"2027":35000,"2028":0,"2029":0,"2030":0,"2031":0}.';

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. PSP_LIGNE_HISTORIQUE — historique des lignes (pattern travaux_commandes_historique)
-- ═══════════════════════════════════════════════════════════════════════════════
-- Delta JSONB (avant/apres des champs modifiés) + operation + resolu + motif.
-- Réutilise le pattern existant (travaux_commandes_historique) : on ne crée PAS
-- un second système générique ; l'historique PSP est spécifique aux lignes PSP,
-- tandis que travaux_commandes_historique reste l'historique des commandes suivi.
create table if not exists public.psp_ligne_historique (
  id uuid primary key default gen_random_uuid(),
  ligne_id uuid not null references public.psp_lignes(id) on delete cascade,
  operation text not null
    check (operation in ('creation', 'modification', 'report', 'annulation', 'conflit_categorie')),
  avant jsonb,
  apres jsonb,
  resolu boolean not null default false,
  motif text,
  utilisateur uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. PSP_REPORTS — reports d'une ligne (2026 → 2027)
-- ═══════════════════════════════════════════════════════════════════════════════
-- Relation EXPLICITE source ↔ cible (jamais une opération orpheline).
-- La ligne cible vit dans une autre version (psp_lignes.programmation_id).
create table if not exists public.psp_reports (
  id uuid primary key default gen_random_uuid(),
  source_ligne_id uuid not null references public.psp_lignes(id),
  source_annee integer not null,
  cible_ligne_id uuid not null references public.psp_lignes(id),
  cible_annee integer not null,
  montant numeric not null check (montant >= 0),
  motif text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. PSP_DEVIS — devis d'une ligne (1..N)
-- ═══════════════════════════════════════════════════════════════════════════════
-- fournisseur_id référencé si le référentiel existe ; `entreprise` (libellé) en
-- repli tant que le fournisseur n'est pas référencé. Montant programmé ≠ devis.
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

-- ═══════════════════════════════════════════════════════════════════════════════
-- 6. GÉNÉRALISATION DE PSP_COMMAND_LINKS — liaison commandes (PAS de psp_ligne_commandes)
-- ═══════════════════════════════════════════════════════════════════════════════
-- La table EXISTANTE relie déjà travaux_commandes ↔ psp_import_rows (rapprochement
-- source, alimente v_travaux_commandes_enrichies). On l'étend (FK optionnelle
-- `psp_ligne_id`) pour exprimer « cette commande est rattachée à cette ligne PSP ».
-- Le détail des commandes reste dans travaux_commandes : aucune duplication.
-- → `psp_ligne_commandes` n'est PAS créée.
alter table public.psp_command_links
  add column if not exists psp_ligne_id uuid references public.psp_lignes(id);

alter table public.psp_command_links
  drop constraint if exists psp_command_links_type_relation_check;
alter table public.psp_command_links
  add constraint psp_command_links_type_relation_check
  check (type_relation in ('commande', 'rattachement_ligne', 'rapprochement_historique'));

-- ═══════════════════════════════════════════════════════════════════════════════
-- 7. GÉNÉRALISATION DE PSP_DECISIONS — arbitrages PSP (PAS de psp_arbitrages)
-- ═══════════════════════════════════════════════════════════════════════════════
-- La couche de décisions existante est étendue pour porter les arbitrages des
-- lignes PSP (report / annulation / conservation / réévaluation / conflit de
-- catégorie). `cle_metier` = "TR|C" pour les arbitrages de ligne ; les colonnes
-- ajoutées (psp_ligne_id, annee_cible, montant) restent NULL pour les décisions
-- existantes (nature / corps_etat / perimetre_psp / rapprochement).
-- → `psp_arbitrages` n'est PAS créée.
alter table public.psp_decisions
  add column if not exists psp_ligne_id uuid references public.psp_lignes(id);
alter table public.psp_decisions
  add column if not exists annee_cible integer;
alter table public.psp_decisions
  add column if not exists montant numeric;

-- Étendre le domaine type_decision aux arbitrages PSP (si une contrainte existe).
-- alter table public.psp_decisions
--   drop constraint if exists psp_decisions_type_decision_check;
-- alter table public.psp_decisions
--   add constraint psp_decisions_type_decision_check
--   check (type_decision in
--     ('nature', 'corps_etat', 'perimetre_psp', 'rapprochement',
--      'report', 'annulation', 'conservation', 'reevaluation', 'conflit_categorie'));


-- ═══════════════════════════════════════════════════════════════════════════════
-- 8. INDEX PROPOSÉS
-- ═══════════════════════════════════════════════════════════════════════════════
-- create index if not exists psp_lignes_programmation_idx
--   on public.psp_lignes(programmation_id, tranche_code);
-- create index if not exists psp_lignes_ligne_budget_idx
--   on public.psp_lignes(ligne_budget);
-- create index if not exists psp_ligne_historique_ligne_idx
--   on public.psp_ligne_historique(ligne_id, created_at desc);
-- create index if not exists psp_reports_source_idx
--   on public.psp_reports(source_ligne_id);
-- create index if not exists psp_reports_cible_idx
--   on public.psp_reports(cible_ligne_id);
-- create index if not exists psp_devis_ligne_idx
--   on public.psp_devis(psp_ligne_id);
-- create index if not exists psp_command_links_ligne_idx
--   on public.psp_command_links(psp_ligne_id);
-- create index if not exists psp_decisions_ligne_idx
--   on public.psp_decisions(psp_ligne_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 9. TRIGGERS PROPOSÉS (NON CRÉÉS)
-- ═══════════════════════════════════════════════════════════════════════════════
-- Garde de gel : une version figée (ou sa simulation associée) ne peut plus être
-- modifiée. À valider selon les transitions officielles (validee → figee).
-- create or replace function public.prevent_update_if_figee()
-- returns trigger language plpgsql as $$
-- begin
--   if tg_op = 'DELETE' or new.statut <> old.statut then return new; end if;
--   if old.statut = 'figee' then
--     raise exception 'Programmation figée : modification interdite (id %)', old.id;
--   end if;
--   return new;
-- end $$;
-- drop trigger if exists prevent_update_if_figee on public.psp_programmations;
-- create trigger prevent_update_if_figee before update or delete
--   on public.psp_programmations
--   for each row execute function public.prevent_update_if_figee();

-- Mise à jour automatique de updated_at (pattern existant).
-- create or replace function public.set_psp_updated_at()
-- returns trigger language plpgsql as $$
-- begin new.updated_at = now(); return new; end $$;
-- drop trigger if exists psp_lignes_updated_at on public.psp_lignes;
-- create trigger psp_lignes_updated_at before update on public.psp_lignes
--   for each row execute function public.set_psp_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════════
-- 10. RLS PROPOSÉES (NON CRÉÉES)
-- ═══════════════════════════════════════════════════════════════════════════════
-- Pattern retenu (conforme aux conventions existantes : fournisseurs, commandes) :
--  · SELECT : authenticated (lecture)
--  · INSERT/UPDATE/DELETE : service_role UNIQUEMENT (server functions, BYPASS RLS)
--    → authenticated n'a AUCUN privilège d'écriture (REVOKE explicite).
-- Les écritures (validation, gel, report, arbitrage, devis) passent par des
-- server functions service_role ; les transitions de statut (validee → figee)
-- sont contrôlées côté serveur.
-- alter table public.psp_programmations enable row level security;
-- create policy "lecture programmations psp" on public.psp_programmations
--   for select to authenticated using (true);
-- revoke insert, update, delete, truncate, references, trigger
--   on public.psp_programmations from authenticated;
-- grant all on public.psp_programmations to service_role;
-- (mêmes règles : psp_lignes, psp_ligne_historique, psp_reports, psp_devis ;
--  psp_command_links, psp_decisions : conserver le modèle existant + étendre.)

-- ═══════════════════════════════════════════════════════════════════════════════
-- FIN DE LA PROPOSITION — À VALIDER AVANT TOUTE EXÉCUTION.
-- ═══════════════════════════════════════════════════════════════════════════════

