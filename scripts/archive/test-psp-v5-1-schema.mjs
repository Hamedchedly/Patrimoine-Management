// ═══════════════════════════════════════════════════════════════════════════════
// V5.1 — Audit de cohérence du modèle PSP proposé (documentaire).
//
// Vérifie que :
//  1. le document `docs/psp-v5.1-data-model.md` existe ;
//  2. le SQL proposé `docs/psp-v5.1-proposed-migration.sql` implémente bien le
//     modèle manifeste ci-dessous (5 CREATE TABLE, UNIQUE TR+C, JSONB, ALTER de
//     généralisation, PAS de psp_arbitrages / psp_ligne_commandes / psp_versions,
//     trigger de gel, RLS lecture authenticated, FIN de proposition) ;
//  3. (optionnel) la base live confirme les constats RÉELS (lecture seule) :
//     psp_programmations ABSENTE, psp_command_links / psp_decisions / psp_rules
//     présentes avec leurs colonnes attendues. Aucune écriture.
//
// Exécution :
//   node scripts/test-psp-v5-1-schema.mjs               → vérifications documentaires
//   node --env-file=.env scripts/test-psp-v5-1-schema.mjs → + vérifications live (lecture)
// ═══════════════════════════════════════════════════════════════════════════════
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sqlPath = resolve(root, "docs/psp-v5.1-proposed-migration.sql");
const mdPath = resolve(root, "docs/psp-v5.1-data-model.md");

// ── Manifeste du modèle proposé (source de vérité documentaire) ────────────────
const MODEL = {
  tables: [
    { name: "public.psp_programmations", kind: "create", role: "racine des versions" },
    { name: "public.psp_lignes", kind: "create", role: "lignes programmées (TR+C)" },
    { name: "public.psp_ligne_historique", kind: "create", role: "historique delta jsonb" },
    { name: "public.psp_reports", kind: "create", role: "reports source↔cible" },
    { name: "public.psp_devis", kind: "create", role: "devis 1..N par ligne" },
  ],
  // Généralisations d'existantes (PAS de nouvelles tables)
  generalisations: [
    {
      table: "public.psp_command_links",
      addColumns: ["psp_ligne_id"],
      widen: ["type_relation"],
      replaces: "psp_ligne_commandes",
    },
    {
      table: "public.psp_decisions",
      addColumns: ["psp_ligne_id", "annee_cible", "montant"],
      widen: ["type_decision"],
      replaces: "psp_arbitrages",
    },
  ],
  excludes: ["psp_arbitrages", "psp_ligne_commandes", "psp_versions"],
  invariants: [
    "unique (programmation_id, tranche_code, categorie)", // identité métier TR+C
    "programme jsonb", // Option A (JSONB années → montants)
    "prevent_update_if_figee", // gel des versions figées
    "service_role", // RLS : écritures service_role uniquement
    "to authenticated using (true)", // RLS : lecture authenticated
    "FIN DE LA PROPOSITION", // fichier terminé
  ],
};

const PASS = [];
const FAIL = [];
const SKIP = [];
function check(label, ok, detail = "") {
  if (ok) PASS.push(label);
  else FAIL.push(`${label}${detail ? ` — ${detail}` : ""}`);
}
function skip(label, detail) {
  SKIP.push(`${label} — ${detail}`);
}

// ── 1. Fichiers présents ───────────────────────────────────────────────────────
check("docs/psp-v5.1-proposed-migration.sql existe", existsSync(sqlPath));
check("docs/psp-v5.1-data-model.md existe", existsSync(mdPath));
if (!existsSync(sqlPath)) {
  console.error("Fichier SQL manquant — impossible de poursuivre.");
  process.exit(1);
}

const sql = readFileSync(sqlPath, "utf8");
const md = existsSync(mdPath) ? readFileSync(mdPath, "utf8") : "";
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");

// ── 2. Cohérence documentaire du SQL proposé ───────────────────────────────────
console.log("\n=== VÉRIFICATIONS DOCUMENTAIRES ===");

