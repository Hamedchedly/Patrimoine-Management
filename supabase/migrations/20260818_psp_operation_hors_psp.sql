-- ═══════════════════════════════════════════════════════════════════════════════
-- PSP V8.3 — OPÉRATIONS HORS PSP (migration ADDITIVE)
--
-- Objectif : permettre une opération hors programmation PSP :
--   · `psp_lignes.origine` accepte 'hors_psp' (CHECK étendu) ;
--   · `psp_lignes.programmation_id` devient NULLABLE (une opération hors PSP
--     n'appartient à aucune programmation).
--
-- Aucune donnée existante modifiée, aucune table créée/supprimée, aucune FK
-- cassée. Tables import/exécution INTANGIBLES (travaux_commandes, psp_import_rows,
-- import_travaux, …). Rollback documenté en fin de fichier.
--
-- Exécution : Supabase SQL Editor (ou `supabase db query --linked`).
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. CHECK `origine` étendu à 'hors_psp' ────────────────────────────────────
-- Le nom de la contrainte est réel : `psp_lignes_origine_check` (vérifié en live).
alter table public.psp_lignes
  drop constraint if exists psp_lignes_origine_check;

alter table public.psp_lignes
  add constraint psp_lignes_origine_check
  check (origine in ('preparation', 'report', 'esquisse', 'suivi', 'hors_psp'));

comment on column public.psp_lignes.origine is
  'Origine d''une opération : preparation | report | esquisse | suivi | hors_psp (V8.3).';

-- ── 2. `programmation_id` NULLABLE (hors PSP) ─────────────────────────────────
alter table public.psp_lignes
  alter column programmation_id drop not null;

comment on column public.psp_lignes.programmation_id is
  'Programmation de rattachement (NULL pour une opération HORS PSP, V8.3).';

-- ── Vérifications ─────────────────────────────────────────────────────────────
-- select pg_get_constraintdef(oid) from pg_constraint
--  where conrelid = 'public.psp_lignes'::regclass and contype = 'c';
-- select is_nullable from information_schema.columns
--  where table_schema='public' and table_name='psp_lignes'
--    and column_name='programmation_id';

-- ═══════════════════════════════════════════════════════════════════════════════
-- ROLLBACK (si nécessaire) :
--   1) restaurer le CHECK précédent :
--      alter table public.psp_lignes drop constraint psp_lignes_origine_check;
--      alter table public.psp_lignes add constraint psp_lignes_origine_check
--        check (origine in ('preparation','report','esquisse','suivi'));
--   2) revenir à programmation_id NOT NULL (SEULEMENT si aucune ligne NULL) :
--      alter table public.psp_lignes alter column programmation_id set not null;
-- ═══════════════════════════════════════════════════════════════════════════════
