// Tests — route /import-psp (logique pure d'analyse / filtres / résumé / lots)
// Exécution : node scripts/test-psp-preview.mjs
// Les écritures Supabase réelles (createPspImport, importPspBatch…) nécessitent
// les variables EXT_SUPABASE_URL / EXT_SUPABASE_SERVICE_ROLE_KEY (absentes en
// local) : la séquence d'import « validé » est donc testée au niveau de sa
// logique pure (résumé, statut final, lots). Le comportement « import annulé »
// relève de l'UI (reset d'état) et est documenté.
import * as XLSX from "xlsx";
import { parsePspWorkbook } from "../src/lib/psp.ts";
import {
  TAILLE_LOT_PSP,
  construireAnalyse,
  construireResumeImport,
  decouperEnLots,
  estFichierExcel,
  filtrerLignesPsp,
  statutFinalImport,
} from "../src/lib/psp.preview.ts";

let passed = 0;
let failed = 0;

function assert(name, cond, detail = "") {
  if (cond) {
    passed += 1;
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function workbook(headers, rows) {
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Travaux");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

function workbookVide() {
  const ws = XLSX.utils.aoa_to_sheet([]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Vide");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

const H = [
  "SECTEUR",
  "TRANCHE",
  "BÂTIMENT",
  "NO COMMANDE",
  "NATURE ANALYTIQUE",
  "CORPS D'ÉTAT",
  "DESCRIPTIF",
  "BUDGET",
  "ENGAGÉ",
  "PAYÉ",
  "COMN_NUM",
];

// ── 1. Aucun fichier ─────────────────────────────────────────────────────────
{
  assert("T1  aucun fichier : nom vide non reconnu Excel", estFichierExcel("") === false);
  // L'absence de fichier ne déclenche aucun traitement : le change input n'est
  // pas appelé (comportement UI documenté, rien à analyser).
}

// ── 2. Fichier non Excel ─────────────────────────────────────────────────────
{
  assert("T2  non Excel : .pdf rejeté", estFichierExcel("rapport.pdf") === false);
  assert("T2  non Excel : .csv rejeté", estFichierExcel("data.csv") === false);
  assert("T2  non Excel : .txt rejeté", estFichierExcel("notes.txt") === false);
  assert("T2  non Excel : .xlsx accepté", estFichierExcel("export.xlsx") === true);
  assert("T2  non Excel : .XLS accepté (insensible casse)", estFichierExcel("EXPORT.XLS") === true);
}

// ── 3. Excel vide ────────────────────────────────────────────────────────────
{
  let aLance = false;
  try {
    parsePspWorkbook(workbookVide());
  } catch (e) {
    aLance = true;
    assert("T3  Excel vide : erreur explicite (en-tête No commande introuvable)", String(e).includes("No commande"));
  }
  assert("T3  Excel vide : le parsing lève une erreur (aucune ligne inventée)", aLance === true);
}

// ── 4. Excel avec en-têtes inconnus ──────────────────────────────────────────
{
  let aLance = false;
  try {
    parsePspWorkbook(workbook(["FOO", "BAR", "BAZ"], [["a", "b", "c"]]));
  } catch (e) {
    aLance = true;
    assert("T4  en-têtes inconnus : erreur explicite (No commande introuvable)", String(e).includes("No commande"));
  }
  assert("T4  en-têtes inconnus : le parsing lève une erreur", aLance === true);
}

// ── 5. Excel valide ──────────────────────────────────────────────────────────
{
  const parsed = parsePspWorkbook(
    workbook(H, [
      ["GE", "ER.T1", null, "2024-001", "NAT", "(j) Couvertures", "Rénovation", 10000, 8000, 5000],
      ["GT", "ER.T2", null, "2024-002", "NAT", "(o) Plomberie", "Chauffe-eau", null, 1800, 0],
      ["GE", "ER.T3", null, "2024-003", "NAT", "(p) Toitures", "Toiture", 5000, 4000, 3000],
    ]),
  );
  const analyse = construireAnalyse(parsed);
  assert("T5  valide : feuille détectée", parsed.feuille === "Travaux");
  assert("T5  valide : 3 lignes totales", analyse.total_lignes === 3);
  assert("T5  valide : 3 lignes valides", analyse.lignes_valides === 3);
  assert("T5  valide : 0 erreur", analyse.lignes_erreur === 0);
  assert("T5  valide : 0 doublon", analyse.doublons === 0);
  assert("T5  valide : 0 conflit", analyse.conflits === 0);
  assert("T5  valide : 3 commandes détectées", analyse.commandes_detectees === 3);
  assert("T5  valide : 3 ER détectés", analyse.er_detectes === 3);
  assert("T5  valide : 3 codes corps d'état détectés", analyse.corps_etat_detectes === 3);
  assert("T5  valide : filtre tous = 3", filtrerLignesPsp(parsed, "tous").length === 3);
}

// ── 6. Doublons (même COMN_NUM) ─────────────────────────────────────────────
{
  const parsed = parsePspWorkbook(
    workbook(H, [
      ["GE", "ER.T1", null, "2024-010", "NAT", null, "Même travaux", 1000, 800, 400, "C1"],
      ["GE", "ER.T1", null, "2024-010", "NAT", null, "Même travaux", 1000, 800, 400, "C1"],
    ]),
  );
  const analyse = construireAnalyse(parsed);
  assert("T6  doublon : 1 doublon détecté", analyse.doublons === 1);
  assert("T6  doublon : 1 ligne primaire", analyse.lignes_valides === 1);
  assert("T6  doublon : filtre doublons = 1", filtrerLignesPsp(parsed, "doublons").length === 1);
  assert("T6  doublon : filtre valides = 1", filtrerLignesPsp(parsed, "valides").length === 1);
}

// ── 7. Conflits (même COMN_NUM, données différentes) ────────────────────────
{
  const parsed = parsePspWorkbook(
    workbook(H, [
      ["GE", "ER.T1", null, "2024-011", "NAT", null, "Version A", 1000, 800, 300, "C2"],
      ["GE", "ER.T1", null, "2024-011", "NAT", null, "Version B", 2000, 1500, 900, "C2"],
    ]),
  );
  const analyse = construireAnalyse(parsed);
  assert("T7  conflit : 1 conflit détecté", analyse.conflits === 1);
  assert("T7  conflit : 0 doublon identique", analyse.doublons === 0);
  assert("T7  conflit : filtre conflits = 1", filtrerLignesPsp(parsed, "conflits").length === 1);
}

// ── 8. COMC_NOLIG absent ≠ erreur ───────────────────────────────────────────
{
  const parsed = parsePspWorkbook(
    workbook(H, [
      ["GE", "ER.T1", null, "2024-020", "NAT", null, "Travaux OK", 1000, 800, 400, "C20"],
      [null, "ER.T2", null, "", "NAT", null, "Sans numéro", null, null, null, "C21"],
    ]),
  );
  const analyse = construireAnalyse(parsed);
  assert("T8  sans COMC_NOLIG : 2 lignes valides", analyse.lignes_valides === 2);
  assert("T8  sans COMC_NOLIG : 0 erreur", analyse.lignes_erreur === 0);
  assert("T8  sans COMC_NOLIG : 1 commande détectée", analyse.commandes_detectees === 1);
  assert("T8  sans COMC_NOLIG : la ligne sans numéro reste visible", parsed.lignes.some((l) => l.numero_commande === ""));
  assert("T8  sans COMC_NOLIG : filtre erreurs = 0", filtrerLignesPsp(parsed, "erreurs").length === 0);
}

// ── 9. Import validé (logique pure) ──────────────────────────────────────────
{
  const parsed = parsePspWorkbook(
    workbook(H, [
      ["GE", "ER.T1", null, "2024-030", "NAT", null, "Travaux", 1000, 800, 400, "C30"],
      [null, "ER.T2", null, "", "NAT", null, "Sans numéro", null, null, null, "C31"],
    ]),
  );
  const resume = construireResumeImport(parsed);
  assert("T9  import : 2 lignes à importer (toutes conservées)", resume.lignes_a_importer === 2);
  assert("T9  import : 2 valides", resume.lignes_valides === 2);
  assert("T9  import : 0 en erreur", resume.lignes_erreur === 0);
  assert("T9  import : statut final termine (aucune anomalie)", statutFinalImport(resume) === "termine");

  const resumeOk = construireResumeImport(parsePspWorkbook(workbook(H, [["GE", "ER.T1", null, "2024-031", null, null, "OK", null, null, null, "C32"]])));
  assert("T9  import : statut final termine", statutFinalImport(resumeOk) === "termine");

  const lots = decouperEnLots(parsed.lignes, TAILLE_LOT_PSP);
  assert("T9  import : 1 lot pour 2 lignes", lots.length === 1);
  assert("T9  import : le lot contient les 2 lignes", lots[0]?.length === 2);
  const gros = Array.from({ length: 250 }, (_, i) => ({
    ligne: i + 1,
    numero_commande: `C-${i}`,
    numero_commande_interne: `I-${i}`,
    secteur: null, tranche_code: null, batiment: null, lot_code: null, entree: null,
    nature_analytique: null, corps_etat: null, descriptif: null, observations: null,
    patrimoine: null, etat: null, date_commande: null, fournisseur: null,
    adresse: null, commune: null,
    budget: null, engage: null, paye: null, ecart: null,
    er_reference: null, tranche_er: null, batiment_er: null, entree_er: null, lot_er: null,
    er_references: [], er_ambigue: false, niveau_rattachement: "unknown",
    corps_etat_code: null, corps_etat_libelle: null, montant_financier_valide: true,
    statut: "valide", erreurs_psp: [],
  }));
  const lotsGros = decouperEnLots(gros, TAILLE_LOT_PSP);
  assert("T9  import : 250 lignes → 3 lots de 100", lotsGros.length === 3);
  assert("T9  import : dernier lot de 50", lotsGros[2]?.length === 50);
}

// ── 10. Import annulé ────────────────────────────────────────────────────────
{
  // L'annulation est un reset d'état UI (annuler() remet parsed/fichier à null).
  // En logique pure, on vérifie qu'aucun helper ne déclenche d'écriture : la
  // construction du résumé est sans effet de bord et ne requiert pas d'import.
  const parsed = parsePspWorkbook(workbook(H, [["GE", "ER.T1", null, "2024-040", null, null, "OK", null, null, null]]));
  const avant = JSON.stringify(construireResumeImport(parsed));
  // « Annuler » équivaut à rejeter parsed : l'aperçu disparaît, aucun lot n'est écrit.
  const aucunLot = decouperEnLots([], TAILLE_LOT_PSP);
  assert("T10 annulé : aucun lot à écrire quand l'analyse est vidée", aucunLot.length === 0);
  assert("T10 annulé : le résumé reste déterministe (aucun effet de bord)", avant === JSON.stringify(construireResumeImport(parsed)));
}

// ── Récapitulatif ────────────────────────────────────────────────────────────
console.log(`\n${passed} passé(s), ${failed} échec(s)`);
if (failed > 0) process.exit(1);
