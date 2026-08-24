// ═══════════════════════════════════════════════════════════════════════════════
// V7.4 — Tests PURS des corrections ciblées du préparateur PSP :
//  1. KPI de la revue cliquables (ligneMatchKpi) + cohérence avec resumeArbitrage ;
//  2. filtre par défaut « Sans commande » (FILTRES_REVUE_DEFAUT) ;
//  3. tri du tableau de la revue (trierLignesRevue) ;
//  4. corps d'état structurés GE/GT/CP (corpsEtatsGroupes) — réutilise le mapping.
// Exécution : node scripts/test-psp-v74.mjs
// ═══════════════════════════════════════════════════════════════════════════════
import {
  FILTRES_REVUE_DEFAUT,
  FILTRES_REVUE_VIDES,
  filtrerLignesArbitrage,
  ligneMatchKpi,
  resumeArbitrage,
  trierLignesRevue,
} from "../src/lib/psp.prep.suivi.ts";
import { corpsEtatsGroupes, categorieDepuisCorpsEtat } from "../src/lib/psp.prep.v7.ts";

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

const ligne = (statut, commande = null, montant = 1000, tranche = "1976") => ({
  tranche,
  categorie: "GT",
  ligne_budget: "526",
  nature_travaux: "travaux",
  montant_programme: montant,
  annee_initiale: 2026,
  commande,
  charge_clientele: "ALOTHORE",
  etat: "programme",
  statut,
  ligne_suivi: null,
});

const ECHANTILLON = [
  ligne("non_engagee"), // sans commande / à reporter
  ligne("terminee", "CMD-1"), // terminée / avec commande
  ligne("commande_non_terminee", "CMD-2"), // commande en cours / avec commande
  ligne("pas_realisee"), // à reporter (non réalisée)
  ligne("hors_programmation", "CMD-3"), // hors programmation
];

// ── 1. KPI cliquables — MÊME logique que resumeArbitrage ──────────────────────
console.log("\n=== 1. KPI REVUE (ligneMatchKpi vs resumeArbitrage) ===");
{
  const resume = resumeArbitrage(ECHANTILLON);
  const comptes = {
    programmees: ECHANTILLON.filter((l) => ligneMatchKpi(l, "programmees")).length,
    terminees: ECHANTILLON.filter((l) => ligneMatchKpi(l, "terminees")).length,
    avecCommande: ECHANTILLON.filter((l) => ligneMatchKpi(l, "avecCommande")).length,
    sansCommande: ECHANTILLON.filter((l) => ligneMatchKpi(l, "sansCommande")).length,
    commandeNonTerminee: ECHANTILLON.filter((l) => ligneMatchKpi(l, "commandeNonTerminee")).length,
    aReporter: ECHANTILLON.filter((l) => ligneMatchKpi(l, "aReporter")).length,
    horsProgrammation: ECHANTILLON.filter((l) => ligneMatchKpi(l, "horsProgrammation")).length,
  };
  check(
    "programmées cohérent (≠ hors programmation)",
    comptes.programmees === resume.programmees && comptes.programmees === 4,
    `kpi=${comptes.programmees} resume=${resume.programmees}`,
  );
  check("terminées cohérent", comptes.terminees === resume.terminees && comptes.terminees === 1);
  check(
    "avec commande cohérent (2 : CMD-1 + CMD-2)",
    comptes.avecCommande === resume.avecCommande && comptes.avecCommande === 2,
  );
  check(
    "sans commande cohérent (1 : non_engagee — même règle que resumeArbitrage)",
    comptes.sansCommande === resume.sansCommande && comptes.sansCommande === 1,
  );
  check(
    "commandes en cours cohérent",
    comptes.commandeNonTerminee === resume.commandeNonTerminee && comptes.commandeNonTerminee === 1,
  );
  check(
    "à reporter cohérent (2 : non_engagee + pas_realisee)",
    comptes.aReporter === resume.aReporter && comptes.aReporter === 2,
  );
  check(
    "hors programmation cohérent",
    comptes.horsProgrammation === resume.horsProgrammation && comptes.horsProgrammation === 1,
  );
}

