// Tests de non-régression — socle logique PSP (src/lib/psp.ts)
// Exécution : node scripts/test-psp.mjs
// Démo (exemple de sortie sur une ligne réelle) : node scripts/test-psp.mjs --demo
// Node 24 importe directement les fichiers TypeScript (type stripping).
import * as XLSX from "xlsx";
import {
  normalizePspHeader,
  parsePspMoney,
  extractCorpsEtat,
  extractErReferences,
  inferErLevel,
  resolveHeaderAlias,
  getCategorieBudget,
  parsePspWorkbook,
} from "../src/lib/psp.ts";

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

/** Construit un classeur xlsx à partir d'en-têtes + lignes (ArrayBuffer). */
function workbook(headers, rows) {
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Travaux");
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

// ── 1. Numéro de commande valide ─────────────────────────────────────────────
{
  const parsed = parsePspWorkbook(
    workbook(H, [["GE", "ER.T1", null, "2024-001", "NAT", "(j) Couvertures", "Rénovation", 10000, 8000, 5000]]),
  );
  const row = parsed.lignes[0];
  assert("T1  numéro valide : 1 ligne reconnue", parsed.lignes.length === 1);
  assert("T1  numéro valide : numero_commande = 2024-001", row?.numero_commande === "2024-001");
  assert("T1  numéro valide : statut = valide", row?.statut === "valide");
  assert("T1  numéro valide : aucun problème", row?.erreurs_psp.length === 0);
}

// ── 2. COMC_NOLIG absent (COMN_NUM présent) ─────────────────────────────────
{
  const parsed = parsePspWorkbook(workbook(H, [[null, "ER.T1", null, "", "NAT", null, "Sans numéro", null, null, null, "5027001"]]));
  const row = parsed.lignes[0];
  assert("T2  sans COMC_NOLIG : enregistrement créé (non supprimé)", parsed.lignes.length === 1);
  assert("T2  sans COMC_NOLIG : numero_commande vide (attribut nullable)", row?.numero_commande === "");
  assert("T2  sans COMC_NOLIG : numero_commande_interne conservé (COMN_NUM)", row?.numero_commande_interne === "5027001");
  assert("T2  sans COMC_NOLIG : PAS une erreur", row?.statut !== "erreur");
  assert("T2  sans COMC_NOLIG : aucune anomalie commande_manquante", row?.erreurs_psp.some((i) => i.code === "commande_manquante") !== true);
  assert("T2  sans COMC_NOLIG : compteur erreurs = 0", parsed.erreurs === 0);
}

// ── 3. Doublon identique (même COMN_NUM) ────────────────────────────────────
{
  const parsed = parsePspWorkbook(
    workbook(H, [
      ["GE", "ER.T1", null, "2024-002", "NAT", null, "Même travaux", 1000, 1000, 500, "C1"],
      ["GE", "ER.T1", null, "2024-002", "NAT", null, "Même travaux", 1000, 1000, 500, "C1"],
    ]),
  );
  assert("T3  doublon identique : 1 ligne primaire", parsed.lignes.length === 1);
  assert("T3  doublon identique : 1 doublon conservé", parsed.doublons.length === 1);
  assert("T3  doublon identique : doublons_identiques = 1", parsed.doublons_identiques === 1);
  assert("T3  doublon identique : doublons_conflits = 0", parsed.doublons_conflits === 0);
  assert(
    "T3  doublon identique : doublon marqué doublon_identique",
    parsed.doublons[0]?.erreurs_psp.some((i) => i.code === "doublon_identique") === true,
  );
}

// ── 4. Conflit (même COMN_NUM, données différentes) ─────────────────────────
{
  const parsed = parsePspWorkbook(
    workbook(H, [
      ["GE", "ER.T1", null, "2024-003", "NAT", null, "Version A", 1000, 800, 300, "C2"],
      ["GE", "ER.T1", null, "2024-003", "NAT", null, "Version B", 2000, 1500, 900, "C2"],
    ]),
  );
  assert("T4  conflit : 1 ligne primaire", parsed.lignes.length === 1);
  assert("T4  conflit : 1 doublon conservé", parsed.doublons.length === 1);
  assert("T4  conflit : doublons_conflits = 1", parsed.doublons_conflits === 1);
  assert(
    "T4  conflit : doublon marqué doublon_conflit",
    parsed.doublons[0]?.erreurs_psp.some((i) => i.code === "doublon_conflit") === true,
  );
}

// ── 4b. Même COMC_NOLIG pour plusieurs COMN_NUM → NON fusionnés ──────────────
{
  const parsed = parsePspWorkbook(
    workbook(H, [
      ["GE", "ER.T1", null, "0559/2026", "NAT", null, "Stop Parks", 2000, 1500, 500, "5027280"],
      ["GE", "ER.T1", null, "0559/2026", "NAT", null, "Stop Parks", 2000, 1500, 500, "5027287"],
    ]),
  );
  assert("T4b même COMC_NOLIG / COMN_NUM différents : 2 enregistrements", parsed.lignes.length === 2);
  assert("T4b mêmes COMC_NOLIG : 0 doublon (clé = COMN_NUM)", parsed.doublons.length === 0);
  assert("T4b chaque enregistrement conserve son COMN_NUM", parsed.lignes.map((l) => l.numero_commande_interne).join(",") === "5027280,5027287");
  assert("T4b chaque enregistrement conserve le COMC_NOLIG", parsed.lignes.every((l) => l.numero_commande === "0559/2026"));
}

// ── 5. Extraction ER (colonne structurée) ────────────────────────────────────
{
  const parsed = parsePspWorkbook(
    workbook(H, [["GE", "ER.T123", null, "2024-004", "NAT", null, "Travaux toiture", null, null, null]]),
  );
  const row = parsed.lignes[0];
  assert("T5  ER : tranche_er = ER.T123", row?.tranche_er === "ER.T123");
  assert("T5  ER : batiment_er = null", row?.batiment_er === null);
  assert("T5  ER : er_reference = ER.T123", row?.er_reference === "ER.T123");
  assert("T5  ER : niveau = tranche", row?.niveau_rattachement === "tranche");
  assert("T5  ER : non ambigu", row?.er_ambigue === false);
  assert("T5  ER : feuille détectée", parsed.feuille === "Travaux");
}
{
  const parsed = parsePspWorkbook(
    workbook(H, [["GE", null, "ER.B45", "2024-004b", "NAT", null, "Travaux bâtiment", null, null, null]]),
  );
  const row = parsed.lignes[0];
  assert("T5b ER : batiment_er = ER.B45 (colonne structurée)", row?.batiment_er === "ER.B45");
  assert("T5b ER : niveau = batiment", row?.niveau_rattachement === "batiment");
}

// ── 6. Plusieurs ER (ambigu) ─────────────────────────────────────────────────
{
  const parsed = parsePspWorkbook(
    workbook(H, [
      [null, null, null, "2024-005", null, null, "Intervention ER.T88 et ER.E12 bâtiments", null, null, null],
    ]),
  );
  const row = parsed.lignes[0];
  assert("T6  ER multiples : er_references contient 2 réf", row?.er_references.length === 2);
  assert("T6  ER multiples : er_reference = null (aucun choix arbitraire)", row?.er_reference === null);
  assert("T6  ER multiples : er_ambigue = true", row?.er_ambigue === true);
  assert("T6  ER multiples : niveau = ambiguous", row?.niveau_rattachement === "ambiguous");
  assert(
    "T6  ER multiples : anomalie er_ambigu",
    row?.erreurs_psp.some((i) => i.code === "er_ambigu") === true,
  );
}

// ── 7. Code corps d'état ─────────────────────────────────────────────────────
{
  const parsed = parsePspWorkbook(
    workbook(H, [["GE", "ER.T1", null, "2024-006", null, "(j) Couvertures", null, null, null, null]]),
  );
  const row = parsed.lignes[0];
  assert("T7  corps d'état : code = j", row?.corps_etat_code === "j");
  assert("T7  corps d'état : libellé = Couvertures", row?.corps_etat_libelle === "Couvertures");
  assert("T7  corps d'état : aucun problème", row?.erreurs_psp.length === 0);

  const trailing = extractCorpsEtat("Couvertures (p)");
  assert("T7b corps d'état format inversé : code = p", trailing.code === "p");
  assert("T7b corps d'état format inversé : libellé = Couvertures", trailing.libelle === "Couvertures");

  const sansCode = extractCorpsEtat("Peinture");
  assert("T7c corps d'état sans code : code = null", sansCode.code === null);
  assert("T7c corps d'état sans code : libellé conservé", sansCode.libelle === "Peinture");
}

// ── 8. Montant invalide (texte dans colonne numérique) ───────────────────────
{
  const parsed = parsePspWorkbook(
    workbook(H, [["GE", "ER.T1", null, "2024-007", null, null, "Budget texte", "abc", 1000, 500]]),
  );
  const row = parsed.lignes[0];
  assert("T8  montant invalide : ligne conservée", parsed.lignes.length === 1);
  assert("T8  montant invalide : montant_financier_valide = false", row?.montant_financier_valide === false);
  assert("T8  montant invalide : budget = null", row?.budget === null);
  assert(
    "T8  montant invalide : anomalie montant_invalide",
    row?.erreurs_psp.some((i) => i.code === "montant_invalide" && i.champ === "budget") === true,
  );
  assert("T8  montant invalide : statut = a_controler", row?.statut === "a_controler");
}

// ── 9. Ligne vide ────────────────────────────────────────────────────────────
{
  const parsed = parsePspWorkbook(
    workbook(H, [
      ["GE", "ER.T1", null, "2024-008", null, null, "Travaux", 1000, 800, 400],
      [null, null, null, null, null, null, null, null, null, null],
      [null, null, null, null, null, null, "", null, null, null],
    ]),
  );
  assert("T9  ligne vide : seule la ligne remplie est comptée", parsed.total_lignes === 1);
  assert("T9  ligne vide : 1 ligne primaire", parsed.lignes.length === 1);
}

// ── 10. En-tête avec accents / casse / espaces ───────────────────────────────
{
  const accents = [
    "SECTEUR",
    "TRANCHE",
    "BÂTIMENT",
    "N° COMMANDE",
    "NATURE ANALYTIQUE",
    "CORPS D'ÉTAT",
    "DESCRIPTIF",
    "BUDGET",
    "ENGAGÉ",
    "PAYÉ",
  ];
  const parsed = parsePspWorkbook(
    workbook(accents, [["GE", "ER.T1", null, "2024-009", "NAT", "(o) Plomberie", "Réparation", 5000, 4000, 2000]]),
  );
  const row = parsed.lignes[0];
  assert("T10 en-tête accents : numero = 2024-009", row?.numero_commande === "2024-009");
  assert("T10 en-tête accents : tranche = ER.T1", row?.tranche_code === "ER.T1");
  assert("T10 en-tête accents : corps code = o", row?.corps_etat_code === "o");
  assert("T10 en-tête accents : engage = 4000", row?.engage === 4000);
  assert("T10 en-tête accents : statut = valide", row?.statut === "valide");
}

// ── 11. En-tête sur deux lignes ──────────────────────────────────────────────
{
  const deuxLignes = [
    ["", "", "BÂTIMENT", "", "", "", "DESCRIPTIF", "BUDGET", "", ""],
    ["N° COMMANDE", "SECTEUR", "", "TRANCHE", "", "CORPS D'ÉTAT", "", "", "ENGAGÉ", ""],
  ];
  // Construction directe : les deux lignes d'en-tête doivent être aplaties.
  const ws = XLSX.utils.aoa_to_sheet([
    ...deuxLignes,
    ["2024-010", "GE", "ER.B7", "ER.T2", null, "(p) Toitures", "Toiture", 12000, 11000, 9000],
  ]);
  const wb2 = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb2, ws, "Travaux");
  const buf = XLSX.write(wb2, { type: "buffer", bookType: "xlsx" });
  const parsed = parsePspWorkbook(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const row = parsed.lignes[0];
  assert("T11 en-tête 2 lignes : numero = 2024-010", row?.numero_commande === "2024-010");
  assert("T11 en-tête 2 lignes : secteur = GE", row?.secteur === "GE");
  assert("T11 en-tête 2 lignes : batiment = ER.B7", row?.batiment === "ER.B7");
  assert("T11 en-tête 2 lignes : tranche = ER.T2", row?.tranche_code === "ER.T2");
  assert("T11 en-tête 2 lignes : corps code = p", row?.corps_etat_code === "p");
  assert("T11 en-tête 2 lignes : engage = 11000", row?.engage === 11000);
}

// ── 12. Niveau ER (inférence) ────────────────────────────────────────────────
{
  assert("T12 ER.E → entree", inferErLevel("ER.E12", "descriptif") === "entree");
  assert("T12 ER.B → batiment", inferErLevel("ER.B9", "descriptif") === "batiment");
  assert("T12 ER.T → tranche", inferErLevel("ER.T55", "descriptif") === "tranche");
  assert("T12 colonne batiment → batiment", inferErLevel("ER.X", "batiment") === "batiment");
  assert("T12 colonne lot → lot", inferErLevel("ER.L5", "lot_code") === "lot");
  assert("T12 préfixe inconnu → unknown", inferErLevel("ER.99", "descriptif") === "unknown");
}

// ── 13. Montant négatif ──────────────────────────────────────────────────────
{
  const parsed = parsePspWorkbook(
    workbook(H, [["GE", "ER.T1", null, "2024-011", null, null, "Avoir", null, -1000, null]]),
  );
  const row = parsed.lignes[0];
  assert("T13 montant négatif : engage = -1000 (conservé)", row?.engage === -1000);
  assert("T13 montant négatif : montant_financier_valide = false", row?.montant_financier_valide === false);
  assert(
    "T13 montant négatif : anomalie montant_negatif",
    row?.erreurs_psp.some((i) => i.code === "montant_negatif") === true,
  );
}

// ── 14. Montant incohérent (engagement > budget) ─────────────────────────────
{
  const parsed = parsePspWorkbook(
    workbook(H, [["GE", "ER.T1", null, "2024-012", null, null, "Travaux", 1000, 5000, 4000]]),
  );
  const row = parsed.lignes[0];
  assert("T14 incohérence : montant_financier_valide = false", row?.montant_financier_valide === false);
  assert(
    "T14 incohérence : anomalie montant_incoherent",
    row?.erreurs_psp.some((i) => i.code === "montant_incoherent") === true,
  );
}

// ── 15. Helpers unitaires ────────────────────────────────────────────────────
{
  assert("T15 normalize : 'N° COMMANDE' → 'n commande'", normalizePspHeader("N° COMMANDE") === "n commande");
  assert("T15 normalize : 'BÂTIMENT' → 'batiment'", normalizePspHeader("BÂTIMENT") === "batiment");
  assert("T15 money : '1 234,56 €' → 1234.56", parsePspMoney("1 234,56 €").nombre === 1234.56);
  assert("T15 money : 'abc' invalide", parsePspMoney("abc").invalide === true);
  assert("T15 money : vide → null sans erreur", parsePspMoney("").nombre === null && parsePspMoney("").invalide === false);
  assert("T15 ER : 'ER.T1' détecté", extractErReferences([{ champ: "descriptif", valeur: "Travaux ER.T1" }]).length === 1);
  assert("T15 ER : 'ER.' seul ignoré", extractErReferences([{ champ: "descriptif", valeur: "réf ER. bâtiment" }]).length === 0);
}

// ── 16-19. En-têtes ISIS (vrai fichier) ──────────────────────────────────────
{
  // Resolution des alias : vrai nom ISIS + variantes classiques + accents.
  assert("T16 ISIS : COMC_NOLIG.Ana_comd_trav_er → numero_commande", resolveHeaderAlias("COMC_NOLIG.Ana_comd_trav_er").normalizedField === "numero_commande");
  assert("T16 ISIS : No commande → numero_commande", resolveHeaderAlias("No commande").normalizedField === "numero_commande");
  assert("T16 ISIS : N° COMMANDE → numero_commande", resolveHeaderAlias("N° COMMANDE").normalizedField === "numero_commande");
  assert("T16 ISIS : NUMERO COMMANDE → numero_commande", resolveHeaderAlias("NUMERO COMMANDE").normalizedField === "numero_commande");
  assert("T16 ISIS : WPATRIMOINE.Ana_comd_trav_er → patrimoine", resolveHeaderAlias("WPATRIMOINE.Ana_comd_trav_er").normalizedField === "patrimoine");
  assert("T16 ISIS : COMD_DATE.Ana_comd_trav_er → date_commande", resolveHeaderAlias("COMD_DATE.Ana_comd_trav_er").normalizedField === "date_commande");
  assert("T16 ISIS : COMC_ETAT.Ana_comd_trav_er → etat", resolveHeaderAlias("COMC_ETAT.Ana_comd_trav_er").normalizedField === "etat");
  assert("T16 ISIS : W_MT_RAPPRO.Ana_comd_trav_er → engage", resolveHeaderAlias("W_MT_RAPPRO.Ana_comd_trav_er").normalizedField === "engage");
  assert("T16 ISIS : nom original conservé", resolveHeaderAlias("COMC_NOLIG.Ana_comd_trav_er").sourceColumn === "COMC_NOLIG.Ana_comd_trav_er");
  assert("T16 ISIS : colonne inconnue → null", resolveHeaderAlias("WINDCOL.Ana_comd_trav_er").normalizedField === null);
}

// ── 17. Parsing d'un classeur aux en-têtes ISIS ──────────────────────────────
{
  const ISIS_H = [
    "WPATRIMOINE.Ana_comd_trav_er",
    "PERC_SECTEUR.Ana_comd_trav_er",
    "COMC_NOLIG.Ana_comd_trav_er",
    "COMN_NUM.Ana_comd_trav_er",
    "COMD_DATE.Ana_comd_trav_er",
    "NAAC_CODE.Ana_comd_trav_er",
    "COMC_ETAT.Ana_comd_trav_er",
    "COMN_MT_DEVIS.Ana_comd_trav_er",
    "W_MT_RAPPRO.Ana_comd_trav_er",
    "W_MT_ECART.Ana_comd_trav_er",
    "WNATURE.Ana_comd_trav_er",
    "WNOTES.Ana_comd_trav_er",
  ];
  const parsed = parsePspWorkbook(
    workbook(ISIS_H, [
      ["ER.T1427", "S11", "0267/2023", 4580034, "2023-01-30T22:59:39.000Z", "CP", "Close", 3181.2, 3181.2, 0, "PLOMBERIE", "Remise en état"],
    ]),
  );
  const row = parsed.lignes[0];
  assert("T17 ISIS : feuille détectée", parsed.feuille === "Travaux");
  assert(
    "T17 ISIS : mapping debuggable numero_commande → COMC_NOLIG.Ana_comd_trav_er",
    parsed.mapping_colonnes.some((m) => m.normalizedField === "numero_commande" && m.sourceColumn === "COMC_NOLIG.Ana_comd_trav_er"),
  );
  assert("T17 ISIS : numero_commande = 0267/2023", row?.numero_commande === "0267/2023");
  assert("T17 ISIS : patrimoine = ER.T1427", row?.patrimoine === "ER.T1427");
  assert("T17 ISIS : etat = Close", row?.etat === "Close");
  assert("T17 ISIS : date_commande conservée", row?.date_commande === "2023-01-30T22:59:39.000Z");
  assert("T17 ISIS : nature_analytique = CP", row?.nature_analytique === "CP");
  assert("T17 ISIS : budget = 3181.2 (COMN_MT_DEVIS)", row?.budget === 3181.2);
  assert("T17 ISIS : engage = 3181.2 (W_MT_RAPPRO)", row?.engage === 3181.2);
  assert("T17 ISIS : ecart = 0 (W_MT_ECART)", row?.ecart === 0);
  assert("T17 ISIS : corps_etat = PLOMBERIE (WNATURE)", row?.corps_etat === "PLOMBERIE");
  assert("T17 ISIS : descriptif = WNOTES", row?.descriptif === "Remise en état");
  assert("T17 ISIS : numero_commande_interne conservé (non clé)", row?.numero_commande_interne === "4580034");
  assert("T17 ISIS : er_reference = ER.T1427 (WPATRIMOINE)", row?.er_reference === "ER.T1427");
  assert("T17 ISIS : statut a_controler (corps d'état WNATURE sans code)", row?.statut === "a_controler");
  assert(
    "T17 ISIS : anomalie corps_etat_non_reconnu (pas de code entre parenthèses)",
    row?.erreurs_psp.some((i) => i.code === "corps_etat_non_reconnu") === true,
  );
}

// ── 18. Variante ISIS sans point / espaces / casse ───────────────────────────
{
  assert("T18 ISIS : COMC_NOLIG seul → numero_commande", resolveHeaderAlias("COMC_NOLIG").normalizedField === "numero_commande");
  assert("T18 ISIS : 'comc_nolig.Ana_comd_trav_er' (casse mixte) → numero_commande", resolveHeaderAlias("comc_nolig.Ana_comd_trav_er").normalizedField === "numero_commande");
  assert("T18 ISIS : 'W PATRIMOINE.Ana_comd_trav_er' (espace) → patrimoine", resolveHeaderAlias("W PATRIMOINE.Ana_comd_trav_er").normalizedField === "patrimoine");
  assert("T18 ISIS : variante suffixe différent .AutreExport → numero_commande", resolveHeaderAlias("COMC_NOLIG.AutreExport").normalizedField === "numero_commande");
}

// ── 19. getCategorieBudget (NAAC_CODE — source de vérité) ────────────────────
{
  assert("T19 catégorie : GE → valide", getCategorieBudget("GE").categorie === "GE" && getCategorieBudget("GE").statut === "valide");
  assert("T19 catégorie : GT → valide", getCategorieBudget("GT").categorie === "GT" && getCategorieBudget("GT").statut === "valide");
  assert("T19 catégorie : CP → valide", getCategorieBudget("CP").categorie === "CP" && getCategorieBudget("CP").statut === "valide");
  assert("T19 catégorie : AC → a_confirmer (non converti)", getCategorieBudget("AC").categorie === "AC" && getCategorieBudget("AC").statut === "a_confirmer");
  assert("T19 catégorie : HO → a_confirmer (non converti)", getCategorieBudget("HO").categorie === "HO" && getCategorieBudget("HO").statut === "a_confirmer");
  assert("T19 catégorie : autre valeur → a_confirmer", getCategorieBudget("XYZ").categorie === "XYZ" && getCategorieBudget("XYZ").statut === "a_confirmer");
  assert("T19 catégorie : null → categorie null + a_confirmer", getCategorieBudget(null).categorie === null && getCategorieBudget(null).statut === "a_confirmer");
  assert("T19 catégorie : vide → categorie null + a_confirmer", getCategorieBudget("").categorie === null && getCategorieBudget("").statut === "a_confirmer");
  assert("T19 catégorie : casse insensible (ge) → GE valide", getCategorieBudget("ge").categorie === "GE" && getCategorieBudget("ge").statut === "valide");
}

// ── 20. Chargé d'opération (UTIC_CODE.Ana_comd_trav_er → charge_operation) ──
{
  const H_UTIC = [
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
    "UTIC_CODE.Ana_comd_trav_er",
  ];
  const parsed = parsePspWorkbook(
    workbook(H_UTIC, [
      ["GE", "ER.T1", null, "2024-UT1", "CP", "(j) Couvertures", "Travaux", 1000, 800, 400, "5027001", "CHARGE-A"],
      ["GT", "ER.T1", null, "2024-UT2", "GT", "Peinture", "Autre", 500, 300, 100, "5027002", null],
    ]),
  );
  assert("T20 UTIC : 2 lignes reconnues", parsed.lignes.length === 2);
  const l1 = parsed.lignes.find((l) => l.numero_commande_interne === "5027001");
  const l2 = parsed.lignes.find((l) => l.numero_commande_interne === "5027002");
  assert("T20 UTIC : charge_operation extrait (CHARGE-A)", l1?.charge_operation === "CHARGE-A", String(l1?.charge_operation));
  assert("T20 UTIC : charge_operation null si absente", l2?.charge_operation === null);
  assert(
    "T20 UTIC : donnees_brutes conserve UTIC_CODE.Ana_comd_trav_er",
    l1 && Object.prototype.hasOwnProperty.call(l1, "UTIC_CODE.Ana_comd_trav_er") && l1["UTIC_CODE.Ana_comd_trav_er"] === "CHARGE-A",
  );
  assert(
    "T20 UTIC : mapping_colonnes débogable",
    parsed.mapping_colonnes.some(
      (m) => m.sourceColumn === "UTIC_CODE.Ana_comd_trav_er" && m.normalizedField === "charge_operation",
    ),
  );
  assert("T20 UTIC : NAAC_CODE conservé", l1?.nature_analytique === "CP");
  assert("T20 UTIC : COMN_NUM conservé", l1?.numero_commande_interne === "5027001");
}

// ── Récapitulatif ────────────────────────────────────────────────────────────
console.log(`\n${passed} passé(s), ${failed} échec(s)`);
if (failed > 0) process.exit(1);

// ── Mode démo : sortie réelle sur une ligne de commande ─────────────────────
if (process.argv.includes("--demo")) {
  console.log("\n=== DÉMO parsePspWorkbook (classeur synthétique réaliste) ===");
  const demo = parsePspWorkbook(
    workbook(H, [
      ["GE", "ER.T101", "ER.B2", "2024-013", "NATX", "(j) Couvertures", "Réfection toiture ER.T101.B2", 25000, 22000, 18000],
      ["GT", "ER.T102", null, "2024-014", "NATY", "(o) Plomberie", "Remplacement chauffe-eau", null, 1800, 0],
      [null, "ER.T103", null, "2024-015", null, "Peinture", "Travaux ER.T103 et ER.E4 — montant en attente", "12 000", -500, 300],
      [null, null, null, null, null, null, "Ligne sans numéro ni ER", null, null, null],
    ]),
  );
  console.log(JSON.stringify(demo, null, 2));
}
