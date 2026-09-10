// ═══════════════════════════════════════════════════════════════════════════════
// V6 — Validation documentaire de la migration PSP (fichier non encore exécuté).
//
// Vérifie que `supabase/migrations/20260815_psp_preparation_persistance.sql`
// implémente le modèle V5.1 validé et les exigences V6 :
//   5 CREATE TABLE (dont psp_programmations), UNIQUE TR+C, programme JSONB,
//   généralisations additives de psp_command_links / psp_decisions, PAS de
//   psp_arbitrages / psp_ligne_commandes / psp_versions, triggers de gel,
//   RLS (SELECT authenticated / écritures service_role), index, rollback présent.
//
// Exécution : node scripts/test-psp-v6-migration.mjs   (aucune écriture)
// ═══════════════════════════════════════════════════════════════════════════════
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sqlPath = resolve(root, "supabase/migrations/20260815_psp_preparation_persistance.sql");
const rollbackPath = resolve(root, "docs/psp-v6-rollback.sql");

const PASS = [];
const FAIL = [];
function check(label, ok, detail = "") {
  if (ok) PASS.push(label);
  else FAIL.push(`${label}${detail ? ` — ${detail}` : ""}`);
}

console.log("=== V6 — VALIDATION DOCUMENTAIRE DE LA MIGRATION ===");
check("fichier migration existe", existsSync(sqlPath));
check("fichier rollback existe", existsSync(rollbackPath));
if (!existsSync(sqlPath)) {
  console.error("Migration introuvable — impossible de valider.");
  process.exit(1);
}

