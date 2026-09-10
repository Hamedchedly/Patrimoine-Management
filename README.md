# Patrimoine S11 — Lot Watcher Pro

Application de gestion et de suivi du patrimoine immobilier (Secteur 11) : carte des
bâtiments, base d'adresses, fournisseurs, programmation des travaux (PSP), suivi
budgétaire annuel et pilotage des commandes.

## Stack

- **Framework** : TanStack Start (SSR) + TanStack Router + TanStack Query
- **UI** : React 19, Tailwind CSS v4, shadcn/ui (Radix), Leaflet / OpenStreetMap
- **Données** : Supabase (Postgres + Storage)
- **Build / serveur** : Vite + [Nitro](https://nitro.build) (presets `vercel` et `node-server`)
- **Déploiement** : Vercel (SSR via Vercel Functions) ; Docker/Node conservé pour Railway

## Démarrage local

```sh
npm install
npm run dev    # http://localhost:5173
```

## Scripts

| Commande                          | Rôle                                                                  |
| --------------------------------- | --------------------------------------------------------------------- |
| `npm run dev`                     | serveur de développement Vite                                         |
| `npm run build`                   | build de production (`.output/` en Node, `.vercel/output` sur Vercel) |
| `npm start`                       | serveur Node de production (`node .output/server/index.mjs`)          |
| `npm test`                        | tests unitaires (node:test)                                           |
| `npm run lint` / `npm run format` | ESLint / Prettier                                                     |

## Variables d'environnement

À définir dans l'hébergeur — voir `.env.example` :

| Variable                                                                | Portée              |
| ----------------------------------------------------------------------- | ------------------- |
| `EXT_SUPABASE_URL`, `EXT_SUPABASE_SERVICE_ROLE_KEY`                     | serveur (dashboard) |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | serveur             |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`                    | build (client)      |

## Déploiement (Vercel)

La branche `main` est déployée automatiquement. Le build produit par Nitro suit la
Build Output API (`.vercel/output`) ; `vercel.json` n'impose aucun preset de framework.

## Structure

```
src/
  components/   UI (map/, bugs/, kanban/, preparation-psp/, suivi/, tranches/, ui/)
  integrations/ clients Supabase
  lib/          logique métier (adresses, psp, travaux, fournisseurs, kanban…)
  routes/       routes TanStack Start (routage par fichiers)
scripts/        outils d'exploitation (import, backfill, rapports)
supabase/       migrations SQL
tests/          tests unitaires
```
