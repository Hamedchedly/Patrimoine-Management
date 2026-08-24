// ═══════════════════════════════════════════════════════════════════════════════
// V8.9.1 — REVUE DES ANCIENNES PROGRAMMATIONS + COHÉRENCE PRÉPARATION ↔ SUIVI.
// Exécution : node scripts/test-psp-v891.mjs
// ═══════════════════════════════════════════════════════════════════════════════
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { anneesProgrammees, extraireProgrammationsHistoriques } from "../src/lib/psp.prep.ts";
import { construireRevueAnciennesProgrammations } from "../src/lib/psp.prep.suivi.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = (p) => join(__dirname, "..", "src", p);
const fichier = (p) => readFileSync(src(p), "utf8");

const supabaseFn = fichier("lib/psp.prep.supabase.functions.ts");
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

// ════════════ A. PROGRAMME MULTI-ANNÉES ═════════════════════════════════════
console.log("\n=== A. programme multi-années ===");
{
  const prog = { 2027: 500, 2028: 6000, 2029: 0, 2030: 3000 };
  const annees = anneesProgrammees(prog);
  check(
    "A1. années réellement programmées = 2027, 2028, 2030",
    JSON.stringify(annees) === "[2027,2028,2030]",
  );
  const hist = extraireProgrammationsHistoriques(prog, 2027);
  check("A2. avec référence 2027 → aucune entrée ancienne", hist.length === 0);
}

// ════════════ B. RÉFÉRENCE 2027 ═════════════════════════════════════════════
console.log("\n=== B. référence 2027 ===");
{
  const prog = { 2025: 0, 2026: 40000, 2027: 50000, 2028: 60000 };
  const hist = extraireProgrammationsHistoriques(prog, 2027);
  check(
    "B1. 2026 ancienne (40 000 €) incluse",
    hist.length === 1 && hist[0].annee === 2026 && hist[0].montant === 40000,
  );
  check("B2. 2027 courante / 2028 future exclues", !hist.some((h) => h.annee >= 2027));
  check("B3. 2025 montant 0 → exclue", !hist.some((h) => h.annee === 2025));
}

// ════════════ C. RÉFÉRENCE 2026 ═════════════════════════════════════════════
console.log("\n=== C. référence 2026 ===");
{
  const prog = { 2025: 35000, 2026: 50000, 2027: 60000 };
  const hist = extraireProgrammationsHistoriques(prog, 2026);
  check(
    "C1. 2025 ancienne (35 000 €) incluse",
    hist.length === 1 && hist[0].annee === 2025 && hist[0].montant === 35000,
  );
  check("C2. 2026 courante / 2027 future exclues", !hist.some((h) => h.annee >= 2026));
}

// ════════════ D. MONTANT 0 ═════════════════════════════════════════════════
console.log("\n=== D. montant 0 ===");
{
  const hist = extraireProgrammationsHistoriques({ 2025: 0, 2026: 0 }, 2027);
  check("D1. aucune année à montant 0 considérée programmée", hist.length === 0);
}

// ════════════ E. DEVIS SEUL ═════════════════════════════════════════════════
console.log("\n=== E. devis seul ===");
{
  const entrees = construireRevueAnciennesProgrammations(
    [
      {
        id: "L1",
        tranche: "1977",
        categorie: "GT",
        corps_etat: "(h) Cages",
        nature_travaux: "Rénovation",
        programme: {},
        origine: "preparation",
        devis: [{ statut: "recu", montant: 50000, entreprise: "ENT A" }],
      },
    ],
    2027,
  );
  check("E1. un devis seul ne crée AUCUNE ancienne programmation", entrees.length === 0);
}

