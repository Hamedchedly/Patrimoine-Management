# Audit V5 — Architecture Supabase du module Préparation PSP

> ⚠️ **Correction V5.1** : ce rapport contenait une conclusion erronée sur
> `psp_programmations` (voir §1, §2, §5, §6, §7, §8), faussée par un **artefact
> de probe** (`SELECT … head:true` répond « OK » avec `count=null` pour une table
> **absente**). La vérification corrigée (probe sans `head` → PGRST205 + OpenAPI)
> établit que **`psp_programmations` n'existe PAS en base** : elle doit être
> **créée**, pas reformatée. Consulter `docs/psp-v5.1-data-model.md` et
> `docs/psp-v5.1-proposed-migration.sql` pour le modèle final.

- **Branche** : `feat/preparation-psp-prototype` (poussée sur `origin` — aucune PR)
- **SHA analysé** : `e6fbae377a39053cf7c34cd35d2d5165662d1d92` (V4, HEAD)
- **Nature** : audit + conception — **aucun** changement de code, de table, de migration, de données ni de RLS.
- **Méthode** : migrations `supabase/migrations/` + types générés `src/integrations/supabase/types.ts` + **sondage réel de la base live** (lecture seule via service role) + inventaire du code (`scripts/audit-schema-supabase.mjs`).

---

## 1. État actuel Supabase

- PostgREST 14.15 (projet `zpkfwsczrtadrhcounof`), schéma `public` uniquement.
- Sondage live (service role, `SELECT` head + 1 ligne) — **tables présentes et volumes** :

| Table | Lignes | Rôle |
|---|---|---|
| `tranches` | 120 | Patrimoine : TR (code PK), localité, sous-secteur, secteur S11, nb logements |
| `lots` | 6 527 | Logements/garages : code_patrimoine PK, tranche FK, adresse/ville de référence |
| `occupants` | 9 128 | Locataires (lot FK) |
| `travaux` | 0 | Légataire (vide) |
| `travaux_commandes` | 187 | **Suivi annuel constaté** (numéro_commande UNIQUE, tranche FK, LB, C=nature_analytique…) |
| `travaux_commandes_historique` | 330 | **Mémoire des modifications / conflits** (avant/apres jsonb, operation, resolu) |
| `travaux_import_details` | 388 | Détails immuables des imports (type creee/conflit/inchangee/archivee/…/report) |
| `import_travaux` | 10 | Journal des imports suivi annuel (compteurs, conflits, reports, annee_exercice) |
| `imports` | 3 | Journal des imports ISIS (tranches/lots) |
| `adresses_geo` | 437 | Cache géocodage /adresses |
| `villes_geo` | 30 | Référentiel villes dashboard |
| `fournisseurs` / `_contacts` / `_aliases` / `_activites` / `fournisseur_favoris` | 32 / 0 / 32 / 0 / 0 | Référentiel fournisseurs (alias multi-sources), activités, favoris |
| `psp_imports` | 1 | Journal import « Historique CMD » (exercice, compteurs, statut) |
| `psp_import_rows` | 407 | **Lignes Historique CMD** (COMN_NUM, donnees_brutes, montants, ER) |
| `psp_command_analysis` | 0 | Analyses/classifications par ligne (vide) |
| `psp_patrimoine_context` | 0 | Contexte patrimonial PSP (vide) |
| `psp_decisions` | 0 | **Couche de décisions humaines** (nature, corps_etat, perimetre_psp, rapprochement) |
| `psp_feedback` | 3 | Corrections/feedback utilisateur |
| `psp_rules` | 0 | Règles générales actives (vide) |
| `psp_programmations` | — | **ABSENTE de la base** (artefact de probe V5 — voir correction ci-dessus) |
| `v_travaux_commandes_enrichies` | 187 | **Vue de rapprochement** commandes ↔ Historique CMD ↔ analyses |

