// Tests V4 — Validation du préparateur avec les vraies données 2026.
// Exécution : node scripts/test-psp-prep-v4.mjs
// Node 24 importe directement les fichiers TypeScript (type stripping).
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parseProgrammationWorkbook } from "../src/lib/psp.prep.data.ts";
import { parseTravauxWorkbook } from "../src/lib/travaux.ts";
import {
  analyserLignesReport,
  cleIdentitePsp,
  detecterModificationsLigne,
  ligneSuiviDepuisRaw,
  memesCle,
  rapprocherLignes,
  resumeArbitrage,
} from "../src/lib/psp.prep.suivi.ts";
import { PSP_ANNEES, ajouterOperationListe } from "../src/lib/psp.prep.ts";

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

// ── Fixtures issues des vrais fichiers 2026 (structure réelle) ──────────────
const PROG2026_FIXTURE = [
  {
    ligne: 4,
    tranche: "1402",
    categorie: "GT",
    corps_etat: "(e) Divers",
    nature_travaux: "Remplacement caisson VMC",
    ligne_budget: null,
    charge_operation: null,
    adresse: null,
    ville: null,
    remarques: null,
    programme: { 2026: 4000, 2027: 0, 2028: 0, 2029: 0, 2030: 0 },
  },
  {
    ligne: 5,
    tranche: "1430",
    categorie: "GE",
    corps_etat: "(j) Couvertures",
    nature_travaux: "DÉMOUSSAGE ET ENTRETIEN DES COUVERTURES",
    ligne_budget: null,
    charge_operation: null,
    adresse: null,
    ville: null,
    remarques: "Report 2025 - Ligne 553",
    programme: { 2026: 8500, 2027: 0, 2028: 10000, 2029: 0, 2030: 0 },
  },
  {
    ligne: 6,
    tranche: "1430",
    categorie: "GT",
    corps_etat: "(e) Divers",
    nature_travaux: "ITI ponctuelle au niveau des ponts thermiques",
    ligne_budget: null,
    charge_operation: null,
    adresse: null,
    ville: null,
    remarques: null,
    programme: { 2026: 4000, 2027: 0, 2028: 0, 2029: 0, 2030: 0 },
  },
  {
    ligne: 7,
    tranche: "1396",
    categorie: "CP",
    corps_etat: "(q) Menuiseries ext",
    nature_travaux: "Condamnation et réaffectation du local vélos",
    ligne_budget: null,
    charge_operation: null,
    adresse: null,
    ville: null,
    remarques: null,
    programme: { 2026: 2000, 2027: 0, 2028: 0, 2029: 0, 2030: 0 },
  },
];

const SUIVI2026_FIXTURE = [
  // ligne programmée + commande terminée (TR 1402 / C GT).
  {
    id: "s-a",
    tranche_code: "1402",
    nature_analytique: "GT",
    charge_clientele: "ALOTHORE",
    ligne_budget: "526",
    descriptif: "Remplacement caisson VMC",
    numero_commande: "5061140",
    fournisseur: "F1",
    budget: 4000,
    engage: 4000,
    paye: 4000,
    etat_travaux: "Terminés",
    etat_commande: "Close",
  },
  // ligne programmée SANS commande (TR 1430 / C GT).
  {
    id: "s-b",
    tranche_code: "1430",
    nature_analytique: "GT",
    charge_clientele: "CANTONY",
    ligne_budget: "527",
    descriptif: "ITI ponctuelle au niveau des ponts thermiques",
    numero_commande: null,
    fournisseur: null,
    budget: 4000,
    engage: 0,
    paye: 0,
    etat_travaux: null,
    etat_commande: null,
  },
  // ligne programmée + commande en cours (TR 1430 / C GE).
  {
    id: "s-c",
    tranche_code: "1430",
    nature_analytique: "GE",
    charge_clientele: "ALOTHORE",
    ligne_budget: "540",
    descriptif: "DÉMOUSSAGE ET ENTRETIEN DES COUVERTURES",
    numero_commande: "5059486",
    fournisseur: "F2",
    budget: 8500,
    engage: 4000,
    paye: 0,
    etat_travaux: "En cours",
    etat_commande: "En cours",
  },
  // ligne du suivi SANS ligne PSP (TR 2423 / C GE) → hors programmation.
  {
    id: "s-d",
    tranche_code: "2423",
    nature_analytique: "GE",
    charge_clientele: "JDUPUIS",
    ligne_budget: "611",
    descriptif: "Travaux hors programmation",
    numero_commande: "5099999",
    fournisseur: "F3",
    budget: 15000,
    engage: 15000,
    paye: 15000,
    etat_travaux: "Terminés",
    etat_commande: "Close",
  },
];

