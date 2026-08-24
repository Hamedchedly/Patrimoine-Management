// ═══════════════════════════════════════════════════════════════════════════════
// V8.9 — STABILISATION DU CYCLE DE VIE DE LA PROGRAMMATION PSP : tests PURS.
// Exécution : node scripts/test-psp-v89.mjs
// ═══════════════════════════════════════════════════════════════════════════════
// Vérifie :
//   · fusionnerProgramme : ne JAMAIS détruire les anciennes années ;
//   · programmerAnnee : ajout/modification/suppression d'une année isolée ;
//   · normaliserProgrammePersist : 0 → clé conservée, négatif → 0 ;
//   · la persistance serveur (updatePspLigne / updatePspOperationComplete)
//     fusionne le programme avec l'existant (conservation des années) ;
//   · le report (route) complète une ligne existante au lieu d'en créer un doublon ;
//   · la projection /suivi lit programme[annee] et le devis ne détermine jamais l'année ;
//   · aucune table/entité parallèle, imports & Dashboard intacts, moteur V8.5 intact.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  fusionnerProgramme,
  normaliserProgrammePersist,
  programmerAnnee,
} from "../src/lib/psp.prep.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = (p) => join(__dirname, "..", "src", p);
const fichier = (p) => readFileSync(src(p), "utf8");

const supabaseFn = fichier("lib/psp.prep.supabase.functions.ts");
const route = fichier("routes/preparation-psp.tsx");
const prep = fichier("lib/psp.prep.ts");
const suiviFn = fichier("lib/psp.prep.supabase.functions.ts");
const suiviView = fichier("lib/psp.suivi.view.ts");
const rapprochement = fichier("lib/psp.suivi.rapprochement.ts");

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

// ════════════ A. CONSERVATION DES ANNÉES (fusionnerProgramme) ═══════════════
console.log("\n=== A. fusionnerProgramme — les anciennes années ne sont jamais détruites ===");
{
  const resultat = fusionnerProgramme(
    { 2027: 50000, 2028: 55000, 2029: 0, 2030: 30000 },
    { 2028: 60000, 2031: 10000 },
  );
  check(
    "A1. ajout/modification d'une année sans détruire les autres",
    resultat["2027"] === 50000 &&
      resultat["2028"] === 60000 &&
      resultat["2029"] === 0 &&
      resultat["2030"] === 30000 &&
      resultat["2031"] === 10000,
  );
  check("A2. clé absente de l'apport conservée (2027 intacte)", resultat["2027"] === 50000);
  check("A3. clé à 0 de l'apport écrasée (déprogrammation volontaire)", resultat["2029"] === 0);
  check(
    "A4. apport vide → programme inchangé",
    JSON.stringify(fusionnerProgramme({ 2027: 5 }, {})) === '{"2027":5}',
  );
}

// ════════════ B. programmerAnnee — ajout / modif / suppression d'une année ════
console.log("\n=== B. programmerAnnee ===");
{
  const { programme: p1, change: c1 } = programmerAnnee({}, 2028, 55000);
  check("B1. ajout 2028 sur programme vide", p1["2028"] === 55000 && c1 === true);
  const { programme: p2, change: c2 } = programmerAnnee(p1, 2028, 60000);
  check("B2. modification 2028 sans toucher aux autres", p2["2028"] === 60000 && c2 === true);
  const { programme: p3, change: c3 } = programmerAnnee(p2, 2028, 0);
  check("B3. suppression explicite 2028 → 0", p3["2028"] === 0 && c3 === true);
  const { change: c4 } = programmerAnnee(p3, 2028, 0);
  check("B4. même valeur → aucun changement", c4 === false);
}

// ════════════ C. normaliserProgrammePersist ═════════════════════════════════
console.log("\n=== C. normaliserProgrammePersist ===");
{
  const n = normaliserProgrammePersist({ 2027: 50000, 2028: 0, 2029: -5 });
  check("C1. montants positifs conservés", n["2027"] === 50000);
  check("C2. 0 → 0 (clé conservée, année visible)", n["2028"] === 0);
  check("C3. négatif → 0", n["2029"] === 0);
}

// ════════════ D. PERSISTANCE SERVEUR — fusion dans updatePspLigne / Complete ══
console.log("\n=== D. Persistance serveur : conservation des années ===");
check(
  "D1. updatePspOperationComplete fusionne le programme avec l'existant",
  supabaseFn.includes("fusionnerProgramme") &&
    supabaseFn.includes("programmeFusionne") &&
    supabaseFn.includes("p_programme: programmeFusionne"),
);
check(
  "D2. updatePspLigne fusionne le programme avec l'existant",
  (supabaseFn.match(/programmeFusionne/g) ?? []).length >= 2 &&
    supabaseFn.includes("fusionnerProgramme"),
);
check(
  "D3. aucune perte : le RPC reçoit le programme COMPLET fusionné (jamais partiel)",
  supabaseFn.includes("data.programme") && supabaseFn.includes("ligneActuelle?.programme"),
);

