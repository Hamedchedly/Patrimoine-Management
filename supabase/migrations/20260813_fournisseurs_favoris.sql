create table if not exists public.fournisseur_favoris (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  fournisseur_id uuid not null
    references public.fournisseurs(id) on delete cascade,
  created_at timestamptz not null default now(),

  unique (user_id, fournisseur_id)
);

create index if not exists fournisseur_favoris_user_idx
  on public.fournisseur_favoris(user_id);

create index if not exists fournisseur_favoris_fournisseur_idx
  on public.fournisseur_favoris(fournisseur_id);

alter table public.fournisseur_favoris enable row level security;

create policy "lecture favoris fournisseur"
  on public.fournisseur_favoris
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

grant select on public.fournisseur_favoris to authenticated;

revoke insert, update, delete, truncate, references, trigger
  on public.fournisseur_favoris
  from authenticated;

grant all on public.fournisseur_favoris to service_role;