// ── 2. Filtre par défaut « Sans commande » + désélection ───────────────────────
console.log("\n=== 2. FILTRE PAR DÉFAUT SANS COMMANDE ===");
{
  check("FILTRES_REVUE_DEFAUT = sansCommande", FILTRES_REVUE_DEFAUT.kpi === "sansCommande");
  check("FILTRES_REVUE_VIDES = aucun KPI", FILTRES_REVUE_VIDES.kpi === "");
  const defaut = filtrerLignesArbitrage(ECHANTILLON, FILTRES_REVUE_DEFAUT);
  check(
    "défaut → uniquement les lignes non engagées (sans commande)",
    defaut.length === 1 && defaut.every((l) => l.statut === "non_engagee"),
    `nb=${defaut.length}`,
  );
  const deselect = filtrerLignesArbitrage(ECHANTILLON, { ...FILTRES_REVUE_DEFAUT, kpi: "" });
  check("désélection → toutes les lignes (5)", deselect.length === 5);
  const terminees = filtrerLignesArbitrage(ECHANTILLON, {
    ...FILTRES_REVUE_DEFAUT,
    kpi: "terminees",
  });
  check(
    "clic « Terminées » → 1 ligne",
    terminees.length === 1 && terminees[0].statut === "terminee",
  );
  const cumul = filtrerLignesArbitrage(ECHANTILLON, {
    ...FILTRES_REVUE_DEFAUT,
    kpi: "avecCommande",
    categorie: "GT",
  });
  check("cumul KPI + catégorie (2)", cumul.length === 2);
}

// ── 3. Tri du tableau de la revue ──────────────────────────────────────────────
console.log("\n=== 3. TRI REVUE ===");
{
  const a = ligne("terminee", "A", 3000, "1982");
  const b = ligne("non_engagee", null, 1000, "1976");
  const c = ligne("commande_non_terminee", "B", 2000, "1976");
  const liste = [a, b, c];
  const asc = trierLignesRevue(liste, "montant", true);
  check(
    "tri montant asc : 1000 → 3000",
    asc.map((l) => l.montant_programme).join(",") === "1000,2000,3000",
  );
  const desc = trierLignesRevue(liste, "montant", false);
  check(
    "tri montant desc : 3000 → 1000",
    desc.map((l) => l.montant_programme).join(",") === "3000,2000,1000",
  );
  const tr = trierLignesRevue(liste, "tranche", true);
  check(
    "tri tranche asc : 1976,1976,1982",
    tr.map((l) => l.tranche).join(",") === "1976,1976,1982",
  );
  check("tri ne mute pas la liste d'origine", liste.length === 3);
}

// ── 4. Corps d'état structurés GE/GT/CP ────────────────────────────────────────
console.log("\n=== 4. CORPS D'ÉTAT STRUCTURÉS ===");
{
  const exemple = [
    "(c) Couvertures",
    "(u) Étanchéité",
    "(f) Façades",
    "(o) Plomberie",
    "(q) Clos-couvert",
    "Électricité",
    "Ravalement",
  ];
  const groupes = corpsEtatsGroupes(exemple);
  check("3 groupes max (GE/GT/CP)", groupes.length >= 1 && groupes.length <= 3);
  check(
    "chaque item affecté via categorieDepuisCorpsEtat (mapping unique)",
    groupes.every((g) => g.items.every((c) => categorieDepuisCorpsEtat(c) === g.categorie)),
    JSON.stringify(groupes.map((g) => [g.categorie, g.items])),
  );
  const tout = groupes.flatMap((g) => g.items);
  check("aucun item perdu", tout.length === exemple.length);
  check(
    "sélection unique réutilisée (un item dans UN seul groupe)",
    new Set(tout).size === tout.length,
  );
}

console.log(`\nRésultat : ${passed} ok, ${failed} échec(s)`);
if (failed > 0) process.exit(1);
