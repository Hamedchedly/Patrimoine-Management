// Vérification lecture seule du chargé d'opération (UTIC_CODE.Ana_comd_trav_er)
// dans le fichier Historique CMD réel. Aucune écriture, aucun import.
// Exécution : node scripts/rapport-psp-utic.mjs
// Usage : node scripts/rapport-psp-utic.mjs [chemin du fichier]
import * as XLSX from "xlsx";
import { readFileSync, existsSync } from "node:fs";
import { parsePspWorkbook } from "../src/lib/psp.ts";

const chemin =
  process.argv[2] ??
  "C:\\Users\\Hamed\\Downloads\\2026-20260810T232136Z-1-001\\11-08-2026\\Liste_COMD_TRAV_ER_3.xlsx";

if (!existsSync(chemin)) {
  console.log(`Fichier introuvable : ${chemin}`);
  process.exit(1);
}

const wb = XLSX.read(readFileSync(chemin));
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
const header = (rows[0] ?? []).map((c) => String(c ?? ""));
const uticIdx = header.findIndex((h) => h.includes("UTIC_CODE"));
const comnIdx = header.findIndex((h) => h.includes("COMN_NUM"));
const wnatIdx = header.findIndex((h) => h.includes("WNATURE"));
const naacIdx = header.findIndex((h) => h.includes("NAAC"));

console.log(`Fichier : ${chemin}`);
console.log(`Colonne G (index 6) : ${JSON.stringify(header[6])}`);
console.log(`Index colonne UTIC_CODE : ${uticIdx}`);

let total = 0, avec = 0, sans = 0;
const distincts = new Set();
const exemples = [];
for (let i = 1; i < rows.length; i++) {
  const r = rows[i] ?? [];
  if (r.every((c) => c === null || c === undefined || c === "")) continue;
  total += 1;
  const v = uticIdx >= 0 ? String(r[uticIdx] ?? "").trim() : "";
  if (v) {
    avec += 1;
    distincts.add(v);
    if (exemples.length < 8) {
      exemples.push({
        comn: r[comnIdx] ?? "",
        utic: v,
        wnature: String(r[wnatIdx] ?? "").slice(0, 45),
        naac: r[naacIdx] ?? "",
      });
    }
  } else {
    sans += 1;
  }
}

console.log("\n— Comptage brut (XLSX) —");
console.log(`  total lignes de données      : ${total}`);
console.log(`  avec UTIC_CODE               : ${avec}`);
console.log(`  sans UTIC_CODE               : ${sans}`);
console.log(`  chargés distincts            : ${distincts.size}`);
console.log(`  liste chargés                : ${[...distincts].sort().join(", ")}`);
console.log("\n— Exemples (COMN_NUM / UTIC_CODE / WNATURE / NAAC) —");
for (const e of exemples) console.log(`  ${e.comn} | ${e.utic} | ${e.wnature} | ${e.naac}`);

// Via le parser (charge_operation) — vérifie le mapping
const parsed = parsePspWorkbook(readFileSync(chemin).buffer.slice(0));
const co = parsed.lignes.filter((l) => l.charge_operation !== null).length;
const coDistincts = new Set(parsed.lignes.map((l) => l.charge_operation).filter(Boolean));
console.log("\n— Via parsePspWorkbook (mapping) —");
console.log(`  lignes primaires              : ${parsed.lignes.length}`);
console.log(`  charge_operation renseigné    : ${co} / ${parsed.lignes.length}`);
console.log(`  chargés distincts             : ${coDistincts.size}`);
console.log("\n— FIN (lecture seule, rien d'écrit) —");
