# PSP — Modèle de données V5.1 (proposition avant migration)

> **Statut** : PROPOSITION documentaire — aucune écriture Supabase effectuée.
> **Référence** : `docs/psp-v5.1-proposed-migration.sql` (SQL complet, à valider avant exécution).
> **Branche** : `feat/preparation-psp-prototype` — jamais mergée dans `develop`.

---

## 1. Contexte et positionnement

Le module « Préparation PSP » a été construit en prototype (V1) puis connecté aux
vraies données PAT S11 (V2), en réutilisant strictement le moteur d'import existant
(V3–V4 : `parseTravauxWorkbook`, `etatMetier`, `champsDifferents`,
`resolveHistoriqueTravaux`). La V5 a audité l'existant Supabase ; la V5.1 finalise
**le modèle de données cible** qui accueillera la programmation PSP pluriannuelle
(2027-2031), ses versions, ses reports, ses devis et ses arbitrages.

Ce document décrit le modèle proposé, les choix structurants, la migration et le
rollback. Il n'est **pas** exécuté.

---

## 2. Constat de la base live (correction de l'audit V5)

L'audit V5 était faussé par un artefact de probe (table rapportée « vide, orpheline »).
La vérification par OpenAPI + requête directe service role corrige le constat :

| Table | Existence réelle | Rôle constaté |
|---|---|---|
| `psp_programmations` | **ABSENTE** (PGRST205) | rien — à créer |
| `psp_imports` | ✅ existe | journal des imports Historique CMD |
| `psp_import_rows` | ✅ existe | lignes Historique CMD |
| `psp_command_analysis` | ✅ existe | analyses / classifications |
| `psp_command_links` | ✅ existe (vide) | liaison `travaux_commandes` ↔ `psp_import_rows` (rapprochement source) |
| `psp_decisions` | ✅ existe (vide) | décisions humaines (nature, corps_etat, perimetre_psp, rapprochement) |
| `psp_patrimoine_context` | ✅ existe (vide) | contexte patrimonial par ER |
| `psp_feedback` | ✅ existe | feedback |
| `psp_rules` | ✅ existe (vide) | règles générales (déclenchement / résultat) |

**Conséquence** : le modèle V5.1 **crée** `psp_programmations` et ses tables filles,
et **généralise** `psp_command_links` + `psp_decisions` (aucun `ALTER` destructif,
aucun `DROP`).

### Colonnes réelles confirmées (OpenAPI `/rest/v1/`, V5.1)

- **`psp_command_links`** : `id, commande_id, import_row_id, type_relation,
  methode, confiance, statut, justification, created_at, updated_at` — relie déjà
  `travaux_commandes` ↔ `psp_import_rows` (rapprochement source). Extension V5.1 :
  `psp_ligne_id` (FK optionnelle vers `psp_lignes`) pour le rattachement
  ligne PSP ↔ commande, et domaine `type_relation` élargi.
- **`psp_decisions`** : `id, cle_metier, type_decision, decision_utilisateur,
  statut, motif, proposition_initiale, valeur_retenue, source_historique,
  source_suivi_annuel, cible_id, cible_type, created_at, updated_at`. Extension
  V5.1 : `psp_ligne_id`, `annee_cible`, `montant` (optionnelles) pour les
  arbitrages PSP.
- **`psp_rules`** : `id, nom, type_regle, condition, resultat, justification,
  priorite, statut, created_at, updated_at` — porte les règles PSP (§9).
- **`travaux_commandes_historique`** : `id, commande_id, import_id, operation,
  avant, apres, resolu, created_at` — pattern confirmé pour `psp_ligne_historique`.

---

## 3. Règles d'identité métier (rappel, validées V1-V4)

1. Une **ligne PSP** = `TR + C` (GE/GT/CP). Jamais le descriptif, l'adresse ou le
   numéro de commande.
2. Une ligne PSP n'existe que **dans le cadre d'une version** de programmation
   (un `psp_programmations`).
3. **`ligne_budget`** est acquise au **premier import** du suivi annuel (0 LB
   acquis), jamais inventée.
4. Le **suivi annuel** (49 commandes + 27 lignes sans commande sur 2026) alimente
   les montants constatés ; la **programmation 2026** (59 lignes avec montant,
   feuille « Prog 2026 ») alimente l'esquisse 2027.

---

## 4. Principes de conception