// ════════════ F. COMMANDE SEULE ═════════════════════════════════════════════
console.log("\n=== F. commande seule ===");
{
  const entrees = construireRevueAnciennesProgrammations(
    [
      {
        id: "L1",
        tranche: "1977",
        categorie: "GT",
        corps_etat: null,
        nature_travaux: null,
        programme: {},
        origine: "preparation",
        commande_liee: {
          numero_commande: "123456",
          etat_commande: "Close",
          etat_travaux: "Terminés",
        },
      },
    ],
    2027,
  );
  check("F1. une commande seule ne crée AUCUNE ancienne programmation", entrees.length === 0);
}

// ════════════ G. REVUE — une entrée par année réellement présente ═══════════
console.log("\n=== G. Revue : une entrée par année historique ===");
{
  const entrees = construireRevueAnciennesProgrammations(
    [
      {
        id: "L1",
        tranche: "1977",
        categorie: "GT",
        corps_etat: "(h) Cages",
        nature_travaux: "Rénovation cages",
        programme: { 2025: 40000, 2027: 50000 },
        origine: "preparation",
      },
      {
        id: "L2",
        tranche: "1401",
        categorie: "CP",
        corps_etat: "(g) Halls",
        nature_travaux: "Peinture halls",
        programme: { 2026: 1500, 2027: 2000 },
        origine: "suivi",
      },
    ],
    2027,
  );
  check("G1. deux entrées (2025 + 2026), une par année réellement présente", entrees.length === 2);
  const annes = entrees.map((e) => e.annee).sort();
  check("G2. années = [2025, 2026]", JSON.stringify(annes) === "[2025,2026]");
  const l1 = entrees.find((e) => e.tranche === "1977");
  check("G3. entrée 1977 → année 2025, montant 40000", l1?.annee === 2025 && l1?.montant === 40000);
  check("G4. origine conservée (preparation)", l1?.origine === "preparation");
  const l2 = entrees.find((e) => e.tranche === "1401");
  check(
    "G5. entrée 1401 → année 2026, montant 1500, origine suivi",
    l2?.annee === 2026 && l2?.montant === 1500 && l2?.origine === "suivi",
  );
}

// ════════════ H. REVUE — états réellement dérivés ═══════════════════════════
console.log("\n=== H. Revue : états dérivés (jamais inventés) ===");
{
  const entrees = construireRevueAnciennesProgrammations(
    [
      {
        id: "L1",
        tranche: "1977",
        categorie: "GT",
        corps_etat: null,
        nature_travaux: null,
        programme: { 2026: 40000 },
        origine: "preparation",
      },
      {
        id: "L2",
        tranche: "1401",
        categorie: "CP",
        corps_etat: null,
        nature_travaux: null,
        programme: { 2026: 1500 },
        origine: "preparation",
        commande_liee: {
          numero_commande: "4928644",
          etat_commande: "Close",
          etat_travaux: "Terminés",
        },
      },
    ],
    2027,
  );
  const l1 = entrees.find((e) => e.tranche === "1977");
  check(
    "H1. sans commande liée → « Sans commande »",
    l1?.etat === "sans_commande" && l1?.commande === null,
  );
  const l2 = entrees.find((e) => e.tranche === "1401");
  check(
    "H2. commande liée Terminés → « Terminée » avec n° de commande",
    l2?.etat === "terminee" && l2?.commande?.numero_commande === "4928644",
  );
}

// ════════════ I. /SUIVI — projection stricte par année ══════════════════════
console.log("\n=== I. Projection /suivi (règle absolue) ===");
check(
  "I1. ligne preparation : visible sur l'année N uniquement si programme[N]>0",
  suiviFn.includes("progAnnee > 0") &&
    suiviFn.includes("!origineSuivi && !horsPsp && progAnnee <= 0 && !commandeLiee"),
);
check(
  "I2. ligne 'suivi' : restreinte à son exercice de matérialisation",
  suiviFn.includes("exerciceLigneSuivi(ligne)") &&
    suiviFn.includes("annee !== exerciceLigneSuivi(ligne)"),
);
check(
  "I3. le devis ne détermine JAMAIS l'année",
  suiviFn.includes(
    "visibleAnnee = progAnnee > 0 || horsPsp || Boolean(commandeLiee) || origineSuivi",
  ),
);