// 2.1 Les 5 tables sont bien créées.
for (const t of MODEL.tables) {
  const re = new RegExp(
    `create\\s+table\\s+if\\s+not\\s+exists\\s+${t.name.replace(".", "\\.")}\\b`,
    "i",
  );
  check(`CREATE TABLE ${t.name}`, re.test(sql));
}

// 2.2 Les généralisations d'existantes sont additives (ALTER … ADD COLUMN, pas de CREATE).
for (const g of MODEL.generalisations) {
  const hasAlter = new RegExp(
    `alter\\s+table\\s+${g.table.replace(".", "\\.")}\\s+add\\s+column`,
    "i",
  ).test(sql);
  check(`ALTER additif ${g.table}`, hasAlter);
  for (const col of g.addColumns) {
    check(
      `  colonne ${g.table}.${col} ajoutée`,
      hasAlter && new RegExp(`add\\s+column\\s+if\\s+not\\s+exists\\s+${col}\\b`, "i").test(sql),
    );
  }
  // La table qu'elle remplace ne doit PAS être créée.
  const regexReplace = new RegExp(
    `create\\s+table\\s+(if\\s+not\\s+exists\\s+)?${g.replaces}\\b`,
    "i",
  );
  check(`  PAS de CREATE ${g.replaces} (réutilisé via ${g.table})`, !regexReplace.test(sql));
}

// 2.3 Les tables écartées n'existent pas comme CREATE TABLE.
for (const ex of MODEL.excludes) {
  const re = new RegExp(`create\\s+table\\s+(if\\s+not\\s+exists\\s+)?${ex}\\b`, "i");
  check(`PAS de CREATE ${ex}`, !re.test(sql));
}

// 2.4 Invariants métier présents dans le SQL (les commentaires comptent aussi).
for (const inv of MODEL.invariants) {
  check(`invariant « ${inv} »`, sql.toLowerCase().includes(inv.toLowerCase()));
}

// 2.5 L'identité TR+C doit être UNIQUE au sein de la version (contrainte réelle).
const sqlSansComment = strip(sql);
check(
  "UNIQUE(programmation_id, tranche_code, categorie) réel",
  /unique\s*\(\s*programmation_id\s*,\s*tranche_code\s*,\s*categorie\s*\)/i.test(sqlSansComment),
);

// 2.6 Les FK pointent vers les tables réelles de la base (référence, pas duplication).
for (const [fk, target] of [
  ["psp_lignes.programmation_id", "public.psp_programmations"],
  ["psp_lignes.tranche_code", "public.tranches"],
  ["psp_devis.fournisseur_id", "public.fournisseurs"],
]) {
  const ok = new RegExp(`references\\s+${target.replace(".", "\\.")}\\b`, "i").test(sqlSansComment);
  check(`FK ${fk} → ${target}`, ok);
}

// 2.7 Le modèle documentaire et le SQL sont alignés.
check("data-model.md mentionne psp_programmations", md.includes("psp_programmations"));
check(
  "data-model.md documente psp_reports source/cible",
  md.includes("source_ligne_id") && md.includes("cible_ligne_id"),
);
check("data-model.md documente le JSONB programme (Option A)", /Option A \(JSONB\)/.test(md));
check("data-model.md documente l'absence de psp_arbitrages", md.includes("psp_arbitrages"));
check(
  "data-model.md documente l'absence de psp_ligne_commandes",
  md.includes("psp_ligne_commandes"),
);