const sql = readFileSync(sqlPath, "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
const sansComment = strip(sql).replace(/\s+/g, " ");

// ── 1. Les 5 tables sont créées ────────────────────────────────────────────────
const tables = [
  "psp_programmations",
  "psp_lignes",
  "psp_ligne_historique",
  "psp_reports",
  "psp_devis",
];
for (const t of tables) {
  check(
    `CREATE TABLE ${t}`,
    new RegExp(`create table if not exists public\\.${t}\\b`, "i").test(sql),
  );
}

// ── 2. Invariants métier (modèle V5.1) ─────────────────────────────────────────
check(
  "identité TR+C : UNIQUE(programmation_id, tranche_code, categorie)",
  /unique\s*\(\s*programmation_id\s*,\s*tranche_code\s*,\s*categorie\s*\)/i.test(sansComment),
);
check("programme JSONB", /programme\s+jsonb/i.test(sansComment));
check(
  "UNIQUE(annee_debut, version) sur psp_programmations",
  /unique\s*\(\s*annee_debut\s*,\s*version\s*\)/i.test(sansComment),
);
check("statut inclut figee", /'figee'/.test(sql));
check("type inclut simulation", /'simulation'/.test(sql));

// ── 3. Généralisations additives (pas de recréation) ───────────────────────────
check(
  "ALTER psp_command_links + psp_ligne_id (additif)",
  /alter table public\.psp_command_links\s+add column if not exists psp_ligne_id/i.test(
    sansComment,
  ),
);
check(
  "ALTER psp_decisions + psp_ligne_id (additif)",
  /alter table public\.psp_decisions\s+add column if not exists psp_ligne_id/i.test(sansComment),
);
check(
  "ALTER psp_decisions + annee_cible (additif)",
  /add column if not exists annee_cible/i.test(sansComment),
);
check(
  "ALTER psp_decisions + montant (additif)",
  /add column if not exists montant/i.test(sansComment),
);
check("type_relation élargi (rattachement_ligne)", /rattachement_ligne/.test(sql));
check(
  "type_decision élargi (report/annulation/conservation/reevaluation/conflit_categorie)",
  ["'report'", "'annulation'", "'conservation'", "'reevaluation'", "'conflit_categorie'"].every(
    (v) => sql.includes(v),
  ),
);

// ── 4. PAS de tables concurrentes ──────────────────────────────────────────────
for (const ex of ["psp_arbitrages", "psp_ligne_commandes", "psp_versions"]) {
  check(
    `PAS de CREATE ${ex}`,
    !new RegExp(`create table\\s+if\\s+not\\s+exists\\s+public\\.${ex}\\b`, "i").test(sql),
  );
}
check(
  "PAS de CREATE psp_rules (conservée)",
  !/create table\s+if\s+not\s+exists\s+public\.psp_rules\b/i.test(sql),
);

// ── 5. Triggers de gel ─────────────────────────────────────────────────────────
check(
  "trigger prevent_update_if_figee (racine)",
  /create trigger prevent_update_if_figee[\s\S]*?on public\.psp_programmations/i.test(sansComment),
);
check(
  "garde lignes (insert/update/delete) préventive",
  /create trigger prevent_psp_ligne_mutation_if_figee[\s\S]*?on public\.psp_lignes/i.test(
    sansComment,
  ),
);
check("garde devis préventive", /prevent_psp_devis_mutation_if_figee/.test(sql));
check("garde reports préventive", /prevent_psp_report_mutation_if_figee/.test(sql));
check("garde historique préventive", /prevent_psp_historique_mutation_if_figee/.test(sql));
check(
  "historique automatique (delta jsonb)",
  /create trigger psp_lignes_history/.test(sansComment),
);
check("updated_at automatique", /create trigger psp_lignes_updated_at/.test(sansComment));

// ── 6. RLS / droits ────────────────────────────────────────────────────────────
check(
  "RLS enable sur les 5 tables",
  tables.every((t) => new RegExp(`alter table public\\.${t} enable row level security`).test(sql)),
);
check(
  "SELECT authenticated (policy)",
  /for select to authenticated using \(true\)/.test(sansComment),
);
check(
  "REVOKE écritures authenticated",
  /revoke insert, update, delete, truncate, references, trigger/i.test(sansComment),
);
check("GRANT ALL service_role", /grant all on[\s\S]*to service_role/i.test(sansComment));
check(
  "PAS d'exposition d'écriture au frontend (aucune policy INSERT/UPDATE/DELETE)",
  !/for (insert|update|delete)\s+to authenticated/i.test(sansComment),
);
// Création de policies idempotente : CREATE POLICY IF NOT EXISTS n'existe qu'en
// PG15+ → chaque policy est créée dans un DO $$ avec vérification pg_policies.
check(
  "aucun CREATE POLICY IF NOT EXISTS (invalide < PG15)",
  !/create policy if not exists/i.test(sansComment),
);
check(
  "5 vérifications pg_policies (une par policy)",
  /from pg_policies/.test(sansComment) &&
    (sansComment.match(/from pg_policies/g) || []).length === 5,
);
check(
  "5 create policy internes (une par DO $$)",
  (sansComment.match(/create policy "lecture/g) || []).length === 5,
);
check(
  "chaque bloc policy fermé (end if; end $$ — 5 occurrences)",
  (sansComment.match(/end if;\s*end \$\$/g) || []).length === 5,
);

// ── 7. Index ───────────────────────────────────────────────────────────────────
const idx = [
  "psp_lignes_programmation_idx",
  "psp_ligne_historique_ligne_idx",
  "psp_reports_source_idx",
  "psp_reports_cible_idx",
  "psp_devis_ligne_idx",
  "psp_command_links_ligne_idx",
  "psp_decisions_ligne_idx",
];
for (const i of idx)
  check(`index ${i}`, new RegExp(`create index if not exists ${i}`, "i").test(sql));

// ── 8. Contraintes de sécurité non-destructive ─────────────────────────────────
check("aucun DROP TABLE", !/\bdrop\s+table\b/i.test(sql));
check(
  "aucun ALTER destructif (DROP COLUMN / SET NOT NULL absent)",
  !/drop column/i.test(sql) && !/set not null/i.test(sql),
);
check("aucun TRUNCATE", !/\btruncate\s+(table|public\.)/i.test(sansComment));
check("aucun DELETE de données", !/\bdelete\s+from\b/i.test(sansComment));
check("marqueur de fin de migration", sql.includes("FIN DE LA MIGRATION V6"));

// ── 9. Syntaxe élémentaire (validations statiques) ─────────────────────────────
// COMMENT ON exige une chaîne littérale : aucun `||` ne doit subsister.
check("aucun `||` (concatenation interdite dans COMMENT ON)", !/\|\|/.test(strip(sql)));
// Chaînes simples équilibrées (hors $$ et hors --) : nombre pair d'apostrophes.
const sansDollar = strip(sql).replace(/\$\$[\s\S]*?\$\$/g, "");
check("apostrophes équilibrées (chaînes fermées)", (sansDollar.match(/'/g) || []).length % 2 === 0);
// Parenthèses équilibrées hors COMMENT ON (littéraux multi-lignes contenant des `(`).
check(
  "parenthèses équilibrées",
  (sansDollar.match(/\(/g) || []).length === (sansDollar.match(/\)/g) || []).length,
);
// Blocs DO $$ tous fermés.
check("blocs DO $$ pairs (bien fermés)", (sql.match(/\$\$/g) || []).length % 2 === 0);

// ── Bilan ──────────────────────────────────────────────────────────────────────
console.log("\n=== BILAN ===");
console.log(`  PASS : ${PASS.length}`);
console.log(`  FAIL : ${FAIL.length}`);
if (FAIL.length > 0) {
  console.log("\nÉCHECS :");
  for (const f of FAIL) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log("\nMigration prête — à exécuter dans Supabase SQL Editor.");