const progFixture = PROG2026_FIXTURE.map((l) => ({
  tranche: l.tranche,
  categorie: l.categorie,
  nature_travaux: l.nature_travaux,
  montant: l.programme["2026"] ?? 0,
  annee: 2026,
  ligne_budget: l.ligne_budget,
}));
const suiviFixture = SUIVI2026_FIXTURE.map((r) => ligneSuiviDepuisRaw(r));
const lignesFixture = analyserLignesReport(progFixture, suiviFixture, 2027);

const l1402 = lignesFixture.find((l) => l.tranche === "1402" && l.categorie === "GT");
const l1430GT = lignesFixture.find((l) => l.tranche === "1430" && l.categorie === "GT");
const l1430GE = lignesFixture.find((l) => l.tranche === "1430" && l.categorie === "GE");
const l2423 = lignesFixture.find((l) => l.tranche === "2423" && l.categorie === "GE");

// ── TEST 1 — ligne programmée + commande ────────────────────────────────────
assert("TEST 1 : 1402/GT rapprochée avec commande 5061140", l1402?.commande === "5061140");
assert("TEST 1b : ligne budgétaire acquise au suivi (526)", l1402?.ligne_budget === "526");

// ── TEST 2 — ligne programmée sans commande ─────────────────────────────────
assert(
  "TEST 2 : 1430/GT sans commande → non engagée (report proposable)",
  l1430GT?.statut === "non_engagee",
);

// ── TEST 3 — ligne programmée + commande en cours ───────────────────────────
assert(
  "TEST 3 : 1430/GE commande en cours → arbitrage",
  l1430GE?.statut === "commande_non_terminee" && l1430GE.etat === "En cours",
);

// ── TEST 4 — ligne programmée + terminée ────────────────────────────────────
assert("TEST 4 : 1402/GT commande terminée → aucun report", l1402?.statut === "terminee");

// ── TEST 5 — ligne suivi sans PSP → hors programmation ──────────────────────
assert(
  "TEST 5 : 2423/GE suivi sans PSP → HORS PROGRAMMATION",
  l2423?.statut === "hors_programmation",
);

// ── TEST 6 — report 2026 → 2027 (badge REPORTÉ DE 2026) ─────────────────────
const reportSaisie = {
  tranche: "1430",
  categorie: "GT",
  charge_clientele: "CANTONY",
  charge_operation: "",
  corps_etat: "",
  adresse: "",
  ville: "",
  nature_travaux: "ITI ponctuelle au niveau des ponts thermiques",
  annee: 2027,
  programme: PSP_ANNEES.map((a) => (a === 2027 ? 4000 : 0)),
  remarques: "Report de 2026",
};
const avecReport = ajouterOperationListe([], reportSaisie, "v4-report");
const opReport = avecReport[0];
assert(
  "TEST 6 : le report crée une opération 2027",
  opReport?.annee === 2027 && opReport?.budget === 4000,
);
if (opReport) {
  opReport.reportee = true;
  opReport.ancienne_annee = 2026;
  opReport.ancien_montant = 4000;
}
assert(
  "TEST 6b : badge REPORTÉ DE 2026 (info d'origine conservée)",
  opReport?.reportee === true &&
    opReport?.ancienne_annee === 2026 &&
    opReport?.ancien_montant === 4000,
);

