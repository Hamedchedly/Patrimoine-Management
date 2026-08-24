-- ═══════════════════════════════════════════════════════════════════════════════
-- ROLLBACK V6 — ANNULATION DE LA MIGRATION PSP PREPARATION PERSISTANTE
--
-- À n'exécuter QUE si la migration 20260815_psp_preparation_persistance.sql
-- doit être annulée. Aucune donnée préexistante n'est perdue :
--   · les 5 tables créées sont nouvelles (aucune donnée antérieure) ;
--   · les colonnes ajoutées à psp_command_links / psp_decisions sont optionnelles.
--
-- Ordre d'exécution :
--   1. suppression des triggers et fonctions créés par la migration ;
--   2. DROP des colonnes ajoutées (additif — données existantes préservées) ;
--   3. désactivation RLS + suppression des politiques créées ;
--   4. DROP des 5 tables créées (commenté par défaut : à décommenter si besoin).
--
-- NB : les contraintes CHECK d'origine de type_relation / type_decision (si elles
-- existaient hors repo) ne sont pas restaurables depuis ce dépôt ; la migration
-- avait retiré toute CHECK existante sur ces colonnes. Après rollback, ces colonnes
-- redeviennent non contraintes (ou recréez la contrainte d'origine souhaitée).
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. Triggers ────────────────────────────────────────────────────────────────
drop trigger if exists psp_lignes_history on public.psp_lignes;
drop trigger if exists psp_lignes_updated_at on public.psp_lignes;
drop trigger if exists psp_devis_updated_at on public.psp_devis;
drop trigger if exists psp_reports_updated_at on public.psp_reports;
drop trigger if exists psp_programmations_updated_at on public.psp_programmations;
drop trigger if exists prevent_update_if_figee on public.psp_programmations;
drop trigger if exists prevent_psp_ligne_mutation_if_figee on public.psp_lignes;
drop trigger if exists prevent_psp_devis_mutation_if_figee on public.psp_devis;
drop trigger if exists prevent_psp_report_mutation_if_figee on public.psp_reports;
drop trigger if exists prevent_psp_historique_mutation_if_figee on public.psp_ligne_historique;

-- ── 2. Fonctions créées par la migration ───────────────────────────────────────
drop function if exists public.log_psp_ligne_history();
drop function if exists public.prevent_update_if_figee();
drop function if exists public.prevent_psp_ligne_mutation_if_figee();
drop function if exists public.prevent_psp_devis_mutation_if_figee();
drop function if exists public.prevent_psp_report_mutation_if_figee();
drop function if exists public.prevent_psp_historique_mutation_if_figee();
drop function if exists public.set_psp_updated_at();
drop function if exists public.psp_programmation_est_figee(uuid);
drop function if exists public.psp_ligne_est_figee(uuid);

-- ── 3. Colonnes ajoutées aux tables existantes (aucune donnée perdue) ──────────
alter table public.psp_command_links
  drop column if exists psp_ligne_id;
alter table public.psp_decisions
  drop column if exists psp_ligne_id,
  drop column if exists annee_cible,
  drop column if exists montant;

-- ── 4. Domaines CHECK ajoutés (restauration à l'état non contraint) ────────────
alter table public.psp_command_links
  drop constraint if exists psp_command_links_type_relation_check;
alter table public.psp_decisions
  drop constraint if exists psp_decisions_type_decision_check;

-- ── 5. RLS et politiques créées sur les 5 nouvelles tables ─────────────────────
drop policy if exists "lecture devis psp" on public.psp_devis;
drop policy if exists "lecture reports psp" on public.psp_reports;
drop policy if exists "lecture historique lignes psp" on public.psp_ligne_historique;
drop policy if exists "lecture lignes psp" on public.psp_lignes;
drop policy if exists "lecture programmations psp" on public.psp_programmations;

alter table public.psp_devis disable row level security;
alter table public.psp_reports disable row level security;
alter table public.psp_ligne_historique disable row level security;
alter table public.psp_lignes disable row level security;
alter table public.psp_programmations disable row level security;

-- ── 6. DROP des 5 tables créées (uniquement si aucune donnée PSP à conserver) ──
-- drop table if exists public.psp_devis;
-- drop table if exists public.psp_reports;
-- drop table if exists public.psp_ligne_historique;
-- drop table if exists public.psp_lignes;
-- drop table if exists public.psp_programmations;

-- ═══════════════════════════════════════════════════════════════════════════════
-- FIN DU ROLLBACK V6
-- ═══════════════════════════════════════════════════════════════════════════════