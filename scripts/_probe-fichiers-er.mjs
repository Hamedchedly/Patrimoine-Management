// PROBE temporaire — colonnes + présence "ER." dans les fichiers suivi.
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import XLSX from "xlsx";

const targets = [
  path.join("data", "2026", "Suivi_Travaux_Secteur_2026.xlsx"),
  path.join("data", "2026", "Prog_Secteur_11_2026.xlsx"),
];
const dl = path.join(os.homedir(), "Downloads");
if (fs.existsSync(dl)) {
  for (const f of fs.readdirSync(dl)) {
    if (/ANM_SUIVTRXSECT.*\.xlsx$/i.test(f)) targets.push(path.join(dl, f));
  }
}
for (const t of targets) {
  if (!fs.existsSync(t)) {
    console.log("ABSENT : " + t);
    continue;
  }
  const wb = XLSX.readFile(t);
  console.log("=== " + t + " ===");
  for (const sn of wb.SheetNames) {
    const ws = wb.Sheets[sn];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
    if (!rows.length) continue;
    const header =
      rows.find((r) =>
        r.some(
          (c) =>
            c != null &&
            (String(c).toUpperCase().includes("COMN") ||
              String(c).toUpperCase().includes("COMMANDE")),
        ),
      ) ?? rows[0];
    console.log(
      "  feuille " +
        sn +
        " lignes " +
        rows.length +
        "\n   header: " +
        (header ?? [])
          .slice(0, 32)
          .map((h) => (h == null ? "" : String(h)))
          .join(" | "),
    );
    let er = 0;
    for (const r of rows) {
      const joined = r.map((c) => (c == null ? "" : String(c))).join(" ");
      if (/ER\.[A-Za-z0-9]/i.test(joined)) er++;
    }
    console.log("   lignes contenant « ER. » : " + er + " / " + rows.length);
  }
}
