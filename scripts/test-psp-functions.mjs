// Tests — server functions PSP (validation pure + helpers)
// Exécution : node scripts/test-psp-functions.mjs
// Les handlers Supabase (createPspImport, importPspBatch…) nécessitent les
// variables EXT_SUPABASE_URL / EXT_SUPABASE_SERVICE_ROLE_KEY : ABSENTES en local.
// Ils ne sont donc PAS exécutés ici — seule la validation (zod) et la logique
// pure (héritage de contexte, construction des lignes d'import) sont testées.
// Node 24 importe directement les fichiers TypeScript (type stripping).
import {
  createPspImportSchema,
  pspBatchSchema,
  pspRowSchema,
  failPspImportSchema,
  finalizePspImportSchema,
  savePspCommandAnalysisSchema,
  savePspPatrimoineContextSchema,
  savePspFeedbackSchema,
  resoudreContexteHerite,
  buildPspImportRowInsert,
} from "../src/lib/psp.functions.ts";

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

const ok = (r) => r.success === true;
const ko = (r) => r.success === false;

/** Ligne PspParsedRow complète et valide (même forme que parsePspWorkbook). */
const ligneValide = () => ({
  ligne: 2,
  numero_commande: "2024-013",
  numero_commande_interne: null,
  secteur: "GE",
  tranche_code: "ER.T101",
  batiment: null,
  lot_code: null,
  entree: null,
  nature_analytique: "NATX",
  corps_etat: "(j) Couvertures",
  descriptif: "Réfection toiture",
  observations: null,
  patrimoine: null,
  etat: null,
  date_commande: null,
  fournisseur: null,
  adresse: null,
  commune: null,
  budget: 25000,
  engage: 22000,
  paye: 18000,
  ecart: null,
  er_reference: "ER.T101",
  tranche_er: "ER.T101",
  batiment_er: null,
  entree_er: null,
  lot_er: null,
  er_references: ["ER.T101"],
  er_ambigue: false,
  niveau_rattachement: "tranche",
  corps_etat_code: "j",
  corps_etat_libelle: "Couvertures",
  montant_financier_valide: true,
  statut: "valide",
  erreurs_psp: [],
});

// ── 1. createPspImportSchema ─────────────────────────────────────────────────
{
  const valide = createPspImportSchema.safeParse({
    fichier_nom: "export-travaux.xlsx",
    exercice: 2026,
    lignes_total: 120,
    lignes_valides: 110,
    lignes_erreur: 5,
    doublons: 5,
    structure_detectee: { colonnes: ["NO COMMANDE", "TRANCHE"] },
    erreurs_detail: [
      { code: "commande_manquante", message: "Numéro manquant", ligne: 7, numero_commande: null, champ: "numero_commande", valeur: null },
    ],
  });
  assert("T1 create : payload valide accepté", ok(valide));
  assert("T1 create : erreurs_detail par défaut []", createPspImportSchema.safeParse({
    fichier_nom: "a.xlsx", exercice: 2026, lignes_total: 1, lignes_valides: 1, lignes_erreur: 0, doublons: 0,
  }).data?.erreurs_detail?.length === 0);
  assert("T1 create : fichier_nom requis", ko(createPspImportSchema.safeParse({
    exercice: 2026, lignes_total: 1, lignes_valides: 1, lignes_erreur: 0, doublons: 0,
  })));
  assert("T1 create : exercice hors bornes rejeté", ko(createPspImportSchema.safeParse({
    fichier_nom: "a.xlsx", exercice: 1900, lignes_total: 1, lignes_valides: 1, lignes_erreur: 0, doublons: 0,
  })));
  assert("T1 create : nombre négatif rejeté", ko(createPspImportSchema.safeParse({
    fichier_nom: "a.xlsx", exercice: 2026, lignes_total: -1, lignes_valides: 1, lignes_erreur: 0, doublons: 0,
  })));
}

// ── 2. pspRowSchema ──────────────────────────────────────────────────────────
{
  const l = ligneValide();
  assert("T2  row : ligne complète valide", ok(pspRowSchema.safeParse(l)));
  assert("T2  row : statut inconnu rejeté", ko(pspRowSchema.safeParse({ ...l, statut: "inconnu" })));
  assert("T2  row : niveau inconnu rejeté", ko(pspRowSchema.safeParse({ ...l, niveau_rattachement: "immeuble" })));
  assert("T2  row : numero_commande manquant rejeté", ko(pspRowSchema.safeParse((() => { const { numero_commande, ...rest } = l; return rest; })())));
  assert("T2  row : numero_commande vide accepté (ligne en erreur)", ok(pspRowSchema.safeParse({ ...l, numero_commande: "" })));
  assert("T2  row : budget texte rejeté", ko(pspRowSchema.safeParse({ ...l, budget: "abc" })));
}