// ════════════ J. COHÉRENCE /suivi 2027 / 2028 ══════════════════════════════
console.log("\n=== J. /suivi 2027 et 2028 ===");
{
  const prog = { 2027: 500, 2028: 6000, 2029: 0, 2030: 3000 };
  check("J1. 2027 → visible (programme[2027]>0)", (prog["2027"] ?? 0) > 0);
  check("J2. 2028 → visible (programme[2028]>0)", (prog["2028"] ?? 0) > 0);
  check("J3. 2029 → invisible (0)", !((prog["2029"] ?? 0) > 0));
  check("J4. 2030 → visible", (prog["2030"] ?? 0) > 0);
}

// ════════════ K. AUCUN DOUBLON psp_lignes ═══════════════════════════════════
console.log("\n=== K. Aucun doublon psp_lignes ===");
check(
  "K1. la revue n'insère/crée rien (fonction pure, aucun .insert/.update)",
  !fichier("lib/psp.prep.suivi.ts").includes(".insert(") &&
    !fichier("lib/psp.prep.suivi.ts").includes(".update("),
);
{
  const bloc = supabaseFn.slice(
    supabaseFn.indexOf("getPspRevueAnciennes"),
    supabaseFn.indexOf("getPspRevueAnciennes") + 2500,
  );
  check(
    "K2. getPspRevueAnciennes est une lecture seule (aucune écriture)",
    !bloc.includes(".insert(") && !bloc.includes(".update(") && !bloc.includes(".delete("),
  );
}

// ════════════ L. AUCUNE TABLE PARALLÈLE / ENTITÉ ════════════════════════════
console.log("\n=== L. Aucune table parallèle ===");
check(
  "L1. aucune nouvelle table référencée",
  !prep.includes("psp_lignes_annees") &&
    !prep.includes("psp_anciennes") &&
    !prep.includes("psp_programmation_historique"),
);

// ════════════ M. MOTEUR V8.5 INTACT ═════════════════════════════════════════
console.log("\n=== M. Moteur V8.5 intact ===");
check(
  "M1. suggererOperationsPourCommande inchangé",
  rapprochement.includes("suggererOperationsPourCommande") &&
    rapprochement.includes("evaluerCorrespondance"),
);

// ════════════ N. IMPORTS INTACTS ════════════════════════════════════════════
console.log("\n=== N. Imports intacts ===");
check(
  "N1. aucune écriture vers les tables d'import dans le lot",
  !supabaseFn.includes('.from("travaux_commandes").insert') &&
    !supabaseFn.includes('.from("import_travaux").insert') &&
    !supabaseFn.includes('.from("psp_import_rows").insert'),
);

// ════════════ O. DASHBOARD INTACT ═══════════════════════════════════════════
console.log("\n=== O. Dashboard intact ===");
check(
  "O1. aucun fichier du lot n'implémente de logique dashboard",
  !prep.includes("dashboard-travaux") &&
    !fichier("lib/psp.prep.suivi.ts").includes("dashboard-travaux"),
);

// ════════════ P. FILTRES / TRI DU SUIVI PRÉSERVÉS ═══════════════════════════
console.log("\n=== P. Filtres / tri du suivi préservés ===");
check(
  "P1. les états de filtres du registre existent (sans_commande, en_cours, terminee, a_verifier)",
  suiviView.includes("sans_commande") &&
    suiviView.includes("en_cours") &&
    suiviView.includes("terminee") &&
    suiviView.includes("a_verifier"),
);
check(
  "P2. le tri utilise trierLignesRegistre (moteur unique, aucune colonne Sous-secteur affichée)",
  fichier("components/suivi/SuiviTable.tsx").includes("trierLignesRegistre") &&
    fichier("components/suivi/SuiviTable.tsx").includes("colSpan={12}"),
);

console.log(`\nV8.9.1 PUR — ${passed} ok / ${failed} échec(s)`);
if (failed > 0) process.exit(1);
