// ═══════════════════════════════════════════════════════════════════════════════
// V8.6.3 — NETTOYAGE LEGACY : tests PURS ciblés.
// Exécution : node scripts/test-psp-v863.mjs
// ═══════════════════════════════════════════════════════════════════════════════
// Points A–H :
//   A. Reports V3/V4 non accessible depuis le parcours principal /preparation-psp ;
//   B. le composant/API legacy n'est pas supprimé ;
//   C. le bandeau distingue lignes détectées / lignes matérialisées ;
//   D. kpiRegistreAnnuel reste le KPI utilisé par /suivi ;
//   E. kpiSuivi reste disponible pour les tests mais n'est plus utilisé par l'UI ;
//   F. aucun changement du moteur de rapprochement V8.5 ;
//   G. aucun changement du moteur de matérialisation ;
//   H. aucun changement Dashboard.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = (p) => join(__dirname, "..", "src", p);
const fichier = (p) => readFileSync(src(p), "utf8");

const grouping = fichier("components/preparation-psp/PspGroupingSelector.tsx");
const preparationRoute = fichier("routes/preparation-psp.tsx");
const suiviRoute = fichier("routes/suivi.tsx");
const supabaseFn = fichier("lib/psp.prep.supabase.functions.ts");
const pspFunctions = fichier("lib/psp.functions.ts");
const suiviView = fichier("lib/psp.suivi.view.ts");
const suiviTable = fichier("components/suivi/SuiviTable.tsx");

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

// ════════════ A/B. REPORTS — revue restaurée en CONSULTATION (V8.8.3) ══════
// V8.8.3 §4 — la « Revue des anciennes lignes PSP non commandées » est RESTAURÉE
// dans /preparation-psp comme fonctionnalité de CONSULTATION / HISTORIQUE, avec
// un libellé explicite, séparée visuellement de la programmation actuelle. Elle
// reste non créatrice/non modificative : aucune ligne opérationnelle n'est
// créée/modifiée (aucune écriture métier).
check(
  "A. la revue « anciennes lignes PSP non commandées » est visible dans le sélecteur, séparée de la programmation",
  grouping.includes('valeur: "reports"') &&
    grouping.includes("Revue des anciennes lignes PSP non commandées") &&
    grouping.includes("separateur"),
);
check(
  "A2. le type ModeAffichage conserve 'reports' (contrat inchangé)",
  grouping.includes('export type ModeAffichage = "tranche" | "charge" | "detail" | "reports"'),
);
check(
  "A3. la revue est une CONSULTATION/HISTORIQUE lecture seule (commentaire explicite)",
  grouping.includes("CONSULTATION") &&
    grouping.includes("aucune écriture") &&
    grouping.includes("aucune deuxième source de vérité"),
);
check(
  "B. le composant PspRevueReports n'est PAS supprimé",
  readFileSync(
    join(__dirname, "..", "src", "components", "preparation-psp", "PspRevueReports.tsx"),
    "utf8",
  ).length > 0,
);
check(
  "B2. le module psp.prep.suivi.ts (V3) n'est PAS supprimé",
  readFileSync(join(__dirname, "..", "src", "lib", "psp.prep.suivi.ts"), "utf8").length > 0,
);
check(
  "B3. l'API createPspReport reste exportée (gel, pas de suppression)",
  supabaseFn.includes("export const createPspReport"),
);
check(
  "B4. PspRevueReports reste rendu par le parcours principal (mode « reports »)",
  preparationRoute.includes("PspRevueReports") && preparationRoute.includes('mode === "reports"'),
);

// ════════════ C. BANDEAU — détectées vs matérialisées ═════════════════════════
check(
  "C. le registre expose le nombre de lignes 'suivi' matérialisées",
  supabaseFn.includes("lignesSuiviMaterialisees") && supabaseFn.includes('l.origine === "suivi"'),
);
check(
  "C2. le bandeau distingue « détectées » et « matérialisées »",
  suiviRoute.includes("détectées dans les imports") &&
    suiviRoute.includes("matérialisée(s) en opérations") &&
    suiviRoute.includes("lignesSuiviMaterialisees"),
);
check(
  "C3. les marqueurs travaux_import_details restent conservés (aucune suppression)",
  suiviRoute.includes("marqueurs d'import") && suiviRoute.includes("traçabilité"),
);

// ════════════ D/E. KPI — kpiRegistreAnnuel actif, kpiSuivi gelé ═══════════════
check("D. /suivi utilise kpiRegistreAnnuel (SuiviTable)", suiviTable.includes("kpiRegistreAnnuel"));
check(
  "E. kpiSuivi est marqué LEGACY / TESTS HISTORIQUES (non utilisé par l'UI)",
  suiviView.includes("LEGACY / TESTS HISTORIQUES") &&
    suiviView.includes("export const kpiSuivi") &&
    !suiviTable.includes("kpiSuivi"),
);
check(
  "E2. kpiSuivi reste exporté (suites historiques V8.2/V8.2.2/V8.6)",
  suiviView.includes("export const kpiSuivi"),
);

// ════════════ F/G. MOTEURS INCHANGÉS ═════════════════════════════════════════
check(
  "F. moteur de rapprochement V8.5 inchangé (aucune modification ce lot)",
  fichier("lib/psp.suivi.rapprochement.ts").includes("suggererOperationsPourCommande") &&
    fichier("lib/psp.suivi.rapprochement.ts").includes("evaluerCorrespondance"),
);
check(
  "G. moteur de matérialisation inchangé (materialiserLignesSansCommande intact)",
  fichier("lib/travaux.functions.ts").includes("export const materialiserLignesSansCommande") &&
    fichier("lib/travaux.functions.ts").includes('origine: "suivi"'),
);
check(
  "H. Dashboard inchangé : aucun fichier du lot n'implémente de logique dashboard",
  !grouping.includes("dashboard") &&
    !supabaseFn.includes("dashboard-travaux") &&
    !suiviView.includes("dashboard-travaux"),
);

// ════════════ LEGACY — commentaires de gel ═══════════════════════════════════
check(
  "LEGACY. psp_command_analysis gelée (commentaire explicite, comportement intact)",
  pspFunctions.includes("LEGACY — ne pas utiliser pour le suivi opérationnel actuel") &&
    pspFunctions.includes("export const savePspCommandAnalysis"),
);
check(
  "LEGACY. psp_patrimoine_context gelée (commentaire explicite, comportement intact)",
  pspFunctions.includes("export const savePspPatrimoineContext") &&
    pspFunctions.includes("gel de `psp_patrimoine_context`"),
);
check(
  "LEGACY. psp_reports gelée (commentaire explicite, createPspReport intact)",
  supabaseFn.includes("gel de `psp_reports`") &&
    supabaseFn.includes("export const createPspReport"),
);

console.log(`\nV8.6.3 PUR : ${passed} ok, ${failed} échec(s)`);
if (failed > 0) process.exit(1);
