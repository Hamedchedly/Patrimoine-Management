// Tests de non-régression — corrections Import Travaux (logique pure)
// Exécution : node scripts/test-travaux-corrections.mjs
// Node 24 importe directement les fichiers TypeScript (type stripping).
import * as XLSX from "xlsx";
import {
  parseTravauxWorkbook,
  travauxComparable,
  travauxIdentiques,
  commandesAAArchiver,
  sliderYearDomain,
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

// ---- Test 1 : import 2023 vierge (parseur) ----
const parsed = parseTravauxWorkbook(
  workbook([
    ["ER", "TR1", "2023-001", "RUE A", "TRAVAUX X", 1000],
    ["ER", "TR1", "2023-002", "RUE B", "TRAVAUX Y", 2000],
  ]),
);
assert("T1  parser : 2 commandes reconnues", parsed.commandes.length === 2);
assert("T1  parser : 0 doublon", parsed.doublons === 0);
assert("T1  parser : 0 conflit", parsed.conflits.length === 0);

// ---- Test 6 : deux lignes identiques dans le même fichier ----
const parsedDup = parseTravauxWorkbook(
  workbook([
    ["ER", "TR1", "2023-001", "RUE A", "TRAVAUX X", 1000],
    ["ER", "TR1", "2023-001", "RUE A", "TRAVAUX X", 1000],
  ]),
);
assert("T6  doublon : 1 seule commande", parsedDup.commandes.length === 1);
assert("T6  doublon : compteur = 1", parsedDup.doublons === 1);
assert("T6  doublon : aucun conflit", parsedDup.conflits.length === 0);

// Doublon intra-fichier avec données différentes → conflit, 1re ligne gagnante
const parsedConf = parseTravauxWorkbook(
  workbook([
    ["ER", "TR1", "2023-001", "RUE A", "TRAVAUX X", 1000],
    ["ER", "TR1", "2023-001", "RUE A", "TRAVAUX X", 9999],
  ]),
);
assert("T6  conflit intra-fichier : 1 conflit", parsedConf.conflits.length === 1);
assert("T6  conflit intra-fichier : 1re ligne gagnante", parsedConf.commandes[0].engage === 1000);

// ---- Comparaison de versions ----
const base = { numero_commande: "1", secteur: "ER", engage: 1000, annee_exercice: 2024 };
const identique = { numero_commande: "1", secteur: "ER", engage: 1000, annee_exercice: 2024 };
const autreMontant = { numero_commande: "1", secteur: "ER", engage: 1001, annee_exercice: 2024 };
const autreAnnee = { numero_commande: "1", secteur: "ER", engage: 1000, annee_exercice: 2025 };
assert("T2  identique = inchangée", travauxIdentiques(base, identique));
assert("T4  montant différent = conflit", !travauxIdentiques(base, autreMontant));
assert("T4  année différente = conflit", !travauxIdentiques(base, autreAnnee));
assert(
  "    null vs absent = identiques",
  travauxIdentiques({ ...base, adresse: null }, { ...base }),
);
assert("    clé incomplète = différente", !travauxIdentiques({ ...base, fournisseur: "X" }, base));
assert(
  "    snapshot comparable couvre tous les champs métier",
  Object.keys(travauxComparable(base)).length >= 26,
);

// ---- Domaine du slider ----
assert(
  "T9  slider : 1 seule année → domaine utilisable",
  JSON.stringify(sliderYearDomain([2026])) === JSON.stringify([2025, 2027]),
);
assert(
  "T9  slider : 4 années → domaine élargi",
  JSON.stringify(sliderYearDomain([2023, 2024, 2025, 2026])) === JSON.stringify([2022, 2027]),
);
assert(
  "T9  slider : sans données → repli",
  JSON.stringify(sliderYearDomain([])) === JSON.stringify([2020, 2025]),
);
assert(
  "T9  slider : borne basse plafonnée",
  JSON.stringify(sliderYearDomain([2020])) === JSON.stringify([2020, 2021]),
);

// ---- Archivage par année (Test 3, 5, 7) ----
const actives = [
  { id: "a1", annee_exercice: 2023 },
  { id: "a2", annee_exercice: 2024 },
  { id: "a3", annee_exercice: 2025 },
];
assert(
  "T3  import 2024 n'archive jamais 2023",
  commandesAAArchiver(actives, 2024, new Set()).every((m) => m.id !== "a1"),
);
assert(
  "T3  import 2024 n'archive jamais 2025",
  commandesAAArchiver(actives, 2024, new Set()).every((m) => m.id !== "a3"),
);
assert(
  "T3  import 2024 archive la 2024 absente",
  JSON.stringify(commandesAAArchiver(actives, 2024, new Set()).map((m) => m.id)) ===
    JSON.stringify(["a2"]),
);
assert(
  "T3  import 2024 ne touche pas une 2024 vue",
  commandesAAArchiver(actives, 2024, new Set(["a2"])).length === 0,
);
assert(
  "T3  import 2023 archive la 2023 absente",
  JSON.stringify(commandesAAArchiver(actives, 2023, new Set()).map((m) => m.id)) ===
    JSON.stringify(["a1"]),
);
assert(
  "T7  import 2025 ne touche pas 2023/2024",
  JSON.stringify(commandesAAArchiver(actives, 2025, new Set()).map((m) => m.id)) ===
    JSON.stringify(["a3"]),
);
assert(
  "T   import sans année → aucun archivage",
  commandesAAArchiver(actives, null, new Set()).length === 0,
);

console.log("\n==========================================");
console.log(`Résultat : ${passed} PASS, ${failed} FAIL`);
console.log("==========================================");
process.exit(failed > 0 ? 1 : 0);