- **RLS** (documentées dans les migrations) : `import_travaux`, `travaux_commandes`, `travaux_commandes_historique` = SELECT authenticated ; `travaux_import_details` = **service_role uniquement** ; référentiel fournisseurs = SELECT authenticated, écritures service_role ; `fournisseur_favoris` = propriétaire. Les tables `tranches/lots/occupants/imports/adresses_geo/villes_geo` et **toutes les `psp_*`** n'ont **pas** de politique documentée dans les migrations.

---

## 2. Tables existantes pertinentes pour PSP

| Table | Rôle / PK / FK | Colonnes pertinentes | Usage code | Réutilisation PSP |
|---|---|---|---|---|
| `tranches` | Référentiel TR ; PK `code` | `code, localite, sous_secteur, secteur, nb_logements` | `isis.functions`, dashboard, référence `psp.prep.data` | **Oui** — source identité TR |
| `lots` | Patrimoine physique ; PK `code_patrimoine`, FK `tranche_code` | `adresse, ville, tranche_code` | `/adresses`, référence PSP | **Oui** — adresse/ville de référence |
| `travaux_commandes` | Suivi annuel constaté ; PK `id`, **UNIQUE `numero_commande`**, FK `tranche_code`, `lot_code`, `vu_dans_import_id` | `ligne_budget, nature_analytique (C), charge_clientele, corps_etat, budget, engage, paye, solde, etat_commande, etat_travaux, annee_exercice, actif` | Moteur d'import, dashboard, `v_travaux_commandes_enrichies` | **Oui** — constatation du suivi (jamais modifiée par PSP) |
| `travaux_commandes_historique` | Mémoire des modifications ; PK `id`, FK `commande_id`, `import_id` ; `operation` check (…, conflit, resolution, report), `resolu` | `avant/apres jsonb, operation, resolu` | `importTravauxBatch`, `resolveHistoriqueTravaux`, alertes | **Oui** — pattern d'historique/confirmation **réutilisable** pour les lignes PSP |
| `travaux_import_details` | Détails immuables d'import ; FK `import_id` (cascade), `commande_id` (set null) | `type, message, details jsonb` | Rapports d'import | Oui (lecture) — états produits par le moteur |
| `import_travaux` | Journal import suivi ; PK `id` | `annee_exercice, conflits, reports, creees…` | Dashboard, import | **Oui** — contexte d'un constat |
| `v_travaux_commandes_enrichies` | **Vue de rapprochement** commandes ↔ psp_import_rows ↔ psp_command_analysis | `commande_id, ligne_budget, nature_analytique, psp_*, lien_*, analyse_*, categorie_budget` | Dashboard, fiche fournisseur | **Oui** — source unique de rapprochement commande/ligne |
| `psp_import_rows` | Historique CMD brut ; FK `import_id` | `numero_commande_interne (COMN_NUM), numero_commande, donnees_brutes, montants, ER` | Import CMD, validation, fournisseurs | Oui (source de rapprochement) |
| `psp_decisions` | Décisions humaines réutilisées ; PK `id` | `cle_metier, type_decision (nature/corps_etat/perimetre_psp/rapprochement), decision_utilisateur, statut (valide/proposition/rejete), motif` | `getPspDecision/savePspDecision` | **Oui** — couche de décision pour « conflit de catégorie » et rapprochement |
| `psp_feedback` | Feedback utilisateur | `cible_type, cible_id, decision_utilisateur, correction, motif` | `savePspFeedback`, validation | Oui — trace décision |
| `psp_rules` | Règles générales (vides) | — | `getPspDecision` (repli règle) | À valider |
| `fournisseurs`/`fournisseur_aliases` | Référentiel (alias multi-sources) | `nom`, alias `source IN (travaux_commandes, psp_import_rows)` | Module fournisseurs | Oui — enrichissement devis/fournisseur |
| `psp_programmations` | **ABSENTE de la base** (artefact de probe V5, corrigé) | n/a (à créer) | aucun | **À créer** : racine des versions PSP |


---

## 3. Fonctions existantes réutilisables