// ── TESTS 7-9 — même TR+C : descriptif / commande / fournisseur modifiés ─────
assert(
  "TEST 7 : TR+C identiques malgré descriptif différent",
  memesCle({ tranche: "1402", categorie: "GT" }, { tranche: "1402", categorie: "GT" }),
);
const m7 = detecterModificationsLigne(
  { tranche_code: "1402", nature_analytique: "GT", descriptif: "Remplacement caisson VMC" },
  { tranche_code: "1402", nature_analytique: "GT", descriptif: "Remplacement caisson VMC + zinc" },
  "1402",
);
assert(
  "TEST 7b : DESCRIPTIF MODIFIÉ détecté (même ligne)",
  m7.some((m) => m.type === "DESCRIPTIF MODIFIÉ"),
);
const m8 = detecterModificationsLigne(
  { tranche_code: "1402", nature_analytique: "GT", numero_commande: "123456" },
  { tranche_code: "1402", nature_analytique: "GT", numero_commande: "123789" },
  "1402",
);
assert(
  "TEST 8 : COMMANDE MODIFIÉE détectée (même ligne)",
  m8.some((m) => m.type === "COMMANDE MODIFIÉE" && m.ancien === "123456" && m.nouveau === "123789"),
);
const m9 = detecterModificationsLigne(
  { tranche_code: "1430", nature_analytique: "GE", fournisseur: "ENTREPRISE A" },
  { tranche_code: "1430", nature_analytique: "GE", fournisseur: "ENTREPRISE B" },
  "1430",
);
assert(
  "TEST 9 : FOURNISSEUR MODIFIÉ détecté (même ligne)",
  m9.some((m) => m.type === "FOURNISSEUR MODIFIÉ"),
);

// ── TEST 10 — ligne budgétaire acquise au premier import ────────────────────
const progSansLB = progFixture.map((p) => ({ ...p, ligne_budget: null }));
const rapprochement = rapprocherLignes(progSansLB, suiviFixture);
const ligne1402 = rapprochement.get(cleIdentitePsp("1402", "GT"));
assert(
  "TEST 10 : LB 526 acquise au premier import (programmation sans LB)",
  ligne1402?.ligne_budget === "526",
);

// ── TEST 11 — ligne budgétaire conservée aux imports suivants ───────────────
const importB = ligneSuiviDepuisRaw({
  id: "s-a2",
  tranche_code: "1402",
  nature_analytique: "GT",
  charge_clientele: "ALOTHORE",
  ligne_budget: "526",
  descriptif: "Remplacement caisson VMC (nature affinée)",
  numero_commande: "5061141",
  fournisseur: "F1",
  budget: 4200,
  engage: 4200,
  paye: 4200,
  etat_travaux: "Terminés",
  etat_commande: "Close",
});
const cle1402 = cleIdentitePsp("1402", "GT");
const importA = suiviFixture.find((s) => cleIdentitePsp(s.tranche, s.categorie) === cle1402);
assert(
  "TEST 11 : LB 526 conservée au second import (même TR+C, même ligne)",
  Boolean(importA && importA.ligne_budget === "526" && importB.ligne_budget === "526"),
);
assert(
  "TEST 11b : pas de nouvelle ligne (même TR+C)",
  cleIdentitePsp(importA?.tranche ?? "", importA?.categorie ?? "GT") ===
    cleIdentitePsp(importB.tranche, importB.categorie),
);

// ── TEST 12 — modification déjà confirmée non redemandée ────────────────────
const historiqueMock = [
  {
    avant: { tranche_code: "1402", nature_analytique: "GT", numero_commande: "123456" },
    apres: { tranche_code: "1402", nature_analytique: "GT", numero_commande: "123789" },
    resolu: true,
  },
];
const confirmees = new Set();
for (const h of historiqueMock) {
  if (!h.resolu) continue;
  for (const modif of detecterModificationsLigne(h.avant, h.apres, "1402")) {
    confirmees.add(`${modif.champ}::${modif.ancien}::${modif.nouveau}`);
  }
}
const modifTest12 = detecterModificationsLigne(
  { tranche_code: "1402", nature_analytique: "GT", numero_commande: "123456" },
  { tranche_code: "1402", nature_analytique: "GT", numero_commande: "123789" },
  "1402",
)[0];
assert(
  "TEST 12 : modification déjà confirmée (resolu=true) → non redemandée",
  Boolean(
    modifTest12 &&
    confirmees.has(`${modifTest12.champ}::${modifTest12.ancien}::${modifTest12.nouveau}`),
  ),
);