// ── 3. pspBatchSchema ────────────────────────────────────────────────────────
{
  const batch = { import_id: "11111111-1111-4111-8111-111111111111", annee_exercice: 2026, rows: [ligneValide()] };
  assert("T3  batch : lot valide", ok(pspBatchSchema.safeParse(batch)));
  assert("T3  batch : import_id non-uuid rejeté", ko(pspBatchSchema.safeParse({ ...batch, import_id: "abc" })));
  assert("T3  batch : rows vide rejeté", ko(pspBatchSchema.safeParse({ ...batch, rows: [] })));
  assert("T3  batch : annee_exercice absente acceptée", ok(pspBatchSchema.safeParse({ import_id: batch.import_id, rows: [ligneValide()] })));
}

// ── 4. failPspImportSchema ───────────────────────────────────────────────────
{
  const fail = { import_id: "11111111-1111-4111-8111-111111111111", erreur_message: "Fichier illisible" };
  assert("T4  fail : payload valide", ok(failPspImportSchema.safeParse(fail)));
  assert("T4  fail : erreur_message requis", ko(failPspImportSchema.safeParse({ import_id: fail.import_id })));
  assert("T4  fail : erreur_message vide rejeté", ko(failPspImportSchema.safeParse({ import_id: fail.import_id, erreur_message: "" })));
}

// ── 5. finalizePspImportSchema ───────────────────────────────────────────────
{
  const fin = { import_id: "11111111-1111-4111-8111-111111111111", statut: "a_controler" };
  assert("T5  finalize : statut a_controler valide", ok(finalizePspImportSchema.safeParse(fin)));
  assert("T5  finalize : statut termine valide", ok(finalizePspImportSchema.safeParse({ ...fin, statut: "termine" })));
  assert("T5  finalize : statut erreur valide", ok(finalizePspImportSchema.safeParse({ ...fin, statut: "erreur" })));
  assert("T5  finalize : statut inconnu rejeté", ko(finalizePspImportSchema.safeParse({ ...fin, statut: "annule" })));
}

// ── 6. savePspCommandAnalysisSchema ──────────────────────────────────────────
{
  const uuid = "11111111-1111-4111-8111-111111111111";
  const base = {
    numero_commande_interne: "4580034",
    numero_commande: "0267/2023",
    import_row_id: "22222222-2222-4222-8222-222222222222",
    source_import_id: uuid,
    modele: "psp-ai-v1",
    prompt_version: "2026-08",
    type_intervention: "renouvellement",
    cause_probable: null,
    phase_patrimoniale: "exploitation",
    composant: "Couvertures",
    niveau_rattachement: "tranche",
    er_reference: "ER.T1396",
    utilisable_cycle: true,
    confiance: 0.85,
    justification: "Corps d'état (j), budget élevé",
    categorie_budget: "CP",
    categorie_budget_statut: "valide",
    analyse_json: { indices: ["corps_etat_code=j", "budget>10000"], duree: "2 ans" },
    statut: "propose",
    analyzed_at: "2026-08-11T10:00:00.000Z",
  };
  assert("T6  analyse : payload valide", ok(savePspCommandAnalysisSchema.safeParse(base)));
  assert("T6  analyse : numero_commande null accepté (COMC_NOLIG nullable)", ok(savePspCommandAnalysisSchema.safeParse({ ...base, numero_commande: null })));
  assert("T6  analyse : numero_commande absent accepté", ok(savePspCommandAnalysisSchema.safeParse((() => { const { numero_commande, ...rest } = base; return rest; })())));
  assert("T6  analyse : numero_commande_interne présent", ok(savePspCommandAnalysisSchema.safeParse({ ...base, numero_commande_interne: "4638553" })));
  assert("T6  analyse : import_row_id non-uuid rejeté", ko(savePspCommandAnalysisSchema.safeParse({ ...base, import_row_id: "abc" })));
  assert("T6  analyse : categorie_budget_statut inconnu rejeté", ko(savePspCommandAnalysisSchema.safeParse({ ...base, categorie_budget_statut: "inconnu" })));
  assert("T6  analyse : categorie_budget_statut absent accepté (dérivé côté serveur)", ok(savePspCommandAnalysisSchema.safeParse((() => { const { categorie_budget_statut, ...rest } = base; return rest; })())));
  assert("T6  analyse : confiance > 1 rejetée", ko(savePspCommandAnalysisSchema.safeParse({ ...base, confiance: 1.2 })));
  assert("T6  analyse : confiance négative rejetée", ko(savePspCommandAnalysisSchema.safeParse({ ...base, confiance: -0.1 })));
  assert("T6  analyse : source_import_id non-uuid rejeté", ko(savePspCommandAnalysisSchema.safeParse({ ...base, source_import_id: "abc" })));
  assert("T6  analyse : analyse_json par défaut {}", JSON.stringify(savePspCommandAnalysisSchema.safeParse((() => { const { analyse_json, ...rest } = base; return rest; })()).data?.analyse_json) === "{}");
  assert("T6  analyse : statut par défaut 'propose'", savePspCommandAnalysisSchema.safeParse((() => { const { statut, ...rest } = base; return rest; })()).data?.statut === "propose");
  assert("T6  analyse : niveau par défaut 'unknown'", savePspCommandAnalysisSchema.safeParse((() => { const { niveau_rattachement, ...rest } = base; return rest; })()).data?.niveau_rattachement === "unknown");
  // Règle : COMC_NOLIG identique pour plusieurs COMN_NUM → autorisé (schema).
  assert("T6  analyse : 2 analyses même COMC_NOLIG / COMN_NUM différents acceptées", ok(savePspCommandAnalysisSchema.safeParse({ ...base, numero_commande_interne: "4638553", numero_commande: "0267/2023" })));
}

