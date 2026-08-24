-- ═══════════════════════════════════════════════════════════════════════════════
-- PSP V8.4 — RELANCES DEVIS + SUIVI CONSULTATION (migration ADDITIVE)
--
-- Objectif :
--   · `psp_devis.date_limite_reponse` : date limite de réponse EXPLICITE
--     (facultative). La logique `dateLimiteReponse` (socle V8.1) la lit déjà ;
--     à défaut, la date par défaut (created_at + 21 j) reste utilisée.
--   · `psp_devis.derniere_relance_at` : date de la DERNIÈRE relance envoyée
--     (distincte de la date de première demande = created_at). V8.4 §10.
--   · `psp_ligne_historique.operation` accepte 'relance' : la server function
--     `enregistrerRelanceDevis` historise chaque relance dans la table EXISTANTE
--     (aucune table d'historique parallèle — V8.4 §11).
--
-- Aucune donnée existante modifiée, aucune table créée/supprimée, aucune FK
-- cassée. Tables import/exécution INTANGIBLES (travaux_commandes, psp_import_rows,
-- import_travaux, …). Rollback documenté en fin de fichier.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. psp_devis.date_limite_reponse (date de retour souhaitée, optionnelle) ──
alter table public.psp_devis
  add column if not exists date_limite_reponse date;

comment on column public.psp_devis.date_limite_reponse is
  'Date limite de réponse souhaitée (optionnelle). À défaut : created_at + 21 jours (V8.4).';

-- ── 2. psp_devis.derniere_relance_at (date de la dernière relance envoyée) ────
alter table public.psp_devis
  add column if not exists derniere_relance_at timestamptz;

comment on column public.psp_devis.derniere_relance_at is
  'Date de la dernière relance envoyée (distincte de created_at = première demande, V8.4).';

-- ── 3. psp_ligne_historique.operation : élargir le CHECK à 'relance' ──────────
alter table public.psp_ligne_historique
  drop constraint if exists psp_ligne_historique_operation_check;

alter table public.psp_ligne_historique
  add constraint psp_ligne_historique_operation_check
  check (operation in ('creation', 'modification', 'report', 'annulation', 'conflit_categorie', 'relance'));

-- ── Vérifications ─────────────────────────────────────────────────────────────
-- select column_name, is_nullable from information_schema.columns
--  where table_schema='public' and table_name='psp_devis'
--    and column_name in ('date_limite_reponse','derniere_relance_at');
-- select pg_get_constraintdef(oid) from pg_constraint
--  where conrelid = 'public.psp_ligne_historique'::regclass and contype='c';

-- ═══════════════════════════════════════════════════════════════════════════════
-- ROLLBACK (si nécessaire) :
--   1) retirer les colonnes ajoutées :
--      alter table public.psp_devis drop column date_limite_reponse;
--      alter table public.psp_devis drop column derniere_relance_at;
--   2) restaurer le CHECK précédent :
--      alter table public.psp_ligne_historique drop constraint psp_ligne_historique_operation_check;
--      alter table public.psp_ligne_historique add constraint psp_ligne_historique_operation_check
--        check (operation in ('creation','modification','report','annulation','conflit_categorie'));
-- ═══════════════════════════════════════════════════════════════════════════════
