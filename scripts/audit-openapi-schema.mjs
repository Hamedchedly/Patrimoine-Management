// V5.1 — Dump du schéma RÉEL Supabase via OpenAPI (Swagger 2.0) PostgREST (lecture seule).
// Exécution : node --env-file=.env scripts/audit-openapi-schema.mjs
const url = process.env["EXT_SUPABASE_URL"];
const key = process.env["EXT_SUPABASE_SERVICE_ROLE_KEY"];
if (!url || !key) throw new Error("EXT_SUPABASE_URL / EXT_SUPABASE_SERVICE_ROLE_KEY manquantes");

const res = await fetch(`${url}/rest/v1/`, {
  headers: { apikey: key, Accept: "application/json" },
});
const spec = await res.json();

const cibles = [
  "psp_programmations",
  "psp_command_links",
  "psp_decisions",
  "psp_rules",
  "psp_patrimoine_context",
  "psp_command_analysis",
  "psp_feedback",
  "psp_imports",
  "psp_import_rows",
  "travaux_commandes_historique",
  "travaux_import_details",
  "fournisseur_aliases",
  "fournisseurs",
];

// Swagger 2.0 : chaque table est un chemin "/<table>" avec un schéma de définition.
const definitions = spec.definitions ?? {};
for (const nom of cibles) {
  const def = definitions[nom];
  if (!def) {
    console.log(`\n${nom} : ABSENTE des définitions`);
    continue;
  }
  const props = Object.keys(def.properties ?? {}).sort();
  const pk = def.properties?.id ? "id(uuid)" : "";
  console.log(`\n${nom}`);
  console.log(`  ${props.join(", ")}`);
}

const tables = Object.keys(definitions)
  .filter((n) => n === n.toLowerCase())
  .sort();
console.log(`\nTOTAL tables dans les définitions : ${tables.length}`);
console.log(`Liste : ${tables.join(", ")}`);