| Fonction | Fichier | Rôle | Réutilisable PSP |
|---|---|---|---|
| `parseTravauxWorkbook` | `travaux.ts` | Parse le **vrai fichier suivi annuel** (en-têtes fusionnés, lignes sans commande → erreurs enrichies) | **Oui — utilisé en V4** |
| `parseProgrammationWorkbook` | `psp.prep.data.ts` | Parse la programmation pluriannuelle (feuille « Prog 2026 », années 2026-2030, LB) | **Oui — utilisé en V4** |
| `parsePspWorkbook` | `psp.ts` | Parse l'historique CMD (Liste_COMD_TRAV_ER) | Oui (rapprochement historique) |
| `etatMetier` / `isPasRealise` | `travaux.ts` | État métier d'une commande / « Pas réalisé » | **Oui — revue des reports** |
| `travauxComparable` / `champsDifferents` / `travauxIdentiques` | `travaux.ts` | Détection des modifications entre versions | **Oui — alertes descriptif/commande/fournisseur** |
| `decisionImportCommande` | `travaux.ts` | creee / inchangee / report / conflit | Oui (concept de « conflit » réutilisé) |
| `snapshotCommande` / `detailConflit` / `detailReport` / … | `travaux.ts` | Snapshots + lignes de détail d'import | Oui (pattern) |
| `commandesAAArchiver` | `travaux.ts` | Archivage annuel | Oui (garde figée) |
| `getAlertesCommande` | `travaux.ts` | Anomalies qualité | Oui |
| `exerciceCourant` | `travaux.ts` | Année courante (jamais codée en dur) | **Oui** |
| `importTravauxBatch` / `finalizeTravauxImport` | `travaux.functions.ts` | Moteur d'import annuel (écritures suivi) | **Non modifié** ; PSP en consomme les résultats |
| `resolveHistoriqueTravaux` | `travaux.dashboard.functions.ts` | Confirmation de conflit (resolu=true + trace) | **Oui — mémoire de confirmation** |
| `getCommandeHistorique` | `travaux.dashboard.functions.ts` | Timeline d'une commande | Oui |
| `getTravauxImportDetails` | `travaux.dashboard.functions.ts` | Détails d'un import par type | Oui |
| `getTravauxDashboard` | `travaux.dashboard.functions.ts` | Lecture agrégée suivi (commandes + historique + imports + tranches) | Oui (lecture) |
| `getPspDecision` / `savePspDecision` | `psp.validation.functions.ts` | Décisions validées réutilisées (nature/corps_etat/perimetre/rapprochement) | **Oui — conflit de catégorie / rapprochement** |
| `construireCleMetierCommande` | `psp.validation.ts` | Clé métier d'une commande | **Oui — clé de décision** |
| `savePspFeedback` / `savePspCommandAnalysis` | `psp.functions.ts` | Feedback / analyse par ligne | Oui (trace) |
| `cleIdentitePsp` (TR+C) | `psp.prep.suivi.ts` | Identité d'une ligne PSP | **Oui** |
| `analyserLignesReport` / `resumeArbitrage` / `filtrerLignesArbitrage` | `psp.prep.suivi.ts` | Revue des reports (V3/V4) | **Oui** |
| `detecterModificationsLigne` / `modificationDejaConfirmee` | `psp.prep.suivi.ts` | Alertes de modifications + mémoire confirmation | **Oui** |

---

## 4. Relations existantes

```
tranches(code) ──1:N── lots(tranche_code)
lots(code_patrimoine) ──1:N── occupants(lot_code)
import_travaux(id) ──1:N── travaux_commandes(vu_dans_import_id)
travaux_commandes(id) ──1:N── travaux_commandes_historique(commande_id)
import_travaux(id) ──1:N── travaux_import_details(import_id) [cascade]
travaux_commandes(id) ──1:N── travaux_import_details(commande_id) [set null]
psp_imports(id) ──1:N── psp_import_rows(import_id)
psp_import_rows(id) ──1:N── psp_command_analysis(import_row_id)
fournisseurs(id) ──1:N── fournisseurs_contacts / fournisseur_aliases / fournisseur_activites / fournisseur_favoris
v_travaux_commandes_enrichies : vue = travaux_commandes ⋈ psp_import_rows(par numéro) ⋈ psp_command_analysis
```

