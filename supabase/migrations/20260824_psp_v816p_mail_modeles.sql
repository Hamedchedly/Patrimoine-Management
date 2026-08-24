-- V8.16p — Modèles de mail personnalisables (demande de devis / relance).
-- Persistés en base (partagés entre l'envoi par ligne et l'envoi groupé).
-- Le contenu par défaut est inséré par scripts/seed-mail-modeles.mjs
-- (source unique : MAIL_MODELES dans src/lib/psp.suivi.foundation.ts).
create table if not exists public.mail_modeles (
  id text primary key,
  libelle text not null,
  sujet text not null,
  corps text not null,
  updated_at timestamptz not null default now()
);

-- Service role (supabaseAdmin) utilisé par les server functions : RLS non requis.
-- À appliquer dans le SQL editor Supabase (pas de CLI disponible).
