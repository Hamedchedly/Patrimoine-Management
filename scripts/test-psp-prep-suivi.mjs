// Tests V3 — Revue des reports (src/lib/psp.prep.suivi.ts)
// Exécution : node scripts/test-psp-prep-suivi.mjs
// Node 24 importe directement les fichiers TypeScript (type stripping).
import {
  HISTORIQUE_MODIFICATIONS_MOCK,
  PSP_PROGRAMMATION_2026,
  SUIVI_2026_MOCK,
  analyserLignesReport,
  cleIdentitePsp,
  detecterModificationsLigne,
  extraireConfirmationsHistorique,
  ligneSansCommande,
  memesCle,
  modificationDejaConfirmee,
  rapprocherLignes,
  resumeArbitrage,
} from "../src/lib/psp.prep.suivi.ts";
import { PSP_ANNEES, ajouterOperationListe } from "../src/lib/psp.prep.ts";
import { etatMetier } from "../src/lib/travaux.ts";

let passed = 0;
let failed = 0;

function assert(name, cond, detail = "") {
  if (cond) {
    passed += 1;
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const EXERCICE = 2027; // préparation 2027 → revue des reports 2026

// ══════════════════════════════════════════════════════════════════════════
// TEST 1 — Même TR + même C + descriptif différent → même ligne + modification
// ══════════════════════════════════════════════════════════════════════════
assert(
  "TEST 1a : TR+C identiques → même ligne",
  memesCle({ tranche: "1976", categorie: "CP" }, { tranche: "1976", categorie: "CP" }),
);
const modifDescriptif = detecterModificationsLigne(
  { tranche_code: "1976", nature_analytique: "CP", descriptif: "Réfection toiture" },
  { tranche_code: "1976", nature_analytique: "CP", descriptif: "Réfection couverture" },
  "1976",
);
assert(
  "TEST 1b : DESCRIPTIF MODIFIÉ détecté (même ligne conservée)",
  modifDescriptif.some(
    (m) =>
      m.type === "DESCRIPTIF MODIFIÉ" &&
      m.ancien === "Réfection toiture" &&
      m.nouveau === "Réfection couverture",
  ),
  JSON.stringify(modifDescriptif),
);

// ══════════════════════════════════════════════════════════════════════════
// TEST 2 — Même TR + même C + commande différente → même ligne + modification
// ══════════════════════════════════════════════════════════════════════════
const modifCommande = detecterModificationsLigne(
  { tranche_code: "1976", nature_analytique: "CP", numero_commande: "123456" },
  { tranche_code: "1976", nature_analytique: "CP", numero_commande: "123789" },
  "1976",
);
assert(
  "TEST 2 : COMMANDE MODIFIÉE détectée (123456 → 123789)",
  modifCommande.some(
    (m) => m.type === "COMMANDE MODIFIÉE" && m.ancien === "123456" && m.nouveau === "123789",
  ),
);

// ══════════════════════════════════════════════════════════════════════════
// TEST 3 — Même TR + même C + fournisseur différent → même ligne + modification
// ══════════════════════════════════════════════════════════════════════════
const modifFournisseur = detecterModificationsLigne(
  { tranche_code: "2086", nature_analytique: "GE", fournisseur: "ENTREPRISE A" },
  { tranche_code: "2086", nature_analytique: "GE", fournisseur: "ENTREPRISE B" },
  "2086",
);
assert(
  "TEST 3 : FOURNISSEUR MODIFIÉ détecté",
  modifFournisseur.some(
    (m) =>
      m.type === "FOURNISSEUR MODIFIÉ" &&
      m.ancien === "ENTREPRISE A" &&
      m.nouveau === "ENTREPRISE B",
  ),
);

// ══════════════════════════════════════════════════════════════════════════
// TEST 4 — Même TR + C différent → ligne distincte
// ══════════════════════════════════════════════════════════════════════════
assert(
  "TEST 4 : TR 1976 + C différent → lignes distinctes",
  !memesCle({ tranche: "1976", categorie: "CP" }, { tranche: "1976", categorie: "GE" }),
);
assert(
  "TEST 4b : clés d'identité distinctes (CP ≠ GE)",
  cleIdentitePsp("1976", "CP") !== cleIdentitePsp("1976", "GE"),
);

// ══════════════════════════════════════════════════════════════════════════
// TEST 5 — Ligne PSP sans commande → résultat du moteur d'import (etatMetier)
// ══════════════════════════════════════════════════════════════════════════
const lignesArbitrage = analyserLignesReport(PSP_PROGRAMMATION_2026, SUIVI_2026_MOCK, EXERCICE);
const anc1 = lignesArbitrage.find((l) => l.tranche === "1976" && l.categorie === "CP");
const suivi001 = SUIVI_2026_MOCK[0];
assert(
  "TEST 5a : ligne 1976/CP sans commande reconnue",
  Boolean(suivi001 && ligneSansCommande(suivi001)),
);
assert(
  "TEST 5b : état issu du moteur (etatMetier) exploité",
  Boolean(suivi001 && typeof etatMetier(suivi001, EXERCICE) === "string"),
);
assert(
  "TEST 5c : 1976/CP → non engagée (report proposable)",
  anc1?.statut === "non_engagee",
  anc1?.statut ?? "?",
);

// ══════════════════════════════════════════════════════════════════════════
// TEST 6 — Nouvelle ligne de suivi sans ligne PSP → hors programmation
// ══════════════════════════════════════════════════════════════════════════
const hp = lignesArbitrage.find((l) => l.tranche === "3049" && l.categorie === "CP");
assert(
  "TEST 6 : suivi 3049/CP → HORS PROGRAMMATION",
  hp?.statut === "hors_programmation",
  hp?.statut ?? "?",
);

// ══════════════════════════════════════════════════════════════════════════
// TEST 7 — Modification déjà confirmée → ne pas redemander
// ══════════════════════════════════════════════════════════════════════════
const confirmees = extraireConfirmationsHistorique(HISTORIQUE_MODIFICATIONS_MOCK);
const ligneResolue = HISTORIQUE_MODIFICATIONS_MOCK[2];
const modifResolue = detecterModificationsLigne(ligneResolue.avant, ligneResolue.apres, "2086")[0];
assert(
  "TEST 7a : modification déjà confirmée (resolu=true) → ne pas redemander",
  modifResolue ? modificationDejaConfirmee(confirmees, modifResolue) : false,
);
const ligneNonResolue = HISTORIQUE_MODIFICATIONS_MOCK[0];
const modifNonResolue = detecterModificationsLigne(
  ligneNonResolue.avant,
  ligneNonResolue.apres,
  "1976",
)[0];
assert(
  "TEST 7b : modification non confirmée → alerte demandée",
  modifNonResolue ? !modificationDejaConfirmee(confirmees, modifNonResolue) : false,
);

// ══════════════════════════════════════════════════════════════════════════
// TEST 8 — Ligne 2026 sans commande → proposer report dans le préparateur 2027
// ══════════════════════════════════════════════════════════════════════════
assert("TEST 8 : 1976/CP non engagée (report proposable)", anc1?.statut === "non_engagee");
const saisieReport = {
  tranche: anc1?.tranche ?? "1976",
  categorie: anc1?.categorie ?? "CP",
  charge_clientele: "",
  charge_operation: "",
  corps_etat: "",
  adresse: "",
  ville: "",
  nature_travaux: anc1?.nature_travaux ?? "Réfection toiture",
  annee: 2027,
  programme: PSP_ANNEES.map((a) => (a === 2027 ? (anc1?.montant_programme ?? 0) : 0)),
  remarques: "Report de 2026",
};
const avecReport = ajouterOperationListe([], saisieReport, "test-report-2027");
assert(
  "TEST 8b : le report crée une opération 2027 dans le brouillon",
  avecReport.length === 1 && avecReport[0].annee === 2027 && avecReport[0].budget === 35000,
);

// ══════════════════════════════════════════════════════════════════════════
// TEST 9 — Ligne 2026 avec commande terminée → ne pas proposer un report
// ══════════════════════════════════════════════════════════════════════════
const anc2 = lignesArbitrage.find((l) => l.tranche === "2086" && l.categorie === "GE");
assert(
  "TEST 9 : 2086/GE commande terminée → aucun report",
  anc2?.statut === "terminee",
  anc2?.statut ?? "?",
);

// ══════════════════════════════════════════════════════════════════════════
// TEST 10 — Ligne 2026 avec commande non terminée → état réel + arbitrage
// ══════════════════════════════════════════════════════════════════════════
const anc3 = lignesArbitrage.find((l) => l.tranche === "2100" && l.categorie === "GE");
assert(
  "TEST 10 : 2100/GE commande non terminée → état réel « En cours » + arbitrage",
  anc3?.statut === "commande_non_terminee" && anc3.etat === "En cours",
  `${anc3?.statut} / ${anc3?.etat}`,
);
assert("TEST 10b : commande affichée", anc3?.commande === "234567");

// ══════════════════════════════════════════════════════════════════════════
// Compléments : rapprochement, résumé, pas réalisée
// ══════════════════════════════════════════════════════════════════════════
const rapprochement = rapprocherLignes(PSP_PROGRAMMATION_2026, SUIVI_2026_MOCK);
assert(
  "rapprochement : chaque programmée a une clé",
  rapprochement.size === PSP_PROGRAMMATION_2026.length,
);
const anc4 = lignesArbitrage.find((l) => l.tranche === "2178" && l.categorie === "CP");
assert(
  "pas réalisée : 2178/CP → pas_realisee (clôturée sans engagement)",
  anc4?.statut === "pas_realisee",
  anc4?.statut ?? "?",
);
const resume = resumeArbitrage(lignesArbitrage);
assert(
  "résumé : comptes cohérents (1 terminée, 2 non engagées, 2 non terminées, 1 pas réalisée, 1 hors programmation)",
  resume.terminees === 1 &&
    resume.sansCommande === 2 &&
    resume.commandeNonTerminee === 2 &&
    resume.pasRealisees === 1 &&
    resume.horsProgrammation === 1,
  JSON.stringify(resume),
);

console.log(`\nRésultat : ${passed} PASS, ${failed} FAIL`);
process.exit(failed === 0 ? 0 : 1);