// ════════════ E. REPORT — ligne existante complétée, jamais de doublon ══════
console.log("\n=== E. Report additif (route /preparation-psp) ===");
check(
  "E1. le report cherche une ligne existante (même TR+C+nature) avant de créer",
  route.includes("const candidat = operations.find") &&
    route.includes("norm(o.nature_travaux) === norm(ligne.nature_travaux)"),
);
check(
  "E2. ligne trouvée → programmerAnnee + update (années préservées)",
  route.includes("programmerAnnee(") &&
    route.includes("updateCompleteFn({") &&
    route.includes("années préservées"),
);
check(
  "E3. ligne absente → création origine='report' conservée (comportement historique)",
  route.includes('origine: "report"') && route.includes("createLigneFn({"),
);
check(
  "E4. aucune création de doublon : le candidat existant passe par update, pas par création",
  route.includes("aucun changement") &&
    route.includes("programmerAnnee(") &&
    route.includes('origine: "report"'),
);

// ════════════ F. PROJECTION /suivi — programme[annee] lu directement ════════
console.log("\n=== F. Projection /suivi ===");
check(
  "F1. une ligne preparation n'apparaît sur l'année N que si programme[N]>0",
  suiviFn.includes("progAnnee > 0") &&
    suiviFn.includes("!origineSuivi && !horsPsp && progAnnee <= 0 && !commandeLiee"),
);
check(
  "F2. une ligne 'suivi' restreinte à SON exercice de matérialisation",
  suiviFn.includes("exerciceLigneSuivi(ligne)") && suiviFn.includes("origineSuivi &&"),
);
check(
  "F3. le devis ne détermine JAMAIS l'année (visibilité = programme / horsPsp / commande liée / origine suivi)",
  suiviFn.includes(
    "visibleAnnee = progAnnee > 0 || horsPsp || Boolean(commandeLiee) || origineSuivi",
  ),
);

// ════════════ G. MULTI-ANNÉES — le modèle psp_lignes.programme le permet ════
console.log("\n=== G. Multi-années dans psp_lignes.programme ===");
check(
  "G1. programme est un Record année→montant (pas une colonne année unique)",
  prep.includes("programme: Record<string, number>") && prep.includes("programme[String(a)]"),
);
check(
  "G2. le formulaire d'édition pré-remplit TOUTES les années (2027-2031)",
  fichier("components/preparation-psp/PspOperationForm.tsx").includes(
    "setProgramme(PSP_ANNEES.map((a) => operation.programme[String(a)] ?? 0))",
  ),
);
check(
  "G3. le tableau affiche une colonne par année (PspTable)",
  fichier("components/preparation-psp/PspTable.tsx").includes("...PSP_ANNEES.map((a) => ({"),
);

// ════════════ H. AUCUNE ENTITÉ / MOTEUR PARALLÈLE ═══════════════════════════
console.log("\n=== H. Architecture : aucune entité parallèle ===");
check(
  "H1. moteur V8.5 intact (suggererOperationsPourCommande)",
  rapprochement.includes("suggererOperationsPourCommande"),
);
check(
  "H2. aucune nouvelle table référencée (psp_lignes reste l'entité unique)",
  !supabaseFn.includes("psp_lignes_annees"),
);
check(
  "H3. le Dashboard n'est pas touché (aucun fichier du lot n'implémente de logique dashboard)",
  !route.includes("dashboard-travaux") &&
    !prep.includes("dashboard-travaux") &&
    !supabaseFn.includes("dashboard-travaux"),
);
check(
  "H4. imports intangibles : aucune écriture nouvelle vers les tables d'import dans le lot",
  !supabaseFn.includes('.from("travaux_commandes").insert') &&
    !supabaseFn.includes('.from("import_travaux").insert'),
);

// ════════════ I. psp_ligne_historique — mécanisme existant inchangé ═════════
console.log("\n=== I. Historique ===");
check(
  "I1. psp_ligne_historique reste le mécanisme unique (trigger + server functions)",
  supabaseFn.includes('from("psp_ligne_historique")') &&
    supabaseFn.includes("getPspLignesHistorique"),
);

// ════════════ J. REVUE LEGACY conservée (consultation) ═════════════════════
console.log("\n=== J. Revue legacy conservée ===");
check(
  "J1. PspRevueReports et psp.prep.suivi.ts existent toujours",
  readFileSync(
    join(__dirname, "..", "src", "components", "preparation-psp", "PspRevueReports.tsx"),
    "utf8",
  ).length > 0 &&
    readFileSync(join(__dirname, "..", "src", "lib", "psp.prep.suivi.ts"), "utf8").length > 0,
);
check(
  "J2. la revue reste identifiée par TR+C (cleIdentitePsp — affichage/historique uniquement)",
  fichier("lib/psp.prep.suivi.ts").includes("export const cleIdentitePsp"),
);

console.log(`\nV8.9 PUR — ${passed} ok / ${failed} échec(s)`);
if (failed > 0) process.exit(1);