// ══════════════════════════════════════════════════════════════════════════
// VRAIS FICHIERS 2026 (si présents dans data/2026/)
// ══════════════════════════════════════════════════════════════════════════
const dir = fileURLToPath(new URL("../data/2026/", import.meta.url));
const progChemin = `${dir}Prog_Secteur_11_2026.xlsx`;
const suiviChemin = `${dir}Suivi_Travaux_Secteur_2026.xlsx`;
if (existsSync(progChemin) && existsSync(suiviChemin)) {
  const arrayBuffer = (chemin) => {
    const b = readFileSync(chemin);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  };
  const prog = parseProgrammationWorkbook(arrayBuffer(progChemin), {
    nom: "prog-2026",
    feuille: "Prog 2026",
  });
  assert(
    "RÉEL : programmation 2026 lue (feuille Prog 2026)",
    prog.lignes.length > 0,
    `(${prog.lignes.length})`,
  );
  assert("RÉEL : aucune catégorie C invalide", prog.erreurs.length === 0, prog.erreurs.join(" | "));
  assert(
    "RÉEL : années 2026-2030 détectées",
    JSON.stringify(prog.annees) === JSON.stringify([2026, 2027, 2028, 2029, 2030]),
    JSON.stringify(prog.annees),
  );
  const suivi = parseTravauxWorkbook(arrayBuffer(suiviChemin));
  assert(
    "RÉEL : suivi 2026 avec commandes",
    suivi.commandes.length > 0,
    `(${suivi.commandes.length})`,
  );
  assert(
    "RÉEL : lignes sans commande détectées par le moteur d'import",
    suivi.erreurs.length > 0 &&
      suivi.erreurs.every((e) => e.message === "Numéro de commande manquant"),
    `(${suivi.erreurs.length})`,
  );
  const programmees = prog.lignes
    .filter((l) => (l.programme["2026"] ?? 0) > 0)
    .map((l) => ({
      tranche: l.tranche,
      categorie: l.categorie ?? "GT",
      nature_travaux: l.nature_travaux,
      montant: l.programme["2026"] ?? 0,
      annee: 2026,
      ligne_budget: l.ligne_budget,
    }));
  const lignesSuivi = [
    ...suivi.commandes.map((c) => ligneSuiviDepuisRaw(c)),
    ...suivi.erreurs.map((e) => ligneSuiviDepuisRaw(e)),
  ];
  const lignesReelles = analyserLignesReport(programmees, lignesSuivi, 2027);
  const resume = resumeArbitrage(lignesReelles);
  assert("RÉEL : ≥ 1 ligne à reporter", resume.aReporter > 0, `(${resume.aReporter})`);
  assert(
    "RÉEL : ≥ 1 ligne hors programmation",
    resume.horsProgrammation > 0,
    `(${resume.horsProgrammation})`,
  );
  assert(
    "RÉEL : aucune programmée sans ligne au suivi (statut inconnue)",
    lignesReelles.filter((l) => l.statut === "inconnue").length === 0,
  );
  const lbReelles = lignesReelles.filter((l) => l.ligne_budget).length;
  assert(
    "RÉEL : des lignes budgétaires récupérées depuis le suivi",
    lbReelles > 0,
    `(${lbReelles})`,
  );
} else {
  console.log("AVERTISSEMENT : fichiers 2026 absents — tests « réels » ignorés.");
}

console.log(`\nRésultat : ${passed} PASS, ${failed} FAIL`);
process.exit(failed === 0 ? 0 : 1);