1. **Réutiliser / généraliser plutôt que créer** : aucune table parallèle, aucun
   second moteur d'import.
2. **Référence, jamais duplication** : commandes (`travaux_commandes`),
   fournisseurs (`fournisseurs`), tranches (`tranches`) sont référencées par FK.
3. **Minimum de tables** : 5 nouvelles tables, 2 généralisations, 0 table
   redondante.
4. **Tracabilité complète** : chaque opération (création, modification, report,
   annulation, conflit de catégorie) est journalisée avec delta JSONB, résolution
   et motif.
5. **Lecture à tous les niveaux** : le frontend et les server functions
   reconstruisent KPI, tableaux et export Excel à partir du modèle ; aucun
   agrégat dupliqué.

## 5. Choix du stockage des montants : JSONB `programme` (Option A)

| Critère | Option A : JSONB `{"2027":…}` | Option B : colonnes annuelles |
|---|---|---|
| Cohérence prototype | ✅ `PspOperation.programme` | ❌ mapping forcé |
| Période variable / extension (2032…) | ✅ aucune migration | ❌ colonne à ajouter |
| Diff entre versions | ✅ trivial (jsonb) | ⚠️ comparaison champ à champ |
| Export Excel (colonne par année) | ✅ construit à la volée | ✅ direct |
| Agrégation SQL (totaux annuels) | ⚠️ jsonb (ou colonne générée/vue) | ✅ direct |
| Contrainte de validité | CHECK + fonction proposée | CHECK simples |

**Choix retenu : Option A (JSONB)**. Les totaux annuels sont déjà calculés côté
application (server functions / frontend) ; la période 2027-2031 peut évoluer sans
migration ; le prototype stocke déjà un dictionnaire années → montants. Une
fonction `psp_programme_valide(p, debut, fin)` est proposée pour contraindre les
clés (années 4 chiffres dans la période) et les valeurs (nombres ≥ 0).

---

## 6. Tables proposées (nouvelles)

### 6.1 `psp_programmations` — racine des versions
| Colonne | Type | Contraintes / rôle |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `annee_debut` | integer | 2000-2100 |
| `annee_fin` | integer | ≥ `annee_debut` |
| `version` | integer | ≥ 1 |
| `type` | text | `officielle` \| `simulation` |
| `statut` | text | `brouillon`, `a_valider`, `validee`, `figee`, `archivee`, `simulation` |
| `parent_id` | uuid FK→self | version/simulation d'origine |
| `auteur`, `remarques` | uuid/text | méta |
| `created_at`/`updated_at` | timestamptz | horodatage |
| `validated_at`/`validated_by`, `frozen_at`/`frozen_by` | timestamptz/uuid | jalons de cycle de vie |
| **UNIQUE** | `(annee_debut, version)` | une version par période/numéro |

Exemple (données réelles V4) : `PSP 2027-2031 V1` → `type=officielle statut=brouillon` ;
une simulation → `type=simulation statut=simulation` (jamais officielle).

### 6.2 `psp_lignes` — lignes programmées d'une version
| Colonne | Type | Rôle |
|---|---|---|
| `id` | uuid PK | |
| `programmation_id` | uuid FK→`psp_programmations` (cascade) | appartenance à une version |
| `tranche_code` | text FK→`tranches.code` | identité TR |
| `categorie` | text | `GE` \| `GT` \| `CP` |
| `corps_etat_code`, `corps_etat`, `nature_travaux` | text | descriptif libre (jamais identifiant) |
| `programme` | jsonb | montants par année (Option A) |
| `ligne_budget` | text | acquise au premier import suivi |
| `origine` | text | `preparation` \| `report` \| `esquisse` \| `suivi` |
| `remarques` | text | |
| **UNIQUE** | `(programmation_id, tranche_code, categorie)` | identité métier TR+C dans la version |

### 6.3 `psp_ligne_historique` — historique des lignes
Réutilise le pattern `travaux_commandes_historique` : `operation` (`creation`,
`modification`, `report`, `annulation`, `conflit_categorie`), `avant`/`apres`
(delta JSONB), `resolu`, `motif`, `utilisateur`. Aucun second système générique.

### 6.4 `psp_reports` — reports d'une ligne (2026 → 2027)
Relation **explicite** `source_ligne_id` ↔ `cible_ligne_id` (+ `source_annee`,
`cible_annee`, `montant`, `motif`, `created_by`). Un report n'est **jamais** une
opération orpheline : il lie deux lignes PSP existantes.

