-- Référentiel fournisseurs — activités manuelles / validées (couche de DÉCISION)
--
-- Couche de surcharge indépendante des données sources (travaux_commandes,
-- psp_import_rows, ISIS, Excel…) : l'utilisateur décide du niveau de
-- référencement d'une entreprise SANS jamais modifier une commande.
--
--   niveau_effectif = niveau_manuel (si présent) SINON niveau_auto (calculé)
--   niveau_auto n'est jamais écrasé : la suppression d'une décision manuelle
--   laisse le calcul automatique reprendre le dessus.
--
-- `source` prépare le terrain pour de futures propositions « ia » (dont seul
-- l'écrit sera alors produit ; l'IA ne pourra jamais modifier un niveau).
--
-- Aucune table source n'est modifiée. Les seules écritures autorisées restent
-- le référentiel (fournisseurs, fournisseurs_contacts, fournisseur_aliases,
-- fournisseur_activites).
--
-- Droits :
--   - SELECT pour authenticated (policies RLS SELECT) ;
--   - écritures EXCLUSIVEMENT par service_role (server functions, BYPASS RLS).

-- ── 1) fournisseur_activites ─────────────────────────────────────────────────
create table if not exists public.fournisseur_activites (
  id uuid primary key default gen_random_uuid(),
  fournisseur_id uuid not null
    references public.fournisseurs(id)
    on delete cascade,
  corps_etat_code text not null,
  corps_etat_libelle text not null,
  niveau text not null
    check (niveau in ('principal', 'secondaire', 'occasionnel')),
  source text not null default 'manuel'
    check (source in ('manuel', 'ia')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (fournisseur_id, corps_etat_code)
);

-- ── Index ────────────────────────────────────────────────────────────────────
create index if not exists fournisseur_activites_fournisseur_idx
  on public.fournisseur_activites (fournisseur_id);

-- ── updated_at automatique (même modèle que le reste du référentiel) ─────────
create or replace function public.set_fournisseur_activites_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists fournisseur_activites_updated_at on public.fournisseur_activites;
create trigger fournisseur_activites_updated_at
  before update on public.fournisseur_activites
  for each row execute function public.set_fournisseur_activites_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.fournisseur_activites enable row level security;

create policy "lecture activites fournisseur"
  on public.fournisseur_activites for select to authenticated using (true);

grant select on public.fournisseur_activites to authenticated;

revoke insert, update, delete, truncate, references, trigger
  on public.fournisseur_activites
  from authenticated;

grant all on public.fournisseur_activites to service_role;
