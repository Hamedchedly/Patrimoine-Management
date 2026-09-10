-- V8.20 — SIGNALEMENTS de bugs (rapports utilisateur + capture d'écran + contexte).
-- À APPLIQUER par l'utilisateur dans l'éditeur SQL Supabase.
create table if not exists public.bug_reports (
  id uuid primary key default gen_random_uuid(),
  cree_le timestamptz not null default now(),
  description text not null,
  categorie text,
  url text,
  page_titre text,
  contexte jsonb,
  capture text,
  statut text not null default 'ouvert'
    check (statut in ('ouvert', 'resolu')),
  resolu_le timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists bug_reports_statut_idx on public.bug_reports(statut, cree_le desc);

alter table public.bug_reports enable row level security;
drop policy if exists "lecture publique signalements" on public.bug_reports;
create policy "lecture publique signalements" on public.bug_reports for select using (true);
drop policy if exists "insertion publique signalements" on public.bug_reports;
create policy "insertion publique signalements" on public.bug_reports for insert with check (true);
drop policy if exists "maj publique signalements" on public.bug_reports;
create policy "maj publique signalements" on public.bug_reports for update using (true);