### 6.5 `psp_devis` — devis d'une ligne (1..N)
`psp_ligne_id` FK (1..N, pas d'UNIQUE), `fournisseur_id` FK→`fournisseurs` si le
référentiel existe, `entreprise` (libellé de repli), `date_devis`, `montant`,
`statut` (8 valeurs), `commentaire`, `document_reference`. Le montant **programmé**
et le **devis** sont distincts.


## 7. Généralisation de `psp_command_links` (pas de `psp_ligne_commandes`)

La table existante relie déjà `travaux_commandes` ↔ `psp_import_rows`
(rapprochement source, alimente `v_travaux_commandes_enrichies`). Elle est étendue
par une FK optionnelle `psp_ligne_id → psp_lignes(id)` et un domaine
`type_relation` élargi (`commande`, `rattachement_ligne`, `rapprochement_historique`).

- `rattachement_ligne` : **cette commande est rattachée à cette ligne PSP**.
- Le détail de la commande reste dans `travaux_commandes` : **aucune duplication**.
- **`psp_ligne_commandes` n'est PAS créée** (même fonction couverte par une
  table existante généralisée).

## 8. Généralisation de `psp_decisions` (pas de `psp_arbitrages`)

La couche de décisions existante est étendue pour porter les **arbitrages PSP** :
`report`, `annulation`, `conservation`, `reevaluation`, `conflit_categorie`.
Colonnes ajoutées (toutes optionnelles, NULL pour les décisions existantes) :
`psp_ligne_id → psp_lignes(id)`, `annee_cible`, `montant`.

- `cle_metier` = `TR|C` pour les arbitrages de ligne.
- Les décisions existantes (nature / corps_etat / perimetre_psp / rapprochement)
  conservent leur sémantique.
- **`psp_arbitrages` n'est PAS créée.**

## 9. `psp_rules` — règles PSP

`psp_rules` (existante, vide) peut porter les règles de préparation :
- ex. « toute ligne dont la catégorie change entre esquisse et programmation →
  exigence de validation humaine » (`conflit de catégorie`) ;
- ex. « toute ligne non réalisée sur l'année N est proposée au report N+1 » ;
- ex. « les lignes sans commande ne sont pas reportées d'office ».

Règles déclenchées côté serveur (server functions), résultats journalisés dans
`psp_ligne_historique` / `psp_decisions`.

## 10. Versionnement

- Une **programmation** = une période (`annee_debut`/`annee_fin`), une **version**
  (V1, V2, …) et un `type`.
- `UNIQUE(annee_debut, version)` garantit une version par période/numéro.
- `parent_id` relie une version à sa source (ex. simulation dérivée de V1).
- Cycle de vie : `brouillon → a_valider → validee → figee` (+ `archivee` pour les
  périodes closes, `simulation` pour les simulations).
- Chaque modification d'une ligne est journalisée (delta JSONB) — un diff de
  version se lit dans `psp_ligne_historique` sans comparaison destructrice.

## 11. Gel (statut `figee`)

- Une version **figée** est en lecture seule (plus aucune écriture).
- `frozen_at` / `frozen_by` documentent le gel.
- Trigger proposé `prevent_update_if_figee` sur `psp_programmations`
  (rejet des UPDATE/DELETE hors transition de statut) — à valider selon les
  transitions officielles.
- Le gel est **contournable seulement par le service (service_role)** pour un
  cas exceptionnel, tracé via l'historique.


## 12. Reports

- **Déclencheur** : ligne non réalisée / à replanifier constatée dans le suivi
  annuel ou la programmation antérieure.
- **Enregistrement** : `psp_reports` (source ↔ cible, années, montant, motif).
- **Résultat** : la ligne cible est créée dans la nouvelle version avec
  `origine = 'report'` et une entrée `psp_ligne_historique.operation = 'report'`.
- **Badge** : l'UI affiche « REPORTÉ DE 2026 » (déjà en place V4).
- Un report ne modifie **jamais** la version source (figée ou non) : il crée une
  ligne cible dans la version de destination.

## 13. Devis

- Un devis appartient à une **ligne** (`psp_ligne_id`, 1..N).
- `fournisseur_id` référencé si le référentiel existe ; sinon libellé `entreprise`.
- Cycle du devis : `a_demander → demande_envoyee → recu → a_analyser →
  retenu/non_retenu` (+ `expire`, `annule`).
