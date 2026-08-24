// ═══════════════════════════════════════════════════════════════════════════════
// V8.8.3 — PROJECTION ANNUELLE STRICTE + REVUE ANCIENNES PSP : tests PURS.
// Exécution : node scripts/test-psp-v883.mjs
// ═══════════════════════════════════════════════════════════════════════════════
// A. programme 2027 > 0 → visible /suivi 2027 ;
// B. programme 2028 absent/0 → invisible /suivi 2028 ;
// C. programme 2028 > 0 → invisible 2027 / visible 2028 ;
// D. devis 2026 + programmation 2028 → invisible 2026 / visible 2028 ;
// E. sans programme → invisible des années futures ;
// F. 2027 sans commande → état « Sans commande » ;
// G. aucune commande fictive ; H. aucun lien fictif ;
// I. revue anciennes PSP visible dans /preparation-psp ;
// J. la revue ne crée/modifie rien ; K. imports intacts ; L. Dashboard intact.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { deriverEtatSuiviAnnuel } from "../src/lib/psp.suivi.view.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = (p) => join(__dirname, "..", "src", p);
const fichier = (p) => readFileSync(src(p), "utf8");

const supabaseFn = fichier("lib/psp.prep.supabase.functions.ts");
const selector = fichier("components/preparation-psp/PspGroupingSelector.tsx");
const prepRoute = fichier("routes/preparation-psp.tsx");
const corrSection = fichier("components/suivi/PspCorrespondancesSection.tsx");
const view = fichier("lib/psp.suivi.view.ts");

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

// ════════════ 1. PROJECTION ANNUELLE STRICTE ══════════════════════════════════
console.log("\n=== 1. Projection annuelle stricte ===");
check(
  "1.1. filtre lié à programme[annee] > 0 (pas seulement « psp_lignes existe »)",
  supabaseFn.includes("progAnnee > 0") && supabaseFn.includes("programme[N]"),
);
check(
  "1.2. ligne 'preparation' sans programme sur l'année → exclue",
  supabaseFn.includes("!origineSuivi && !horsPsp && progAnnee <= 0") ||
    (supabaseFn.includes("!origineSuivi") &&
      supabaseFn.includes("!horsPsp") &&
      supabaseFn.includes("progAnnee <= 0") &&
      supabaseFn.includes("!commandeLiee")),
);
check(
  "1.3. ligne 'suivi' restreinte à SON exercice de matérialisation",
  supabaseFn.includes("exerciceLigneSuivi(ligne)") &&
    supabaseFn.includes("origineSuivi &&") &&
    supabaseFn.includes("annee !== exerciceLigneSuivi(ligne)"),
);
check(
  "1.4. fonction exerciceLigneSuivi dérivée du programme ou de la remarque « import annuel »",
  supabaseFn.includes("export const exerciceLigneSuivi") &&
    supabaseFn.includes("import annuel\\s+(\\d{4})"),
);
check(
  "1.5. le devis ne détermine JAMAIS l'année (commentaire explicite)",
  supabaseFn.includes("un devis (psp_devis) ne détermine JAMAIS l'année de suivi"),
);

// ════════════ 2. ÉTATS / ANTI-FICTIF ══════════════════════════════════════════
console.log("\n=== 2. États / aucune donnée fictive ===");
check(
  "2.1. 2027 sans commande → état « Sans commande »",
  deriverEtatSuiviAnnuel({ numeroCommande: null, engage: null, paye: null }) === "sans_commande",
);
check(
  "2.2. aucune commande fictive (commandes filtrées par exercice depuis travaux_commandes)",
  supabaseFn.includes('.eq("annee_exercice", annee)') && supabaseFn.includes('travaux_commandes"'),
);
check(
  "2.3. aucun lien fictif (rattachement = confirmation humaine via createPspCommandLink)",
  supabaseFn.includes("export const createPspCommandLink") &&
    !supabaseFn.includes("commande_fictive"),
);

// ════════════ 3. REVUE ANCIENNES PSP ══════════════════════════════════════════
console.log("\n=== 3. Revue des anciennes lignes PSP ===");
check(
  "3.1. option « Revue des anciennes lignes PSP non commandées » visible dans le sélecteur",
  selector.includes("Revue des anciennes lignes PSP non commandées") &&
    selector.includes('valeur: "reports"'),
);
check(
  "3.2. mode séparé visuellement de la programmation actuelle",
  selector.includes("separateur") && selector.includes("border-l border-dashed"),
);
check(
  "3.3. la route /preparation-psp rend bien PspRevueReports quand mode=reports",
  prepRoute.includes('mode === "reports"') && prepRoute.includes("PspRevueReports"),
);
check(
  "3.4. PspRevueReports est une CONSULTATION (aucune création d'opération)",
  fichier("components/preparation-psp/PspRevueReports.tsx").includes("resumeArbitrage") &&
    !fichier("components/preparation-psp/PspRevueReports.tsx").includes("createPspLigne"),
);
check(
  "3.5. la revue réutilise psp.prep.suivi.ts (contrat legacy, aucune deuxième source)",
  fichier("lib/psp.prep.suivi.ts").includes("analyserLignesReport"),
);

// ════════════ 4. CORRESPONDANCES COMMANDES ════════════════════════════════════
console.log("\n=== 4. Correspondances commandes ===");
check(
  "4.1. état vide compact et explicite (« Aucune commande à rapprocher »)",
  corrSection.includes("Aucune commande à rapprocher") && corrSection.includes("il ne crée jamais"),
);
check(
  "4.2. rôle limité au rattachement (proposition + confirmation humaine)",
  corrSection.includes("createPspCommandLink") && !corrSection.includes("createPspLigne"),
);

// ════════════ 5. ANTI-RÉGRESSION ══════════════════════════════════════════════
console.log("\n=== 5. Anti-régression ===");
check(
  "5.1. deriverEtatSuiviAnnuel intact (tolérance 0,01)",
  view.includes("Math.abs(p - e) < 0.01") && view.includes("export const deriverEtatSuiviAnnuel"),
);
check(
  "5.2. moteur V8.5 intact (suggererOperationsPourCommande)",
  fichier("lib/psp.suivi.rapprochement.ts").includes("export const suggererOperationsPourCommande"),
);
check(
  "5.3. materialiserLignesSansCommande intact (origine='suivi')",
  fichier("lib/travaux.functions.ts").includes("export const materialiserLignesSansCommande") &&
    fichier("lib/travaux.functions.ts").includes('origine: "suivi"'),
);
check(
  "5.4. etat_pilotage intact (server function + labels)",
  supabaseFn.includes("export const updatePspLigneEtatPilotage") &&
    supabaseFn.includes("ETAT_PILOTAGE_LABELS"),
);
check(
  "5.5. libelleEntreprise intact (V8.8 §1)",
  fichier("lib/psp.prep.v7.ts").includes("export const libelleEntreprise"),
);
check(
  "5.6. aucune référence aux tables d'import en écriture",
  !supabaseFn.includes('.from("travaux_commandes").insert') &&
    !supabaseFn.includes('.from("import_travaux").insert'),
);

console.log(`\nV8.8.3 PUR — ${passed} ok / ${failed} échec(s)`);
if (failed > 0) process.exit(1);
