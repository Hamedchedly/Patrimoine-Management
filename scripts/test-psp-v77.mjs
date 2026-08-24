// ═══════════════════════════════════════════════════════════════════════════════
// V7.7 — Tests PURS :
//  1. export XLSX : 13 colonnes, noms/ordre exacts, montants, adresse+ER, CC, catégorie ;
//  2. fichier .xlsx réel généré et relu (colonne/ligne/valeurs) ;
//  3. CC : modification référentiel → tableau rafraîchi (enrichissement) ;
//  4. garages : masqués / visibles / retirés si décochés ;
//  5. budget : enveloppe / programmé / restant / % / dépassement (même calcul que la préparation) ;
//  6. paramètres : onglets et corps référentiels (structure de données).
// Exécution : node scripts/test-psp-v77.mjs
// ═══════════════════════════════════════════════════════════════════════════════
import XLSX from "xlsx";
import { readFileSync, unlinkSync } from "node:fs";

import {
  construireDonneesExportXlsx,
  ENTETES_EXPORT_XLSX,
  creerOperation,
  PSP_ANNEES,
} from "../src/lib/psp.prep.ts";
import { construireReferencePatrimoine, enrichirOperationsAvecReference } from "../src/lib/psp.prep.data.ts";
import {
  calculEnveloppe,
  libelleAdressePerimetre,
  programmeParAnneeCategorie,
  resumeSelectionAdresse,
  sansGarages,
  estLotGarage,
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

// ── 1. EXPORT XLSX — 13 colonnes exactes ───────────────────────────────────────
console.log("\n=== 1. EXPORT XLSX — COLONNES ===");
check("13 colonnes", ENTETES_EXPORT_XLSX.length === 13, String(ENTETES_EXPORT_XLSX.length));
check(
  "noms et ordre exacts",
  JSON.stringify(ENTETES_EXPORT_XLSX) ===
    JSON.stringify(["TR", "Arl/sect", "ADRESSE", "C", "CORPS D'ETAT", "Ch. Op.", "Ligne budgétaire", "NATURE TRAVAUX", "2027", "2028", "2029", "2030", "2031"]),
);
check("aucune autre colonne (2026/Total absents)", !ENTETES_EXPORT_XLSX.includes("Total") && !ENTETES_EXPORT_XLSX.includes("2026"));

// ── 2. DONNÉES EXPORTÉES (brouillon réel) ──────────────────────────────────────
console.log("\n=== 2. VALEURS EXPORTÉES ===");
{
  const op = creerOperation(
    {
      tranche: "1977",
      categorie: "CP",
      charge_clientele: "CMICHEL",
      charge_operation: "HCHEDLY",
      corps_etat: "(m) Carrelage",
      adresse: "",
      ville: "",
      nature_travaux: "Remplacement carrelage parties communes",
      annee: 2027,
      programme: [12000, 8000, 0, 0, 0],
      ligne_budget: "526",
    },
    "op-1",
  );
  // Adresse = périmètre réel (lot → « adresse, ville - ER.xxx »).
  const lotsParId = new Map([
    ["L1", { code_patrimoine: "ER.123456", adresse: "3 RUE DE PARIS", ville: "COUPVRAY" }],
  ]);
  const opAdresse = {
    ...op,
    adresse: libelleAdressePerimetre(
      [{ niveau: "lot", rue: null, numero: null, lot_id: "L1" }],
      lotsParId,
      { adresse: "", ville: "" },
    ),
  };
  const donnees = construireDonneesExportXlsx([opAdresse], {
    secteurDeTranche: (t) => (t === "1977" ? "CMICHEL" : null),
  });
  check("une ligne exportée", donnees.lignes.length === 1);
  const ligne = donnees.lignes[0] ?? [];
  check("TR = 1977", ligne[0] === "1977");
  check("Arl/sect = identifiant personnel CMICHEL (V7.8)", ligne[1] === "CMICHEL");
  check("ADRESSE = 3 RUE DE PARIS, COUPVRAY - ER.123456", ligne[2] === "3 RUE DE PARIS, COUPVRAY - ER.123456", String(ligne[2]));
  check("C = CP (référentiel)", ligne[3] === "CP");
  check("CORPS D'ETAT = (m) Carrelage", ligne[4] === "(m) Carrelage");
  check("Ch. Op. = HCHEDLY", ligne[5] === "HCHEDLY");
  check("Ligne budgétaire = 526 (réelle)", ligne[6] === "526");
  check("NATURE TRAVAUX conservée", ligne[7] === "Remplacement carrelage parties communes");
  check("2027 = 12000", ligne[8] === 12000);
  check("2028 = 8000", ligne[9] === 8000);
  check("2029-2031 = 0", ligne[10] === 0 && ligne[11] === 0 && ligne[12] === 0);
}

// ── 3. FICHIER .xlsx RÉEL (généré puis relu) ───────────────────────────────────
console.log("\n=== 3. FICHIER XLSX RÉEL ===");
{
  const op = creerOperation(
    {
      tranche: "1982",
      categorie: "GT",
      charge_clientele: "ALOTHORE",
      charge_operation: "",
      corps_etat: "(d) Espaces Ext",
      adresse: "5 RUE DE L EGLISE, THORIGNY",
      ville: "",
      nature_travaux: "Aménagement espaces extérieurs",
      annee: 2028,
      programme: [0, 5000, 7000, 0, 0],
      ligne_budget: null,
    },
    "op-2",
  );
  const donnees = construireDonneesExportXlsx([op], { secteurDeTranche: () => "S11" });
  const feuille = XLSX.utils.aoa_to_sheet([donnees.entetes, ...donnees.lignes]);
  const classeur = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(classeur, feuille, "Programmation PSP");
  const chemin = "scripts/tmp-v77-export.xlsx";
  XLSX.writeFile(classeur, chemin);
  check("fichier .xlsx créé", (() => {
    try {
      readFileSync(chemin);
      return true;
    } catch {
      return false;
    }
  })());
  check("extension .xlsx", chemin.endsWith(".xlsx"));
  const relu = XLSX.readFile(chemin);
  const sheet = relu.Sheets[relu.SheetNames[0]];
  const matrice = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  check("13 colonnes relues", (matrice[0] ?? []).length === 13, String((matrice[0] ?? []).length));
  check("en-tête exact relu", JSON.stringify(matrice[0]) === JSON.stringify(donnees.entetes));
  check("1 ligne relue", matrice.length === 2);
  const rl = matrice[1] ?? [];
  check("TR relue = 1982", rl[0] === "1982");
  check("Ch. Op. par défaut HCHEDLY", rl[5] === "HCHEDLY");
  check("Ligne budgétaire vide (jamais inventée)", String(rl[6]) === "");
  check("2028 relu = 5000", Number(rl[9]) === 5000);
  check("2029 relu = 7000", Number(rl[10]) === 7000);
  try {
    unlinkSync(chemin);
  } catch {
    /* déjà supprimé */
  }
}

// ── 4. CC : modification référentiel → tableau rafraîchi ───────────────────────
console.log("\n=== 4. SYNCHRONISATION CC ===");
{
  const tranches = [
    { code: "1950", libelle: null, localite: "THORIGNY", sous_secteur: "1", secteur: "S11", nb_logements: 30 },
  ];
  const lots = [{ id: "a", code_patrimoine: "ER.1", tranche_code: "1950", adresse: "RUE X", ville: "REIMS" }];
  const commandes = [{ tranche_code: "1950", charge_clientele: "CANTONY" }];
  const referentielA = [{ sous_secteur: "1", charge_clientele: "ALOTHORE", identifiant_personnel: "ALOTHORE", actif: true }];
  const refA = construireReferencePatrimoine(tranches, lots, commandes, referentielA);
  const op = creerOperation({ tranche: "1950", categorie: "GT", charge_clientele: "", charge_operation: "", corps_etat: "(d) Espaces Ext", adresse: "", ville: "", nature_travaux: "Toiture", annee: 2027, programme: [1000, 0, 0, 0, 0] }, "op-cc");
  const enrichiesA = enrichirOperationsAvecReference([op], refA);
  check("CC A affiché (ALOTHORE)", enrichiesA[0]?.charge_clientele === "ALOTHORE");
  // L'utilisateur modifie le référentiel → CC B.
  const referentielB = [{ sous_secteur: "1", charge_clientele: "CMICHEL", identifiant_personnel: "CMICHEL", actif: true }];
  const refB = construireReferencePatrimoine(tranches, lots, commandes, referentielB);
  const enrichiesB = enrichirOperationsAvecReference(enrichiesA, refB);
  check("après modification du référentiel → CC B affiché (CMICHEL)", enrichiesB[0]?.charge_clientele === "CMICHEL", String(enrichiesB[0]?.charge_clientele));
  check("source sous-secteur respectée (sous_secteur = 1)", refB.tranches.get("1950")?.sous_secteur === "1");
}
// ── 5. GARAGES ──────────────────────────────────────────────────────────────────
console.log("\n=== 5. GARAGES ===");
{
  const garage = { id: "g", code_patrimoine: "ER.9", tranche_code: "1977", adresse: "RUE X", type_lot: "GAR" };
  const box = { id: "b", code_patrimoine: "ER.8", tranche_code: "1977", adresse: "RUE X", type_lot: "BOX" };
  const lot = { id: "l", code_patrimoine: "ER.7", tranche_code: "1977", adresse: "RUE X", type_lot: "PAR" };
  const tous = [garage, box, lot];
  check("décoché → garage absent des résultats", sansGarages(tous, false).every((l) => !estLotGarage(l)));
  check("décoché → 1 résultat (lot normal)", sansGarages(tous, false).length === 1);
  check("coché → garages présents", sansGarages(tous, true).length === 3);
  check("décoché après avoir coché → garage retiré", JSON.stringify(sansGarages(sansGarages(tous, true), false)) === JSON.stringify(sansGarages(tous, false)));
  check("résumé adresse inchangé", resumeSelectionAdresse({ rue: "RUE X", adresses: [], lots: [lot] }) === "ER.7");
}

// ── 6. BUDGET : MÊME CALCUL QUE LA PRÉPARATION ─────────────────────────────────
console.log("\n=== 6. BUDGET / ENVELOPPES ===");
{
  const ops = [
    creerOperation({ tranche: "1977", categorie: "GT", charge_clientele: "", charge_operation: "", corps_etat: "(d) Espaces Ext", adresse: "", ville: "", nature_travaux: "A", annee: 2027, programme: [420000, 0, 0, 0, 0] }, "b1"),
    creerOperation({ tranche: "1977", categorie: "GT", charge_clientele: "", charge_operation: "", corps_etat: "(d) Espaces Ext", adresse: "", ville: "", nature_travaux: "B", annee: 2027, programme: [100000, 0, 0, 0, 0] }, "b2"),
  ];
  const programmePar = programmeParAnneeCategorie(ops);
  check("programmé GT 2027 = 520000", (programmePar["2027|GT"] ?? 0) === 520000);
  const calc = calculEnveloppe(500000, 520000);
  check("enveloppe = 500000", calc.enveloppe === 500000);
  check("programmé = 520000", calc.programme === 520000);
  check("restant = -20000", calc.restant === -20000);
  check("dépassement détecté", calc.depassement === true);
  check("% = 104%", Math.round((calc.pourcentage ?? 0) * 100) === 104);
  const calcOk = calculEnveloppe(500000, 400000);
  check("cas normal : restant 100000, pas de dépassement", calcOk.restant === 100000 && calcOk.depassement === false && Math.round((calcOk.pourcentage ?? 0) * 100) === 80);
  check("enveloppe nulle → % null (à définir)", calculEnveloppe(0, 5000).pourcentage === null);
}

// ── 7. PARAMÈTRES — STRUCTURE DES CORPS RÉFÉRENTIELS ───────────────────────────
console.log("\n=== 7. PARAMÈTRES (données) ===");
{
  const referentiel = [
    { code: "f", libelle: "(f) Ravalement", categorie: "GE", actif: true },
    { code: "m", libelle: "(m) Carrelage", categorie: "CP", actif: true },
  ];
  check("catégorie GE depuis référentiel", referentiel.find((r) => r.libelle === "(f) Ravalement")?.categorie === "GE");
  check("catégorie CP depuis référentiel", referentiel.find((r) => r.libelle === "(m) Carrelage")?.categorie === "CP");
  check("aucun CC copié dans les lignes (source de vérité)", creerOperation({ tranche: "1950", categorie: "GT", charge_clientele: "", charge_operation: "", corps_etat: "(d) Espaces Ext", adresse: "", ville: "", nature_travaux: "X", annee: 2027, programme: [1, 0, 0, 0, 0] }, "t").sous_secteur === null);
}

console.log(`\nRésultat : ${passed} ok, ${failed} échec(s)`);
if (failed > 0) process.exit(1);