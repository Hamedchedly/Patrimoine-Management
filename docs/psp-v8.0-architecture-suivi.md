# RAPPORT V8.0 — ARCHITECTURE MODULE SUIVI

**Projet** : PAT S11 · **Dépôt** : `Hamedchedly/Patrimoine-Management`
**Branche** : `feat/preparation-psp-prototype` · **SHA de référence** : `d5074feb96cc0e3437848c86711790234e0da4f2`
**Date** : 16/08/2026 · **Nature** : étape d'architecture et de conception fonctionnelle — **aucun code fonctionnel développé**.

> Ce document est le livrable V8.0. Il audite l'existant, identifie les incohérences, propose un
> modèle métier, des flux, des composants UI, des tests et un plan.
> **Aucune migration exécutée, aucune table créée, aucune donnée modifiée.**

---

## 0. Synthèse (TL;DR)

1. **L'existant est largement réutilisable** : ~90 % des besoins V8 sont couverts par les tables et
   fonctions actuelles. **Aucune nouvelle table n'est nécessaire** pour concevoir le Suivi.
2. **Problème critique confirmé** : la revue des reports (`psp.prep.suivi.ts`) rapproche encore sur
   **TR + C** (`cleIdentitePsp`) alors que la base autorise **plusieurs opérations par TR+C**
   (contrainte UNIQUE supprimée par la migration `20260818`). Cette logique doit être **remplacée**,
   pas étendue.
3. **Identité de référence proposée** : `psp_lignes.id` (technique, déjà FK partout) + une **clé
   métier stable** `code_operation` (colonne additive à valider — décision **D1**), héritée lors des
   reports.
4. **Rapprochement cible** : `psp_lignes → psp_command_links → travaux_commandes` (1..N), mécanisme
   déjà créé (`psp_ligne_id`, `methode`, `confiance`, `statut`, `justification`). Le moteur TR+C
   V3/V4 est **obsolète** pour le Suivi.
5. **Statuts séparés impérativement** : STATUT PSP (brouillon→…→annulée) ≠ STATUT OPÉRATIONNEL
   (à lancer → … → clôturée). L'écart actuel entre `psp_lignes.statut` et le cycle cible est un
   problème détecté (décision **D2**).
6. **2 migrations additives proposées, aucune exécutée** : `code_operation` (M1) et extension du
   domaine `psp_lignes.statut` (M2). Rollback trivial. Une vue de lecture `v_psp_suivi_operations`
   est proposée (M3, sans table).
7. **Recommandation** : valider les décisions métier D1–D7 avant d'implémenter ; lancer le
   développement V8 par étapes (V8.1 → V8.6) avec non-régression complète (Dashboard 175/0).

---

## 1. Audit architecture actuelle

### 1.1 Modules et routes existants

| Route | Rôle | État |
|---|---|---|
| `/preparation-psp` | Préparation de la programmation pluriannuelle 2027–2031 (brouillon Supabase, lignes, périmètres, devis, enveloppes, revue des reports V3/V4, export XLSX) | V7.10 opérationnel |
| `/psp-validation` | Classification PSP des commandes importées (périmètre PMR / hors PSP, catégorie, priorité, décisions humaines) | Opérationnel |
| `/dashboard-travaux` | Dashboard des commandes (import Excel annuel) : KPI, carte, historique, décisions | Opérationnel (175 tests) |
| `/import-travaux` | Moteur d'import Excel du suivi annuel | Opérationnel |
| `/import-psp`, `/import` | Import ISIS / classification PSP | Opérationnel |
| `/fournisseurs*`, `/adresses` | Référentiels fournisseurs et patrimoine | Opérationnel |

### 1.2 Composants UI du module Préparation (`src/components/preparation-psp/`)

`PspHeader` (en-tête, source, export) · `PspGroupingSelector` (modes tranche/charge/detail/reports) ·
`PspTable` · `PspOperationRow` · `PspGroupRow` · `PspOperationDetail` (fiche) · `PspOperationForm`
(ajout/modification) · `PspQuickAddRow` (saisie directe) · `PspDevisPanel` (devis, case unique V7.10) ·
`PspSettingsDialog` (+ onglets via `PspEnveloppesDialog`, `PspChargesClienteleDialog`,
`PspCorpsEtatsDialog`) · `PspRevueReports` (revue V3/V4) · `PspAdressePanel` + `useRecherchePatrimoine`
(périmètre) · `PspFournisseurSearch` · `useReferentielCorpsEtats` · `PspAncienneProgrammation` ·
`PspDetailFilters` · `PspSecteurBadge`.

### 1.3 Calque serveur / persistance

