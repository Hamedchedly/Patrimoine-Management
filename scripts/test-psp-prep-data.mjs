// Tests V2 — adaptateur « vraies données PAT S11 » (src/lib/psp.prep.data.ts)
// Exécution : node scripts/test-psp-prep-data.mjs
// Node 24 importe directement les fichiers TypeScript (type stripping).
import * as XLSX from "xlsx";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  construireReferencePatrimoine,
  enrichirOperationsAvecReference,
  parseEsquisse2027Workbook,
  resoudreTranche,
} from "../src/lib/psp.prep.data.ts";
import { PSP_OPERATIONS, totalOperation } from "../src/lib/psp.prep.ts";

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

// ── 1. Référence patrimoniale (données synthétiques réelles) ───────────────
const tranches = [
  {
    code: "1976",
    libelle: null,
    localite: "THORIGNY-SUR-MARNE",
    sous_secteur: "2",
    secteur: "S11",
    nb_logements: 40,
  },
  {
    code: "2086",
    libelle: "LOT 3",
    localite: "CHELLES",
    sous_secteur: "4",
    secteur: "S11",
    nb_logements: 53,
  },
];
const lots = [
  { tranche_code: "1976", adresse: "32 RUE CORNILLIOT", ville: "THORIGNY-SUR-MARNE" },
  { tranche_code: "1976", adresse: "32 RUE CORNILLIOT", ville: "THORIGNY-SUR-MARNE" },
  { tranche_code: "1976", adresse: "5 RUE DE L EGLISE", ville: "THORIGNY-SUR-MARNE" },
  { tranche_code: "2086", adresse: "10 CORNILLES", ville: "CHESSY" },
];
const commandes = [
  { tranche_code: "1976", charge_clientele: "SKILIDJIAN" },
  { tranche_code: "1976", charge_clientele: "SKILIDJIAN" },
  { tranche_code: "1976", charge_clientele: "CANTONY" },
  { tranche_code: "2086", charge_clientele: "JDUPUIS" },
  { tranche_code: "9999", charge_clientele: "CBELAIR" },
];

// V7.6 §8 — le CC provient UNIQUEMENT du référentiel sous-secteur → CC
// (jamais la fréquence des commandes historiques).
const referentiel = [
  { sous_secteur: "2", charge_clientele: "SKILIDJIAN", identifiant_personnel: "SKILIDJIAN", actif: true },
  { sous_secteur: "4", charge_clientele: "JDUPUIS", identifiant_personnel: "JDUPUIS", actif: true },
];

const reference = construireReferencePatrimoine(tranches, lots, commandes, referentiel);
assert("référence : 2 tranches indexées", reference.tranches.size === 2);
assert(
  "référence : totaux bruts conservés",
  reference.totalLots === 4 && reference.totalCommandes === 5,
);

const ref1976 = resoudreTranche(reference, "1976");
assert("TR→CC : SKILIDJIAN (référentiel sous-secteur 2)", ref1976?.charge_clientele === "SKILIDJIAN");
assert(
  "TR→adresse : 32 RUE CORNILLIOT (mode des lots 1976)",
  ref1976?.adresse_reference === "32 RUE CORNILLIOT",
);
assert("TR→ville : THORIGNY-SUR-MARNE", ref1976?.ville === "THORIGNY-SUR-MARNE");
assert("TR→sous-secteur : 2", ref1976?.sous_secteur === "2");
assert("TR inconnu → null", resoudreTranche(reference, "9999") === null);

// V7.6 §8 — sans référentiel, le CC n'est JAMAIS déduit des commandes.
const refSansReferentiel = construireReferencePatrimoine(tranches, lots, commandes, []);
assert(
  "V7.6 : sans référentiel → CC null (plus jamais fréquence commandes)",
  refSansReferentiel.tranches.get("1976")?.charge_clientele === null,
);

