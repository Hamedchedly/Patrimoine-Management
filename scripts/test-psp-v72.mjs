// ═══════════════════════════════════════════════════════════════════════════════
// V7.2 — Tests des fonctions PURES de la consolidation UX métier (aucune base).
//
// Couvre (logique pure derrière les écrans) :
//  1. construirePerimetres : tranche / rue / multi-adresses / multi-lots ;
//  2. numeroDeEntree (« 25-27 RUE DE RUZE » → « 25-27 ») ;
//  3. programmeParAnneeCategorie (répartition annuelle GE/GT/CP intégrée) ;
//  4. multi-années (une opération sur plusieurs années) + filtre cumulatif ;
//  5. corps d'état → catégorie automatique ;
//  6. statut / priorité (libellés + tri headers) ;
//  7. devis (libellés statut + numéro document_reference).
//
// Les scénarios dépendants de la base (TR inexistante, ER → lot → TR,
// locataire → lot, lot d'une autre TR rejeté, gel, suppression réelle) sont
// couverts par test-psp-v7-live.mjs et test-psp-supabase.mjs (non-régression).
//
// Exécution : node scripts/test-psp-v72.mjs
// ═══════════════════════════════════════════════════════════════════════════════
import {
  DEVIS_STATUT_LABELS,
  PRIORITE_LABELS,
  STATUT_LABELS,
  calculEnveloppe,
  categorieDepuisCorpsEtat,
  construirePerimetres,
  filtrerParAnneesCumulatif,
  numeroDeEntree,
  programmeParAnneeCategorie,
} from "../src/lib/psp.prep.v7.ts";
import { trierOperationsDetail } from "../src/lib/psp.prep.ts";

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
  charge_clientele: "ALOTHORE",
  charge_operation: "",
  categorie: "GT",
  corps_etat_code: "",
  corps_etat: "(d) Couvertures",
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

// ── 1. Périmètre patrimonial (construirePerimetres) ────────────────────────────
check(
  "P1. toute la tranche (mode force)",
  JSON.stringify(construirePerimetres({ lots: [], adresses: [], rue: null, mode: "force" })) ===
    JSON.stringify([{ niveau: "tranche", rue: null, numero: null, lot_id: null }]),
);
check(
  "P2. toute la rue",
  JSON.stringify(
    construirePerimetres({ lots: [], adresses: [], rue: "RUE CORNILLIOT", mode: "auto" }),
  ) === JSON.stringify([{ niveau: "rue", rue: "RUE CORNILLIOT", numero: null, lot_id: null }]),
);
const multiAdresses = construirePerimetres({
  lots: [],
  adresses: ["12 RUE CORNILLIOT", "14 RUE CORNILLIOT"],
  rue: "RUE CORNILLIOT",
  mode: "auto",
});
check(
  "P3. multi-adresses (même rue)",
  multiAdresses.length === 2 && multiAdresses[0]?.numero === "12",
);
const multiLots = construirePerimetres({
  lots: [
    { id: "lot1", adresse: "12 RUE CORNILLIOT" },
    { id: "lot2", adresse: "12 RUE CORNILLIOT" },
  ],
  adresses: [],
  rue: "RUE CORNILLIOT",
  mode: "auto",
});
check(
  "P4. multi-lots (niveau lot prioritaire)",
  multiLots.length === 2 && multiLots.every((p) => p.niveau === "lot" && p.lot_id),
);
const adressePrecise = construirePerimetres({
  lots: [],
  adresses: ["25-27 RUE DE RUZE"],
  rue: "RUE DE RUZE",
  mode: "auto",
});
check("P5. adresse précise (numéro déduit)", adressePrecise[0]?.numero === "25-27");
check(
  "P6. numeroDeEntree",
  numeroDeEntree("25-27 RUE DE RUZE") === "25-27" && numeroDeEntree("12 RUE A") === "12",
);

// ── 2. Répartition annuelle intégrée (GE/GT/CP sous chaque année) ──────────────
const opsAn = [
  op("o1", { 2027: 300000, 2028: 120000 }, { categorie: "GT" }),
  op("o2", { 2027: 150000 }, { categorie: "GE" }),
  op("o3", { 2028: 90000, 2030: 40000 }, { categorie: "CP" }),
];
const par = programmeParAnneeCategorie(opsAn);
check("R1. 2027|GT = 300000", par["2027|GT"] === 300000);
check("R2. 2027|GE = 150000", par["2027|GE"] === 150000);
check("R3. 2028|CP = 90000", par["2028|CP"] === 90000);
check("R4. multi-années opération o1 (2027+2028)", par["2028|GT"] === 120000);
check("R5. aucune clé hors programme", par["2031|CP"] === undefined);
const envGt = calculEnveloppe(400000, 300000 + 120000);
check(
  "R6. enveloppe GT : % et dépassement",
  Math.round(envGt.pourcentage * 100) === 105 && envGt.depassement,
);

// ── 3. Filtre annuel cumulatif (multi-années) ──────────────────────────────────
check("F1. clic 2027 → 2 opérations", filtrerParAnneesCumulatif(opsAn, [2027]).length === 2);
check("F2. 2027+2028 → 3 (cumulatif)", filtrerParAnneesCumulatif(opsAn, [2027, 2028]).length === 3);
check(
  "F3. désélection 2027 → 2028+2030",
  filtrerParAnneesCumulatif(opsAn, [2028, 2030]).length === 2,
);

// ── 4. Corps d'état → catégorie ────────────────────────────────────────────────
check("C1. (d) Couvertures → GT", categorieDepuisCorpsEtat("(d) Couvertures") === "GT");
check("C2. (u) Etanchéité → CP", categorieDepuisCorpsEtat("(u) Etanchéité") === "CP");
check("C3. défaut GT", categorieDepuisCorpsEtat("(x) Inconnu") === "GT");

// ── 5. Statut / priorité ───────────────────────────────────────────────────────
check(
  "S1. libellés statut",
  STATUT_LABELS.a_definir === "À définir" &&
    STATUT_LABELS.attente_agence === "Attente retour agence" &&
    STATUT_LABELS.attente_confirmation === "Attente confirmation",
);
check(
  "S2. libellés priorité",
  PRIORITE_LABELS.prioritaire === "Prioritaire" &&
    PRIORITE_LABELS.normale === "Normale" &&
    PRIORITE_LABELS.non_prioritaire === "Non prioritaire",
);
const opsTri = [
  op("a", { 2027: 1 }, { statut: "attente_confirmation", priorite: "non_prioritaire" }),
  op("b", { 2027: 2 }, { statut: "a_definir", priorite: "prioritaire" }),
  op("c", { 2027: 3 }, { statut: "attente_agence", priorite: "normale" }),
];
check("S3. tri Statut asc", trierOperationsDetail(opsTri, "statut", true)[0]?.id === "b");
check("S4. tri Priorité asc", trierOperationsDetail(opsTri, "priorite", true)[0]?.id === "a");

// ── 6. Devis (numéro porté par document_reference) ─────────────────────────────
check(
  "D1. statuts devis présents",
  DEVIS_STATUT_LABELS.recu === "Reçu" && DEVIS_STATUT_LABELS.retenu === "Retenu",
);

// ── Bilan ──────────────────────────────────────────────────────────────────────
console.log(`\nV7.2 — ${PASS.length} PASS / ${FAIL.length} FAIL`);
if (FAIL.length > 0) {
  console.error("ÉCHECS :");
  for (const f of FAIL) console.error(`  ✗ ${f}`);
  process.exit(1);
}
for (const p of PASS) console.log(`  ✓ ${p}`);
console.log("Tous les tests V7.2 passent.");