// ── 3. Constats live (optionnel, lecture seule) ─────────────────────────────────
console.log("\n=== CONSTATS LIVE (optionnels, lecture seule) ===");
let live = false;
try {
  const { supabaseAdmin } = await import("../src/integrations/supabase-ext/client.server.ts");
  const db = supabaseAdmin;
  const url = process.env["EXT_SUPABASE_URL"];
  const key = process.env["EXT_SUPABASE_SERVICE_ROLE_KEY"];

  // NOTE — artefact de probe évité : `.select("*", { head: true })` répond « OK »
  // avec count=null pour une table ABSENTE (cache PostgREST). Le contrôle
  // d'existence se fait donc SANS head (PGRST205 en cas de table absente) et
  // les colonnes via le schéma OpenAPI (/rest/v1/, lecture seule).

  const existence = async (table) => {
    const { error } = await db.from(table).select("*", { count: "exact" }).limit(1);
    return !error;
  };

  const spec = await (
    await fetch(`${url}/rest/v1/`, { headers: { apikey: key, Accept: "application/json" } })
  ).json();
  const definitions = spec.definitions ?? {};
  const colonnes = (table) => Object.keys(definitions[table]?.properties ?? {}).sort();

  // 3.1 psp_programmations : PRÉSENTE après la migration V6 (le constat V5.1
  // d'absence a été validé avant migration ; depuis, la table est créée).
  const progLive = await existence("psp_programmations");
  check(
    "psp_programmations PRÉSENTE après migration V6 (probe sans head)",
    progLive,
    "la table ne répond pas — migration 20260815 non appliquée ?",
  );
  check(
    "psp_programmations PRÉSENTE (OpenAPI)",
    !!definitions["psp_programmations"],
    "absente des définitions OpenAPI — migration 20260815 non appliquée ?",
  );

  // 3.2 psp_command_links : présente, colonnes réelles.
  const linksCols = colonnes("psp_command_links");
  check("psp_command_links présente (OpenAPI)", linksCols.length > 0, "absente des définitions");
  for (const col of [
    "commande_id",
    "import_row_id",
    "type_relation",
    "methode",
    "confiance",
    "statut",
    "justification",
  ]) {
    check(
      `psp_command_links.${col} (colonne réelle)`,
      linksCols.includes(col),
      `got: ${linksCols.join(", ")}`,
    );
  }

  // 3.3 psp_decisions : présente, colonnes réelles.
  const decisionsCols = colonnes("psp_decisions");
  check("psp_decisions présente (OpenAPI)", decisionsCols.length > 0, "absente des définitions");
  for (const col of ["cle_metier", "type_decision", "decision_utilisateur", "statut", "motif"]) {
    check(
      `psp_decisions.${col} (colonne réelle)`,
      decisionsCols.includes(col),
      `got: ${decisionsCols.join(", ")}`,
    );
  }

  // 3.4 psp_rules : présente (candidat aux règles PSP).
  const rulesCols = colonnes("psp_rules");
  check("psp_rules présente (OpenAPI)", rulesCols.length > 0, "absente des définitions");
  for (const col of ["type_regle", "condition", "resultat", "statut"]) {
    check(
      `psp_rules.${col} (colonne réelle)`,
      rulesCols.includes(col),
      `got: ${rulesCols.join(", ")}`,
    );
  }

  // 3.5 Pattern travaux_commandes_historique confirmé (réutilisé par psp_ligne_historique).
  const histCols = colonnes("travaux_commandes_historique");
  check(
    "travaux_commandes_historique présente (pattern réutilisé)",
    histCols.length > 0,
    "absente des définitions",
  );
  for (const col of ["operation", "avant", "apres", "resolu"]) {
    check(
      `travaux_commandes_historique.${col} (colonne réelle)`,
      histCols.includes(col),
      `got: ${histCols.join(", ")}`,
    );
  }

  live = true;
} catch (err) {
  skip("connexion live", `indisponible (${err.message}) — relancer avec --env-file=.env`);
}

// ── Bilan ──────────────────────────────────────────────────────────────────────
console.log(`\n=== BILAN ===`);
console.log(`  PASS : ${PASS.length}`);
console.log(`  FAIL : ${FAIL.length}`);
if (SKIP.length) console.log(`  SKIP : ${SKIP.length}`);
console.log(`  mode live : ${live ? "activé" : "non requis"}`);
if (PASS.length) console.log("\n  ✔ " + PASS.join("\n  ✔ "));
if (SKIP.length) console.log("\n  ⚠ " + SKIP.join("\n  ⚠ "));
if (FAIL.length) {
  console.log("\n  ✘ " + FAIL.join("\n  ✘ "));
  process.exit(1);
}
console.log("\nModèle PSP V5.1 cohérent — aucune écriture Supabase effectuée.");
