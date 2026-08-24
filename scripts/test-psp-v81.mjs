// ═══════════════════════════════════════════════════════════════════════════════
// V8.1 — SOCLE MODULE SUIVI (tests PURS) :
//  A. PSP sans commande · B. PSP avec devis · C. plusieurs devis ·
//  D. devis sans montant · E. devis retenu · F. commande rapprochée ·
//  G. commande non rapprochée · H. plusieurs commandes · I. import → suivi ·
//  J. aucune copie commande dans psp_lignes · K. aucun MOCK · L. identité = id ·
//  M. aucune collision TR+C · N. moteur état (etatMetier) inchangé ·
//  O. mailto généré · P. variables mail remplacées · Q. multi-entreprises ·
//  R. relance nécessaire · S. entreprise compatible corps d'état ·
//  T. aucune activité entreprise inventée.
// Exécution : node scripts/test-psp-v81.mjs
// ═══════════════════════════════════════════════════════════════════════════════
import {
  construireSuiviOperation,
  statutConsultationGlobal,
  grouperConsultationParEntreprise,
  relanceNecessairePourDevis,
  devisSansMontant,
  devisRetenuDe,
  statutRapprochementDepuisLien,
  statutExecutionDepuisCommandes,
  statutPspDepuisLigne,
  composerMail,
  MAIL_MODELES,
  construireMailto,
  remplacerVariablesMail,
  recommanderEntreprises,
} from "../src/lib/psp.suivi.foundation.ts";
import { etatMetier } from "../src/lib/travaux.ts";

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

// ── Fixtures ──────────────────────────────────────────────────────────────────
const il_y_a = (jours) => new Date(Date.now() - jours * 86400000).toISOString();

const ligne = (over = {}) => ({
  id: "11111111-1111-4111-8111-111111111111",
  programmation_id: "00000000-0000-4000-8000-000000000001",
  tranche_code: "1977",
  categorie: "GT",
  corps_etat_code: "ce-couv",
  corps_etat: "Couverture",
  nature_travaux: "Réfection toiture",
  programme: { 2027: 150000, 2028: 0, 2029: 0, 2030: 0, 2031: 0 },
  ligne_budget: null,
  remarques: null,
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
});

// ── A. PSP sans commande ─────────────────────────────────────────────────────
console.log("\nA. PSP sans commande");
{
  const vue = construireSuiviOperation({ ligne: ligne(), exercice: 2026 });
  check("nb_commandes = 0", vue.commandes.nb_commandes === 0);
  check("statut exécution = sans_commande", vue.execution.statut === "sans_commande");
  check(
    "rapprochement global = non_rapproche",
    vue.commandes.statut_rapprochement_global === "non_rapproche",
  );
  check("consultation = pas_consulte", vue.consultation.statut === "pas_consulte");
}

// ── B. PSP avec devis ─────────────────────────────────────────────────────────
console.log("\nB. PSP avec devis");
{
  const vue = construireSuiviOperation({ ligne: ligne(), devis: [devis()], exercice: 2026 });
  check("nb_demandes = 1", vue.consultation.nb_demandes === 1);
  check("1 entreprise consultée", vue.consultation.nb_entreprises_consultees === 1);
  check("statut consultation = en_attente", vue.consultation.statut === "en_attente");
}

// ── C. plusieurs devis ────────────────────────────────────────────────────────
console.log("\nC. plusieurs devis");
{
  const devis2 = [
    devis({ fournisseur_id: "a", entreprise: "A" }),
    devis({ id: "x2", fournisseur_id: "b", entreprise: "B", created_at: il_y_a(2) }),
    devis({ id: "x3", fournisseur_id: "c", entreprise: "C", created_at: il_y_a(1) }),
  ];
  const vue = construireSuiviOperation({ ligne: ligne(), devis: devis2, exercice: 2026 });
  check("3 entreprises consultées", vue.consultation.nb_entreprises_consultees === 3);
  check("3 demandes", vue.consultation.nb_demandes === 3);
}

