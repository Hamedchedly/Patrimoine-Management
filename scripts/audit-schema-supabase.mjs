// Audit V5 — inventaire RÉEL des tables Supabase (lecture seule, aucune écriture).
// ⚠️ Correction V5.1 : la sonde n'utilise PAS `head: true` (artefact : une table
// ABSENTE répond « OK » avec count=null — voir docs/audit-psp-architecture-v5.md).
// Exécution : node --env-file=.env scripts/audit-schema-supabase.mjs
import { supabaseAdmin } from "../src/integrations/supabase-ext/client.server.ts";

const db = supabaseAdmin;

const candidats = [
  "tranches",
  "lots",
  "occupants",
  "travaux",
  "travaux_commandes",
  "travaux_commandes_historique",
  "travaux_import_details",
  "import_travaux",
  "imports",
  "adresses_geo",
  "villes_geo",
  "fournisseurs",
  "fournisseurs_contacts",
  "fournisseur_aliases",
  "fournisseur_activites",
  "fournisseur_favoris",
  "psp_imports",
  "psp_import_rows",
  "psp_command_analysis",
  "psp_command_links",
  "psp_decisions",
  "psp_feedback",
  "psp_rules",
  "psp_programmations",
];

const existantes = [];
const absentes = [];

for (const table of candidats) {
  // Sans `head` : une table absente lève PGRST205 (existence fiable).
  const { error } = await db.from(table).select("*", { count: "exact" }).limit(1);
  if (!error) {
    const { data: une, error: e1 } = await db.from(table).select("*").limit(1);
    if (e1) {
      absentes.push(`${table} (erreur lecture: ${e1.message})`);
      continue;
    }
    existantes.push({ table, colonnes: une && une[0] ? Object.keys(une[0]).sort() : [] });
  } else {
    absentes.push(table);
  }
}

console.log("=== TABLES PRÉSENTES ===");
for (const t of existantes) {
  console.log(`\n${t.table}`);
  console.log(`  colonnes : ${t.colonnes.join(", ") || "(table vide — colonnes via OpenAPI, voir audit-openapi-schema.mjs)"}`);
}
console.log(`\n=== TABLES ABSENTES ===\n${absentes.join(", ")}`);
