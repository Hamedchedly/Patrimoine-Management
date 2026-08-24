-- ─────────────────────────────────────────────────────────────────────────────
-- PSP V8.13 — Distinguer « lignes sans n° de commande » des erreurs réelles
-- ─────────────────────────────────────────────────────────────────────────────
-- Contexte :
--   Le moteur d'import sépare désormais les lignes sans n° de commande
--   (`type = 'sans_commande'`) des véritables lignes erronées (`type = 'erreur'`).
--   La contrainte CHECK actuelle de `travaux_import_details.type` ne connaît pas
--   la valeur `sans_commande` → on l'étend sans retirer les valeurs existantes.
--
--  → Exécuter ce fichier dans l'éditeur SQL de Supabase (dashboard → SQL editor)
--    puis, si des lignes ont déjà été importées avec l'ancien modèle :
--      update public.travaux_import_details
--         set type = 'sans_commande'
--       where message = 'Numéro de commande manquant'
--         and type = 'erreur';
--
-- ── 1. Retirer l'ancien CHECK ─────────────────────────────────────────────────
alter table public.travaux_import_details
  drop constraint if exists travaux_import_details_type_check;

-- ── 2. Recréer le CHECK avec la nouvelle valeur ───────────────────────────────
alter table public.travaux_import_details
  add constraint travaux_import_details_type_check
  check (
    type in (
      'creee',
      'conflit',
      'inchangee',
      'archivee',
      'doublon',
      'ignoree',
      'erreur',
      'report',
      'sans_commande'
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (si besoin) :
--   alter table public.travaux_import_details drop constraint if exists
--     travaux_import_details_type_check;
--   alter table public.travaux_import_details add constraint
--     travaux_import_details_type_check
--     check (type in ('creee', 'conflit', 'inchangee', 'archivee', 'doublon',
--       'ignoree', 'erreur', 'report'));
-- ─────────────────────────────────────────────────────────────────────────────