// ── D. devis sans montant ─────────────────────────────────────────────────────
console.log("\nD. devis sans montant");
{
  const sansMontant = devis({ montant: null, statut: "demande_envoyee" });

  // ── E. devis retenu ───────────────────────────────────────────────────────────
  console.log("\nE. devis retenu");
  {
    const devisRetenu = devis({ statut: "retenu", montant: 84500, date_devis: "2026-08-27" });
    const vue = construireSuiviOperation({ ligne: ligne(), devis: [devisRetenu], exercice: 2026 });
    check("statut = devis_retenu", vue.consultation.statut === "devis_retenu");
    check("devis retenu identifié", devisRetenuDe([devisRetenu])?.id === devisRetenu.id);
  }

  // ── F. commande rapprochée (auto) ─────────────────────────────────────────────
  console.log("\nF. commande rapprochée");
  {
    const liens = [lien({ methode: "auto", confiance: 1, statut: "valide" })];
    const vue = construireSuiviOperation({
      ligne: ligne(),
      liens,
      commandes: [commande()],
      exercice: 2026,
    });
    check("1 commande liée", vue.commandes.nb_commandes === 1);
    check("rapprochement = auto", vue.commandes.statut_rapprochement_global === "auto");
    check("budget commande = 143500", vue.commandes.budget_commande === 143500);
    check("engagé = 140000", vue.commandes.engage === 140000);
    check("payé = 75000", vue.commandes.paye === 75000);
    check("statut exécution = travaux_en_cours", vue.execution.statut === "travaux_en_cours");
  }

  // ── G. commande non rapprochée ────────────────────────────────────────────────
  console.log("\nG. commande non rapprochée");
  {
    // Commande existante mais AUCUN lien → non rapprochée (rien d'inventé).
    const vue = construireSuiviOperation({
      ligne: ligne(),
      commandes: [commande()],
      exercice: 2026,
    });
    check("aucune commande liée (lien manquant)", vue.commandes.nb_commandes === 0);
    check(
      "rapprochement = non_rapproche",
      vue.commandes.statut_rapprochement_global === "non_rapproche",
    );
    check(
      "lien rejeté → non_rapproche",
      statutRapprochementDepuisLien({ methode: "auto", statut: "rejete", confiance: 1 }) ===
        "non_rapproche",
    );
    check(
      "lien à confirmer → a_confirmer",
      statutRapprochementDepuisLien({ methode: "auto", statut: "a_confirmer", confiance: 0.6 }) ===
        "a_confirmer",
    );
  }

  // ── H. plusieurs commandes ────────────────────────────────────────────────────
  console.log("\nH. plusieurs commandes");
  {
    const liens = [
      lien({ id: "l1", commande_id: "c1", methode: "manuel", statut: "valide", confiance: 1 }),
      lien({ id: "l2", commande_id: "c2", methode: "auto", statut: "valide", confiance: 1 }),
    ];
    const commandes = [
      commande({ id: "c1", numero_commande: "100", budget: 50000 }),
      commande({ id: "c2", numero_commande: "200", budget: 93500, etat_travaux: "Terminés" }),
    ];
    const vue = construireSuiviOperation({
      ligne: ligne(),
      liens,
      commandes,
      exercice: 2026,
    });
    check("2 commandes liées", vue.commandes.nb_commandes === 2);
    check("budget agrégé = 143500", vue.commandes.budget_commande === 143500);
    check(
      "rapprochement global = manuel (priorité)",
      vue.commandes.statut_rapprochement_global === "manuel",
    );
    check("au moins une terminée → travaux_termines", vue.execution.statut === "travaux_termines");
  }

  check("devis sans montant accepté", devisSansMontant(sansMontant) === true);
  const vue = construireSuiviOperation({
    ligne: ligne(),
    devis: [sansMontant],
    exercice: 2026,
  });
  const entreprise = vue.consultation.entreprises[0];
  check("montant null conservé (pas 0)", entreprise?.montant === null);
  check("statut consultation dérivé malgré montant null", vue.consultation.statut === "en_attente");
}

// ── I. import → apparition dans le suivi (recalcul) ───────────────────────────
console.log("\nI. import → apparition dans le suivi");
{
  const avant = construireSuiviOperation({ ligne: ligne(), exercice: 2026 });
  check("avant import : sans commande", avant.commandes.nb_commandes === 0);
  const apres = construireSuiviOperation({
    ligne: ligne(),
    liens: [lien()],
    commandes: [commande()],
    exercice: 2026,
  });
  check("après import : commande apparue", apres.commandes.nb_commandes === 1);
  check(
    "ligne PSP inchangée par l'import",
    avant.programmation.ligne.programme["2027"] === apres.programmation.ligne.programme["2027"],
  );
}

// ── J. aucune copie commande dans psp_lignes ──────────────────────────────────
console.log("\nJ. aucune copie commande dans psp_lignes");
{
  const vue = construireSuiviOperation({
    ligne: ligne(),
    liens: [lien()],
    commandes: [commande()],
    exercice: 2026,
  });
  const l = vue.programmation.ligne;
  check("pas de numero_commande sur la ligne", !("numero_commande" in l));
  check("pas de budget/engagé/payé sur la ligne", !("engage" in l) && !("paye" in l));
  check("montant programmé intact (150000)", l.programme["2027"] === 150000);
}

