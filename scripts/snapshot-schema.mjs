// Snapshot du schéma Supabase (lecture seule) — capture l'état réel des tables
// exposées par PostgREST (OpenAPI /rest/v1/) avant/après une migration.
// Exécution : node --env-file=.env scripts/snapshot-schema.mjs [fichier-sortie.md]
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const url = process.env["EXT_SUPABASE_URL"];
const key = process.env["EXT_SUPABASE_SERVICE_ROLE_KEY"];
if (!url || !key) throw new Error("EXT_SUPABASE_URL / EXT_SUPABASE_SERVICE_ROLE_KEY manquantes");

const res = await fetch(`${url}/rest/v1/`, {
  headers: { apikey: key, Accept: "application/json" },
});
const spec = await res.json();
const defs = spec.definitions ?? {};

const sortie = resolve(process.argv[2] ?? "docs/snapshot-schema-supabase.md");

let md = `# État du schéma Supabase — snapshot ${new Date().toISOString()}\n\n`;
md +=
  "Capture lecture seule (OpenAPI /rest/v1/), aucune écriture. **Piège `head:true` évité.**\n\n";
md += "## Tables exposées par PostgREST\n\n";
const tables = Object.keys(defs)
  .filter((n) => n === n.toLowerCase())
  .sort();
md += `**${tables.length} tables** : ${tables.join(", ")}\n\n`;
md += "## Colonnes des tables `psp_*`\n";
for (const n of tables.filter((t) => t.startsWith("psp_"))) {
  const d = defs[n];
  md += `\n### ${n}\n`;
  if (d.properties) {
    const cols = Object.entries(d.properties).sort(([a], [b]) => a.localeCompare(b));
    for (const [c, v] of cols) {
      const t = v.type || "";
      const fmt = v.format ? `:${v.format}` : "";
      const def = v.default !== undefined ? ` (def ${JSON.stringify(v.default)})` : "";
      md += `- \`${c}\` ${t}${fmt}${def}\n`;
    }
  }
}
writeFileSync(sortie, md);
console.log(`Snapshot écrit : ${sortie} (${md.split("\n").length} lignes)`);
