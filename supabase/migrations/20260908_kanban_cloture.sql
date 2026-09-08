-- V8.28 — « Déclarer terminée » (Kanban/Pilotage) : signalement manuel de fin de
-- travaux en ATTENTE de confirmation par l'import suivant.
--
--   · `kanban_clotures` : une ligne par (exercice, commande réelle OU ligne PSP).
--     statut 'a_confirmer' = signalé par l'utilisateur, pas encore confirmé par
--     l'import (l'import/registre montre l'état réel « Terminée » → confirmation).
--     Checklist : facture / PV de réception / rapport (+ note).
--     Fichiers joints : stockés dans le bucket Storage public « kanban-clotures »
--     (créé automatiquement côté serveur) ; la colonne `fichiers` (jsonb) garde la
--     liste [{nom, chemin, taille, type}].
--
-- ⚠️ À APPLIQUER dans l'éditeur SQL Supabase (aucune CLI disponible).

create table if not exists public.kanban_clotures (
  id uuid primary key default gen_random_uuid(),
  exercice integer not null check (exercice between 2000 and 2100),
  psp_ligne_id uuid references public.psp_lignes(id) on delete set null,
  commande_id uuid references public.travaux_commandes(id) on delete set null,
  facture boolean not null default false,
  pv_reception boolean not null default false,
  rapport boolean not null default false,
  note text,
  fichiers jsonb not null default '[]'::jsonb,
  statut text not null default 'a_confirmer' check (statut in ('a_confirmer', 'confirme')),
  signale_le timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- Une seule clôture par cible (commande réelle OU ligne PSP) et par exercice.
create unique index if not exists kanban_clotures_commande_exercice_uq
  on public.kanban_clotures (exercice, commande_id)
  where commande_id is not null;
create unique index if not exists kanban_clotures_ligne_exercice_uq
  on public.kanban_clotures (exercice, psp_ligne_id)
  where psp_ligne_id is not null;

create index if not exists kanban_clotures_exercice_statut_idx
  on public.kanban_clotures (exercice, statut);

alter table public.kanban_clotures enable row level security;

drop policy if exists "kanban_clotures_select" on public.kanban_clotures;
create policy "kanban_clotures_select" on public.kanban_clotures
  for select using (true);

drop policy if exists "kanban_clotures_insert" on public.kanban_clotures;
create policy "kanban_clotures_insert" on public.kanban_clotures
  for insert with check (true);

drop policy if exists "kanban_clotures_update" on public.kanban_clotures;
create policy "kanban_clotures_update" on public.kanban_clotures
  for update using (true);

drop policy if exists "kanban_clotures_delete" on public.kanban_clotures;
create policy "kanban_clotures_delete" on public.kanban_clotures
  for delete using (true);

comment on table public.kanban_clotures is
  'V8.28 — signalement manuel de fin de travaux (Kanban/Pilotage), à confirmer à l''import.';