// ── K. aucun MOCK ─────────────────────────────────────────────────────────────
console.log("\nK. aucun MOCK");
{
  const vue = construireSuiviOperation({ ligne: ligne(), exercice: 2026 });
  check("source.reelle = true", vue.source.donnees_reelles === true);
  check("source.mock = false", vue.source.mock === false);
  check("aucune valeur 3200000", JSON.stringify(vue).includes("3200000") === false);
}

// ── L. identité par psp_lignes.id ─────────────────────────────────────────────
console.log("\nL. identité par psp_lignes.id");
{
  const vue = construireSuiviOperation({ ligne: ligne(), exercice: 2026 });
  check("identite.id = ligne.id", vue.identite.id === "11111111-1111-4111-8111-111111111111");
  check(
    "identite = {id, tranche, categorie, origine}",
    JSON.stringify(Object.keys(vue.identite).sort()) ===
      JSON.stringify(["categorie", "id", "origine", "tranche"].sort()),
  );
}

// ── M. aucune collision TR+C ──────────────────────────────────────────────────
console.log("\nM. aucune collision TR+C");
{
  const ligne1 = ligne({ id: "ligne-1" });
  const ligne2 = ligne({ id: "ligne-2", corps_etat: "Chauffage", nature_travaux: "Chauffage" });
  const vue1 = construireSuiviOperation({ ligne: ligne1, exercice: 2026 });
  const vue2 = construireSuiviOperation({ ligne: ligne2, exercice: 2026 });
  check("2 opérations même TR+C → identités distinctes", vue1.identite.id !== vue2.identite.id);
  check(
    "natures distinctes conservées",
    vue1.programmation.nature === "Réfection toiture" && vue2.programmation.nature === "Chauffage",
  );
}

// ── N. moteur état des travaux inchangé (etatMetier) ──────────────────────────
console.log("\nN. Dashboard inchangé (etatMetier)");
{
  check(
    "Terminés/Close → Terminés",
    etatMetier({ etat_travaux: "Terminés", etat_commande: null, engage: 0 }, 2026) === "Terminés",
  );
  check(
    "En cours + engagé → En cours",
    etatMetier({ etat_travaux: "En cours", etat_commande: null, engage: 12000 }, 2026) ===
      "En cours",
  );
  check(
    "exécution dérivée alignée sur etatMetier",
    statutExecutionDepuisCommandes(
      [
        {
          lien_id: "x",
          commande_id: "y",
          numero_commande: "1",
          entreprise: "A",
          date_import: null,
          descriptif: null,
          budget: null,
          engage: null,
          paye: null,
          solde: null,
          etat_commande: "Close",
          etat_travaux: "Terminés",
          statut_rapprochement: "auto",
          statut_rapprochement_label: "",
          confiance: 1,
        },
      ],
      2026,
    ) === "travaux_termines",
  );
}

// ── O. mailto généré correctement ─────────────────────────────────────────────
console.log("\nO. mailto généré correctement");
{
  const url = construireMailto({
    email: "contact@abc.fr",
    sujet: "Demande de devis – 1977 – Toiture",
    corps: "Bonjour, veuillez nous transmettre votre proposition.",
  });
  check("mailto commence par mailto:contact@abc.fr?", url.startsWith("mailto:contact@abc.fr?"));
  check(
    "sujet encodé",
    url.includes("subject=") && decodeURIComponent(url).includes("Demande de devis"),
  );
  check("corps encodé", url.includes("body=") && decodeURIComponent(url).includes("Bonjour"));
}

// ── P. variables mail correctement remplacées ─────────────────────────────────
console.log("\nP. variables mail remplacées");
{
  const modele = MAIL_MODELES.find((m) => m.id === "demande_devis");
  const compose = composerMail(modele, {
    TR: "1977",
    NATURE_TRAVAUX: "Réfection toiture",
    CORPS_ETAT: "Couverture",
    ADRESSE: "10 rue des Lilas",
    DATE_RETOUR: "2026-09-10",
  });
  check("sujet complet", compose.sujet === "Demande de devis – 1977 – Réfection toiture");
  check(
    "corps : nature insérée",
    compose.corps.includes("Nature des travaux :\nRéfection toiture"),
  );
  check(
    "corps : TR et adresse insérés",
    compose.corps.includes("Référence patrimoine :\n1977") &&
      compose.corps.includes("10 rue des Lilas"),
  );
  // Variable inconnue → conservée telle quelle (aucune invention).
  check(
    "variable inconnue conservée",
    remplacerVariablesMail("X {INCONNUE} Y", {}) === "X {INCONNUE} Y",
  );
}