// ── 7. savePspPatrimoineContextSchema ────────────────────────────────────────
{
  const base = {
    er_id: "ER.T101",
    niveau: "tranche",
    type_patrimoine: "neuf",
    date_reference_gestion: "2021-01-15",
    source_date_reference: "date_reception_logements",
    perimetre_psp: true,
    parent_er_id: null,
    exception: false,
    justification: "Tranche livrée en 2021",
    donnees_contextuelles: { nb_logements: 120, livraison: "2021" },
  };
  assert("T7  contexte : payload valide", ok(savePspPatrimoineContextSchema.safeParse(base)));
  assert("T7  contexte : niveau inconnu rejeté (pas unknown/ambiguous)", ko(savePspPatrimoineContextSchema.safeParse({ ...base, niveau: "unknown" })));
  assert("T7  contexte : er_id requis", ko(savePspPatrimoineContextSchema.safeParse({ ...base, er_id: "" })));
  assert("T7  contexte : exception par défaut false", savePspPatrimoineContextSchema.safeParse((() => { const { exception, ...rest } = base; return rest; })()).data?.exception === false);
  assert("T7  contexte : donnees_contextuelles par défaut {}", JSON.stringify(savePspPatrimoineContextSchema.safeParse((() => { const { donnees_contextuelles, ...rest } = base; return rest; })()).data?.donnees_contextuelles) === "{}");
}

// ── 8. savePspFeedbackSchema ─────────────────────────────────────────────────
{
  const base = {
    cible_type: "commande",
    cible_id: "2024-013",
    proposition_initiale: { type_intervention: "renouvellement", confiance: 0.7 },
    decision_utilisateur: "reparation",
    correction: { type_intervention: "reparation", cause_probable: "sinistre" },
    motif: "Sinistre déclaré par le locataire",
  };
  assert("T8  feedback : payload valide", ok(savePspFeedbackSchema.safeParse(base)));
  assert("T8  feedback : cible_type inconnu rejeté", ko(savePspFeedbackSchema.safeParse({ ...base, cible_type: "auto" })));
  assert("T8  feedback : cible_id requis", ko(savePspFeedbackSchema.safeParse({ ...base, cible_id: "" })));
  assert("T8  feedback : correction absente acceptée", ok(savePspFeedbackSchema.safeParse((() => { const { correction, ...rest } = base; return rest; })())));
}

