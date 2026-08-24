-- ═══════════════════════════════════════════════════════════════════════════════
-- V8.8 §9 — STATUT DE PILOTAGE MANUEL (etat_pilotage) — MIGRATION ADDITIVE.
-- À EXÉCUTER MANUELLEMENT dans le SQL Editor Supabase APRÈS validation.
-- NE PAS l'appliquer automatiquement par le code.
-- ═══════════════════════════════════════════════════════════════════════════════
-- Règles :
--  · strictement ADDITIF : aucune table créée, aucune contrainte modifiée ;
--  · ne remplace JAMAIS l'état réel dérivé (deriverEtatSuiviAnnuel) ni l'état
--    importé (travaux_commandes) ;
--  · ne touche pas psp_lignes.statut (workflow de préparation PSP) ;
--  · valeurs bornées par un CHECK — aucune valeur inventée.
alter table public.psp_lignes
  add column if not exists etat_pilotage text;

comment on column public.psp_lignes.etat_pilotage is
  'V8.8 — État de pilotage manuel du gestionnaire, DISTINCT de l''état réel '
  'dérivé (payé/engagé) et de l''état importé (travaux_commandes). '
  'Aucun remplacement des états automatiques.';

alter table public.psp_lignes
  add constraint psp_lignes_etat_pilotage_check
  check (
    etat_pilotage is null
    or etat_pilotage in (
      'a_traiter',
      'devis_a_demander',
      'devis_demande',
      'devis_recu',
      'commande_a_passer',
      'en_cours',
      'bloquee',
      'prioritaire',
      'a_cloturer'
    )
  );
