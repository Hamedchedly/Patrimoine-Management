-- V8.18 — ÉTIQUETTE (mode d'acquisition / nature) sur les tranches.
-- Libre avec suggestions : VEFA, RACHAT, USUFRUIT, BAIL À CONSTRUIRE…
-- À APPLIQUER par l'utilisateur dans l'éditeur SQL Supabase (comme les autres migrations).
alter table public.tranches
  add column if not exists etiquette text;

comment on column public.tranches.etiquette is
  'Étiquette libre (VEFA, RACHAT, USUFRUIT, BAIL À CONSTRUIRE…) pour comprendre le statut d''une tranche.';
