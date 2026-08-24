-- ═══════════════════════════════════════════════════════════════════════════
-- PSP — Modèle aligné sur l'export ISIS réel (Liste_COMD_TRAV_ER)
-- ⚠️ MIGRATION NON APPLIQUÉE à Supabase DEV tant qu'elle n'est pas validée.
-- Tables concernées : psp_import_rows et psp_command_analysis UNIQUEMENT.
-- Aucune table PAT S11 n'est modifiée (tranches, lots, travaux_commandes,
-- travaux_commandes_historique, import_travaux).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1) psp_import_rows : colonnes sources ISIS (toutes NULLABLE) ────────────
-- Une ligne Excel = un COMN_NUM. COMC_NOLIG (numero_commande) reste nullable
-- et NON unique. L'unicité d'une ligne d'import reste (import_id, ligne_numero) :
-- PAS de UNIQUE sur numero_commande_interne (une même commande peut apparaître
-- dans plusieurs imports).
ALTER TABLE psp_import_rows
  ADD COLUMN IF NOT EXISTS numero_commande_interne text,
  ADD COLUMN IF NOT EXISTS patrimoine text,
  ADD COLUMN IF NOT EXISTS secteur text,
  ADD COLUMN IF NOT EXISTS date_commande text,
  ADD COLUMN IF NOT EXISTS etat text,
  ADD COLUMN IF NOT EXISTS montant_budget numeric,
  ADD COLUMN IF NOT EXISTS montant_ecart numeric,
  ADD COLUMN IF NOT EXISTS fournisseur text,
  ADD COLUMN IF NOT EXISTS adresse text,
  ADD COLUMN IF NOT EXISTS commune text,
  ADD COLUMN IF NOT EXISTS batiment_num text,
  ADD COLUMN IF NOT EXISTS entree_num text;

-- ── 2) psp_command_analysis : ancrage sur COMN_NUM + catégorie budgétaire ───
ALTER TABLE psp_command_analysis
  ADD COLUMN IF NOT EXISTS numero_commande_interne text,
  ADD COLUMN IF NOT EXISTS import_row_id uuid REFERENCES psp_import_rows(id),
  ADD COLUMN IF NOT EXISTS categorie_budget text,
  ADD COLUMN IF NOT EXISTS categorie_budget_statut text;

-- ── 3) Remplacer UNIQUE(numero_commande) par UNIQUE(numero_commande_interne) ─
-- COMC_NOLIG est nullable et non unique ; COMN_NUM est l'identifiant source
-- stable. Le nom de contrainte par défaut est
-- « psp_command_analysis_numero_commande_key ».
ALTER TABLE psp_command_analysis
  DROP CONSTRAINT IF EXISTS psp_command_analysis_numero_commande_key;
ALTER TABLE psp_command_analysis
  ADD CONSTRAINT psp_command_analysis_numero_commande_interne_key
  UNIQUE (numero_commande_interne);

-- ── 4) Index utiles ─────────────────────────────────────────────────────────
-- Retrouver les lignes d'un COMN_NUM / d'un import.
CREATE INDEX IF NOT EXISTS psp_import_rows_numero_commande_interne_idx
  ON psp_import_rows (numero_commande_interne);
CREATE INDEX IF NOT EXISTS psp_import_rows_import_numero_interne_idx
  ON psp_import_rows (import_id, numero_commande_interne);
-- Accéder à l'analyse par ligne source / par n° lisible.
CREATE INDEX IF NOT EXISTS psp_command_analysis_import_row_id_idx
  ON psp_command_analysis (import_row_id);
CREATE INDEX IF NOT EXISTS psp_command_analysis_numero_commande_idx
  ON psp_command_analysis (numero_commande);