- Le devis **retenu** alimente le montant programmé de l'année suivante
  (arbitrage humain tracé dans `psp_decisions`).

## 14. Commandes

- Le suivi annuel (`travaux_commandes`, déjà en base) est **référencé**, jamais
  copié.
- `psp_command_links` (généralisée) porte la liaison ligne PSP ↔ commande.
- Le rapprochement source (commande ↔ `psp_import_rows`) reste inchangé
  (`psp_command_links` sert les deux usages, distingués par `type_relation`).
- Les montants constatés sont lus dans `travaux_commandes` au moment de
  l'affichage ; aucune copie horodatée (la lecture est instantanée).

## 15. RLS

- **SELECT** : `authenticated` (lecture).
- **Écritures** : `service_role` uniquement (server functions, `BYPASS RLS`) —
  pattern existant (fournisseurs, commandes).
- `REVOKE` explicite des écritures pour `authenticated` ; `GRANT ALL` à
  `service_role`.
- Transitions de statut (validee → figee) contrôlées côté serveur.
- RLS proposée mais **non appliquée** (voir § migration).

## 16. Migration (proposée, non exécutée)

Ordre proposé (idempotent, non destructif) :
1. `CREATE TABLE psp_programmations`
2. `CREATE TABLE psp_lignes` (FK → programmations, tranches)
3. `CREATE TABLE psp_ligne_historique` (FK → lignes)
4. `CREATE TABLE psp_reports` (FK → lignes source/cible)
5. `CREATE TABLE psp_devis` (FK → lignes, fournisseurs)
6. `ALTER TABLE psp_command_links` (+ `psp_ligne_id`, élargir `type_relation`)
7. `ALTER TABLE psp_decisions` (+ `psp_ligne_id`, `annee_cible`, `montant`,
   élargir `type_decision`)
8. Index (proposés, §8 du SQL)
9. Triggers (proposés, §9 du SQL) — à valider
10. RLS (proposée, §10 du SQL) — à valider

**Contraintes de non-exécution** :
- Aucune écriture Supabase tant que le modèle n'est pas validé.
- Aucun `DROP`, aucun `ALTER` destructif, aucun changement de schéma existant
  hors `psp_command_links` / `psp_decisions` (extensions additives).
- Ne **pas** régénérer `src/integrations/supabase/types.ts` avant la migration
  réelle.

## 17. Rollback

- **Avant exécution** : simple suppression des fichiers (aucun effet en base).
- **Après exécution** (si erreur) : les 5 `CREATE TABLE` sont réversibles par
  `DROP TABLE` en cascade (aucune donnée préexistante perdue : toutes les tables
  sont nouvelles).
- **`psp_command_links` / `psp_decisions`** : les colonnes ajoutées sont
  optionnelles → `ALTER TABLE … DROP COLUMN` restauré en l'état initial (les
  données existantes sont préservées ; un `DROP CONSTRAINT` du nouveau CHECK
  restaure l'ancien domaine, script d'annulation fourni).
- Les RLS et triggers sont désactivables sans impact sur les données.

## 18. Ce qui n'est PAS créé (décisions explicites)

| Table écartée | Raison |
|---|---|
| `psp_arbitrages` | `psp_decisions` généralisée couvre les arbitrages |
| `psp_ligne_commandes` | `psp_command_links` généralisée couvre le rattachement |
| `psp_versions` | le versionnement vit dans `psp_programmations` |
| `psp_annees` / colonnes annuelles | stockage JSONB (Option A) |
| tables de rapprochement parallèles | réutilisation du moteur d'import existant |
| table « ancienne programmation » | données 2026 lues dans les vrais fichiers + suivi |

## 19. Prochaines étapes

1. Validation humaine du modèle (ce document + SQL) et arbitrages métier
   restants (« sans commande » vs « pas réalisé », conflit de catégorie,
   sort des tables `psp_decisions`/`psp_rules`).
2. `scripts/test-psp-v5-1-schema.mjs` — audit de cohérence documentaire.
3. Commit documentaire `docs(psp): finalize supabase data model proposal`.
4. **Après validation** : migration réelle + régénération `types.ts`.
5. Ne **jamais** merger dans `develop` avant la fin de l'expérimentation.

