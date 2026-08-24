// ═══════════════════════════════════════════════════════════════════════════════
// V7.1 — Tests des fonctions PURES du workspace « Préparation PSP » aligné
// (aucune base requise).
//
// Couvre :
//  1. statut / priorité : libellés + tri par header (CleTri étendu) ;
//  2. hiérarchie adresse : rues de tranche → numéros → lots ;
//  3. libellé d'adresse affiché (adresseExportPatrimoine réutilisée) ;
//  4. enveloppe intégrée (calculEnveloppe : consommé / restant / % / dépassement) ;
//  5. corps d'état → catégorie automatique (aucune saisie manuelle) ;
//  6. filtre annuel cumulatif (click année, multi-sélection, désélection).
//
// Exécution : node scripts/test-psp-v71.mjs
// ═══════════════════════════════════════════════════════════════════════════════
import {
  DEVIS_STATUT_LABELS,
  PRIORITE_LABELS,
  STATUT_LABELS,
  adresseExportPatrimoine,
  calculEnveloppe,
  categorieDepuisCorpsEtat,
  filtrerParAnneesCumulatif,
  libelleAdressePerimetre,
  lotsDeAdresse,
  numerosDeRue,
  operationConcerneAnnee,
  ruesDeTranche,
} from "../src/lib/psp.prep.v7.ts";
import { trierOperationsDetail, valeurTriOperation } from "../src/lib/psp.prep.ts";

const PASS = [];
const FAIL = [];
function check(label, cond, detail = "") {
  if (cond) PASS.push(label);
  else FAIL.push(`${label}${detail ? ` — ${detail}` : ""}`);
}

const op = (id, programme, extra = {}) => ({
  id,
  annee: 2027,
  tranche: "1976",
  charge_clientele: "CC",
  charge_operation: "",
  categorie: "GE",
  corps_etat_code: "",
  corps_etat: "(e) Électricité",
  adresse: "RUE CORNILLIOT",
  ville: "THORIGNY-SUR-MARNE",
  sous_secteur: null,
  nature_travaux: `Travaux ${id}`,
  budget: 0,
  programme,
  remarques: null,
  devis: [],
  reportee: false,
  ancienne_annee: null,
  ancien_montant: null,
  ...extra,
});

// ── 1. Statut / priorité ───────────────────────────────────────────────────────
check(
  "S1. libellés statut complets",
  STATUT_LABELS.a_definir === "À définir" &&
    STATUT_LABELS.attente_agence === "Attente retour agence" &&
    STATUT_LABELS.attente_confirmation === "Attente confirmation",
);
check(
  "S2. libellés priorité complets",
  PRIORITE_LABELS.prioritaire === "Prioritaire" &&
    PRIORITE_LABELS.normale === "Normale" &&
    PRIORITE_LABELS.non_prioritaire === "Non prioritaire",
);
check("S3. libellés statut devis présents", DEVIS_STATUT_LABELS.recu === "Reçu");

const opsTri = [
  op("a", { 2027: 1 }, { statut: "attente_agence", priorite: "normale" }),
  op("b", { 2027: 2 }, { statut: "a_definir", priorite: "prioritaire" }),
  op("c", { 2027: 3 }, { statut: "attente_confirmation", priorite: "non_prioritaire" }),
];
const triStatut = trierOperationsDetail(opsTri, "statut", true);
check("S4. tri par Statut (a_definir d'abord)", triStatut[0]?.id === "b");
const triPriorite = trierOperationsDetail(opsTri, "priorite", true);
check("S5. tri par Priorité (non_prioritaire d'abord)", triPriorite[0]?.id === "c");
check(
  "S6. valeurTriOperation statut/priorite",
  valeurTriOperation(opsTri[0], "statut") === "attente_agence" &&
    valeurTriOperation(opsTri[0], "priorite") === "normale",
);

// ── 2. Hiérarchie adresse (rues → numéros → lots) ──────────────────────────────
const lots = [
  { adresse: "12 RUE CORNILLIOT", ville: "THORIGNY-SUR-MARNE" },
  { adresse: "14 RUE CORNILLIOT", ville: "THORIGNY-SUR-MARNE" },
  { adresse: "25-27 RUE DE RUZE", ville: "VAIRES-SUR-MARNE" },
  { adresse: "25-27 RUE DE RUZE", ville: "VAIRES-SUR-MARNE" },
];
const rues = ruesDeTranche(lots);
check("A1. rues distinctes (2)", rues.length === 2, JSON.stringify(rues));
check(
  "A2. nb_lots par rue",
  rues.find((r) => r.rue === "RUE DE RUZE")?.nb_lots === 2 &&
    rues.find((r) => r.rue === "RUE CORNILLIOT")?.nb_lots === 2,
);
check(
  "A3. recherche progressive de rue (q='corn')",
  ruesDeTranche(lots, "corn").length === 1 &&
    ruesDeTranche(lots, "corn")[0].rue === "RUE CORNILLIOT",
);
const numeros = numerosDeRue(lots, "RUE CORNILLIOT");
check(
  "A4. numéros de la rue (12, 14)",
  numeros.length === 2 && numeros[0] === "12 RUE CORNILLIOT" && numeros[1] === "14 RUE CORNILLIOT",
);
const numRuzes = numerosDeRue(lots, "RUE DE RUZE");
check("A5. numéros groupés (25-27)", numRuzes.length === 1 && numRuzes[0] === "25-27 RUE DE RUZE");
check(
  "A6. lotsDeAdresse exacte (2 lots RUZE)",
  lotsDeAdresse(lots, "25-27 RUE DE RUZE").length === 2,
);

