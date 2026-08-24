// V8.16 — Tests PURS des KPI du suivi annuel (formules alignées sur l'outil d'export).
// Référence réelle 2023 fournie par l'utilisateur :
//   ALL  : engagé 257 003,31 · payé 220 745,18 · %engagé/budget 90,18 % · %payé/engagé 85,89 % · %hors budget 48,45 %
//   PROG : engagé 118 907,97 · payé 117 887,97 · %engagé/budget 41,72 % · %payé/engagé 99,14 %
//   HORS : engagé 138 095,34 · payé 102 857,21 · %payé/engagé 74,48 %
//   Budgets cat : GT 40 000 · GE 105 000 · CP 140 000 (= 285 000 en LB distinctes)
// Exécution : node scripts/test-suivi-stats.mjs
import {
  calculerStatsSuiviAnnuel,
  detecterLBIncoherentes,
  enveloppeBudgetaireSuivi,
} from "../src/lib/travaux.suivi.stats.ts";

let passed = 0;
let failed = 0;

function check(name, cond, detail = "") {
  if (cond) {
    passed += 1;
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const proche = (a, b, tol = 0.011) => Math.abs(a - b) < tol;

// ── Jeu de données synthétique calqué sur la référence 2023 ───────────────────
const commandes = [
  // GT programmé (LB) / hors
  { nature_analytique: "GT", ligne_budget: "GT1", budget: 40000, engage: 50154.7, paye: 50154.7 },
  { nature_analytique: "GT", ligne_budget: null, engage: 11946.02, paye: 11946.02 },
  // GE programmé (LB) / hors
  { nature_analytique: "GE", ligne_budget: "GE1", budget: 105000, engage: 165.6, paye: 165.6 },
  { nature_analytique: "GE", ligne_budget: null, engage: 73421.82, paye: 73421.82 },
  // CP programmé (LB) / hors
  {
    nature_analytique: "CP",
    ligne_budget: "CP1",
    budget: 140000,
    engage: 67567.67,
    paye: 67567.67,
  },
  { nature_analytique: "CP", ligne_budget: null, engage: 17489.37, paye: 17489.37 },
];
const suivi = [
  // Lignes sans commande : GT hors (engagé), GE programmé (LB GE1, engagé), GE hors, CP hors
  { nature_analytique: "GT", ligne_budget: null, engage: 7543.47, paye: 0 },
  { nature_analytique: "GE", ligne_budget: "GE1", engage: 1020, paye: 0 },
  { nature_analytique: "GE", ligne_budget: null, engage: 12386.35, paye: 0 },
  { nature_analytique: "CP", ligne_budget: null, engage: 15308.31, paye: 0 },
];

// ── 1. Enveloppe (LB distinctes) ──────────────────────────────────────────────
check(
  "env : LB distinctes (GT1+GE1+CP1) = 285 000",
  enveloppeBudgetaireSuivi([...commandes, ...suivi]) === 285000,
  String(enveloppeBudgetaireSuivi([...commandes, ...suivi])),
);
check(
  "env : ligne sans LB exclue",
  enveloppeBudgetaireSuivi([{ ligne_budget: null, budget: 99999 }]) === 0,
);

const s = calculerStatsSuiviAnnuel(commandes, suivi);

// ── 2. Totaux ─────────────────────────────────────────────────────────────────
check("engagé total = 257 003,31", proche(s.engage, 257003.31), String(s.engage));
check("payé total = 220 745,18", proche(s.paye, 220745.18), String(s.paye));
check("enveloppe = 285 000", proche(s.budgetTotal, 285000), String(s.budgetTotal));

// ── 3. KPI ────────────────────────────────────────────────────────────────────
check("% engagé programmé vs budget = 42 % (41,72)", s.pct === 42, String(s.pct));
check("% engagé total vs budget = 90 % (90,18)", s.pctTotal === 90, String(s.pctTotal));
check("% payé vs engagé = 86 % (85,89)", s.pctPaye === 86, String(s.pctPaye));
check("% hors budget = 48 % (48,45)", s.pctHorsBudget === 48, String(s.pctHorsBudget));
check("% payé vs engagé programmé = 99 % (99,14)", s.pctPayeProg === 99, String(s.pctPayeProg));
check("% payé vs engagé hors prog = 74 % (74,48)", s.pctPayeHors === 74, String(s.pctPayeHors));

// ── 4. Compteurs (lignes suivi incluses) ──────────────────────────────────────
check("nProg = 4 (commandes + suivi programmées)", s.nProg === 4, String(s.nProg));
check("nHors = 6 (commandes + suivi hors)", s.nHors === 6, String(s.nHors));
check("engProg = 118 907,97", proche(s.engProg, 118907.97), String(s.engProg));
check("engHors = 138 095,34", proche(s.engHors, 138095.34), String(s.engHors));
check("nProgCmd = 3 (commandes avec LB)", s.nProgCmd === 3, String(s.nProgCmd));
check("nProgSuivi = 1 (lignes suivi avec LB)", s.nProgSuivi === 1, String(s.nProgSuivi));

// ── 5. Par catégorie ──────────────────────────────────────────────────────────
const gt = s.cat.find((c) => c.code === "GT");
const ge = s.cat.find((c) => c.code === "GE");
const cp = s.cat.find((c) => c.code === "CP");
check("GT budget = 40 000", proche(gt.budget, 40000), String(gt.budget));
check("GE budget = 105 000", proche(ge.budget, 105000), String(ge.budget));
check("CP budget = 140 000", proche(cp.budget, 140000), String(cp.budget));
check(
  "GT engagé = 69 644,19 (prog 50 154,70 + hors 19 489,49)",
  proche(gt.engage, 69644.19),
  String(gt.engage),
);
check("GE engagé = 86 993,77", proche(ge.engage, 86993.77), String(ge.engage));
check("CP engagé = 100 365,35", proche(cp.engage, 100365.35), String(cp.engage));
check("GT payé = 62 100,72", proche(gt.paye, 62100.72), String(gt.paye));
check("GE payé = 73 587,42", proche(ge.paye, 73587.42), String(ge.paye));
check("CP payé = 85 057,04 (corrigé)", proche(cp.paye, 85057.04), String(cp.paye));

// ── 6. Barres : reste / dépassement (100 % = enveloppe) ───────────────────────
check(
  "GT : engagé total > budget → overrun 29 644,19, reste 0",
  proche(gt.overrun, 29644.19) && gt.reste === 0,
  `overrun=${gt.overrun} reste=${gt.reste}`,
);
check(
  "GE : reste = budget − (prog+hors) = 18 006,23, overrun 0",
  proche(ge.reste, 18006.23) && ge.overrun === 0,
  `reste=${ge.reste} overrun=${ge.overrun}`,
);
check(
  "CP : reste = 39 634,65, overrun 0",
  proche(cp.reste, 39634.65) && cp.overrun === 0,
  `reste=${cp.reste} overrun=${cp.overrun}`,
);
check(
  "GT nbProg=1 nbHors=2 nbSuivi=1",
  gt.nbProg === 1 && gt.nbHors === 2 && gt.nbSuivi === 1,
  `p=${gt.nbProg} h=${gt.nbHors} s=${gt.nbSuivi}`,
);

// ── 7. Aucune ligne → KPI neutres (pas de division par 0) ─────────────────────
const vide = calculerStatsSuiviAnnuel([], []);
check(
  "aucune ligne : pct 0, budget 0, compteurs 0",
  vide.pct === 0 &&
    vide.pctTotal === 0 &&
    vide.pctPaye === 0 &&
    vide.budgetTotal === 0 &&
    vide.nProg === 0 &&
    vide.nHors === 0,
  JSON.stringify(vide),
);

// ── 8. Détection des LB incohérentes (même LB, budgets différents) ─────────────
check(
  "LB 565 : 2 lignes à budgets différents → détectée",
  (() => {
    const a = detecterLBIncoherentes([
      { ligne_budget: "565", budget: 5000 },
      { ligne_budget: "565", budget: 6000 },
      { ligne_budget: "581", budget: 3000 },
    ]);
    return (
      a.length === 1 &&
      a[0].ligne_budget === "565" &&
      a[0].budgets[0] === 5000 &&
      a[0].budgets[1] === 6000 &&
      a[0].nbLignes === 2
    );
  })(),
  "",
);
check(
  "LB identique (même budget) → non détectée",
  detecterLBIncoherentes([
    { ligne_budget: "267", budget: 105000 },
    { ligne_budget: "267", budget: 105000 },
  ]).length === 0,
);
check(
  "sans LB → non détectée",
  detecterLBIncoherentes([
    { ligne_budget: null, budget: 9999 },
    { ligne_budget: "", budget: 5000 },
  ]).length === 0,
);
check(
  "LB 565 réelle (5 000 vs 6 000) → budgets triés",
  (() => {
    const a = detecterLBIncoherentes([
      { ligne_budget: "565", budget: 6000 },
      { ligne_budget: "565", budget: 5000 },
    ]);
    return a.length === 1 && JSON.stringify(a[0].budgets) === JSON.stringify([5000, 6000]);
  })(),
  "",
);

console.log(`\nV8.16 STATS SUIVI — ${passed} ok / ${failed} échec(s)`);
process.exit(failed === 0 ? 0 : 1);
