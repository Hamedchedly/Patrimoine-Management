-- V8.16r — Délai de réponse souhaité (jours) par modèle de mail.
-- Défaut 7 (une semaine) — éditable dans l'éditeur « Modèles de mail » (/suivi).
alter table public.mail_modeles
  add column if not exists delai_jours integer not null default 7;

-- Service role (supabaseAdmin) utilisé par les server functions : RLS non requis.
-- À appliquer dans le SQL editor Supabase (pas de CLI disponible).