- `src/lib/psp.prep.supabase.functions.ts` : server functions service_role (brouillon, lignes, devis,
  périmètres, enveloppes, reports, décisions, commandes, recherche patrimoine, corps d'état, historique).
- `src/lib/travaux.functions.ts` + `src/lib/travaux.dashboard.functions.ts` : import Excel + Dashboard.
- `src/lib/psp.validation.functions.ts` : aperçu/détail validation PSP + décisions.
- `src/lib/psp.prep.data.functions.ts` : référence patrimoine, charges clientèle, fichiers 2026.

### 1.4 Calque pur (testable Node)

`psp.prep.ts` (calculs, types, export) · `psp.prep.v7.ts` (enveloppes, corps d'état, périmètres, CC,
diff) · `psp.prep.suivi.ts` (revue des reports V3/V4 — **TR+C, à refactorer**) · `psp.prep.data.ts`
(recherche patrimoine, programmation) · `psp.classification.ts` · `psp.validation.ts` · `travaux.ts`
(moteur d'import + état des travaux) · `fournisseurs.ts` / `fournisseurs.analyse.ts` · `geo.functions.ts`.---

## 2. Cartographie des sources de vérité

### A. PATRIMOINE (règle §1A — source du « où »)

| Donnée | Table source | Notes |
|---|---|---|
| TR / tranche | `tranches` | `tranches.code` est la FK de `psp_lignes.tranche_code` |
| Sous-secteur | `tranches.sous_secteur` | vérité unique pour le CC |
| ID CC | `psp_charges_clientele` | correspondance `sous_secteur → identifiant_personnel` (uppercase) |
| Lot / adresse / rue / numéro / ER / bâtiment | `lots`, `tranches`, adresses | enrichies à l'affichage, **jamais recopiées** dans PSP |

**Règle strictement respectée** : le CC est **toujours** dérivé de `tranches.sous_secteur` via
`psp_charges_clientele`. Il **n'est jamais** déduit de `travaux_commandes.charge_clientele` ni de la
fréquence historique des commandes (V7.9 l'a acté ; V8 le conserve).

### B. PROGRAMMATION PSP (règle §1B — « ce que nous avons décidé de programmer »)

`psp_programmations` (versions, statut, gel) → `psp_lignes` (opérations, `programme` JSONB par année,
`ligne_budget`, `statut`, `priorite`) → `psp_ligne_patrimoine` (périmètre) · `psp_enveloppes`
(budget) · `psp_devis` (devis, montant nullable, `created_at` = date de demande) · `psp_reports`
(reports d'exercice) · `psp_decisions` (arbitrages) · `psp_ligne_historique` (audit).

### C. EXÉCUTION / SUIVI (règle §1C — « ce qui s'est réellement passé »)

`travaux_commandes` (commande, fournisseur, budget, engagé, payé, solde, écarts, états, dates) ·
`travaux_commandes_historique` (audit des imports) · `import_travaux` + `travaux_import_details`
(journal d'import) · `psp_import_rows` (brut Historique CMD, `numero_commande_interne`) ·
`v_travaux_commandes_enrichies` (vue de rapprochement commande ↔ import ↔ analyse).

**Règle strictement respectée** : **aucune valeur d'exécution n'est recopiée dans `psp_lignes`**.
Le Suivi agrégera à la lecture.

---

## 3. Cartographie des tables (état live 16/08/2026)

### 3.1 PSP — préparation

| Table | Colonnes clés | Rôle V8 |
|---|---|---|
| `psp_programmations` | id, annee_debut, annee_fin, version, type, statut, parent_id, auteur, remarques, validated_at/by, frozen_at/by | racine des versions ; **statut version** (brouillon→a_valider→validee→figee→archivee) |
| `psp_lignes` | id, programmation_id, tranche_code, categorie (GE/GT/CP), corps_etat_code, corps_etat, nature_travaux, programme jsonb, ligne_budget, remarques, origine, statut, priorite, created_at, updated_at | **identité de l'opération** ; aucune contrainte UNIQUE métier depuis `20260818` |
| `psp_ligne_patrimoine` | id, psp_ligne_id, tranche_code, niveau (tranche/rue/adresse/lot), rue, numero, lot_id | périmètre de la fiche opération |
| `psp_enveloppes` | id, programmation_id, annee, categorie, montant ; UNIQUE(programmation_id, annee, categorie) | budget disponible (somme réelle) |
| `psp_devis` | id, psp_ligne_id, fournisseur_id, entreprise, date_devis (null), montant (null), statut, commentaire, document_reference, created_at, updated_at | **demande/reçu** : created_at = date de demande |
| `psp_reports` | id, source_ligne_id, source_annee, cible_ligne_id, cible_annee, montant, motif | trace des reports d'exercice |
| `psp_ligne_historique` | id, ligne_id, operation (creation/modification/report/annulation/conflit_categorie), avant, apres, resolu, motif, created_at | historique des opérations PSP |
| `psp_decisions` | id, type_decision, cible_type, cible_id, cle_metier, proposition_initiale, decision_utilisateur, valeur_retenue, motif, statut, psp_ligne_id, annee_cible, montant | décisions/arbitrages (rapprochement, report, annulation…) |
| `psp_command_links` | id, commande_id, import_row_id, type_relation (commande/rattachement_ligne/rapprochement_historique), methode, confiance (numeric), statut, justification, psp_ligne_id | **mécanisme central du rattachement ligne↔commande** |
| `psp_charges_clientele` | id, sous_secteur, charge_clientele, identifiant_personnel, actif | référentiel CC (vérité §1A) |
| `psp_corps_etats` | id, code, libelle, categorie, actif | référentiel corps d'état |

### 3.2 Exécution / import

| Table | Colonnes clés | Rôle V8 |
|---|---|---|
| `travaux_commandes` | id, numero_commande, secteur, tranche_code, lot_code, batiment, charge_clientele, adresse, nature_analytique, corps_etat, charge_operation, ligne_budget, descriptif, budget, numero_fournisseur, fournisseur, etat_commande, engage, ecart, paye, solde, etat_travaux, date_demarrage, date_fin_travaux, observations, actif, annee_exercice | source unique financière/état des commandes |
| `travaux_commandes_historique` | id, import_id, commande_id, operation, avant, apres, resolu, created_at | historique des imports (conflits, modifs, confirmations) |
| `psp_import_rows` | id, import_id, ligne_numero, numero_commande, numero_commande_interne, er_reference, tranche_er, batiment_er, entree_er, lot_er, corps_etat_code/libelle, nature_analytique, annee_exercice, montants (engage/paye/budget/ecart), fournisseur, adresse, donnees_brutes | brut Historique CMD ; `numero_commande_interne` = clé de rapprochement source |
| `import_travaux` / `travaux_import_details` | journal + détails d'import (type, message, details jsonb) | rapports d'import |
| `fournisseurs` / `fournisseur_aliases` | nom, ville… ; (fournisseur_id, source, identifiant_source) | référentiel fournisseurs + alias (recherche) |
| `v_travaux_commandes_enrichies` | vue : travaux_commandes ⟕ psp_import_rows ⟕ psp_command_links ⟕ psp_command_analysis | vue de rapprochement source (Dashboard, fiches fournisseur) |
---

## 4. Cartographie des fonctions réutilisables

### 4.1 Moteur d'import Excel et états des travaux (`travaux.ts`, `travaux.functions.ts`)
`parseTravauxWorkbook` · `travauxComparable` · `travauxIdentiques` · `champsDifferents` ·
`decisionImportCommande` (creee/inchangee/report/conflit) · `etatMetier` / `isPasRealise` (état des
travaux normalisé — **source unique**) · `getAlertesCommande` · `getDernierImportExercice` ·
`resyncImportErrors` · `commandesAAArchiver` · `visibleArchivage` ·
`createTravauxImport` / `importTravauxBatch` / `finalizeTravauxImport` (server).

### 4.2 Dashboard (`travaux.dashboard.functions.ts`)
`getTravauxDashboard` · `getTravauxStats` · `getCommandeHistorique` · `updateCommandeTravaux` ·
`getPspEnrichissementCommandes` · `resolveHistoriqueTravaux` · `checkTravauxLatestImport`.

### 4.3 Préparation PSP (pur)
`psp.prep.ts` : `montantAnnee`, `totalOperation`, `totalProgramme`, `sommeParAnnee`,
`statsOperations`, `statsDevis`, `construireDonneesExportXlsx`, `trierOperationsDetail`,
`grouperParTranche`, `grouperParChargéClientele`, `comparerProgrammation`.
`psp.prep.v7.ts` : `budgetDisponibleParAnnee`, `budgetDisponibleTotalReel`, `calculEnveloppe`,
`programmeParAnneeCategorie`, `corpsEtatsGroupes`, `categorieDepuisCorpsEtat`,
`adresseExportPatrimoine`, `libelleAdressePerimetre`, `construirePerimetres`, `diffHistorique`,
`applicerReferentielCcUpsert`.
`psp.prep.data.ts` : `construireReferencePatrimoine`, `resoudreTranche`, `parseProgrammationWorkbook`.

### 4.4 Server PSP (`psp.prep.supabase.functions.ts`)
`getPspBrouillon` · `createPspOperationComplete` / `updatePspOperationComplete` (atomiques) ·
`create/update/delete PspDevis` · `createPspPerimetres` · `getPspEnveloppes` / `savePspEnveloppes` ·
`updatePspLigneStatutPriorite` · `createPspReport` · `saveDecisionPsp` · `createPspCommandLink`
(rattachement **manuel** ligne↔commande, résolution réelle de l'import) · `getPspLignesHistorique` ·
`rechercherPatrimoineGlobal`, `rechercherTranches`, `rechercherLotsV7`… · `getCorpsEtats` /
`savePspCorpsEtat` / `savePspChargeClientele`.

### 4.5 Validation PSP (`psp.validation.ts`, `psp.validation.functions.ts`)
`resoudrePerimetrePsp` · `construireCleMetierCommande` · `detecterIncoherenceNature` ·
`extraireChargePsp` · `calculerScorePriorite` · `construireGroupeApercu` ·
`getPspValidationApercu` / `getPspValidationDetail` · `getPspDecision` / `savePspDecision` /
`resoudreDecisionPsp`.

### 4.6 Revue des reports V3/V4 (`psp.prep.suivi.ts`) — **le seul calque à refactorer**
`cleIdentitePsp` (TR+C — **obsolète pour V8**) · `memesCle` · `rapprocherLignes` ·
`analyserLignesReport` · `resumeArbitrage` · `filtrerLignesArbitrage` · `trierLignesRevue` ·
`ligneSuiviDepuisRaw` / `ligneSuiviDepuisCommande` (mapping — **réutilisables**) ·
`detecterModificationsLigne` / `cleModification` / `modificationDejaConfirmee` /
`extraireConfirmationsHistorique` (diff + mémoire — **réutilisables**).

### 4.7 Fournisseurs / géo
`rechercherFournisseurs` (fournisseurs.ts) · `rechercherFournisseursDevis` (server) ·
`villeDepuisAdresse` / `buildDataVilles` / `repartitionCommandesParSecteur` (travaux.ts).

> **Règle de non-duplication V8** : ne pas recréer le moteur d'état des travaux, le moteur d'import,
> le moteur d'historique, la recherche patrimoine, le référentiel CC, le référentiel corps d'état ni
> les calculs budgétaires — tout existe et est listé ci-dessus.

---

## 5. Problèmes détectés

1. **TR+C encore utilisé comme clé de rapprochement** dans `psp.prep.suivi.ts` alors que la base
   autorise plusieurs opérations par TR+C (migration `20260818`) → collisions, opérations masquées,
   modifications attribuées à la mauvaise ligne (§6).
2. **Le mode « reports » repose sur des MOCK en repli** (`SUIVI_2026_MOCK`, `PSP_PROGRAMMATION_2026`,
   `HISTORIQUE_MODIFICATIONS_MOCK`) dans `preparation-psp.tsx` (lignes 62-75, 305-366). Le futur Suivi
   devra être 100 % alimenté par les sources réelles (§2).
3. **Statuts désalignés** : `psp_lignes.statut` ne connaît que `a_definir | attente_agence |
   attente_confirmation`, alors que le cycle cible est Brouillon / À arbitrer / Validée / Figée /
   Reportée / Annulée ; le cycle opérationnel (demande devis → … → clôturée) n'existe nulle part (§9, D2).
4. **Pas de clé métier lisible/stable par opération** : seule `psp_lignes.id` (uuid) identifie une
   ligne ; elle change lors d'un report (nouvelle ligne `origine='report'`), ce qui complique le
   suivi d'une opération sur plusieurs exercices (§7, D1).
5. **`psp_command_links` peu peuplé** : le rattachement ligne↔commande existe (fonction
   `createPspCommandLink`, `psp_ligne_id`) mais l'UI de la fiche opération ne l'expose pas encore
   (pas de section « Commandes » dans `PspOperationDetail`).
6. **`v_travaux_commandes_enrichies` ne joint pas `psp_lignes`** : le rapprochement ligne PSP ↔
   commande doit passer par `psp_command_links.psp_ligne_id` (déjà présent), pas par la vue.
7. **Le CC de `travaux_commandes` peut diverger** de la vérité patrimoniale : affiché tel quel par
   l'import, il ne doit jamais contredire `tranches.sous_secteur → psp_charges_clientele` (règle §1A).
8. **Résidus trompeurs dans `psp.prep.ts`** : `BUDGET_SOURCE = "MOCK"` et
   `PSP_BUDGET_DISPONIBLE_PAR_ANNEE` (3 200 000 €) existent encore (plus utilisés au chargement
   depuis V7.10) ; à supprimer ou neutraliser à la prochaine étape (D5).
9. **Aucune route `/suivi` ni navigation dédiée** : le Suivi devra être accessible et cohérent avec
   le Dashboard (même vue commandes, même historique).
10. **Deux historiques distincts** (`psp_ligne_historique` et `travaux_commandes_historique`) :
    corrects et à conserver, mais la fiche opération devra **fusionner les deux à l'affichage**
    (aucun nouveau stockage).
---

## 6. Problème critique : TR + C

### 6.1 Constat
- `psp_lignes` : la contrainte `UNIQUE (programmation_id, tranche_code, categorie)` a été **supprimée**
  (`20260818_psp_operation_multi_tranche_atomique.sql`) : une tranche peut porter plusieurs opérations
  de même catégorie (toiture GT / chauffage GT / ventilation GT).
- `psp.prep.suivi.ts` : `cleIdentitePsp(tranche, categorie) = tranche|categorie` reste la clé de la
  revue des reports (`rapprocherLignes`, `analyserLignesReport`, `resumeArbitrage`).

### 6.2 Pourquoi TR+C est insuffisant
1. **C n'est pas un identifiant** : c'est une catégorie budgétaire (GE/GT/CP). Deux opérations
   légitimes partagent TR + C.
2. `rapprocherLignes` retient **une seule** ligne du suivi par clé (priorité « ligne_budget présente,
   sinon la 1re ») : les autres opérations du même TR+C sont ignorées ou faussement classées
   « hors programmation ».
3. `detecterModificationsLigne` compare « même TR + même C » : un changement de nature d'une opération
   peut être attribué à une autre opération du même couple.
4. `ligne_budget` peut être **partagée** entre opérations (même imputation comptable) → la « ligne
   budgétaire » ne discrimine pas non plus.
5. Un report d'exercice crée une **nouvelle ligne** (`psp_reports`, `origine='report'`) : le suivi
   de l'opération à travers les exercices exige une identité stable, pas un couple dérivé.

### 6.3 Fonctions qui dépendent aujourd'hui de TR+C
| Fonction | Fichier | Impact |
|---|---|---|
| `cleIdentitePsp`, `memesCle` | `psp.prep.suivi.ts` | clé elle-même — à abandonner pour le Suivi |
| `rapprocherLignes` | `psp.prep.suivi.ts` | cœur du rapprochement programmation↔suivi |
| `analyserLignesReport` | `psp.prep.suivi.ts` | vue « à arbitrer » (V3/V4) |
| `resumeArbitrage`, `filtrerLignesArbitrage`, `ligneMatchKpi` | `psp.prep.suivi.ts` | compteurs/filtres de la revue |
| `detecterModificationsLigne` (commentaire « même TR + même C ») | `psp.prep.suivi.ts` | détection des modifs |
| `comparerProgrammation` (rapproche « même TR + nature normalisée ») | `psp.prep.ts` | comparaison ancienne programmation — à harmoniser |
| `PspRevueReports` (composant) | `src/components/preparation-psp` | UI de la revue |
| scripts `analyse-fichiers-2026.mjs`, `test-psp-prep-suivi.mjs`, `test-psp-prep-v4.mjs`, `test-psp-v74.mjs` | `scripts/` | tests V3/V4 — à faire évoluer |

### 6.4 Ce qui doit changer
- Le **rapprochement ligne PSP ↔ commande** du Suivi utilisera `psp_command_links` (granularité
  **ligne**, pas TR+C) — le seul mécanisme à étendre.
- La revue V3/V4 basée sur TR+C sera **remplacée** (le composant `PspRevueReports` et ses fixtures
  mockées sont obsolètes pour le Suivi) ; ses blocs génériques réutilisables (mapping, diff, mémoire
  de confirmation) sont conservés.

---

## 7. Proposition d'identité opération

### 7.1 Audit des usages (constat)
- **FK réelles** : `psp_devis.psp_ligne_id`, `psp_ligne_patrimoine.psp_ligne_id`,
  `psp_ligne_historique.ligne_id`, `psp_reports.source_ligne_id/cible_ligne_id`,
  `psp_command_links.psp_ligne_id`, `psp_decisions.psp_ligne_id` → **toute la grappe de tables
  PSP est déjà rattachée à `psp_lignes.id`**.
- `psp_reports` exprime déjà « opération de l'exercice N reportée vers N+1 » par couple
  source_ligne_id → cible_ligne_id.
- Aucune autre colonne n'est utilisée comme clé de grappe.

### 7.2 Proposition (à valider — D1)
**Référence technique** : `psp_lignes.id` (inchangé) — unique, déjà FK de tout le graphe.

**Clé métier stable et lisible** : nouvelle colonne `psp_lignes.code_operation` (text, nullable,
ex. `1977-GT-001`).
- Générée automatiquement à la création (`{tranche}-{C}-{NNN}` séquentiel dans la programmation).
- **UNIQUE partielle** `UNIQUE (programmation_id, code_operation)` — distinguer à coup sûr plusieurs
  opérations sur même TR, même C, même année.
- **Héritée lors d'un report** : la ligne cible (`origine='report'`) reprend le
  `code_operation` de la ligne source (via `psp_reports`) → l'opération reste identifiable
  à travers les exercices (besoin « historique du patrimoine »).
- Affichée dans le tableau, la fiche et l'export ; utilisée dans le rapprochement et le diagnostic
  UI (§20).
- Nullable et rétro-compatible : backfill proposé, aucune donnée existante modifiée autrement.

**Alternative sans migration** (si D1 refusée) : clé dérivée de lecture
`(programmation_id, tranche_code, categorie, corps_etat_code, nature_travaux)` utilisée **uniquement
en aide au rapprochement** (jamais comme contrainte) — plus fragile (nature modifiable, corps d'état
nullable).

### 7.3 Conséquences
- `psp.prep.suivi.ts` : `cleIdentitePsp`/`rapprocherLignes`/`analyserLignesReport` sont retirés du
  chemin du Suivi (remplacés par le rapprochement par `id`/`code_operation` + `psp_command_links`).
- `comparerProgrammation` (psp.prep.ts) : aligné sur `code_operation` quand disponible.
- Tests V3/V4 (`test-psp-prep-suivi`, `test-psp-prep-v4`) : conservés pour la rétro-compatibilité du
  prototype, marqués « à remplacer » par les tests V8 du rapprochement par ligne.

---

## 8. Proposition de rapprochement PSP ↔ commandes

### 8.1 Critères actuellement utilisés
1. **Source (existant, inchangé)** : `travaux_commandes.numero_commande` ↔
   `psp_import_rows.numero_commande_interne` (via `v_travaux_commandes_enrichies` et
   `psp_command_links.type_relation IN ('commande','rapprochement_historique')`). Confiance = 1.
2. **Revue V3/V4 (obsolète)** : TR + C (à remplacer, §6).
3. **Manuel (existant)** : `createPspCommandLink` → `psp_command_links` avec `psp_ligne_id`,
   `methode='manuel'`, `confiance=1`, `statut='valide'`.

### 8.2 Cible (3 niveaux, sans nouveau moteur parallèle)
| Niveau | Mécanisme | Statut de confiance |
|---|---|---|
| L1 Rapprochement source | `psp_import_rows.numero_commande_interne` ↔ `travaux_commandes.numero_commande` | AUTO (confiance 1) |
| L2 Rattachement ligne ↔ commande | `psp_command_links.psp_ligne_id` ↔ `commande_id`, `type_relation='rattachement_ligne'` | AUTO-CONFIRMÉ / À CONFIRMER / MANUEL / NON RAPPROCHÉ |
| L3 Agrégation opération | somme des L2 par `psp_lignes.id` (0..N commandes) | affichage lecture seule |

**Système de confiance (données déjà dans `psp_command_links` : `methode`, `confiance` numeric,
`statut`, `justification`)** :
- **AUTO-CONFIRMÉ** : un seul candidat sans ambiguïté → `methode='auto'`, `confiance=1`,
  `statut='valide'` (créé automatiquement).
- **À CONFIRMER** : plusieurs candidats plausibles → `confiance` 0..1, `statut='a_confirmer'`,
  proposition la plus forte affichée, validation humaine requise.
- **MANUEL** : rattachement humain (existant `createPspCommandLink`).
- **NON RAPPROCHÉ** : aucune liaison → opération « sans commande » ou commande « hors programmation ».

**Critères de proposition automatique L2** (à pondérer, seuils = décision **D3**) :
`tranche_code` (TR) exact · `nature_analytique` (C) exact · `ligne_budget` si présente ·
`corps_etat`/`descriptif` similitude (fonctions existantes `corpsEtatsGroupes`, `etatMetier`) ·
année (`annee_exercice` / `programme[annee]`) · fournisseur (via `fournisseur_aliases`).
Le CC n'est **jamais** un critère (§1A).

---

## 9. Cycle de vie opération

**Deux statuts séparés, jamais fusionnés** (implémentation = décision **D2**) :

| STATUT PSP (sur `psp_lignes`/`psp_programmations`) | STATUT OPÉRATIONNEL (dérivé à la lecture, §10) |
|---|---|
| brouillon | à_lancer |
| a_arbitrer | demande_devis |
| validee | devis_recu |
| figee | commande_passee |
| reportee (via `psp_reports` + `psp_decisions`) | travaux_a_demarrer |
| annulee (via `psp_decisions`) | travaux_en_cours |
|  | travaux_termines |
|  | cloturee |

- **STATUT OPÉRATIONNEL dérivé** (recommandé, sans colonne) à partir de : présence de devis
  (`psp_devis`), présence de commandes (`psp_command_links`), `etatMetier` (`travaux_commandes`),
  dates (`date_demarrage`, `date_fin_travaux`). Pas de valeur stockée → aucune désynchronisation.
- **STATUT PSP géré** par `psp_lignes.statut` (à faire évoluer vers le domaine cible — M2) et par le
  gel version (`psp_programmations.statut='figee'`).
- Exemple cible : PSP=VALIDÉE + Opération=DEVIS REÇU (deux badges distincts, aucun recouvrement).
---

## 10. Modèle du futur Suivi

### 10.1 Architecture de données (aucune copie)
```
psp_lignes ──┬── psp_ligne_patrimoine        travaux_commandes (source C)
             ├── psp_devis                   travaux_commandes_historique
             ├── psp_ligne_historique        psp_import_rows
             └── psp_command_links ────────► travaux_commandes
                      (psp_ligne_id ↔ commande_id)
```
Lecture agrégée au moment de l'affichage ; **aucune valeur financière/état copiée dans PSP**.

### 10.2 Nouvelle vue de lecture (proposée, sans table — M3)
`v_psp_suivi_operations` : une ligne par `psp_lignes.id`, avec :
- opération (code, tranche, catégorie, corps d'état, nature, priorité, statut PSP) ;
- périmètre (adresse/lot via `psp_ligne_patrimoine` + `lots`) ;
- programmation (montants par année depuis `programme`, budget disponible depuis `psp_enveloppes`) ;
- devis (dernière demande, devis reçus, min/moy/max via `statsDevis`) ;
- commandes liées (agrégat `psp_command_links` → `travaux_commandes`) ;
- financier : `SUM(budget)`, `SUM(engage)`, `SUM(paye)`, `SUM(solde)` ;
- état opérationnel **dérivé** (logique pure réutilisée, pas de SQL métier dupliqué si possible).

### 10.3 Règles d'agrégation
- `Programmé` = `psp_lignes.programme[année]` (B) · `Commandé` = `SUM(travaux_commandes.budget)`
  (C) · `Engagé` = `SUM(engage)` · `Payé` = `SUM(paye)` · `Reste` = programmé − engagé.
- Un nouvel import Excel modifie `travaux_commandes` → le Suivi **reflète automatiquement** la
  nouvelle valeur à la prochaine lecture (aucune synchro, aucun cache horodaté).

---

## 11. Structure du tableau Suivi

Colonnes (9, pas 25 — le détail est dans la fiche) :

| # | Colonne | Contenu | Source |
|---|---|---|---|
| 1 | OPÉRATION | code_operation + nature/corps d'état | B |
| 2 | TR | tranche_code | B |
| 3 | CC | identifiant_personnel (via tranches.sous_secteur → psp_charges_clientele) | A |
| 4 | C | GE/GT/CP | B |
| 5 | PROGRAMMATION | année cible + budget programmé | B |
| 6 | DEVIS | statut (demande envoyée / reçu + montant) | B |
| 7 | COMMANDE | n° + fournisseur + état | C (via liens) |
| 8 | TRAVAUX | état opérationnel (badge) | dérivé (C) |
| 9 | FINANCIER | programmé / commandé / engagé / payé / restant | B + C |

**Filtres** : année · TR · CC · C · corps d'état · statut PSP · statut opérationnel · fournisseur ·
commande (avec/sans) · priorité · recherche texte (code, nature, n°, fournisseur).

**UX** : chaque ligne mène à la fiche opération ; badges de confiance de rapprochement sur la
colonne COMMANDE ; aucun mock, valeurs réelles uniquement.

---

## 12. Structure de la fiche opération

Recomposition proposée à partir de `PspOperationDetail` + nouveaux blocs (tout est lecture des
sources B + C, rien n'est copié) :

**EN-TÊTE** : code_operation · nature · TR · CC / ID CC (via §1A) · C · corps d'état · priorité ·
STATUT PSP (badge) · STATUT OPÉRATIONNEL (badge dérivé) · bouton « Signaler un problème » (§20).

**PÉRIMÈTRE** : adresse · ER · lot · bâtiment · tranche (`psp_ligne_patrimoine` + `lots`).

**PROGRAMMATION** : tableau 2027–2031 (montant par année, `programme` jsonb) · Budget programmé ·
Budget disponible (`psp_enveloppes`) · Écart.

**DEVIS** : demande (date = `created_at`, entreprise, statut) · réception (date = `date_devis`,
montant nullable, n° document) — réutilise `PspDevisPanel`/`statsDevis`.

**COMMANDES** : liste des `psp_command_links` → `travaux_commandes` : n° commande, fournisseur,
budget, engagé, payé, solde, état commande, état travaux, dates. Actions : rattacher (existant
`createPspCommandLink`), confirmer/refuser une proposition (confiance).

**TRAVAUX** : état (`etatMetier`) · date démarrage · date fin · observations (lecture
`travaux_commandes`).

**HISTORIQUE** : chronologie fusionnée `psp_ligne_historique` (PSP) + `travaux_commandes_historique`
(commandes liées) + devis (`created_at`/`updated_at`) — triée par date, libellés métier.

---

## 13. KPI

KPIs dynamiques (tous calculés depuis les sources réelles B + C, **aucun MOCK**) :

| KPI | Définition |
|---|---|
| Opérations programmées | COUNT(`psp_lignes`) actives |
| Demandes de devis | COUNT(`psp_devis` statut IN demande_envoyee/a_demander) |
| Devis reçus | COUNT(`psp_devis` statut=recu) |
| Commandées | COUNT(opérations avec ≥1 lien `rattachement_ligne` validé) |
| Travaux en cours | opérations dont état dérivé = travaux_en_cours |
| Terminées | état dérivé = travaux_termines |
| Sans commande | opérations sans lien (statut = à_lancer..devis_recu) |
| Budget programmé | SUM(`programme`) |
| Budget commandé | SUM(`travaux_commandes.budget` liées) |
| Budget engagé | SUM(`engage`) |
| Budget payé | SUM(`paye`) |
| Reste à engager | programmé − engagé |

Réutilise les briques pures existantes : `statsOperations`, `sommeParAnnee`,
`budgetDisponibleTotalReel`, `resumeArbitrage` (adapté par ligne), `statsDevis`.

---

## 14. Gestion devis

- **Réutiliser `psp_devis` tel quel** (V7.10 : `montant` nullable, `created_at` = date de demande,
  `date_devis` = date du devis reçu, `statut`, `document_reference`).
- **Une demande sans montant n'est PAS une anomalie** : affichage « Demande le … » + statut
  « demande_envoyee » ; le montant et la date apparaissent quand le devis est reçu (statut « recu »).
- Affichage fiche : **DEMANDE DEVIS** (date) puis **DEVIS REÇU** (date + montant) — exactement le
  modèle du brief.
- Réutilise `PspDevisPanel`, `createPspDevis`/`updatePspDevis`/`deletePspDevis`, `statsDevis`
  (min/moy/max ignorent les montants null — déjà acté V7.10).
- Le devis **n'alimente jamais** le budget programmé (règle V6 conservée).

---

## 15. Gestion commandes

- Mécanisme de rattachement : **`psp_command_links`** (`psp_ligne_id` ↔ `commande_id`),
  `type_relation='rattachement_ligne'` — déjà créé et testé (`createPspCommandLink`).
- **1 opération ↔ 0..N commandes** (ex. toiture : diagnostic + MO + travaux) : agrégation L3 (§8).
- **Commande sans opération PSP** → liste « HORS PROGRAMMATION » (§18), sans création automatique
  de ligne PSP.
- **Opération PSP sans commande** → état « SANS COMMANDE », normal (§19).
- Lecture des montants/états : `travaux_commandes` **en direct** (jamais copié). Si plusieurs
  commandes : le bloc « Commandes » liste chacune ; le FINANCIER agrège les sommes.
- Interaction avec la confiance : confirmer/refuser un rattachement automatique proposé (statuts
  §8.2), réutilise `saveDecisionPsp` (type_decision='rapprochement').
---

## 16. Gestion import Excel

- Le Suivi **ne possède aucun import** : il lit `travaux_commandes` / `travaux_commandes_historique`
  produits par `/import-travaux` (moteur existant, non modifié).
- **Compatibilité automatique** : un nouvel import modifie commande/fournisseur/budget/engagé/payé/
  état/dates → le Suivi affiche les nouvelles valeurs à la prochaine requête (aucune copie, aucun
  cache). Exemple du brief :
  - Programmé 150 000 € (B) · Commandé 143 500 € · Engagé 140 000 € · Payé 75 000 € ·
    Reste 65 000 € (C).
- Les alertes de modification d'import (conflits) restent dans le Dashboard ; la fiche opération
  peut en afficher un résumé via `getCommandeHistorique`/`travaux_commandes_historique`.

---

## 17. Gestion historique

- **Deux systèmes existants, conservés tels quels** :
  - PSP : `psp_ligne_historique` (delta avant/apres, operation creation/modification/report/
    annulation/conflit_categorie, resolu, motif, created_at) — alimenté par trigger + server
    functions.
  - Commandes : `travaux_commandes_historique` (operation, avant/apres, resolu, import_id).
  - Devis : `created_at`/`updated_at` (`psp_devis`).
- Le Suivi **fusionne à l'affichage** (chronologie unique) — aucune table d'historique supplémentaire.
- Réutilise `getPspLignesHistorique`, `detecterModificationsLigne`, `extraireConfirmationsHistorique`,
  `getCommandeHistorique`.
- L'historique du patrimoine (interventions 2023/2024/2025/2026 par TR) s'appuie sur
  `travaux_commandes` + `psp_import_rows` + `psp_command_links` — **aucune duplication**, une vue
  « TR → interventions par exercice » filtrée par `tranche_code` et `annee_exercice`.

---

## 18. Gestion hors programmation

- **Commande importée sans `psp_command_links`** → liste « COMMANDES HORS PROGRAMMATION »
  (TR = 1950, C = GT, aucune ligne PSP) : affichée avec son état réel (C) et signalée
  `NON RAPPROCHÉ`.
- **Aucune création automatique de ligne PSP** : seules des actions humaines explicites sont
  proposées dans la fiche commande :
  1. Rattacher à une opération existante (`createPspCommandLink`, methode='manuel') ;
  2. Créer une opération à partir de la commande (pré-remplissage d'un `PspOperationForm`) ;
  3. Marquer « intervention hors PSP » (décision `psp_decisions`, type_decision='conservation',
     valeur_retenue='hors_psp').
- La revue V3/V4 classait déjà ces lignes « hors_programmation » — logique reprise et étendue au
  niveau **ligne** (pas TR+C).

---

## 19. Gestion sans commande

- **Opération PSP sans commande = situation normale**, jamais une erreur :
  - Badge « SANS COMMANDE » ; statut opérationnel : à_lancer / demande_devis / devis_recu.
  - Indicateurs « Demande devis : Oui/Non », « Devis reçu : Oui/Non » (dérivés de `psp_devis`).
  - Montant programmé conservé (B) ; aucun montant commandé (vide, pas 0 inventé — cohérent
    avec la règle V7.10 « — » au lieu de 0).
- Le KPI « Sans commande » et le filtre correspondant exploitent l'absence de lien L2.

---

## 20. Besoins éventuels de migration

**Aucune migration exécutée.** Propositions (à valider avant V8.1) :

### M1 — `psp_lignes.code_operation` (identité métier, D1)
- Contenu : `add column code_operation text null` ; `UNIQUE (programmation_id, code_operation)` ;
  trigger de génération `{tranche}-{C}-{NNN}` ; backfill des lignes existantes (idempotent) ;
  héritage lors des reports.
- Pourquoi : distinguer plusieurs opérations même TR/C/année et suivre une opération entre
  exercices (§7).
- Impact : **additif** ; aucune donnée modifiée ; index léger.
- Données concernées : `psp_lignes` (nouvelles lignes + backfill).
- Rollback : `drop column code_operation` (et le trigger associé).

### M2 — extension du domaine `psp_lignes.statut` (cycle de vie PSP, D2)
- Contenu : remplacement du CHECK `('a_definir','attente_agence','attente_confirmation')` par
  `('brouillon','a_arbitrer','validee','figee','reportee','annulee')` (avec mapping/backfill
  conservatif : a_definir→a_arbitrer, attente_*→a_arbitrer).
- Pourquoi : aligner le statut PSP sur le cycle cible §9 ; séparer du statut opérationnel.
- Impact : additif sur le domaine (DROP + ADD du CHECK) ; migrations de données limitées aux
  valeurs `a_definir/attente_agence/attente_confirmation` (16 lignes actuelles).
- Rollback : recréation du CHECK précédent.

### M3 — vue `v_psp_suivi_operations` (lecture seule, sans table)
- Contenu : vue SQL de lecture agrégeant B + C (voir §10.2) ; index en appui si besoin.
- Impact : **aucune donnée** ; rollback = `drop view`.

### M4 — (optionnel) `psp_command_links.statut` étendu `'a_confirmer'`
- Si le domaine actuel ne l'inclut pas : extension additive du CHECK pour porter la confiance §8.2.
- Rollback : re-CREATE du CHECK précédent.

> **Aucune nouvelle table n'est nécessaire** : `psp_lignes`, `psp_ligne_patrimoine`, `psp_devis`,
> `psp_reports`, `psp_decisions`, `psp_ligne_historique`, `psp_command_links`, `travaux_commandes`,
> `travaux_commandes_historique`, `psp_import_rows`, `psp_charges_clientele`, `psp_corps_etats`
> couvrent 100 % des besoins fonctionnels identifiés.
---

## 21. Plan de développement V8 par étapes

> Chaque étape = branche déjà active, tests purs + live, `build`/`tsc`/`eslint`, SSR, non-régression
> complète. Aucune étape n'est lancée avant validation de ce rapport.

| Étape | Contenu | Livrable |
|---|---|---|
| **V8.1 — Fondations** | Validation D1/D2 → migrations M1/M2 (+M4 si besoin) ; refactor de l'identité : suppression de `cleIdentitePsp` du chemin Suivi ; `comparerProgrammation` aligné ; vue M3 | modèle + migrations + tests identité |
| **V8.2 — Route Suivi** | `/suivi` : tableau §11 + filtres + navigation ; server fn `getPspSuiviOperations` (lecture B+C via M3 ou agrégation) | tableau opérationnel |
| **V8.3 — Fiche opération** | fiche §12 : en-tête, périmètre, programmation, devis, historique fusionné | fiche lecture |
| **V8.4 — Rapprochement** | propositions automatiques L2 (score, seuils D3), confirmation/refus humain, badges de confiance ; commandes dans la fiche (§15) | rapprochement complet |
| **V8.5 — Hors programmation + sans commande + KPI** | §18/§19/§13 ; historique patrimoine par TR (§17) | vue globale |
| **V8.6 — UX diagnostic** | §20 : bouton « Signaler un problème », identifiant technique de vue, contexte (page, mode, opération, TR, action) | qualité UX |

### 21.1 Dépendances
- V8.1 (identité) est un prérequis de V8.4 (rapprochement) et V8.5 (hors programmation).
- V8.2 peut démarrer sans V8.1 si D1 est rejetée (clé dérivée) — mais V8.4 en sera plus fragile.
- Aucune étape ne touche `/dashboard-travaux`, `/import-travaux`, `/psp-validation` (non-régression
  absolue).

---

## 22. Plan de tests

### 22.1 Nouveaux tests V8 (purs, Node)
| Test | Scénario (brief §21) |
|---|---|
| A | PSP sans commande → badge SANS COMMANDE, financier « — » |
| B | PSP avec demande de devis sans montant (montant null accepté, « Demande le ») |
| C | PSP avec devis reçu (date + montant affichés) |
| D | PSP avec 1 commande (financier agrégé depuis travaux_commandes) |
| E | PSP avec plusieurs commandes (toiture : diagnostic + MO + travaux) |
| F | commande hors programmation (affichée, non créée en PSP) |
| G | opération hors programmation (non créée sans validation) |
| H | opération terminée (état dérivé = travaux_termines) |
| I | opération reportée (ligne cible, `psp_reports`, code_operation hérité) |
| J | modification d'une commande après import (nouvelle valeur reflétée) |
| K | nouvel import Excel (données C actualisées, aucune copie dans PSP) |
| L | rapprochement automatique (score, AUTO-CONFIRMÉ vs À CONFIRMER) |
| M | rapprochement manuel (`createPspCommandLink`) |
| N | refus d'un rapprochement (statut rejeté, commande NON RAPPROCHÉE) |
| O | **plusieurs opérations même TR + C** (2..3 lignes distinctes, zéro collision) |
| P | historique (chronologie fusionnée PSP + commandes) |
| Q | cohérence financier (programmé ≥ commandé ≥ engagé ≥ payé — alertes si non) |
| R | absence de mock (aucune valeur 3 200 000 / 16 000 000 ni `SUIVI_2026_MOCK` dans le chemin Suivi) |

### 22.2 Non-régression (toutes versions)
`test-psp` · `test-psp-functions` · `test-psp-classification` · `test-psp-prep` (+data/suivi/v4) ·
`test-psp-v7`→`v710` (+live) · `test-psp-validation` · `test-psp-preview` · `test-psp-supabase` ·
**`test-dashboard-travaux` (175/0 — Dashboard inchangé)**.

### 22.3 Live (Supabase)
Scénarios D/E/F/I/L/M/N avec données de test marquées (`__V8__`) puis purgées ; vérification que
les 15 enveloppes réelles et les lignes existantes restent intactes.

---

## 23. Risques de régression

1. **Dashboard / import Excel** : le Suivi ne doit **jamais** écrire dans `travaux_commandes`,
   `psp_import_rows`, `import_travaux` → risque nul par construction (lecture seule) ; la
   non-régression `test-dashboard-travaux` (175/0) reste le garde-fou.
2. **Préparation PSP (V7.1→V7.10)** : le refactor de l'identité ne doit pas casser la saisie,
   l'export XLSX, les enveloppes, les devis (case unique) ni le gel. Tests V7 conservés.
3. **`psp.prep.suivi.ts`** : si l'on retire `cleIdentitePsp` du chemin Suivi, le composant
   `PspRevueReports` (prototype V3/V4) reste utilisable pendant la transition — jamais supprimé sans
   remplacement.
4. **Performance** : l'agrégation B+C à la lecture doit rester maîtrisée (vue M3 + index
   `psp_command_links(psp_ligne_id)` existant) ; éviter le N+1 (pattern `getPspBrouillon`).
5. **RLS / service_role** : le Suivi suit le pattern existant (SELECT authenticated, écritures
   service_role) — aucune ouverture de droits.
6. **Gel** : le rapprochement et les rattachements ne doivent pas contourner `prevent_*_if_figee`
   (les écritures sur `psp_command_links` liées à une programmation figée devront respecter le gel
   comme les autres mutations PSP).
7. **Règle §1A** : toute union avec `travaux_commandes.charge_clientele` dans une vue doit rester
   **indicative** (jamais utilisée pour dériver le CC d'une opération PSP).

---

## 24. Recommandation finale

1. **Valider le modèle** : entériner les décisions métier **D1** (clé métier `code_operation`),
   **D2** (statuts PSP cible), **D3** (seuils de confiance du rapprochement), **D4** (remplacement de
   la revue V3/V4 par le Suivi), **D5** (sort/destinée de l'onglet « reports »), **D6** (alimenter
   l'historique patrimonial par TR depuis les imports 2023–2026 existants), **D7** (mécanisme
   « Signaler un problème » retenu).
2. **Aucune implémentation avant validation** de ce rapport.
3. **Aucune migration exécutée à cette étape** ; les propositions M1–M4 sont prêtes pour V8.1.
4. **Aucune nouvelle table requise** ; l'existant couvre le besoin — c'est la conclusion forte de
   cet audit.
5. **Non-régression absolue** sur Dashboard (175/0), import Excel et préparation avant chaque étape.

---

## Décisions métier à trancher (liste D1–D7)

- **D1** — Adopter `psp_lignes.code_operation` (colonne + UNIQUE partielle + héritage report) ou
  rester sur une clé dérivée en lecture ?
- **D2** — Faire évoluer `psp_lignes.statut` vers le cycle cible (brouillon/a_arbitrer/validee/
  figee/reportee/annulee) avec mapping des valeurs actuelles ?
- **D3** — Seuils et pondérations du score de rapprochement automatique (AUTO-CONFIRMÉ / À CONFIRMER) ?
- **D4** — Le Suivi remplace-t-il la « revue des reports » V3/V4 (onglet actuel) ?
- **D5** — Sort des données MOCK du chemin Suivi (suppression de `SUIVI_2026_MOCK`,
  `PSP_PROGRAMMATION_2026`, `HISTORIQUE_MODIFICATIONS_MOCK`, `BUDGET_SOURCE`/`PSP_BUDGET_*`) ?
- **D6** — L'historique patrimonial par TR (2023→2026) est-il alimenté par les imports existants
  uniquement, sans autre source ?
- **D7** — Mécanisme « Signaler un problème » : quel format (bouton + identifiant de vue + contexte
  automatique, sans capture d'écran automatique) ?

---

STOP.

*Fin du rapport V8.0. Aucune étape V8.1 engagée, aucune implémentation du module Suivi démarrée.*
