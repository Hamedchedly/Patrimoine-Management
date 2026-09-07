-- V8.21 — KANBAN devis → commande → travaux : « commandes passées » à confronter.
-- À APPLIQUER par l'utilisateur dans l'éditeur SQL Supabase.
-- Une « commande passée » est saisie dans le Kanban (entreprise + n° + date) SANS
-- créer tout de suite une ligne travaux_commandes. Au prochain import du suivi
-- annuel de l'exercice, la confrontation retrouve la commande réelle importée :
--   statut='confirme' + commande_id + lien psp_command_links (rattachement_ligne).
-- Si la commande n'est pas retrouvée → statut='ecart' (alerte à l'utilisateur).
create table if not exists public.kanban_commandes_passees (
  id uuid primary key default gen_random_uuid(),
  exercice integer not null check (exercice between 2000 and 2100),
  psp_ligne_id uuid references public.psp_lignes(id) on delete set null,
  tranche_code text,
  adresse text,
  libelle text,
  montant_prevu numeric,
  entreprise text not null,
  numero_commande text,
  date_commande date not null default current_date,
  statut text not null default 'a_confirmer'
    check (statut in ('a_confirmer', 'confirme', 'ecart')),
  commande_id uuid references public.travaux_commandes(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists kanban_cmd_exercice_idx
  on public.kanban_commandes_passees (exercice, statut);
create index if not exists kanban_cmd_ligne_idx
  on public.kanban_commandes_passees (psp_ligne_id, exercice);

alter table public.kanban_commandes_passees enable row level security;
drop policy if exists "kanban lecture" on public.kanban_commandes_passees;
create policy "kanban lecture" on public.kanban_commandes_passees for select using (true);
drop policy if exists "kanban insertion" on public.kanban_commandes_passees;
create policy "kanban insertion" on public.kanban_commandes_passees for insert with check (true);
drop policy if exists "kanban maj" on public.kanban_commandes_passees;
create policy "kanban maj" on public.kanban_commandes_passees for update using (true);
