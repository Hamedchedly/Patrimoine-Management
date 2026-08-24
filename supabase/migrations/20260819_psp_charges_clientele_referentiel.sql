-- ═══════════════════════════════════════════════════════════════════════════════
-- PSP V7.5 — RÉFÉRENTIEL CHARGÉ CLIENTÈLE (sous_secteur → CC actuel)
--
-- Contexte (audit) :
--  · le CC était déduit par fréquence des commandes historiques
--    (travaux_commandes.charge_clientele) — peut retourner un ANCIEN chargé
--    (ex. TR 1950 → CANTONY alors que ALOTHORE gère la tranche) ;
--  · aucun référentiel métier (table personnel / sous_secteurs) n'existe.
--
-- Cette migration crée le référentiel EXPLICITE :
--    sous_secteur → charge_clientele → identifiant_personnel → actif
-- Le système résout ensuite : tranches.sous_secteur → CC ACTUEL.
--
-- Non destructif : aucune donnée existante modifiée. Le seed initial reprend
-- le CC le plus fréquent par sous-secteur comme point de départ (modifiable
-- ensuite). Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════════

create table if not exists public.psp_charges_clientele (
  id uuid primary key default gen_random_uuid(),
  sous_secteur text not null unique,
  charge_clientele text not null,
  identifiant_personnel text,
  actif boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.psp_charges_clientele is
  'V7.5 — Référentiel actuel : sous_secteur → chargé de clientèle (autorité métier, plus jamais déduit par fréquence des commandes).';
comment on column public.psp_charges_clientele.charge_clientele is
  'Libellé du chargé de clientèle (ex. ALOTHORE).';
comment on column public.psp_charges_clientele.identifiant_personnel is
  'Identifiant personnel (ex. JBRANCO) — permet de distinguer libellé et code.';

-- RLS : lecture pour authenticated, écritures service_role uniquement.
alter table public.psp_charges_clientele enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'psp_charges_clientele' and policyname = 'lecture charges cliente'
  ) then
    create policy "lecture charges cliente"
      on public.psp_charges_clientele for select to authenticated using (true);
  end if;
end $$;

-- Seed initial (idempotent) : pour chaque sous-secteur, le CC le plus fréquent
-- dans les commandes de ses tranches → point de départ du référentiel.
insert into public.psp_charges_clientele (sous_secteur, charge_clientele, identifiant_personnel, actif)
select ss.sous_secteur, cc.charge_clientele, cc.charge_clientele, true
from (
  select distinct sous_secteur
  from public.tranches
  where sous_secteur is not null and trim(sous_secteur) <> ''
) ss
cross join lateral (
  select c.charge_clientele, count(*) as nb
  from public.travaux_commandes c
  join public.tranches t on t.code = c.tranche_code
  where t.sous_secteur = ss.sous_secteur
    and c.charge_clientele is not null and trim(c.charge_clientele) <> ''
  group by c.charge_clientele
  order by nb desc
  limit 1
) cc
on conflict (sous_secteur) do nothing;

-- Vérifications :
--  select * from public.psp_charges_clientele order by sous_secteur ;
--  select t.code, t.sous_secteur, r.charge_clientele, r.actif
--    from tranches t
--    left join psp_charges_clientele r on r.sous_secteur = t.sous_secteur
--    where t.code in ('1950','1976','1977') ;
