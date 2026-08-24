-- ═══════════════════════════════════════════════════════════════════════════════
-- HOTFIX V6 — CORRECTION DES TRIGGERS DE GARDE (DELETE silencieusement ignoré)
--
-- ⚠️ DÉCOUVERT PAR L'AUDIT LIVE post-migration (test-psp-supabase.mjs) :
--   les gardes `prevent_psp_*_mutation_if_figee` faisaient `return new;` sur
--   DELETE. Or en PostgreSQL, dans un trigger BEFORE DELETE, `NEW` est NULL et
--   un retour NULL ANNULE SILENCIEUSEMENT la suppression de la ligne.
--
--   Conséquences constatées en live :
--    · DELETE d'une ligne/devis/report/historique d'une programmation NON figée
--      → opération silencieusement ignorée (0 ligne supprimée, aucune erreur) ;
--    · DELETE d'une programmation (cascade) → les enfants survivent en orphelins
--      (FK violée silencieusement contournée par le retour NULL) ;
--    · le test « suppression ligne (brouillon) » passait à tort.
--
-- Correction : retourner `old` sur DELETE (comportement correct : poursuivre la
-- suppression) tout en conservant le gel (exception sur programmation figée).
--
-- Aucune table modifiée, aucune donnée modifiée, aucune contrainte supprimée.
-- Idempotent (CREATE OR REPLACE FUNCTION).
--
-- À exécuter dans Supabase SQL Editor APRÈS la migration principale
-- 20260815_psp_preparation_persistance.sql (déjà appliquée).
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. Garde lignes : DELETE → return old ──────────────────────────────────────
create or replace function public.prevent_psp_ligne_mutation_if_figee()
returns trigger language plpgsql as $$
declare
  pid uuid;
begin
  if tg_op = 'DELETE' then
    pid := old.programmation_id;
    if public.psp_programmation_est_figee(pid) then
      raise exception 'Programmation figée : suppression de ligne interdite (id %)', pid;
    end if;
    return old;
  end if;
  -- INSERT / UPDATE
  if tg_op = 'INSERT' then
    pid := new.programmation_id;
  else
    pid := old.programmation_id;
  end if;
  if public.psp_programmation_est_figee(pid) then
    raise exception 'Programmation figée : création/modification de ligne interdite (id %)', pid;
  end if;
  return new;
end $$;

-- ── 2. Garde devis : DELETE → return old ───────────────────────────────────────
create or replace function public.prevent_psp_devis_mutation_if_figee()
returns trigger language plpgsql as $$
declare
  pid uuid;
begin
  if tg_op = 'DELETE' then
    pid := old.psp_ligne_id;
    if public.psp_ligne_est_figee(pid) then
      raise exception 'Programmation figée : suppression de devis interdite (ligne %)', pid;
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    pid := new.psp_ligne_id;
  else
    pid := old.psp_ligne_id;
  end if;
  if public.psp_ligne_est_figee(pid) then
    raise exception 'Programmation figée : création/modification de devis interdite (ligne %)', pid;
  end if;
  return new;
end $$;

-- ── 3. Garde reports : DELETE → return old ─────────────────────────────────────
create or replace function public.prevent_psp_report_mutation_if_figee()
returns trigger language plpgsql as $$
declare
  src uuid;
  cible uuid;
begin
  if tg_op = 'DELETE' then
    src := old.source_ligne_id;
    cible := old.cible_ligne_id;
    if public.psp_ligne_est_figee(src) or public.psp_ligne_est_figee(cible) then
      raise exception 'Programmation figée : suppression de report interdite';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    src := new.source_ligne_id;
    cible := new.cible_ligne_id;
  else
    src := old.source_ligne_id;
    cible := old.cible_ligne_id;
  end if;
  if public.psp_ligne_est_figee(src) or public.psp_ligne_est_figee(cible) then
    raise exception 'Programmation figée : création/modification de report interdite';
  end if;
  return new;
end $$;

-- ── 4. Garde historique : DELETE → return old ──────────────────────────────────
create or replace function public.prevent_psp_historique_mutation_if_figee()
returns trigger language plpgsql as $$
declare
  pid uuid;
begin
  if tg_op = 'DELETE' then
    pid := old.ligne_id;
    if public.psp_ligne_est_figee(pid) then
      raise exception 'Programmation figée : suppression de l''historique interdite (ligne %)', pid;
    end if;
    return old;
  end if;
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

-- ═══════════════════════════════════════════════════════════════════════════════
-- VÉRIFICATION POST-FIX (dans le SQL Editor) :
--   · create or replace function public.prevent_psp_ligne_mutation_if_figee() → OK ;
--   · après création d'une programmation brouillon + ligne :
--       delete from public.psp_lignes where id = '<ligne>';      → 1 ligne supprimée ;
--       delete from public.psp_programmations where id = '<prog>'; → cascade OK (0 orphelin).
--   · sur une programmation figée, le même DELETE doit lever l'exception.
-- ═══════════════════════════════════════════════════════════════════════════════
-- FIN DU HOTFIX V6
-- ═══════════════════════════════════════════════════════════════════════════════