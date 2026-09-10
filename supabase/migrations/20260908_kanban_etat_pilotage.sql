-- V8.23 — Forçage manuel de l'étape (Kanban / Pilotage) : psp_lignes.etat_pilotage.
-- À APPLIQUER par l'utilisateur dans l'éditeur SQL Supabase.
-- Colonne additive portant l'« état de pilotage » manuel choisi par l'utilisateur
-- (distinct de l'état réel dérivé des devis/commandes). Valeurs libres ; l'app
-- borne à un vocabulaire (ETAT_PILOTAGE_LABELS) et l'UI du Kanban la lit pour
-- forcer la colonne d'une carte.
alter table public.psp_lignes add column if not exists etat_pilotage text;

comment on column public.psp_lignes.etat_pilotage is
  'État de pilotage manuel (forçage Kanban / fiche) — distinct de l''état réel dérivé.';