// ── Q. plusieurs entreprises consultées (workflow) ────────────────────────────
console.log("\nQ. plusieurs entreprises consultées");
{
  const liste = grouperConsultationParEntreprise(
    [
      devis({ id: "d1", fournisseur_id: "fA", entreprise: "A", created_at: il_y_a(5) }),
      devis({ id: "d2", fournisseur_id: "fB", entreprise: "B", created_at: il_y_a(4) }),
      devis({
        id: "d3",
        fournisseur_id: "fC",
        entreprise: "C",
        created_at: il_y_a(3),
        statut: "recu",
        montant: 90000,
      }),
    ],
    new Date(),
  );
  check("3 entreprises regroupées", liste.length === 3);
  check(
    "chaque entreprise a SA demande",
    liste.every((e) => e.date_demande != null),
  );
  check(
    "une seule devis reçu (C)",
    liste.find((e) => e.entreprise === "C")?.statut_devis === "recu",
  );
}

// ── R. relance nécessaire ─────────────────────────────────────────────────────
console.log("\nR. relance nécessaire");
{
  const vieille = devis({ created_at: il_y_a(45), statut: "demande_envoyee", montant: null });
  check(
    "demande > 21 jours sans devis → relance",
    relanceNecessairePourDevis(vieille, new Date(), 21) === true,
  );
  const recente = devis({ created_at: il_y_a(3), statut: "demande_envoyee" });
  check(
    "demande récente → pas de relance",
    relanceNecessairePourDevis(recente, new Date(), 21) === false,
  );
  const avecDevis = devis({ created_at: il_y_a(45), statut: "recu" });
  check(
    "demande ancienne mais devis reçu → pas de relance",
    relanceNecessairePourDevis(avecDevis, new Date(), 21) === false,
  );
  check(
    "statut global = relance_necessaire",
    statutConsultationGlobal([vieille], new Date(), 21) === "relance_necessaire",
  );
}

// ── S. entreprise compatible avec corps d'état ────────────────────────────────
console.log("\nS. entreprise compatible avec corps d'état");
{
  const suggestions = recommanderEntreprises({
    fournisseurs: [
      { id: "f1", nom: "TOITURE PRO" },
      { id: "f2", nom: "EVIZIO" },
      { id: "f3", nom: "SANS HISTORIQUE" },
    ],
    historique: [
      { fournisseur_id: "f1", corps_etat: "Couverture", montant: 120000, annee: 2026 },
      { fournisseur_id: "f1", corps_etat: "Couverture", montant: 80000, annee: 2025 },
      { fournisseur_id: "f1", corps_etat: "Peinture", montant: 30000, annee: 2025 },
      { fournisseur_id: "f2", corps_etat: "Peinture", montant: 90000, annee: 2026 },
    ],
    activites: [],
    corps_etat_operation: "Couverture",
  });
  const toiturePro = suggestions.find((s) => s.fournisseur_id === "f1");
  check("TOITURE PRO suggérée (historique Couverture)", toiturePro != null);
  check(
    "étiquette commandes historiques (2)",
    toiturePro?.etiquettes.some((e) => e.includes("2 commandes historiques sur ce corps d'état")),
  );
  check(
    "jamais « Meilleure entreprise »",
    JSON.stringify(suggestions).includes("Meilleure") === false,
  );
  check(
    "libellés compatibles uniquement",
    suggestions.every((s) => ["forte", "compatible"].includes(s.correspondance)),
  );
}

// ── T. aucune activité entreprise inventée ────────────────────────────────────
console.log("\nT. aucune activité entreprise inventée");
{
  const suggestions = recommanderEntreprises({
    fournisseurs: [
      { id: "f1", nom: "INCONNU" },
      { id: "f2", nom: "AUTRE" },
    ],
    historique: [],
    activites: [],
    corps_etat_operation: "Couverture",
  });
  check("aucune entreprise sans données → non suggérée (rien d'inventé)", suggestions.length === 0);
  // Activités manuelles validées (fournisseur_activites) : source RÉELLE, prioritaire.
  const avecActivite = recommanderEntreprises({
    fournisseurs: [{ id: "f1", nom: "TOITURE PRO" }],
    historique: [],
    activites: [
      {
        fournisseur_id: "f1",
        corps_etat_code: "couverture",
        corps_etat_libelle: "Couverture",
        niveau: "principal",
      },
    ],
    corps_etat_operation: "Couverture",
  });
  check(
    "activité manuelle réelle → suggérée (Corps d'état compatible)",
    avecActivite.some((s) => s.etiquettes.includes("Corps d'état compatible")),
  );
}

// ── Résultat ──────────────────────────────────────────────────────────────────
console.log(`\nRésultat : ${passed} ok, ${failed} échec(s)`);
if (failed > 0) {
  process.exit(1);
}
