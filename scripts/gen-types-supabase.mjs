// ═══════════════════════════════════════════════════════════════════════════════
// V6 — Génération de src/integrations/supabase/types.ts à partir du schéma RÉEL.
//
// Aucune CLI supabase disponible → le générateur lit l'OpenAPI PostgREST
// (/{url}/rest/v1/) et reproduit le format de `supabase gen types typescript`.
//
// Fiabilité des nullabilités (validée par probes live) :
//   · nullable = colonne ABSENTE de `required[]` (le flag x-nullable de cette
//     version PostgREST n'est pas fiable) ;
//   · Insert requis = NOT NULL (dans required[]) SANS default ;
//   · Insert optionnel = nullable OU avec default ;
//   · PK / FK lues dans les `description` (« This is a Primary Key.<pk/> »,
//     « This is a Foreign Key to `t.table`.<fk table='t' column='c'/> »).
//
// Exécution : node --env-file=.env scripts/gen-types-supabase.mjs
// ═══════════════════════════════════════════════════════════════════════════════
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sortie = resolve(root, "src/integrations/supabase/types.ts");

const url = process.env["EXT_SUPABASE_URL"];
const key = process.env["EXT_SUPABASE_SERVICE_ROLE_KEY"];
if (!url || !key) throw new Error("EXT_SUPABASE_URL / EXT_SUPABASE_SERVICE_ROLE_KEY manquantes");

const spec = await (
  await fetch(`${url}/rest/v1/`, { headers: { apikey: key, Accept: "application/json" } })
).json();
const defs = spec.definitions ?? {};

// ── Mapping type OpenAPI → TypeScript ──────────────────────────────────────────
function tsType(prop) {
  const t = prop.type ?? "string";
  if (t === "boolean") return "boolean";
  if (t === "integer" || t === "number") return "number";
  if (t === "array") return "Json[]";
  if (t === "object") return prop.format === "jsonb" ? "Json" : "Json";
  if (prop.format === "jsonb" || prop.format === "json") return "Json";
  return "string"; // text, uuid, date, timestamps…
}

// ── Colonnes : tri alphabétique, nullabilité via required[] ────────────────────
const tables = Object.keys(defs)
  .filter((n) => n === n.toLowerCase() && !n.includes(" "))
  .sort();

function tableInfo(name, def) {
  const required = new Set(def.required ?? []);
  const props = def.properties ?? {};
  const cols = Object.keys(props)
    .filter((c) => props[c] && typeof props[c] === "object")
    .sort();
  return cols.map((c) => {
    const p = props[c];
    const nullable = !required.has(c);
    const hasDefault = "default" in p;
    const base = tsType(p);
    const row = nullable ? `${base} | null` : base;
    const insertRequired = !nullable && !hasDefault;
    const insert = insertRequired ? base : nullable ? `${base} | null` : base; // nullable → ?: ; not-null+default → ?:
    // Relations : FK dans la description
    const fkMatch = /<fk table='([^']+)' column='([^']+)'\/>/.exec(p.description ?? "");
    const rels = fkMatch
      ? [
          {
            foreignKeyName: `${name}_${c}_fkey`,
            columns: [c],
            isOneToOne: false,
            referencedRelation: fkMatch[1],
            referencedColumns: [fkMatch[2]],
          },
        ]
      : [];
    return { c, row, insert, insertRequired, nullable, rels };
  });
}

const LIGNES = [];
LIGNES.push(
  "export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];",
);
LIGNES.push("");
LIGNES.push("export type Database = {");
LIGNES.push("  // Allows to automatically instantiate createClient with right options");
LIGNES.push("  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)");
LIGNES.push("  __InternalSupabase: {");
LIGNES.push('    PostgrestVersion: "14.15";');
LIGNES.push("  };");
LIGNES.push("  public: {");
LIGNES.push("    Tables: {");

for (const t of tables) {
  const def = defs[t];
  if (!def?.properties) continue;
  const infos = tableInfo(t, def);
  if (infos.length === 0) continue;
  LIGNES.push(`      ${t}: {`);
  LIGNES.push("        Row: {");
  for (const i of infos) LIGNES.push(`          ${i.c}: ${i.row};`);
  LIGNES.push("        };");
  LIGNES.push("        Insert: {");
  for (const i of infos)
    LIGNES.push(`          ${i.c}${i.insertRequired ? "" : "?"}: ${i.insert};`);
  LIGNES.push("        };");
  LIGNES.push("        Update: {");
  for (const i of infos) LIGNES.push(`          ${i.c}?: ${i.row};`);
  LIGNES.push("        };");
  LIGNES.push("        Relationships: [");
  const allRels = infos.flatMap((i) => i.rels);
  allRels.forEach((r) => {
    LIGNES.push("          {");
    LIGNES.push(`            foreignKeyName: "${r.foreignKeyName}";`);
    LIGNES.push(`            columns: [${r.columns.map((c) => `"${c}"`).join(", ")}];`);
    LIGNES.push(`            isOneToOne: ${r.isOneToOne};`);
    LIGNES.push(`            referencedRelation: "${r.referencedRelation}";`);
    LIGNES.push(
      `            referencedColumns: [${r.referencedColumns.map((c) => `"${c}"`).join(", ")}];`,
    );
    LIGNES.push("          },");
  });
  LIGNES.push("        ];");
  LIGNES.push("      };");
}

LIGNES.push("    };");
LIGNES.push("    Views: {");
LIGNES.push("      [key: string]: never;");
LIGNES.push("    };");
LIGNES.push("    Functions: {");
LIGNES.push("      [key: string]: never;");
LIGNES.push("    };");
LIGNES.push("    Enums: {");
LIGNES.push("      [key: string]: never;");
LIGNES.push("    };");
LIGNES.push("    CompositeTypes: {");
LIGNES.push("      [key: string]: never;");
LIGNES.push("    };");
LIGNES.push("  };");
LIGNES.push("};");
LIGNES.push("");

writeFileSync(sortie, LIGNES.join("\n"));
console.log(`types.ts régénéré : ${sortie} (${tables.length} tables, ${LIGNES.length} lignes)`);
