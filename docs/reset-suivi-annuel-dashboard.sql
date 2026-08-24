-- ═══════════════════════════════════════════════════════════════════════════════
-- SUPPRESSION DES DONNÉES DU SUIVI ANNUEL / DASHBOARD TRAVAUX
-- ⚠️ DESTRUCTIF — à exécuter dans l'éditeur SQL de Supabase
--    (Dashboard → SQL Editor → Run). Irréversible.
-- ⚠️ Faire une sauvegarde AVANT : node --env-file=.env scripts/backup-db.mjs
--
-- Périmètre (identique au reset validé de scripts/reimport-anm-2026.mjs --reset) :
--   SUPPRIMÉ   : travaux_commandes (toutes années), import_travaux,
--                travaux_import_details, travaux_commandes_historique,
--                psp_command_links,
--                psp_lignes ANNUELLES (programmation_id IS NULL : origine
--                'suivi' / 'hors_psp') + leurs psp_ligne_patrimoine, psp_devis,
--                psp_reports, psp_decisions (et historique via ON DELETE CASCADE) ;
--   PRÉSERVÉ   : psp_programmations + psp_lignes de PRÉPARATION
--                (programmation_id NOT NULL), fournisseurs, patrimoine
--                (tranches/lots/adresses), psp_enveloppes, référentiels.
-- ═══════════════════════════════════════════════════════════════════════════════

begin;

-- ── 1. Enfants directs des commandes / imports (détails, historique, liens) ──
delete from public.travaux_import_details;
delete from public.travaux_commandes_historique;
delete from public.psp_command_links;

-- ── 2. Dépendances des lignes PSP annuelles (programmation_id IS NULL) ───────
delete from public.psp_ligne_patrimoine
where psp_ligne_id in (select id from public.psp_lignes where programmation_id is null);

delete from public.psp_devis
where psp_ligne_id in (select id from public.psp_lignes where programmation_id is null);

delete from public.psp_reports
where source_ligne_id in (select id from public.psp_lignes where programmation_id is null)
   or cible_ligne_id in (select id from public.psp_lignes where programmation_id is null);

delete from public.psp_decisions
where psp_ligne_id in (select id from public.psp_lignes where programmation_id is null);

-- psp_ligne_historique des lignes annuelles : purgé automatiquement
-- (ON DELETE CASCADE de psp_lignes.ligne_id).

-- ── 3. Lignes PSP ANNUELLES (suivi / hors PSP) — la préparation est préservée ─
delete from public.psp_lignes where programmation_id is null;

-- ── 4. Commandes de travaux (toutes années) puis imports ─────────────────────
delete from public.travaux_commandes;
delete from public.import_travaux;

-- ── Vérification (les 5 compteurs ci-dessous doivent être à 0) ───────────────
select 'travaux_commandes'          as table_name, count(*) from public.travaux_commandes
union all select 'import_travaux'   , count(*) from public.import_travaux
union all select 'travaux_import_details', count(*) from public.travaux_import_details
union all select 'travaux_commandes_historique', count(*) from public.travaux_commandes_historique
union all select 'psp_lignes annuelles', count(*) from public.psp_lignes where programmation_id is null;

-- ═══════════════════════════════════════════════════════════════════════════════
-- ROLLBACK si problème (avant de commit) :  rollback;
-- Après vérification, le commit est implicite à la fin du script dans l'éditeur.
-- ═══════════════════════════════════════════════════════════════════════════════