---

## 5. Problèmes / risques identifiés

1. **`psp_programmations` n'existe PAS en base** (artefact de probe V5, corrigé en V5.1) → racine du modèle PSP **à créer**, sans risque de collision.
2. **`src/integrations/supabase/types.ts` est obsolète** : les tables `psp_*`, `fournisseurs*`, `travaux_commandes_historique`, `travaux_import_details` n'y figurent pas (généré avant les migrations récentes). Régénérer les types avant le branchement PSP.
3. **`travaux_commandes.classification_programmation/secteur`** existent en base mais le code les **exclut des UPDATE** (garde anti-casse) — cohérence à confirmer.
4. **RLS des tables `psp_*` non documentées** (créées hors migrations) → risque d'accès REST anon. À cadrer dans la migration.
5. **`v_travaux_commandes_enrichies`** dépend de `psp_import_rows`/`psp_command_analysis` (actuellement partiels) → le rapprochement est partiel tant que l'historique CMD n'est pas complet.
6. **« Sans commande » vs « Pas réalisé »** : avec les règles actuelles (`etatMetier`), une ligne sans commande du suivi est classée « non engagée » (jamais « Pas réalisé », car `isPasRealise` exige une `annee_exercice` clôturée + état vide). En 2026 : 16 lignes « sans commande », 0 « pas réalisé ». Définition métier à trancher (§9).
7. **Conflits de catégorie** (TR identique, C différent entre programmation et suivi) : la V4 les a constatés — **ne pas rattacher automatiquement** ; proposer une règle « CONFLIT DE CATÉGORIE » via la couche `psp_decisions`.
8. **Orphelin : la ligne budgétaire n'existe pas dans la programmation** (0/114 en V4) — acquise au 1er import du suivi, jamais inventée.


---

## 6. Modèle PSP recommandé — principe

Objectif : **minimum de tables, maximum de cohérence, aucune duplication inutile**.

- **Créer** : `psp_programmations` (racine — absente de la base, voir correction V5.1). **Réutiliser** : le pattern d'historique de `travaux_commandes_historique` (avant/apres jsonb + operation + resolu), la couche `psp_decisions` (conflit de catégorie, rapprochement — à généraliser pour les arbitrages), `psp_command_links` (à généraliser pour le rattachement ligne↔commande), `tranches/lots/travaux_commandes` (références, jamais dupliquées).
- **Version = enregistrement `psp_programmations`** (pas de table `psp_versions` séparée) : une programmation (2027-2031) a N versions ; chaque version porte ses lignes `psp_lignes`. Une **simulation** est une version de statut `simulation` (brouillon marqué), jamais la version officielle.
- **Historique des lignes** : audit-delta `psp_ligne_historique` (pattern `travaux_commandes_historique`) — on n'archive jamais la ligne entière entre versions, on conserve les champs modifiés.

## 7. Tables réellement nécessaires (proposition)

| Table | Justification | Alternative écartée |
|---|---|---|
| `psp_programmations` (à créer) | Racine : période, version, statut, auteur, dates, parent | Table `psp_versions` séparée (redondant) |
| `psp_lignes` | Lignes programmées d'une version (identité TR+C) | Réutiliser `travaux_commandes` (non : prévisionnel ≠ constaté) |
| `psp_ligne_historique` | Évolution des lignes entre versions (delta jsonb) | Snapshots complets (duplication) |
| `psp_reports` | Reports 2026→2027 (relation source/cible explicite) | Simple ligne créée sans lien (perte de traçabilité) |
| `psp_devis` | Devis d'une ligne (1..N) | Colonne jsonb sur psp_lignes (pas d'intégrité) |
| `psp_ligne_commandes` | Liaison ligne ↔ commandes existantes (référence) | Duplication des commandes (interdit) |
| `psp_arbitrages` | Décisions report/annulation/conservation/réévaluation + conflit catégorie | Réutiliser `psp_decisions` seul (type restreint) — les deux coexistent |

