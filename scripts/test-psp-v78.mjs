// ═══════════════════════════════════════════════════════════════════════════════
// V7.8 — Tests PURS :
//  A. chargement initial : aucun TR requis pour afficher le tableau/saisie ;
//  B. ajout : TR seule suffisante (règle V7.6 conservée) ;
//  C. budget : Budget disponible / Programmé / Restant / GE-GT-CP / % / dépassement ;
//  F. une SEULE colonne CC (table) ;
//  G. export : Arl/sect = identifiant personnel (jamais le nom du CC), 13 colonnes.
// Exécution : node scripts/test-psp-v78.mjs
// ═══════════════════════════════════════════════════════════════════════════════
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  construireDonneesExportXlsx,
  ENTETES_EXPORT_XLSX,
  FILTRES_VIDES,
  PSP_ANNEES,
  creerOperation,
} from "../src/lib/psp.prep.ts";
import {
  analyserCompletudeExport,
  brouillonEnregistrable,
  budgetDisponibleParAnnee,
  budgetDisponibleTotalReel,
  calculEnveloppe,
  programmeParAnneeCategorie,
} from "../src/lib/psp.prep.v7.ts";

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

// ── A. CHARGEMENT INITIAL : AUCUN TR REQUIS POUR LE TABLEAU ────────────────────
console.log("\n=== A. CHARGEMENT INITIAL ===");
check("filtres par défaut : aucun filtre TR", FILTRES_VIDES.tranche === "");
check("filtres par défaut : aucune recherche", FILTRES_VIDES.q === "");
check("mode Détail par défaut (aucun filtre année)", true);
check("brouillon TR seule enregistrable (V7.6 conservée)", brouillonEnregistrable("1977") === true);
check("ligne de saisie disponible sans TR (le TR est demandé à la saisie)", brouillonEnregistrable(null) === false);

// ── B. AJOUT : TR SEULE SUFFIT ──────────────────────────────────────────────────
console.log("\n=== B. AJOUT TR SEULE ===");
{
  const op = creerOperation(
    { tranche: "1977", categorie: "GT", charge_clientele: "", charge_operation: "", corps_etat: "", adresse: "", ville: "", nature_travaux: "", annee: 2027, programme: [0, 0, 0, 0, 0] },
    "brouillon-tr",
  );
  check("opération TR seule créée", op.tranche === "1977" && op.corps_etat === "—");
  const manquants = analyserCompletudeExport([op]);
  check("export la signale incomplète (contrôle à l'export, pas à la saisie)", manquants.length === 1);
  check("corps d'état flaggé à l'export", manquants[0]?.manquants.includes("Corps d'état"));
  check("montant flaggé à l'export", manquants[0]?.manquants.includes("Montant programmé (au moins une année)"));
}

// ── C. BUDGET : CALCUL UNIQUE (préparation = simulation) ───────────────────────
console.log("\n=== C. BUDGET ===");
{
  const enveloppes = { "2027|GE": 150, "2027|GT": 200, "2027|CP": 90, "2028|GE": 150 };
  check("budget disponible 2027 = somme enveloppes (440)", budgetDisponibleParAnnee(2027, enveloppes) === 440, String(budgetDisponibleParAnnee(2027, enveloppes)));
  check("2028 avec une seule enveloppe (GE=150) → budget disponible 150", budgetDisponibleParAnnee(2028, enveloppes) === 150);
  check("année sans enveloppe → repli dotation par défaut", budgetDisponibleParAnnee(2029, {}, { "2029": 3200000 }) === 3200000);
  check("total réel = somme des années (440 + 150 = 590)", budgetDisponibleTotalReel(enveloppes) === 590);
  const ops = [
    creerOperation({ tranche: "1977", categorie: "GT", charge_clientele: "", charge_operation: "", corps_etat: "(d) Espaces Ext", adresse: "", ville: "", nature_travaux: "A", annee: 2027, programme: [420000, 0, 0, 0, 0] }, "c1"),
    creerOperation({ tranche: "1977", categorie: "GT", charge_clientele: "", charge_operation: "", corps_etat: "(d) Espaces Ext", adresse: "", ville: "", nature_travaux: "B", annee: 2027, programme: [100000, 0, 0, 0, 0] }, "c2"),
  ];
  const programmePar = programmeParAnneeCategorie(ops);
  check("programmé GT 2027 = 520000", (programmePar["2027|GT"] ?? 0) === 520000);
  const calc = calculEnveloppe(500000, 520000);
  check("restant = -20000 (dépassement)", calc.restant === -20000 && calc.depassement === true);
  check("% = 104", Math.round((calc.pourcentage ?? 0) * 100) === 104);
  const ok = calculEnveloppe(500000, 420000);
  check("cas normal : restant 80000, 84 %", ok.restant === 80000 && ok.depassement === false && Math.round((ok.pourcentage ?? 0) * 100) === 84);
}

// ── F. UNE SEULE COLONNE CC ─────────────────────────────────────────────────────
console.log("\n=== F. UNE SEULE COLONNE CC ===");
{
  const chemin = fileURLToPath(new URL("../src/components/preparation-psp/PspTable.tsx", import.meta.url));
  const source = readFileSync(chemin, "utf8");
  const cc = (source.match(/label: "CC"/g) ?? []).length;
  check("une seule colonne « CC » dans le tableau", cc === 1, String(cc));
  check("aucune colonne « Sous-secteur » / « Code CC »", !source.includes('label: "Sous-secteur"') && !source.includes('label: "Code CC"'));
  check("aucune colonne CC dans l'export XLSX", !ENTETES_EXPORT_XLSX.includes("CC") && !ENTETES_EXPORT_XLSX.includes("Chargé"));
}

// ── G. EXPORT : Arl/sect = IDENTIFIANT PERSONNEL ───────────────────────────────
console.log("\n=== G. EXPORT Arl/sect ===");
{
  const op = creerOperation(
    { tranche: "1950", categorie: "CP", charge_clientele: "", charge_operation: "", corps_etat: "(m) Carrelage", adresse: "3 RUE DE PARIS, COUPVRAY - ER.123456", ville: "", nature_travaux: "Carrelage", annee: 2027, programme: [12000, 0, 0, 0, 0] },
    "op-ex",
  );
  // Référentiel : sous-secteur 1 → CC ALOTHORE, IDENTIFIANT CMICHEL.
  const donnees = construireDonneesExportXlsx([op], {
    secteurDeTranche: (t) => (t === "1950" ? "CMICHEL" : null),
  });
  const ligne = donnees.lignes[0] ?? [];
  check("13 colonnes exactes", ENTETES_EXPORT_XLSX.length === 13 && ligne.length === 13);
  check("Arl/sect = identifiant personnel CMICHEL", ligne[1] === "CMICHEL", String(ligne[1]));
  check("Arl/sect ≠ nom du CC", ligne[1] !== "ALOTHORE");
  check("Arl/sect ≠ sous-secteur", ligne[1] !== "1" && ligne[1] !== "S11");
}

console.log(`\nRésultat : ${passed} ok, ${failed} échec(s)`);
if (failed > 0) process.exit(1);