// ── 9. resoudreContexteHerite ────────────────────────────────────────────────
{
  const parent = {
    type_patrimoine: "ancien",
    date_reference_gestion: "2015-03-01",
    source_date_reference: "date_debut_gestion",
    perimetre_psp: true,
  };
  const res = resoudreContexteHerite(
    { type_patrimoine: null, date_reference_gestion: null, source_date_reference: null, perimetre_psp: null },
    parent,
  );
  assert("T9  héritage : champs null complétés par le parent", res.type_patrimoine === "ancien" && res.date_reference_gestion === "2015-03-01" && res.source_date_reference === "date_debut_gestion" && res.perimetre_psp === true);

  const res2 = resoudreContexteHerite(
    { type_patrimoine: "neuf", date_reference_gestion: null, source_date_reference: "date_reception_logements", perimetre_psp: false },
    parent,
  );
  assert("T9  héritage : valeur propre conservée", res2.type_patrimoine === "neuf" && res2.perimetre_psp === false);
  assert("T9  héritage : null uniquement complété", res2.date_reference_gestion === "2015-03-01" && res2.source_date_reference === "date_reception_logements");

  const res3 = resoudreContexteHerite(
    { type_patrimoine: "neuf", date_reference_gestion: "2021-01-15", source_date_reference: null, perimetre_psp: null },
    null,
  );
  assert("T9  héritage : sans parent, inchangé", res3.type_patrimoine === "neuf" && res3.date_reference_gestion === "2021-01-15" && res3.source_date_reference === null && res3.perimetre_psp === null);
}

// ── 10. buildPspImportRowInsert ──────────────────────────────────────────────
{
  const ligne = ligneValide();
  const insert = buildPspImportRowInsert("11111111-1111-4111-8111-111111111111", 2026, ligne);
  assert("T10 insert : ligne_numero = ligne", insert.ligne_numero === 2);
  assert("T10 insert : numero_commande conservé (métier)", insert.numero_commande === "2024-013");
  assert("T10 insert : import_id propagé", insert.import_id === "11111111-1111-4111-8111-111111111111");
  assert("T10 insert : statut propagé", insert.statut === "valide");
  assert("T10 insert : donnees_brutes = ligne complète", JSON.stringify(insert.donnees_brutes) === JSON.stringify(ligne));
  assert("T10 insert : erreurs = erreurs_psp de la ligne", JSON.stringify(insert.erreurs) === JSON.stringify(ligne.erreurs_psp));
  assert("T10 insert : er_reference propagé", insert.er_reference === "ER.T101");
  assert("T10 insert : tranche_er propagé", insert.tranche_er === "ER.T101");
  assert("T10 insert : corps_etat_code propagé", insert.corps_etat_code === "j");
  assert("T10 insert : corps_etat_libelle propagé", insert.corps_etat_libelle === "Couvertures");
  assert("T10 insert : nature_analytique propagé", insert.nature_analytique === "NATX");
  assert("T10 insert : montant_engage = engage", insert.montant_engage === 22000);
  assert("T10 insert : montant_paye = paye", insert.montant_paye === 18000);
  assert("T10 insert : annee_exercice propagée", insert.annee_exercice === 2026);

  const sansNumero = buildPspImportRowInsert("11111111-1111-4111-8111-111111111111", null, { ...ligne, numero_commande: "" });
  assert("T10 insert : numero_commande vide → null", sansNumero.numero_commande === null);
  assert("T10 insert : annee_exercice absente → null", sansNumero.annee_exercice === null);
}

