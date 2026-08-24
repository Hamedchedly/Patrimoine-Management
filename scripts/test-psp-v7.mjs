// ═══════════════════════════════════════════════════════════════════════════════
// V7 — Tests des fonctions PURES de préparation (aucune base requise).
//
//  1. filtre année 2027 · 2. 2027+2028 · 3. désélection 2028 · 4. combinaisons
//  12. corps d'état → catégorie · 16. calcul restant · 17. dépassement
//  21+29. export adresse structurée
// Exécution : node scripts/test-psp-v7.mjs
// ═══════════════════════════════════════════════════════════════════════════════
import {
  CORPS_ETAT_CATEGORIE,
  adresseExportPatrimoine,
  calculEnveloppe,
  categorieDepuisCorpsEtat,
  filtrerParAnneesCumulatif,
  operationConcerneAnnee,
} from "../src/lib/psp.prep.v7.ts";
const PASS = [];
const FAIL = [];
function check(label, cond, detail = "") {
  if (cond) PASS.push(label);
  else FAIL.push(`${label}${detail ? ` — ${detail}` : ""}`);
}

const op = (id, programme) => ({
  id,
  annee: 2027,
  tranche: "1976",
  charge_clientele: "CC",
  charge_operation: "",
  categorie: "GE",
  corps_etat_code: "j",
  corps_etat: "(j) Couvertures",
  adresse: "",
  ville: "",
  sous_secteur: null,
  nature_travaux: "N",
  budget: Object.values(programme).reduce((s, v) => s + v, 0),
  programme,
  remarques: null,
  devis: [],
  reportee: false,
  ancienne_annee: null,
  ancien_montant: null,
});

const A = op("A", { 2027: 1000, 2029: 500 });
const B = op("B", { 2028: 2000 });
const C = op("C", { 2030: 300 });
const ops = [A, B, C];

// ── 1-4. Filtre annuel cumulatif ────────────────────────────────────────────────
check(
  "1. filtre 2027 → A seulement",
  filtrerParAnneesCumulatif(ops, [2027])
    .map((o) => o.id)
    .join() === "A",
);
check(
  "2. filtre 2027+2028 → A+B",
  filtrerParAnneesCumulatif(ops, [2027, 2028])
    .map((o) => o.id)
    .join(",") === "A,B",
);
check(
  "3. désélection 2028 → A seul",
  filtrerParAnneesCumulatif(ops, [2027])
    .map((o) => o.id)
    .join() === "A",
);
check(
  "3b. 2028 seul → B",
  filtrerParAnneesCumulatif(ops, [2028])
    .map((o) => o.id)
    .join() === "B",
);
check(
  "4. 2027+2029 → A (cumul par OR)",
  filtrerParAnneesCumulatif(ops, [2027, 2029])
    .map((o) => o.id)
    .join() === "A",
);
check("4b. aucune sélection → toutes", filtrerParAnneesCumulatif(ops, []).length === 3);
check("4c. 2031 (aucune ligne) → vide", filtrerParAnneesCumulatif(ops, [2031]).length === 0);
check(
  "4d. opérationConcerneAnnee A/2027",
  operationConcerneAnnee(A, 2027) && !operationConcerneAnnee(A, 2028),
);

// ── 12. Corps d'état → catégorie ────────────────────────────────────────────────
check("12. (u) Etanchéité → CP", categorieDepuisCorpsEtat("(u) Etanchéité") === "CP");
check("12. (j) Couvertures → GE", categorieDepuisCorpsEtat("(j) Couvertures") === "GE");
check("12. (o) Plomberie → CP", categorieDepuisCorpsEtat("(o) Plomberie") === "CP");
check("12. (c) Isolation → GT", categorieDepuisCorpsEtat("(c) Isolation") === "GT");
check("12. inconnu → GT (défaut)", categorieDepuisCorpsEtat("(zz) Inconnu") === "GT");
check("12. sans parenthèse → GT (défaut)", categorieDepuisCorpsEtat("Ravalement") === "GT");
check("12. mapping couvre 16 codes réels 2026", Object.keys(CORPS_ETAT_CATEGORIE).length === 16);

// ── 16-17. Enveloppes ───────────────────────────────────────────────────────────
check("16. restant = enveloppe - programme", calculEnveloppe(300000, 120000).restant === 180000);
check(
  "16. pourcentage 40 %",
  Math.abs((calculEnveloppe(300000, 120000).pourcentage ?? 0) - 0.4) < 1e-9,
);
check(
  "17. dépassement (restant < 0)",
  calculEnveloppe(100000, 120000).depassement === true &&
    calculEnveloppe(100000, 120000).restant === -20000,
);
check("17b. pas de dépassement si égal", calculEnveloppe(100000, 100000).depassement === false);
check(
  "17c. enveloppe nulle → pourcentage null, pas de dépassement",
  calculEnveloppe(0, 50000).pourcentage === null && calculEnveloppe(0, 50000).depassement === false,
);

// ── 21/29. Export adresse structurée ────────────────────────────────────────────
check(
  "29. adresse précise sans lot",
  adresseExportPatrimoine({
    niveau: "adresse",
    rue: "RUE CORNILLIOT",
    numero: "12",
    ville: "THORIGNY-SUR-MARNE",
  }) === "12 RUE CORNILLIOT, THORIGNY-SUR-MARNE",
);
check(
  "29. adresse + 1 lot",
  adresseExportPatrimoine({
    niveau: "adresse",
    rue: "RUE CORNILLIOT",
    numero: "12",
    ville: "THORIGNY-SUR-MARNE",
    lots: [{ code_patrimoine: "ER.123456" }],
  }) === "12 RUE CORNILLIOT, THORIGNY-SUR-MARNE - ER.123456",
);
check(
  "29. adresse + 2 lots",
  adresseExportPatrimoine({
    niveau: "adresse",
    rue: "RUE CORNILLIOT",
    numero: "12",
    ville: "THORIGNY-SUR-MARNE",
    lots: [{ code_patrimoine: "ER.123456" }, { code_patrimoine: "ER.123457" }],
  }) === "12 RUE CORNILLIOT, THORIGNY-SUR-MARNE - ER.123456 / ER.123457",
);
check(
  "29. rue entière",
  adresseExportPatrimoine({ niveau: "rue", rue: "RUE CORNILLIOT", ville: "THORIGNY-SUR-MARNE" }) ===
    "RUE CORNILLIOT, THORIGNY-SUR-MARNE",
);
check(
  "29. tranche entière (sans adresse connue) → ville seule",
  adresseExportPatrimoine({ niveau: "tranche", ville: "THORIGNY-SUR-MARNE" }) ===
    "THORIGNY-SUR-MARNE",
);

console.log("\n=== BILAN ===");
console.log(`  PASS : ${PASS.length}`);
console.log(`  FAIL : ${FAIL.length}`);
if (FAIL.length > 0) {
  console.log("\nÉCHECS :");
  for (const f of FAIL) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log("\nTous les tests PURS V7 passent.");