// ── 2. Enrichissement des opérations par la référence réelle ───────────────
const enrichies = enrichirOperationsAvecReference(PSP_OPERATIONS, reference);
const op1976 = enrichies.find((o) => o.tranche === "1976");
assert(
  "enrichissement : TR 1976 aligné sur le réel (adresse + ville)",
  Boolean(
    op1976 && op1976.adresse === "32 RUE CORNILLIOT" && op1976.ville === "THORIGNY-SUR-MARNE",
  ),
);
assert(
  "enrichissement : TR 1976 → CC réel SKILIDJIAN",
  Boolean(op1976 && op1976.charge_clientele === "SKILIDJIAN"),
);
const opInconnu = enrichies.find((o) => o.tranche === "3329");
assert(
  "enrichissement : TR inconnu conservé tel quel",
  Boolean(opInconnu && opInconnu.charge_clientele !== ""),
);
assert(
  "enrichissement : montants inchangés",
  Math.abs(
    enrichies.reduce((s, o) => s + totalOperation(o), 0) -
      PSP_OPERATIONS.reduce((s, o) => s + totalOperation(o), 0),
  ) < 0.001,
);

// ── 3. Esquisse PSP 2027 (source de préparation) ───────────────────────────
function workbook(headers, rows) {
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Esquisse");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

const H = [
  "TR",
  "Arl/sect",
  "ADRESSE",
  "Ville",
  "C",
  "CORPS D'ETAT",
  "NATURE TRAVAUX",
  "2027",
  "2028",
  "2029",
  "2030",
  "2031",
  "Remarques",
  "devis si existant",
];

const esquisse = parseEsquisse2027Workbook(
  workbook(H, [
    [
      "1976",
      "S11",
      "32 RUE CORNILLIOT",
      "THORIGNY-SUR-MARNE",
      "CP",
      "(d) Couvertures",
      "Réfection toiture",
      185000,
      0,
      0,
      0,
      0,
      "urgence",
      "Entreprise A:198500",
    ],
    [
      "2086",
      "S11",
      "10 CORNILLES",
      "CHESSY",
      "GE",
      "(r) Ascenseurs",
      "Remplacement ascenseur",
      0,
      230000,
      0,
      0,
      0,
      "",
      "",
    ],
    [
      "1976",
      "S11",
      "32 RUE CORNILLIOT",
      "THORIGNY-SUR-MARNE",
      "XX",
      "(a) Maçonnerie",
      "Reprise maçonnerie",
      0,
      0,
      30000,
      0,
      0,
      "",
      "",
    ],
  ]),
  "esquisse-psp-2027-test.xlsx",
);
assert(
  "esquisse : 3 opérations lues",
  esquisse.operations.length === 3,
  `(${esquisse.operations.length})`,
);
assert(
  "esquisse : 1 ligne avec C invalide signalée",
  esquisse.erreurs.length === 1,
  esquisse.erreurs.join(" | "),
);
const esq1 = esquisse.operations[0];
assert("esquisse : C = CP sur la ligne 1 (catégorie budgétaire)", esq1?.categorie === "CP");
assert("esquisse : 2027 = 185 000 sur la ligne 1", esq1?.programme["2027"] === 185000);
assert("esquisse : année principale 2027", esq1?.annee === 2027);
const esq2 = esquisse.operations[1];
assert("esquisse : C = GE sur la ligne 2", esq2?.categorie === "GE");
assert("esquisse : année principale 2028 (premier montant)", esq2?.annee === 2028);
const esq3 = esquisse.operations[2];
assert("esquisse : C invalide → repli GT", esq3?.categorie === "GT");
assert("esquisse : budget = total programmé (ligne 3 = 30 000)", esq3?.budget === 30000);
assert(
  "esquisse : corps d'état indépendant de C",
  esq1?.corps_etat === "(d) Couvertures" && esq1?.corps_etat_code === "(d)",
);

// ── 4. Absence de mutation Supabase (lecture seule) ────────────────────────
try {
  const chemin = fileURLToPath(new URL("../src/lib/psp.prep.data.functions.ts", import.meta.url));
  const source = readFileSync(chemin, "utf8");
  const interdits = [".insert(", ".update(", ".delete(", ".upsert(", ".rpc("];
  const trouves = interdits.filter((motif) => source.includes(motif));
  assert(
    "lecture seule : aucune écriture dans l'adaptateur serveur",
    trouves.length === 0,
    trouves.join(", "),
  );
  assert(
    "lecture seule : uniquement des .select(",
    (source.match(/\.select\(/g) ?? []).length >= 3,
  );
} catch {
  assert("lecture seule : fichier serveur lisible", false);
}

console.log(`\nRésultat : ${passed} PASS, ${failed} FAIL`);
process.exit(failed === 0 ? 0 : 1);