// ── 11. buildPspImportRowInsert — mapping ISIS complet ───────────────────────
{
  const ligneIsis = () => ({
    ligne: 2,
    numero_commande: "0267/2023",
    numero_commande_interne: "4572981",
    secteur: "S11",
    tranche_code: null,
    batiment: "352080",
    lot_code: null,
    entree: "1",
    nature_analytique: "CP",
    corps_etat: "PLOMBERIE",
    descriptif: "Remise en état",
    observations: null,
    patrimoine: "ER.T1396",
    etat: "Close",
    date_commande: "2023-01-30T22:59:39.000Z",
    fournisseur: "1201000",
    adresse: "7 AV. GEORGES POMPIDOU",
    commune: "94370 SUCY-EN-BRIE",
    budget: 3181.2,
    engage: 3181.2,
    paye: null,
    ecart: 0,
    er_reference: "ER.T1396",
    tranche_er: "ER.T1396",
    batiment_er: null,
    entree_er: null,
    lot_er: null,
    er_references: ["ER.T1396"],
    er_ambigue: false,
    niveau_rattachement: "tranche",
    corps_etat_code: null,
    corps_etat_libelle: "PLOMBERIE",
    montant_financier_valide: true,
    statut: "a_controler",
    erreurs_psp: [{ code: "corps_etat_non_reconnu", message: "sans code", ligne: 2, numero_commande: "0267/2023", champ: "corps_etat", valeur: "PLOMBERIE" }],
  });
  const ins = buildPspImportRowInsert("11111111-1111-4111-8111-111111111111", 2026, ligneIsis());
  assert("T11 ISIS : numero_commande_interne ← COMN_NUM", ins.numero_commande_interne === "4572981");
  assert("T11 ISIS : numero_commande ← COMC_NOLIG", ins.numero_commande === "0267/2023");
  assert("T11 ISIS : patrimoine ← WPATRIMOINE", ins.patrimoine === "ER.T1396");
  assert("T11 ISIS : secteur ← PERC_SECTEUR", ins.secteur === "S11");
  assert("T11 ISIS : batiment_num ← BAIN_NUM", ins.batiment_num === "352080");
  assert("T11 ISIS : entree_num ← ENTN_NUM", ins.entree_num === "1");
  assert("T11 ISIS : date_commande ← COMD_DATE", ins.date_commande === "2023-01-30T22:59:39.000Z");
  assert("T11 ISIS : etat ← COMC_ETAT", ins.etat === "Close");
  assert("T11 ISIS : montant_budget ← COMN_MT_DEVIS", ins.montant_budget === 3181.2);
  assert("T11 ISIS : montant_ecart ← W_MT_ECART", ins.montant_ecart === 0);
  assert("T11 ISIS : fournisseur ← FRAN_NUM", ins.fournisseur === "1201000");
  assert("T11 ISIS : adresse ← WADRESSE", ins.adresse === "7 AV. GEORGES POMPIDOU");
  assert("T11 ISIS : commune ← WCOMMUNE", ins.commune === "94370 SUCY-EN-BRIE");
  assert("T11 ISIS : corps_etat_libelle ← WNATURE", ins.corps_etat_libelle === "PLOMBERIE");
  assert("T11 ISIS : corps_etat_code null (aucun code inventé)", ins.corps_etat_code === null);
  assert("T11 ISIS : nature_analytique ← NAAC_CODE", ins.nature_analytique === "CP");
  assert("T11 ISIS : donnees_brutes complètes", JSON.stringify(ins.donnees_brutes) === JSON.stringify(ligneIsis()));
}

// ── 12. Règles COMN_NUM / COMC_NOLIG ─────────────────────────────────────────
{
  const uuid1 = "11111111-1111-4111-8111-111111111111";
  const uuid2 = "22222222-2222-4222-8222-222222222222";
  const base = () => ({
    ligne: 3, numero_commande: "0267/2023", numero_commande_interne: "4572981",
    secteur: "S11", tranche_code: null, batiment: null, lot_code: null, entree: null,
    nature_analytique: "GE", corps_etat: "DIAGNOSTIC", descriptif: null, observations: null,
    patrimoine: "ER.T1396", etat: null, date_commande: null, fournisseur: null,
    adresse: null, commune: null, budget: null, engage: null, paye: null, ecart: null,
    er_reference: "ER.T1396", tranche_er: "ER.T1396", batiment_er: null, entree_er: null, lot_er: null,
    er_references: ["ER.T1396"], er_ambigue: false, niveau_rattachement: "tranche",
    corps_etat_code: null, corps_etat_libelle: "DIAGNOSTIC", montant_financier_valide: true,
    statut: "a_controler", erreurs_psp: [],
  });
  // COMC_NOLIG identique pour plusieurs COMN_NUM → autorisé (pas d'unicité au niveau ligne).
  const a = base();
  const b = { ...base(), numero_commande_interne: "4618055" };
  assert("T12 même COMC_NOLIG / COMN_NUM différents : batch accepté", ok(pspBatchSchema.safeParse({ import_id: uuid1, rows: [a, b] })));
  // Même COMN_NUM dans deux imports différents → autorisé dans psp_import_rows
  // (l'unicité est (import_id, ligne_numero) ; pas de UNIQUE sur numero_commande_interne).
  const imp1 = { import_id: uuid1, rows: [a] };
  const imp2 = { import_id: uuid2, rows: [{ ...base(), ligne: 5 }] };
  assert("T12 même COMN_NUM dans 2 imports différents : autorisé", ok(pspBatchSchema.safeParse(imp1)) && ok(pspBatchSchema.safeParse(imp2)));
}

// ── Récapitulatif ────────────────────────────────────────────────────────────
console.log(`\n${passed} passé(s), ${failed} échec(s)`);
if (failed > 0) process.exit(1);