// ── 3. Libellé d'adresse affiché dans le tableau ───────────────────────────────
const lotsParId = new Map([
  [
    "lot1",
    { code_patrimoine: "ER.123456", adresse: "12 RUE CORNILLIOT", ville: "THORIGNY-SUR-MARNE" },
  ],
  [
    "lot2",
    { code_patrimoine: "ER.123457", adresse: "12 RUE CORNILLIOT", ville: "THORIGNY-SUR-MARNE" },
  ],
]);
check(
  "P1. sans périmètre → repli adresse/ville",
  libelleAdressePerimetre([], lotsParId, {
    adresse: "RUE CORNILLIOT",
    ville: "THORIGNY-SUR-MARNE",
  }) === "RUE CORNILLIOT, THORIGNY-SUR-MARNE",
);
check(
  "P2. rue entière",
  libelleAdressePerimetre(
    [{ niveau: "rue", rue: "RUE CORNILLIOT", numero: null, lot_id: null }],
    lotsParId,
    { adresse: "", ville: "THORIGNY-SUR-MARNE" },
  ) === "RUE CORNILLIOT, THORIGNY-SUR-MARNE",
);
check(
  "P3. adresse précise",
  libelleAdressePerimetre(
    [{ niveau: "adresse", rue: "RUE CORNILLIOT", numero: "12", lot_id: null }],
    lotsParId,
    { adresse: "", ville: "THORIGNY-SUR-MARNE" },
  ) === "12 RUE CORNILLIOT, THORIGNY-SUR-MARNE",
);
check(
  "P4. lot précis (adresse + ER)",
  libelleAdressePerimetre([{ niveau: "lot", rue: null, numero: null, lot_id: "lot1" }], lotsParId, {
    adresse: "",
    ville: "",
  }) === "12 RUE CORNILLIOT, THORIGNY-SUR-MARNE - ER.123456",
);
check(
  "P5. multi-lots (codes séparés par /)",
  libelleAdressePerimetre(
    [
      { niveau: "lot", rue: null, numero: null, lot_id: "lot1" },
      { niveau: "lot", rue: null, numero: null, lot_id: "lot2" },
    ],
    lotsParId,
    { adresse: "", ville: "" },
  ).includes("ER.123456 / ER.123457"),
);

// ── 4. Enveloppe intégrée (consommé / restant / % / dépassement) ───────────────
const env = calculEnveloppe(300000, 120000);
check("E1. pourcentage 40 %", Math.round(env.pourcentage * 100) === 40);
check("E2. restant 180 000", env.restant === 180000 && !env.depassement);
const dep = calculEnveloppe(300000, 400000);
check("E3. dépassement détecté", dep.depassement && dep.restant === -100000);
check("E4. enveloppe non définie → pourcentage null", calculEnveloppe(0, 0).pourcentage === null);

// ── 5. Corps d'état → catégorie automatique ────────────────────────────────────
check("C1. (d) Couvertures → GT", categorieDepuisCorpsEtat("(d) Couvertures") === "GT");
check("C2. (u) Etanchéité → CP", categorieDepuisCorpsEtat("(u) Etanchéité") === "CP");
check("C3. lettre hors mapping → défaut GT", categorieDepuisCorpsEtat("(x) Inconnu") === "GT");

// ── 6. Filtre annuel cumulatif (clic année, multi, désélection) ────────────────
const opsAnn = [
  op("y27", { 2027: 5000, 2028: 0, 2029: 0, 2030: 0, 2031: 0 }),
  op("y28", { 2027: 0, 2028: 7000, 2029: 0, 2030: 0, 2031: 0 }),
  op("y2728", { 2027: 1000, 2028: 2000, 2029: 0, 2030: 0, 2031: 0 }),
  op("y30", { 2027: 0, 2028: 0, 2029: 0, 2030: 9000, 2031: 0 }),
];
check("F1. aucune année → toutes", filtrerParAnneesCumulatif(opsAnn, []).length === 4);
check("F2. clic 2027 → 2 opérations", filtrerParAnneesCumulatif(opsAnn, [2027]).length === 2);
check(
  "F3. 2027 + 2028 cumulatif → 3 opérations",
  filtrerParAnneesCumulatif(opsAnn, [2027, 2028]).length === 3,
);
check(
  "F4. désélection 2028 → 2027 + 2030 = 3",
  filtrerParAnneesCumulatif(opsAnn, [2027, 2030]).length === 3,
);
check(
  "F5. operationConcerneAnnee",
  operationConcerneAnnee(opsAnn[0], 2027) && !operationConcerneAnnee(opsAnn[0], 2028),
);

// ── Bilan ──────────────────────────────────────────────────────────────────────
console.log(`\nV7.1 — ${PASS.length} PASS / ${FAIL.length} FAIL`);
if (FAIL.length > 0) {
  console.error("ÉCHECS :");
  for (const f of FAIL) console.error(`  ✗ ${f}`);
  process.exit(1);
}
for (const p of PASS) console.log(`  ✓ ${p}`);
console.log("Tous les tests V7.1 passent.");

check("A7. lotsDeAdresse aucun pour rue seule", lotsDeAdresse(lots, "RUE CORNILLIOT").length === 0);
