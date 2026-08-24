-- Référentiel fournisseurs — couche d'enrichissement (les données sources restent immuables)
--
-- Le fournisseur est identifié par son UUID INTERNE (fournisseurs.id).
-- Les identifiants provenant des différentes sources vivent dans fournisseur_aliases :
--   source IN ('travaux_commandes','psp_import_rows') + identifiant_source,
--   UNIQUE(source, identifiant_source).
-- Exemple : DUPONT → travaux_commandes = 1234 ET psp_import_rows = 001234
-- → deux alias pointant vers le même fournisseurs.id, sans aucune modification des sources.
--
-- Aucune table source n'est modifiée (travaux_commandes, psp_import_rows,
-- psp_imports, tranches, lots, import_travaux, ISIS…).
--
-- Droits :
--   - SELECT pour authenticated (via policies RLS SELECT) ;
--   - écritures EXCLUSIVEMENT par le service_role (server functions, BYPASS RLS) :
--     authenticated n'a AUCUN privilège d'écriture (REVOKE explicite).

-- ── 1) fournisseurs ───────────────────────────────────────────────────────────
create table if not exists public.fournisseurs (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  adresse text,
  complement_adresse text,
  code_postal text,
  ville text,
  pays text,
  site_web text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── 2) fournisseurs_contacts ──────────────────────────────────────────────────
create table if not exists public.fournisseurs_contacts (
  id uuid primary key default gen_random_uuid(),
  fournisseur_id uuid not null
    references public.fournisseurs(id)
    on delete cascade,
  nom text not null,
  fonction text,
  email text,
  telephone text,
  ordre integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── 3) fournisseur_aliases (identifiants sources multi-espaces) ──────────────
create table if not exists public.fournisseur_aliases (
  id uuid primary key default gen_random_uuid(),
  fournisseur_id uuid not null
    references public.fournisseurs(id)
    on delete cascade,
  source text not null
    check (source in ('travaux_commandes', 'psp_import_rows')),
  identifiant_source text not null,
  created_at timestamptz not null default now(),
  unique (source, identifiant_source)
);

-- ── Index sur les clés étrangères ─────────────────────────────────────────────
create index if not exists fournisseurs_contacts_fournisseur_idx
  on public.fournisseurs_contacts (fournisseur_id);
create index if not exists fournisseur_aliases_fournisseur_idx
  on public.fournisseur_aliases (fournisseur_id);

-- ── updated_at automatique (même modèle que travaux_commandes) ───────────────
create or replace function public.set_fournisseurs_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists fournisseurs_updated_at on public.fournisseurs;
create trigger fournisseurs_updated_at before update on public.fournisseurs
for each row execute function public.set_fournisseurs_updated_at();

drop trigger if exists fournisseurs_contacts_updated_at on public.fournisseurs_contacts;
create trigger fournisseurs_contacts_updated_at before update on public.fournisseurs_contacts
for each row execute function public.set_fournisseurs_updated_at();

-- ── RLS ───────────────────────────────────────────────────────────────────────
alter table public.fournisseurs enable row level security;
alter table public.fournisseurs_contacts enable row level security;
alter table public.fournisseur_aliases enable row level security;

-- Policies RLS SELECT pour authenticated (lecture)
create policy "lecture fournisseurs"
  on public.fournisseurs for select to authenticated using (true);
create policy "lecture contacts fournisseur"
  on public.fournisseurs_contacts for select to authenticated using (true);
create policy "lecture alias fournisseur"
  on public.fournisseur_aliases for select to authenticated using (true);

-- ── Droits : SELECT authenticated · écritures service_role uniquement ────────
grant select on
  public.fournisseurs,
  public.fournisseurs_contacts,
  public.fournisseur_aliases
  to authenticated;

revoke insert, update, delete, truncate, references, trigger on
  public.fournisseurs,
  public.fournisseurs_contacts,
  public.fournisseur_aliases
  from authenticated;

grant all on
  public.fournisseurs,
  public.fournisseurs_contacts,
  public.fournisseur_aliases
  to service_role;
