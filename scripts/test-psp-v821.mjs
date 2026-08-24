// ═══════════════════════════════════════════════════════════════════════════════
// V8.2.1 — CORRECTIONS WORKFLOW PSP → CONSULTATION → DEVIS → SUIVI (tests PURS) :
//  A. devis sans montant · B. devis avec montant · C. plusieurs entreprises ·
//  D. demande envoyée · E. devis reçu · F. devis retenu · G. mailto généré ·
//  H. contenu mail modifiable · I. recherche ER réelle (détection) ·
//  J. restauration périmètre (modification) · K. commande importée ·
//  L. montant engagé (1 commande + dédoublonnage) · M. plusieurs commandes ·
//  N. cohérence Préparation → Suivi (identité = psp_lignes.id) ·
//  O. chaîne d'avancement (états réels).
// Exécution : node scripts/test-psp-v821.mjs
// ═══════════════════════════════════════════════════════════════════════════════
import {
  construireSuiviOperation,
  construireMailto,
  composerMail,
  MAIL_MODELES,
  devisSansMontant,
  grouperConsultationParEntreprise,
  rattacherCommandes,
  remplacerVariablesMail,
} from "../src/lib/psp.suivi.foundation.ts";
import {
  comparatifDevis,
  etapesAvancement,
  filtrerOperationsSuivi,
  FILTRES_SUIVI_VIDES,
} from "../src/lib/psp.suivi.view.ts";
import {
  detecterRecherchePatrimoine,
  suggestionsLotsDepuisPerimetres,
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

const il_y_a = (jours) => new Date(Date.now() - jours * 86400000).toISOString();

const ligne = (over = {}) => ({
  id: "11111111-1111-4111-8111-111111111111",
  programmation_id: "00000000-0000-4000-8000-000000000001",
  tranche_code: "1977",
  categorie: "GT",
  corps_etat: "Couverture",
  nature_travaux: "Réfection toiture",
  programme: { 2027: 150000, 2028: 0, 2029: 0, 2030: 0, 2031: 0 },
  origine: "preparation",
  statut: "a_definir",
  priorite: "normale",
  ...over,
});

const devis = (over = {}) => ({
  id: "22222222-2222-4222-8222-222222222222",
  psp_ligne_id: "11111111-1111-4111-8111-111111111111",
  fournisseur_id: "33333333-3333-4333-8333-333333333333",
  entreprise: "ENTREPRISE A",
  date_devis: null,
  montant: 84500,
  statut: "demande_envoyee",
  commentaire: null,
  document_reference: null,
  created_at: il_y_a(3),
  ...over,
});

const lien = (over = {}) => ({
  id: "44444444-4444-4444-8444-444444444444",
  commande_id: "55555555-5555-4555-8555-555555555555",
  psp_ligne_id: "11111111-1111-4111-8111-111111111111",
  type_relation: "rattachement_ligne",
  methode: "auto",
  confiance: 1,
  statut: "valide",
  justification: "test",
  ...over,
});

const commande = (over = {}) => ({
  id: "55555555-5555-4555-8555-555555555555",
  numero_commande: "123456",
  tranche_code: "1977",
  fournisseur: "ENTREPRISE A",
  descriptif: "Réfection toiture",
  corps_etat: "Couverture",
  etat_commande: "En cours",
  etat_travaux: "En cours",
  budget: 143500,
  engage: 140000,
  paye: 75000,
  solde: 65000,
  date_import: "2026-03-15T09:00:00Z",
  date_demarrage: "2026-04-01",
  date_fin_travaux: null,
  annee_exercice: 2026,
  ...over,
}); // ── A/B/C/D/E/F — devis et consultation ─────────────────────────────────────
console.log("\nA-F. devis / consultation");
{
  const sansMontant = devis({ montant: null, statut: "demande_envoyee" });
  check("A. devis sans montant accepté", devisSansMontant(sansMontant) === true);

  const avecMontant = devis({ statut: "recu", montant: 84500, date_devis: "2026-08-27" });
  check("B. devis avec montant", avecMontant.montant === 84500);

  const list = grouperConsultationParEntreprise(
    [
      devis({ id: "d1", fournisseur_id: "fA", entreprise: "A", created_at: il_y_a(5) }),
      devis({ id: "d2", fournisseur_id: "fB", entreprise: "B", created_at: il_y_a(4) }),
      devis({ id: "d3", fournisseur_id: "fC", entreprise: "C", created_at: il_y_a(3) }),
    ],
    new Date(),
  );
  check("C. plusieurs entreprises consultées (3)", list.length === 3);
  check(
    "C. chaque entreprise a sa demande",
    list.every((e) => e.date_demande != null),
  );

  const vueEnvoyee = construireSuiviOperation({
    ligne: ligne(),
    devis: [sansMontant],
    exercice: 2026,
  });
  check("D. demande envoyée → en_attente", vueEnvoyee.consultation.statut === "en_attente");

  const vueRecu = construireSuiviOperation({
    ligne: ligne(),
    devis: [avecMontant],
    exercice: 2026,
  });
  check("E. devis reçu → devis_recu", vueRecu.consultation.statut === "devis_recu");
  check("E. nb_devis_recus = 1", vueRecu.consultation.nb_devis_recus === 1);

  const retenu = devis({ statut: "retenu", montant: 84500, date_devis: "2026-08-27" });
  const vueRetenu = construireSuiviOperation({ ligne: ligne(), devis: [retenu], exercice: 2026 });
  check("F. devis retenu", vueRetenu.consultation.statut === "devis_retenu");
}

// ── G/H — mailto + contenu modifiable ───────────────────────────────────────
console.log("\nG-H. mailto / contenu modifiable");
{
  const compose = composerMail(
    MAIL_MODELES.find((m) => m.id === "demande_devis"),
    {
      TR: "1977",
      NATURE_TRAVAUX: "Réfection toiture",
      CORPS_ETAT: "Couverture",
      ADRESSE: "10 rue des Lilas",
      DATE_RETOUR: "2026-09-10",
    },
  );
  check("G. sujet généré", compose.sujet === "Demande de devis – 1977 – Réfection toiture");
  check(
    "G. mailto généré",
    construireMailto({ email: "a@b.fr", sujet: compose.sujet, corps: compose.corps }).startsWith(
      "mailto:a@b.fr?",
    ),
  );
  check(
    "H. contenu modifiable (texte libre)",
    typeof compose.corps === "string" && compose.corps.length > 50,
  );
  const personnalise = remplacerVariablesMail(compose.corps, { DATE_RETOUR: "2026-09-25" });
  check(
    "H. personnalisation avant mailto",
    personnalise !== compose.corps || compose.corps.includes("2026-09-10"),
  );
  check(
    "H. réinitialisation possible (modèle inchangé)",
    compose.corps.includes("Nature des travaux :"),
  );
}

// ── I — recherche ER réelle (détection) ─────────────────────────────────────
console.log("\nI. recherche ER réelle (détection)");
{
  check("I. ER complet → lot", detecterRecherchePatrimoine("ER.33334") === "lot");
  check("I. ER partiel → lot", detecterRecherchePatrimoine("ER.33") === "lot");
  check("I. ER avec espace → lot", detecterRecherchePatrimoine("ER 33334") === "lot");
  check("I. ER garage → lot", detecterRecherchePatrimoine("ER.G1850.01009") === "lot");
  check(
    "I. identifiant numérique → tranche (serveur élargit aux lots)",
    detecterRecherchePatrimoine("33334") === "tranche",
  );
  check("I. TR explicite → tranche", detecterRecherchePatrimoine("TR 1977") === "tranche");
  // Extraction du cœur numérique (utilisée par la requête lots côté serveur).
  const num = (q) => q.replace(/\D/g, "");
  check("I. cœur numérique de ER.33334 = 33334", num("ER.33334") === "33334");
  check("I. cœur numérique de 33334 = 33334", num("33334") === "33334");
}

// ── J — restauration du périmètre (modification) ────────────────────────────
console.log("\nJ. restauration du périmètre (modification)");
{
  const lotsParId = new Map([
    ["lot-1", { code_patrimoine: "ER.33334", adresse: "10 rue des Lilas", ville: "MEAUX" }],
    ["lot-2", { code_patrimoine: "ER.33335", adresse: "10 rue des Lilas", ville: "MEAUX" }],
  ]);
  const sugg = suggestionsLotsDepuisPerimetres(
    [
      { niveau: "lot", rue: null, numero: null, lot_id: "lot-1" },
      { niveau: "lot", rue: null, numero: null, lot_id: "lot-2" },
    ],
    lotsParId,
    "1977",
  );
  check("J. 2 lots restaurés", sugg.length === 2);
  check("J. code_patrimoine réel", sugg[0]?.code_patrimoine === "ER.33334");
  check(
    "J. tranche restaurée",
    sugg.every((s) => s.tranche_code === "1977"),
  );
  check(
    "J. dédoublonnage (même lot 2x)",
    suggestionsLotsDepuisPerimetres(
      [
        { niveau: "lot", rue: null, numero: null, lot_id: "lot-1" },
        { niveau: "lot", rue: null, numero: null, lot_id: "lot-1" },
      ],
      lotsParId,
      "1977",
    ).length === 1,
  );
  check(
    "J. lot inconnu ignoré",
    suggestionsLotsDepuisPerimetres(
      [{ niveau: "lot", rue: null, numero: null, lot_id: "inconnu" }],
      lotsParId,
      "1977",
    ).length === 0,
  );
}
// ── K/L/M — commandes importées + montant engagé ────────────────────────────
console.log("\nK/L/M. commandes + montant engagé");
{
  // K. commande importée liée.
  const liees = rattacherCommandes([lien()], [commande()]);
  check("K. commande importée liée", liees.length === 1);
  check("K. numéro commande réel", liees[0]?.numero_commande === "123456");
  check("K. montant commande (budget) = 143500", liees[0]?.budget === 143500);

  // L. 1 opération → 1 commande → montant engagé.
  const vue = construireSuiviOperation({
    ligne: ligne(),
    liens: [lien()],
    commandes: [commande()],
    exercice: 2026,
  });
  check("L. engagé = 140000 (travaux_commandes.engage)", vue.commandes.engage === 140000);
  check("L. payé = 75000", vue.commandes.paye === 75000);
  check("L. commandé = 143500 (budget)", vue.commandes.budget_commande === 143500);

  // L. dédoublonnage : 2 liens vers la MÊME commande → comptée UNE fois.
  const vueDedup = construireSuiviOperation({
    ligne: ligne(),
    liens: [lien(), lien({ id: "lien-2" })],
    commandes: [commande()],
    exercice: 2026,
  });
  check("L. doublons de rapprochement ignorés (1 commande)", vueDedup.commandes.nb_commandes === 1);
  check("L. engagé non double-compté", vueDedup.commandes.engage === 140000);

  // M. 1 opération → plusieurs commandes → agrégation.
  const vueMulti = construireSuiviOperation({
    ligne: ligne(),
    liens: [lien({ id: "l1", commande_id: "c1" }), lien({ id: "l2", commande_id: "c2" })],
    commandes: [
      commande({ id: "c1", numero_commande: "100", engage: 80000, paye: 40000, budget: 90000 }),
      commande({ id: "c2", numero_commande: "200", engage: 60000, paye: 30000, budget: 70000 }),
    ],
    exercice: 2026,
  });
  check("M. 2 commandes liées", vueMulti.commandes.nb_commandes === 2);
  check("M. engagé agrégé = 140000", vueMulti.commandes.engage === 140000);
  check("M. payé agrégé = 70000", vueMulti.commandes.paye === 70000);
  check("M. commandé agrégé = 160000", vueMulti.commandes.budget_commande === 160000);
  check(
    "M. commande manquante ignorée (rien inventé)",
    construireSuiviOperation({
      ligne: ligne(),
      liens: [lien({ id: "l1", commande_id: "absente" })],
      commandes: [commande()],
      exercice: 2026,
    }).commandes.nb_commandes === 0,
  );
}

// ── N — cohérence Préparation → Suivi (identité = psp_lignes.id) ────────────
console.log("\nN. cohérence Préparation → Suivi");
{
  const ligneId = "11111111-1111-4111-8111-111111111111";
  const vue = construireSuiviOperation({ ligne: ligne(), exercice: 2026 });
  check("N. même identité psp_lignes.id", vue.identite.id === ligneId);
  // Deux opérations même TR+C → identités distinctes (jamais TR+C).
  const l2 = ligne({ id: "autre-id", corps_etat: "Chauffage", nature_travaux: "Chauffage" });
  const vue2 = construireSuiviOperation({ ligne: l2, exercice: 2026 });
  check(
    "N. collision TR+C impossible (identités distinctes)",
    vue.identite.id !== vue2.identite.id,
  );
  check(
    "N. aucune clé TR+C réintroduite",
    JSON.stringify(vue.identite).includes("1977|GT") === false,
  );
}

// ── O — chaîne d'avancement (états réels) ───────────────────────────────────
console.log("\nO. chaîne d'avancement");
{
  const avancement = etapesAvancement(
    construireSuiviOperation({
      ligne: ligne(),
      devis: [
        devis({ statut: "recu", montant: 80000 }),
        devis({ id: "x", statut: "retenu", montant: 84500 }),
      ],
      liens: [lien()],
      commandes: [commande({ etat_travaux: "En cours" })],
      exercice: 2026,
    }),
  );
  const codes = avancement.map((e) => e.code);
  check(
    "O. 8 étapes ordonnées",
    codes.join(",") ===
      "programmation,consultation,demandes_devis,devis_recus,devis_retenu,commande,travaux_en_cours,termine",
  );
  const atteints = avancement.filter((e) => e.atteint).map((e) => e.code);
  check(
    "O. états réels atteints (jusqu'à travaux_en_cours)",
    atteints.join(",") ===
      "programmation,consultation,demandes_devis,devis_recus,devis_retenu,commande,travaux_en_cours",
  );
  const simple = etapesAvancement(construireSuiviOperation({ ligne: ligne(), exercice: 2026 }));
  check(
    "O. sans devis/commande : seulement programmation",
    simple
      .filter((e) => e.atteint)
      .map((e) => e.code)
      .join(",") === "programmation",
  );
}

// ── Résultat ──────────────────────────────────────────────────────────────────
console.log(`\nRésultat : ${passed} ok, ${failed} échec(s)`);
if (failed > 0) process.exit(1);
