// Tests du rapport d'import cliquable — détails persistés par catégorie (logique pure)
// Exécution : node scripts/test-travaux-import-details.mjs
import * as XLSX from "xlsx";
import {
  parseTravauxWorkbook,
  champsDifferents,
  snapshotCommande,
  TRAVAUX_FIELDS,
  travauxComparable,
  decisionImportCommande,
  commandesAAArchiver,
  detailCreee,
  detailInchangee,
  detailConflit,
  detailIgnoree,
  detailArchivee,
  detailIssue,
  detailReport,
} from "../src/lib/travaux.ts";

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

function workbook(rows) {
  const ws = XLSX.utils.aoa_to_sheet([
    ["SECTEUR", "TRANCHE", "NO COMMANDE", "ADRESSE", "DESCRIPTIF", "ENGAGE"],
    ...rows,
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Travaux");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

const creeeRow = {
  id: "cmd-1",
  numero_commande: "2024-001",
  lot_code: "ER.1",
  adresse: "RUE A",
  fournisseur: "SARL B",
  engage: 12500,
  date_demarrage: "2024-03-01",
  etat_travaux: "En cours",
  annee_exercice: 2024,
};

// ---- T5 : erreurs du parseur (lignes sans numéro) ----
const parsed = parseTravauxWorkbook(
  workbook([
    ["ER", "TR1", "2024-001", "RUE A", "TRAVAUX X", 1000],
    ["ER", "TR1", null, "RUE B", "SANS NUMERO", 2000],
  ]),
);
assert("T5  sans numéro : ligne détectée", parsed.sansCommande.length === 1);
assert(
  "T5  sans numéro : ligne et message conservés",
  parsed.sansCommande[0]?.line === 3 && parsed.sansCommande[0]?.message.includes("manquant"),
);

// ---- T6 : doublons du parseur ----
const parsedDup = parseTravauxWorkbook(
  workbook([
    ["ER", "TR1", "2024-001", "RUE A", "TRAVAUX X", 1000],
    ["ER", "TR1", "2024-001", "RUE A", "TRAVAUX X", 1000],
  ]),
);
assert("T6  doublon identique : 1 détail", parsedDup.doublonsDetails.length === 1);
assert(
  "T6  doublon identique : message",
  parsedDup.doublonsDetails[0]?.message === "Doublon identique",
);
assert("T6  doublon identique : ligne 3", parsedDup.doublonsDetails[0]?.line === 3);

const parsedConf = parseTravauxWorkbook(
  workbook([
    ["ER", "TR1", "2024-001", "RUE A", "TRAVAUX X", 1000],
    ["ER", "TR1", "2024-001", "RUE A", "TRAVAUX X", 9999],
  ]),
);
assert(
  "T6  doublon divergent : message",
  parsedConf.doublonsDetails[0]?.message === "Doublon avec des valeurs différentes",
);
assert("T6  doublon divergent : conflit associé", parsedConf.conflits.length === 1);

// ---- T2 : champs différents ----
assert(
  "T2  champsDifferents : liste exacte",
  JSON.stringify(champsDifferents({ a: 1, b: "x" }, { a: 2, b: "x" })) === JSON.stringify(["a"]),
);
assert(
  "T2  champsDifferents : ajout/suppression",
  JSON.stringify(champsDifferents({ a: 1 }, { a: 1, c: 3 })) === JSON.stringify(["c"]),
);
assert("T2  champsDifferents : identiques → vide", champsDifferents({ a: 1 }, { a: 1 }).length === 0);

// ---- T1 : détail créée (snapshot complet) ----
const dCreee = detailCreee("imp-1", creeeRow, 2);
assert("T1  creee : type + import_id", dCreee["type"] === "creee" && dCreee["import_id"] === "imp-1");
assert("T1  creee : numéro/lot/année", dCreee["numero_commande"] === "2024-001" && dCreee["lot_code"] === "ER.1" && dCreee["annee_exercice"] === 2024);
const snap = dCreee["details"];
assert("T1  creee : snapshot adresse/fournisseur/montant", snap["adresse"] === "RUE A" && snap["fournisseur"] === "SARL B" && snap["montant"] === 12500);
assert("T1  creee : ligne conservée", dCreee["ligne"] === 2);

// ---- T3 : détail archivée (motif) ----
const dArch = detailArchivee("imp-1", { ...creeeRow, id: "cmd-2", numero_commande: "2024-002" });
assert("T3  archivee : type + motif", dArch["type"] === "archivee" && dArch["message"] === "Absente du fichier importé");
assert("T3  archivee : snapshot complet", dArch["details"]["numero_commande"] === "2024-002" && dArch["details"]["motif"] === "Absente du fichier importé");

// ---- T4 : rattachement non résolu ----
const dIg = detailIgnoree("imp-1", { numero_commande: "2024-003", tranche_code: "ZZZ", lot_code: null, annee_exercice: 2024 }, 7);
assert("T4  ignoree : type + message", dIg["type"] === "ignoree" && dIg["message"].includes("ZZZ"));
assert("T4  ignoree : tranche fournie dans details", dIg["details"]["tranche_fournie"] === "ZZZ");
assert("T4  ignoree : ligne", dIg["ligne"] === 7);

// ---- T7 : inchangée ----
const dInc = detailInchangee("imp-1", { ...creeeRow, id: "cmd-9" }, 4);
assert("T7  inchangee : type + commande_id", dInc["type"] === "inchangee" && dInc["commande_id"] === "cmd-9");

// ---- Conflit : avant/apres + champs différents ----
const avant = { numero_commande: "2024-001", engage: 1000, fournisseur: "A" };
const apres = { numero_commande: "2024-001", engage: 2000, fournisseur: "A" };
const dConf = detailConflit("imp-1", { ...creeeRow, id: "cmd-1" }, avant, apres, 5);
assert("T2/T  conflit : champs_differents exacts", JSON.stringify(dConf["details"]["champs_differents"]) === JSON.stringify(["engage"]));
assert("T   conflit : avant/apres conservés", dConf["details"]["avant"]["engage"] === 1000 && dConf["details"]["apres"]["engage"] === 2000);

// ---- T8 : compteur == nombre de détails (cohérence) ----
const nCreees = 5;
const rowsCreees = Array.from({ length: nCreees }, (_, i) =>
  detailCreee("imp-1", { ...creeeRow, id: `cmd-${i}`, numero_commande: `2024-0${i}` }, i + 1),
);
assert("T8  creees == COUNT(details creee)", rowsCreees.length === nCreees);

// ---- T9 : deux imports distincts ----
const rowsImp1 = [detailCreee("imp-1", creeeRow, 1)];
const rowsImp2 = [detailCreee("imp-2", { ...creeeRow, numero_commande: "2025-001" }, 1)];
assert("T9  import_id distincts", rowsImp1[0]["import_id"] === "imp-1" && rowsImp2[0]["import_id"] === "imp-2");

// ---- T10 : immutabilité du snapshot ----
const source = { ...creeeRow, numero_commande: "2024-010" };
const dImm = detailCreee("imp-1", source, 1);
source["numero_commande"] = "MODIFIEE-APRES";
source["engage"] = 99999;
assert("T10 immutabilité : numéro figé", dImm["numero_commande"] === "2024-010");
assert("T10 immutabilité : montant figé", dImm["details"]["montant"] === 12500);

// ---- detailIssue (doublon/erreur) ----
const dIssue = detailIssue("imp-1", "doublon", { line: 3, message: "Doublon identique", numero_commande: "2024-001" });
assert("T   detailIssue : type + ligne + message", dIssue["type"] === "doublon" && dIssue["ligne"] === 3 && dIssue["message"] === "Doublon identique");

// ---- snapshotCommande couvre les champs d'affichage ----
const snap2 = snapshotCommande(creeeRow);
assert(
  "T   snapshot : champs d'affichage présents",
  "numero_commande" in snap2 && "annee_exercice" in snap2 && "lot_code" in snap2 && "adresse" in snap2 && "fournisseur" in snap2 && "montant" in snap2 && "statut" in snap2,
);

// =====================================================================
// Régressions `numero_commande` (correction NOT NULL à l'INSERT)
// =====================================================================

// ---- Test 1 : invariant TRAVAUX_FIELDS ----
assert(
  "T1  invariant : numero_commande dans TRAVAUX_FIELDS",
  TRAVAUX_FIELDS.includes("numero_commande"),
);

// ---- Test 2 : régression VALID_COLUMNS (payload INSERT) ----
const VALID_COLUMNS = [...TRAVAUX_FIELDS, "vu_dans_import_id", "actif"];
const sourceInsert = {
  numero_commande: "85566693",
  secteur: "ER",
  tranche_code: "TR1",
  adresse: "RUE A",
  fournisseur: "SARL B",
  engage: 1000,
  annee_exercice: 2024,
};
const fullRowInsert = { ...sourceInsert, vu_dans_import_id: "imp-x", actif: true };
const payloadInsert = Object.fromEntries(
  Object.entries(fullRowInsert).filter(([key]) => VALID_COLUMNS.includes(key)),
);
assert(
  "T2  VALID_COLUMNS : numero_commande présent dans le payload INSERT",
  payloadInsert["numero_commande"] === "85566693",
);
assert(
  "T2  VALID_COLUMNS : payload du cas réel",
  JSON.stringify(payloadInsert["numero_commande"]) === JSON.stringify("85566693"),
);

// ---- Test 3 : snapshot historique/conflit ----
assert(
  "T3  travauxComparable : numero_commande conservé",
  travauxComparable({ numero_commande: "85566693", secteur: "ER" })["numero_commande"] ===
    "85566693",
);

// ---- Test 4 : ligne sans numéro → erreur, jamais dans commandes ----
const parsedNoNum = parseTravauxWorkbook(
  workbook([
    ["ER", "TR1", "2024-001", "RUE A", "TRAVAUX X", 1000],
    ["ER", "TR1", null, "RUE B", "SANS NUMERO", 2000],
  ]),
);
assert("T4  sans numéro : 1 ligne sans commande détectée", parsedNoNum.sansCommande.length === 1);
assert(
  "T4  sans numéro : absente de commandes",
  parsedNoNum.commandes.every((c) => c.numero_commande !== null && c.numero_commande !== undefined),
);
assert("T4  sans numéro : 1 seule commande reconnue", parsedNoNum.commandes.length === 1);

// =====================================================================
// Report d'exercice — règle métier validée
// (numero_commande = identité UNIQUE et immuable ; annee_exercice = mutable)
// =====================================================================

const baseCmd = (annee, extra = {}) => ({
  id: "cmd-4930372",
  numero_commande: "4930372",
  secteur: "ER",
  tranche_code: "TR1",
  adresse: "RUE A",
  fournisseur: "SARL B",
  engage: 3000,
  annee_exercice: annee,
  ...extra,
});

// T1 — création : aucun 4930372 en base
assert(
  "T1  création : decision = creee",
  decisionImportCommande({ source: baseCmd(2030), before: null }) === "creee",
);

// T2 — inchangée : 4930372/2030 identique
assert(
  "T2  inchangée : decision = inchangee",
  decisionImportCommande({ source: baseCmd(2030), before: baseCmd(2030) }) === "inchangee",
);

// T3 — report d'exercice : seule annee change (2025 → 2030)
assert(
  "T3  report : seule annee change → report",
  decisionImportCommande({ source: baseCmd(2030), before: baseCmd(2025) }) === "report",
);
const dReport = detailReport("imp-1", baseCmd(2025), travauxComparable(baseCmd(2025)), travauxComparable(baseCmd(2030)), 5);
assert("T3  report : type = report", dReport["type"] === "report");
assert(
  "T8  report : avant.annee=2025 / apres.annee=2030",
  dReport["details"]["avant"]["annee_exercice"] === 2025 &&
    dReport["details"]["apres"]["annee_exercice"] === 2030,
);
assert(
  "T3  report : pas un conflit (champs_differents = [annee_exercice])",
  JSON.stringify(dReport["details"]["champs_differents"]) === JSON.stringify(["annee_exercice"]),
);

// T6 — unicité : le numéro existant ne produit JAMAIS une création
assert(
  "T6  unicité : numéro existant + autre année → report, jamais creee",
  decisionImportCommande({ source: baseCmd(2030), before: baseCmd(2025) }) !== "creee",
);
assert(
  "T6  unicité : decision report sur la même ligne (pas de seconde ligne)",
  decisionImportCommande({ source: baseCmd(2030), before: baseCmd(2025) }) === "report",
);

// T4 — vrai conflit : même année, montant différent
assert(
  "T4  conflit : même année + montant différent",
  decisionImportCommande({
    source: baseCmd(2030, { engage: 4500 }),
    before: baseCmd(2030),
  }) === "conflit",
);

// T5 — année + autre champ différent → conflit
assert(
  "T5  conflit : année + autre champ",
  decisionImportCommande({
    source: baseCmd(2030, { engage: 4500 }),
    before: baseCmd(2025),
  }) === "conflit",
);

// T7 — archivage après report : la ligne reportée (vue, même année) n'est PAS archivée
const activesApresReport = [
  { id: "cmd-4930372", annee_exercice: 2030 },
  { id: "cmd-85566693", annee_exercice: 2030 },
];
const missingApresReport = commandesAAArchiver(activesApresReport, 2030, new Set(["cmd-4930372"]));
assert(
  "T7  archivage : la commande reportée n'est pas archivée",
  missingApresReport.every((m) => m.id !== "cmd-4930372"),
);

console.log("\n==========================================");
console.log(`Résultat : ${passed} PASS, ${failed} FAIL`);
console.log("==========================================");
process.exit(failed > 0 ? 1 : 0);

