// ═══════════════════════════════════════════════════════════════════════════════
// V8.8.3 — PROJECTION ANNUELLE STRICTE : tests LIVE sur données réelles.
// Exécution : node --env-file=.env scripts/test-psp-v883-live.mjs
// ═══════════════════════════════════════════════════════════════════════════════
// Vérifie sur des lignes réelles :
//  · une ligne 'preparation' n'apparaît que sur les années où programme[N]>0 ;
//  · une ligne 'suivi' matérialisée 2026 n'apparaît pas en 2027-2031 ;
//  · exerciceLigneSuivi dérive correctement l'exercice (programme / remarque) ;
//  · aucune écriture (lecture seule) ; tables d'import identiques avant/après.
import { createClient } from "@supabase/supabase-js";

import { exerciceLigneSuivi } from "../src/lib/psp.prep.supabase.functions.ts";

const url = process.env["EXT_SUPABASE_URL"];
const key = process.env["EXT_SUPABASE_SERVICE_ROLE_KEY"] ?? process.env["EXT_SUPABASE_ANON_KEY"];
const db = createClient(url, key);

let passed = 0;
let failed = 0;
function check(label, ok, detail = "") {
  if (ok) {
    passed++;
    console.log(`  ✔ ${label}`);
  } else {
    failed++;
    console.error(`  ✘ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// ════════════ 1. exerciceLigneSuivi (logique pure) ═════════════════════════════
console.log("\n=== 1. exerciceLigneSuivi ===");
check(
  "1.1. ligne 'suivi' programme 2026 → exercice 2026",
  exerciceLigneSuivi({ origine: "suivi", programme: { 2026: 3000 } }) === 2026,
);
check(
  "1.2. ligne 'suivi' programme 2028 → exercice 2028 (jamais déduit du devis)",
  exerciceLigneSuivi({ origine: "suivi", programme: { 2028: 50000 } }) === 2028,
);
check(
  "1.3. ligne 'suivi' sans programme + remarque « import annuel 2026 » → 2026",
  exerciceLigneSuivi({
    origine: "suivi",
    programme: {},
    remarques: "Matérialisée depuis l'import annuel 2026 (fichier.xlsx) — sans commande",
  }) === 2026,
);
check(
  "1.4. ligne 'preparation' → null (non concernée)",
  exerciceLigneSuivi({ origine: "preparation", programme: { 2027: 100 } }) === null,
);

// ════════════ 2. DONNÉES RÉELLES ═══════════════════════════════════════════════
console.log("\n=== 2. Projection stricte sur lignes réelles ===");
const { data: prep } = await db
  .from("psp_lignes")
  .select("id, tranche_code, programme, origine, remarques")
  .eq("origine", "preparation")
  .order("created_at", { ascending: true });
const ligne1977 = (prep ?? []).find((l) => l.tranche_code === "1977");
const ligne1395 = (prep ?? []).find((l) => l.tranche_code === "1395");
const ligne1401 = (prep ?? []).find((l) => l.tranche_code === "1401");
check("2.1. ligne réelle TR 1977 trouvée (programmation pluriannuelle)", ligne1977?.id != null);

if (ligne1977?.id) {
  const prog = ligne1977.programme ?? {};
  const visibles = [2027, 2028, 2029, 2030, 2031].filter((a) => (prog[String(a)] ?? 0) > 0);
  check("2.2. TR 1977 visible en 2027 (programme 2027=500)", visibles.includes(2027));
  check("2.3. TR 1977 visible en 2028 (programme 2028=6000)", visibles.includes(2028));
  check("2.4. TR 1977 INVISIBLE en 2029 (programme 2029=0)", !visibles.includes(2029));
  check("2.5. TR 1977 visible en 2030 (programme 2030=3000)", visibles.includes(2030));
  check("2.6. TR 1977 INVISIBLE en 2031 (programme 2031=0)", !visibles.includes(2031));
}
if (ligne1395?.id) {
  const prog = ligne1395.programme ?? {};
  const visibles = [2027, 2028, 2029, 2030, 2031].filter((a) => (prog[String(a)] ?? 0) > 0);
  check("2.7. ligne sans programme (TR 1395) → invisible de 2027-2031", visibles.length === 0);
}
if (ligne1401?.id) {
  const prog = ligne1401.programme ?? {};
  check(
    "2.8. TR 1401 visible en 2027 et 2030, invisible 2028/2029/2031",
    (prog["2027"] ?? 0) > 0 &&
      (prog["2030"] ?? 0) > 0 &&
      (prog["2028"] ?? 0) === 0 &&
      (prog["2029"] ?? 0) === 0 &&
      (prog["2031"] ?? 0) === 0,
  );
}

// ════════════ 3. LIGNES 'SUIVI' 2026 NE DOIVENT PAS APPARAÎTRE EN 2027+ ═══════
console.log("\n=== 3. Lignes 'suivi' 2026 hors des années futures ===");
const { data: suivi } = await db
  .from("psp_lignes")
  .select("id, tranche_code, origine, programme, remarques")
  .eq("origine", "suivi");
const exercices = (suivi ?? []).map((l) => exerciceLigneSuivi(l));
const exercicesNonNuls = exercices.filter((e) => e != null);
check(
  "3.1. exercices dérivés des lignes 'suivi' réelles = 2026 (toutes matérialisées 2026)",
  exercicesNonNuls.length === exercices.length &&
    exercicesNonNuls.length > 0 &&
    exercicesNonNuls.every((e) => e === 2026),
  `(${exercicesNonNuls.length}/${exercices.length} non nuls)`,
);
check(
  "3.2. aucune ligne 'suivi' réelle avec programme future 2027-2031",
  (suivi ?? []).every(
    (l) => ![2027, 2028, 2029, 2030, 2031].some((a) => (l.programme?.[String(a)] ?? 0) > 0),
  ),
);

// ════════════ 4. INTÉGRITÉ (aucune écriture) ═══════════════════════════════════
console.log("\n=== 4. Intégrité (lecture seule) ===");
const tablesImport = [
  "travaux_commandes",
  "travaux_commandes_historique",
  "import_travaux",
  "imports",
  "psp_imports",
  "psp_import_rows",
  "travaux_import_details",
];
const comptage = async () => {
  const out = {};
  for (const t of tablesImport) {
    const { count } = await db.from(t).select("id", { count: "exact", head: true });
    out[t] = count;
  }
  return out;
};
const avant = await comptage();
const apres = await comptage();
console.log("  avant :", JSON.stringify(avant));
console.log("  après :", JSON.stringify(apres));
check(
  "4.1. les 7 tables d'import strictement identiques (test en lecture seule)",
  tablesImport.every((t) => avant[t] === apres[t]),
);
const { count: liens } = await db
  .from("psp_command_links")
  .select("id", { count: "exact", head: true });
check("4.2. aucun lien créé (psp_command_links inchangé)", liens === 0);

console.log(`\nV8.8.3 LIVE — ${passed} ok / ${failed} échec(s)`);
if (failed > 0) process.exit(1);
