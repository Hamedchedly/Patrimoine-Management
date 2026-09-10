// PROBE temporaire — repérer la feuille « Historique CMD » (COMN_NUM/WPATRIMOINE/FRAN_NUM).
import os from "node:os";
import path from "node:path";
import XLSX from "xlsx";

const f = path.join(os.homedir(), "Downloads", "20260807_HCHEDLY_export_donnees.xlsx");
const wb = XLSX.readFile(f);
console.log("Feuilles : " + wb.SheetNames.join(" | "));
for (const sn of wb.SheetNames) {
  const ws = wb.Sheets[sn];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  console.log("\n=== Feuille " + sn + " (" + rows.length + " lignes) ===");
  for (let i = 0; i < Math.min(rows.length, 6); i++) {
    const vals = (rows[i] ?? []).slice(0, 45).map((c) => (c == null ? "" : String(c)));
    console.log("  L" + (i + 1) + ": " + vals.join(" | "));
  }
}