**Non créées** : `psp_versions` (une ligne par version dans psp_programmations suffit), `psp_simulations` (statut `simulation`), tables budgétaires (la dotation reste MOCK tant qu'elle n'est pas définie).

## 8. Colonnes proposées

**`psp_programmations`** (à créer — absente de la base, voir correction V5.1)
`id uuid PK` · `annee_debut integer NOT NULL` (ex. 2027) · `annee_fin integer NOT NULL` (ex. 2031) · `version integer NOT NULL` · `statut text NOT NULL check (brouillon, simulation, validee, figee)` · `parent_id uuid FK self` (version/simulation d'origine) · `auteur uuid FK auth.users` · `date_validation timestamptz` · `remarques text` · `created_at` · `updated_at` · **UNIQUE (annee_debut, version)**.

**`psp_lignes`**
`id uuid PK` · `programmation_id uuid FK psp_programmations (cascade)` · `tranche text NOT NULL` · `categorie text NOT NULL check (GE,GT,CP)` · `ligne_budget text` (acquise au 1er import suivi) · `nature_travaux text` · `corps_etat text` · `adresse text` · `ville text` · `charge_clientele text` · `charge_operation text` · `programme jsonb NOT NULL` (ex. {"2027":35000,"2028":0,…}) · `remarques text` · `created_at` · `updated_at` · **UNIQUE (programmation_id, tranche, categorie)**.

**`psp_ligne_historique`**
`id uuid PK` · `ligne_id uuid FK psp_lignes` · `operation text check (creation, modification, report, annulation)` · `avant jsonb` · `apres jsonb` · `resolu boolean default false` · `motif text` · `utilisateur uuid FK auth.users` · `created_at` — pattern identique à `travaux_commandes_historique`.

**`psp_reports`**
`id uuid PK` · `ligne_source_id uuid FK psp_lignes` · `ligne_resultat_id uuid FK psp_lignes` (ligne reportée créée) · `version_cible_id uuid FK psp_programmations` · `annee_source integer` · `annee_cible integer` · `montant numeric` · `motif text` · `utilisateur uuid FK auth.users` · `created_at`.


## 9. Clés primaires / étrangères / contraintes

- **PK** : `id uuid` sur chaque table (généré) ; identité métier **UNIQUE** : `psp_programmations(annee_debut, version)` et `psp_lignes(programmation_id, tranche, categorie)` (TR+C au sein d'une version).
- **FK** : `psp_lignes.programmation_id → psp_programmations(id)` (cascade) ; `psp_ligne_historique.ligne_id → psp_lignes(id)` ; `psp_reports.ligne_source_id/ligne_resultat_id → psp_lignes(id)`, `version_cible_id → psp_programmations(id)` ; `psp_devis.ligne_id → psp_lignes(id)` ; `psp_ligne_commandes.commande_id → travaux_commandes(id)` (**référence** aux commandes existantes) ; `utilisateur → auth.users(id)`.
- **Contraintes** : check `categorie IN (GE,GT,CP)` ; check `statut` (programmations) ; check `operation`/`type_arbitrage`/`statut devis` ; `programme jsonb` validé côté serveur (années de la période).
- **Garde « figé »** : `psp_lignes` d'une version `figee` ne peut être modifiée que par server function qui refuse l'UPDATE (ou trigger `prevent_update_if_figee`).

## 10. Stratégie de versionnement

- Une préparation = une **version** (`psp_programmations.version`) sur la même période.
- Statuts : `brouillon` → (éventuellement `simulation`) → `validee` → `figee`.
- `parent_id` = version validée d'origine pour comparer (diff V1→V2→V3).
- Auteur, date, date_validation renseignés à chaque transition.
- Une version figée est **immuable** : toute nouvelle préparation crée `version+1`.

## 11. Stratégie de gel

- Transition `validee → figee` via server function (service_role) uniquement.
- Trigger/contrainte `prevent_update_if_figee` sur `psp_programmations`/`psp_lignes` : interdit UPDATE/DELETE d'une version figée (sauf cas d'erreur avec contournement explicite documenté).
- **Les imports annuels n'écrivent jamais dans `psp_lignes`** : ils constatent dans `travaux_commandes`. La programmation figée est donc **protégée de fait** et par contrainte.

## 12. Stratégie de report

- Décision de report dans le brouillon → création d'une ligne dans la version cible **et** enregistrement `psp_reports` (source, cible, année source/cible, montant, motif, utilisateur, date, version cible) **et** trace `psp_ligne_historique (operation=report)`.
- La ligne reportée garde l'information d'origine (montant, année 2026) via `psp_reports` — jamais une opération orpheline.
- Les reports sont **décidés par le préparateur** (jamais par un import).

## 13. Stratégie devis

- `psp_devis` : une ligne → 0..N devis. Chaque devis : entreprise, date, montant, statut, commentaire, document_url.
- Le devis **ne remplace jamais** le montant programmé (`psp_lignes.programme`), la commande (`travaux_commandes`), l'engagé ni le payé — ces montants restent dans leurs tables respectives. L'écart « budget programmé vs estimation devis » est calculé (jamais stocké en double).

## 14. Stratégie simulations

- Une simulation = version `simulation` sur la même période (ou une période future) avec `parent_id` pointant la version officielle courante.
- Les simulations ne modifient jamais la version officielle ; elles sont exclues des vues « officielles » (filtre `statut <> 'simulation'`).

## 16. Relations (diagramme logique)

```
psp_programmations (période, version, statut, parent_id)
        │ 1──N
        ▼
   psp_lignes (TR + C, programme jsonb, LB)
        │ 1──N        │ 1──N            │ 1──N              │ 1──N
        ▼             ▼                 ▼                  ▼
psp_ligne_historique  psp_devis     psp_arbitrages   psp_ligne_commandes
   (delta jsonb)       (devis)      (report/annuler/   (commande_id ──► travaux_commandes)
                                    conflit catégorie)
        │
        └──► psp_reports (ligne_source_id ─► ligne_resultat_id, année source/cible,
                           montant, motif, utilisateur, date, version cible)

Conflit de catégorie (TR identique + C différent) : psp_arbitrages(type=conflit_categorie)
   + décision humaine dans psp_decisions(cle_metier="TR|C", type_decision='rapprochement').
```

## 17. RLS / sécurité (proposition, non créée)

- **Lecture** : SELECT `authenticated` sur toutes les tables PSP (pattern `travaux_commandes`/`fournisseurs`).
- **Création / modification** : exclusivement **service_role** (server functions, BYPASS RLS) — `authenticated` n'a aucun privilège d'écriture (REVOKE explicite).
- **Validation / gel** : server functions service_role uniquement ; transition de statut contrôlée.
- **Simulations** : mêmes règles ; lecture filtrée côté serveur (statut).
- **Archivage** : pas d'archivage physique ; les versions figées sont immuables, les lignes hors programmation restent dans `travaux_commandes`.
- Pattern appliqué dans les migrations existantes (fournisseurs : SELECT authenticated, écritures service_role) — à reproduire.

## 18. Performance

- **Aucun N+1** : chargement d'une version = 1 requête programmation + 1 requête lignes (IN) + 1 requête devis/arbitrages/reports (IN).
- **Pas de duplication** : les montants programmés vivent dans `psp_lignes.programme` (jsonb) ; les totaux par année/catégorie sont **calculés** (server functions ou frontend), jamais stockés.
- **SQL** : contraintes/triggers de gel ; agrégats éventuels en vue (v_psp_lignes_courantes) à la demande.
- **Server functions** : validation de `programme`, transition de statut, gel, report (écritures encapsulées).
- **Frontend** : calculs de revue des reports (déjà purs dans `psp.prep.suivi.ts`) — réutilisés.
- **Synchronisations inutiles évitées** : le rapprochement commandes↔lignes passe par `psp_ligne_commandes` (écrit lors du constat) et `v_travaux_commandes_enrichies` (existant).

## 19. Plan de migration par étapes

1. **Valider le modèle** (cette V5) — décisions métier (§20) et arbitrage sur `psp_programmations` (reformater vs supprimer).
2. **Migration 1 (schéma)** : reformater/créer `psp_programmations`, créer `psp_lignes`, `psp_ligne_historique`, `psp_reports`, `psp_devis`, `psp_arbitrages`, `psp_ligne_commandes` + contraintes + index + RLS + policies.
3. **Migration 2 (garde)** : triggers `prevent_update_if_figee` + vue `v_psp_lignes_courantes` (si nécessaire).
4. **Régénération des types Supabase** (`supabase types` → `src/integrations/supabase/types.ts`).
5. **Server functions d'écriture PSP** (version, validation, gel, report, devis) — réutilisant les patterns `createServerFn` existants.
6. **Backfill** : depuis les vrais fichiers 2026 (parseur V4) → première version brouillon 2027 + imports du suivi constaté (moteur existant).
7. **Branchement du préparateur (V6)** : lire/écrire les versions PSP, connexion de la revue des reports, des reports et des alertes.
8. **Rapports/analyses** : vues d'agrégation + tableau de bord de validation.

## 20. Points nécessitant décision métier

1. **`psp_programmations`** : reformater la table existante (vide) vs créer un nom propre — à trancher.
2. **« Sans commande » vs « Pas réalisé »** : proposer une définition métier claire (proposition : *programmée + sans commande → à arbitrer/reporter* ; *programmée + commande clôturée sans engagement → pas réalisé*). Les règles actuelles (`etatMetier`) ne sont **pas** modifiées automatiquement.
3. **Conflit de catégorie** (TR identique, C différent) : valider la règle « CONFLIT DE CATÉGORIE → validation humaine via psp_decisions(type=rapprochement, cle_metier="TR|C") ». Le descriptif ne résout jamais ce conflit.
4. **Hors programmation / hors budget** : confirmer le rattachement manuel (jamais automatique sur le descriptif) et le marquage « HORS PROGRAMMATION / HORS BUDGET ».
5. **Devis** : valider la structure minimale proposée (§8) et le statut par devis.
6. **Ligne budgétaire** : confirmer qu'elle n'est acquise qu'au premier import du suivi (jamais inventée).
7. **Simulations** : valider le statut `simulation` + `parent_id` (pas de table dédiée).
8. **RLS** : valider le principe « SELECT authenticated, écritures service_role uniquement » pour toutes les tables PSP.

- Plusieurs simulations (A/B/C) = plusieurs versions `simulation`, comparables entre elles et avec la version `figee`.

## 15. Stratégie historique

- `psp_ligne_historique` = **audit-delta** (pattern `travaux_commandes_historique`) : `avant/apres` (jsonb des champs modifiés) + `operation` + `resolu` + `motif` + utilisateur + date.
- V1 `2027=35k` → V2 `2028=35k` → V3 `2028=38k` : trois enregistrements d'historique (modification année, modification montant) sans dupliquer la ligne entière.
- Une modification déjà confirmée (`resolu=true`) n'est pas redemandée (réutilisation du mécanisme existant).

**`psp_devis`**
`id uuid PK` · `ligne_id uuid FK psp_lignes` · `entreprise text NOT NULL` · `date_devis date` · `montant numeric` · `statut text check (en_attente, accepte, retenu, ecarte)` · `commentaire text` · `document_url text` · `created_at` · `updated_at`.

**`psp_ligne_commandes`**
`id uuid PK` · `ligne_id uuid FK psp_lignes` · `commande_id uuid FK travaux_commandes` (référence, pas duplication) · `methode text check (import_suivi, manuel, rapprochement)` · `created_at` · **UNIQUE (ligne_id, commande_id)**.

**`psp_arbitrages`**
`id uuid PK` · `ligne_id uuid FK psp_lignes` · `type_arbitrage text check (report, annulation, conservation, reevaluation, conflit_categorie)` · `decision text` · `annee_cible integer` · `motif text` · `utilisateur uuid FK auth.users` · `statut text check (proposition, valide)` · `created_at`.

