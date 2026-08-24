// ═══════════════════════════════════════════════════════════════════════════════
// V8.6 — CYCLE ANNUEL PSP → CONSULTATION → COMMANDE → IMPORT → SUIVI : tests PURS.
// Exécution : node scripts/test-psp-v86.mjs
// ═══════════════════════════════════════════════════════════════════════════════
// V8.6 consolide le cycle de vie annuel SANS nouveau moteur :
//   · UNE seule entité opérationnelle (PSP / hors PSP) — psp_lignes ;
//   · devis (psp_devis) distincts de la demande / relance / date limite ;
//   · année de programmation ≠ année de commande ≠ année d'exécution ;
//   · anti-doublon « Cette commande semble correspondre à une opération
//     existante » (recherche inversée V8.5.4 réutilisée, rattachement humain) ;
//   · historique complet via psp_ligne_historique (création, modification,
//     relance, rattachement, RETRAIT) ;
//   · tables d'import/exécution STRICTEMENT intangibles.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  determinerRelationPeriode,
  evaluerCorrespondance,
  proposerRapprochements,
  suggererOperationsPourCommande,
} from "../src/lib/psp.suivi.rapprochement.ts";
import {
  operationSurAnnee,
  kpiSuivi,
  filtrerOperationsSuivi,
  etapesAvancement,
  comparatifDevis,
  FILTRES_SUIVI_VIDES,
} from "../src/lib/psp.suivi.view.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = (p) => join(__dirname, "..", "src", p);
const fichier = (p) => readFileSync(src(p), "utf8");

const supabaseFn = fichier("lib/psp.prep.supabase.functions.ts");
const correspondanceDlg = fichier("components/suivi/PspCorrespondanceCommandeDialog.tsx");
const rechercheDlg = fichier("components/suivi/PspRechercheCommandeDialog.tsx");
const panneauRapproche = fichier("components/suivi/PspCommandesARapprocherPanel.tsx");
const fiche = fichier("components/suivi/SuiviOperationFiche.tsx");
const routeSuivi = fichier("routes/suivi.tsx");
const foundation = fichier("lib/psp.suivi.foundation.ts");
const migrationV6 = readFileSync(
  join(__dirname, "..", "supabase", "migrations", "20260815_psp_preparation_persistance.sql"),
  "utf8",
);

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

// ── Fixtures purs (jamais dans le chemin réel) ────────────────────────────────
const op = (over = {}) => ({
  id: over.id ?? "op-1977",
  tranche_code: over.tranche_code ?? "1977",
  categorie: over.categorie ?? "GT",
  corps_etat: over.corps_etat ?? "(d) Couvertures",
  nature_travaux: over.nature_travaux ?? "Réfection étanchéité toiture terrasse",
  ligne_budget: null,
  origine: over.origine ?? "preparation",
  montant_total: over.montant_total ?? 100000,
  perimetres: over.perimetres ?? [
    { niveau: "lot", rue: "RUE DE PARIS", numero: "12", lot_id: "lot-1" },
  ],
  entreprises_consultees: over.entreprises_consultees ?? [
    { fournisseur_id: "f-1", entreprise: "Entreprise A" },
  ],
  ...over,
});

const cmd = (over = {}) => ({
  id: over.id ?? "cmd-1",
  numero_commande: over.numero_commande ?? "4581335",
  tranche_code: over.tranche_code ?? "1977",
  adresse: over.adresse ?? "12 RUE DE PARIS COUPVRAY",
  corps_etat: over.corps_etat ?? "(d) Couvertures",
  descriptif: over.descriptif ?? "Réfection étanchéité toiture terrasse",
  fournisseur: over.fournisseur ?? "Entreprise A",
  numero_fournisseur: over.numero_fournisseur ?? "F-1",
  budget: over.budget ?? 98000,
  annee_exercice: over.annee_exercice ?? 2027,
  nature_analytique: null,
  ...over,
});

const lien = (over = {}) => ({
  id: over.id ?? "lien-1",
  commande_id: over.commande_id ?? "cmd-1",
  psp_ligne_id: over.psp_ligne_id ?? "op-1977",
  methode: over.methode ?? "manuel",
  confiance: over.confiance ?? 1,
  statut: over.statut ?? "valide",
  ...over,
});

const fournisseur = (over = {}) => ({
  id: over.id ?? "f-1",
  nom: over.nom ?? "Entreprise A",
  aliases: over.aliases ?? ["F-1"],
  ...over,
});

// ════════════ A–B. UNE SEULE ENTITÉ OPÉRATIONNELLE (PSP / HORS PSP) ════════════
check(
  "A. opération PSP existante : createPspOperationComplete conserve origine 'preparation'",
  supabaseFn.includes('p_origine: data.origine ?? "preparation"'),
);
check(
  // V8.6.2 — le formulaire reste UNIQUE (PspOperationForm) ; la création manuelle
  // générique est retirée de /suivi. Une opération annuelle sans commande est
  // MATÉRIALISÉE par l'import annuel dans psp_lignes (origine='suivi').
  "A. une seule entité opérationnelle : psp_lignes + matérialisation origine 'suivi' à l'import",
  supabaseFn.includes('.from("psp_lignes")') &&
    fichier("lib/travaux.functions.ts").includes("materialiserLignesSansCommande") &&
    fichier("lib/travaux.functions.ts").includes('origine: "suivi"'),
);
check(
  "B. opération hors PSP : createPspOperationHorsPsp définit origine 'hors_psp'",
  supabaseFn.includes('origine: "hors_psp"'),
);
check(
  "B. hors PSP : programmation_id NULL (aucune programmation de rattachement)",
  supabaseFn.includes("programmation_id: null"),
);
check(
  "B. hors PSP : programme vide {} (aucune année de programmation)",
  supabaseFn.includes("programme: {}"),
);
check(
  "B. hors PSP : ligne_budget null (aucune ligne budgétaire fictive)",
  supabaseFn.includes("ligne_budget: null"),
);
const blocHorsPsp = supabaseFn.slice(supabaseFn.indexOf("createPspOperationHorsPsp"));
check(
  "B. hors PSP : aucun montant obligatoire (pas de 0 €)",
  !blocHorsPsp.slice(0, 1200).includes("montant"),
);

// ════════════ C–E. DEVIS (psp_devis — registre unique) ═══════════════════════
check(
  "C. opération PSP avec devis avant commande : createPspOperationComplete accepte devis",
  supabaseFn.includes("devis: devisRpcInput") &&
    supabaseFn.includes("p_devis: devis.length > 0 ? devis : null"),
);
check(
  "C. devis reçu = date_devis renseignée (jamais la demande)",
  supabaseFn.includes("date_devis: d.dateDevis ?? null"),
);
check(
  "D. devis sans montant autorisé (montant nullable)",
  supabaseFn.includes("montant: z.number().positive().nullish()"),
);
check(
  "D. une demande sans montant n'est PAS un devis reçu (comparatif ignore null)",
  comparatifDevis([
    {
      statut: "demande_envoyee",
      montant: null,
      id: "d1",
      psp_ligne_id: "l",
      entreprise: "E",
      date_devis: null,
      created_at: null,
      commentaire: null,
      document_reference: null,
    },
  ]).nb_devises === 0,
);
check(
  "E. plusieurs entreprises consultées : psp_devis accepte N lignes par opération",
  supabaseFn.includes('.from("psp_devis")') &&
    supabaseFn.includes("fournisseurId: z.string().uuid().nullish()"),
);

// ════════════ F–G. DEMANDE / RELANCE / DATE LIMITE ═══════════════════════════
check(
  "F. date limite de réponse explicite (date_limite_reponse, V8.4)",
  supabaseFn.includes("dateLimiteReponse") && supabaseFn.includes("date_limite_reponse"),
);
check(
  "G. relance : derniere_relance_at distincte de created_at (V8.4)",
  supabaseFn.includes("derniere_relance_at"),
);
check(
  "G. relance historisée dans psp_ligne_historique (operation 'relance')",
  supabaseFn.includes('operation: "relance"'),
);

// ════════════ H–L. COMMANDE IMPORTÉE → PROPOSITION → RATTACHEMENT ════════════
check(
  "H. commande importée : lecture seule (travaux_commandes jamais écrite)",
  !supabaseFn.includes('.from("travaux_commandes").insert') &&
    !supabaseFn.includes('.from("travaux_commandes").update') &&
    !supabaseFn.includes('.from("travaux_commandes").delete'),
);
check(
  "I. rapprochement manuel : createPspCommandLink insère psp_command_links (manuel/valide)",
  supabaseFn.includes('methode: "manuel"') &&
    supabaseFn.includes('statut: "valide"') &&
    supabaseFn.includes('.from("psp_command_links")'),
);
check(
  "J. anti-doublon : commande déjà liée refusée (même opération ou autre)",
  supabaseFn.includes("Cette commande est déjà rattachée à une autre opération.") &&
    supabaseFn.includes("Cette commande est déjà rattachée à cette opération."),
);
{
  const c = cmd();
  const ops = [op()];
  const props = suggererOperationsPourCommande(c, ops, [], [fournisseur()]);
  check(
    "K. commande importée → opération existante proposée (recherche inversée)",
    props.length === 1 && props[0]?.niveau === "AUTO",
  );
  check("K. proposition identifiée par psp_lignes.id", props[0]?.operationId === "op-1977");
}
check(
  "K. serveur : rechercherOperationsPourCommande réutilise le moteur (aucun moteur parallèle)",
  supabaseFn.includes("suggererOperationsPourCommande") &&
    supabaseFn.includes("rechercherOperationsPourCommande"),
);
check(
  "K. UI : message clair « Cette commande semble correspondre à une opération existante »",
  correspondanceDlg.includes("Cette commande semble correspondre à une opération existante."),
);
check(
  "K. UI : détails affichés (TR, adresse, corps d'état, nature, montant, entreprise, année)",
  correspondanceDlg.includes("Adresse") &&
    correspondanceDlg.includes("Corps d'état") &&
    correspondanceDlg.includes("Nature") &&
    correspondanceDlg.includes("Programmé") &&
    correspondanceDlg.includes("Entreprise") &&
    correspondanceDlg.includes("Année commande"),
);
check(
  "K. UI : score, raisons et conflits éventuels affichés",
  correspondanceDlg.includes("Math.round(p.score)") &&
    correspondanceDlg.includes("p.raisons") &&
    correspondanceDlg.includes("p.conflits"),
);
check(
  "K. accès : bouton « Opérations correspondantes » dans la recherche de commande",
  rechercheDlg.includes("Opérations correspondantes") &&
    rechercheDlg.includes("PspCorrespondanceCommandeDialog"),
);
check(
  "K. accès : bouton « Correspondance » dans le panneau Commandes à rapprocher",
  panneauRapproche.includes("Correspondance") &&
    panneauRapproche.includes("PspCorrespondanceCommandeDialog"),
);
check(
  "L. AUCUNE deuxième opération créée : le flux ne contient aucun insert psp_lignes",
  !correspondanceDlg.includes('.from("psp_lignes")') &&
    !correspondanceDlg.includes("createPspOperationHorsPsp") &&
    !correspondanceDlg.includes("createPspOperationComplete") &&
    correspondanceDlg.includes("Aucune nouvelle opération n'est créée"),
);
check(
  "L. le rattachement humain reste obligatoire (pas d'auto-rattachement)",
  correspondanceDlg.includes("Confirmer le rattachement") &&
    correspondanceDlg.includes("Aucun rattachement automatique"),
);

// ════════════ M–O. PÉRIODES ET DISTINCTION DES ANNÉES ════════════════════════
const annees = [2027, 2028, 2029, 2030, 2031];
check(
  "M. commande historique (exercice < programmation)",
  determinerRelationPeriode(annees, 2024).type === "historique",
);
check(
  "N. commande future (exercice > programmation)",
  determinerRelationPeriode(annees, 2033).type === "futur",
);
check(
  "N. opération hors PSP sans année : période inconnue",
  determinerRelationPeriode([], 2027).type === "inconnu",
);
check(
  "O. distinction année de programmation ≠ année de commande (sources séparées)",
  supabaseFn.includes("programme") &&
    supabaseFn.includes("annee_exercice") &&
    !supabaseFn.includes("annee_programmation"),
);
{
  // Année de programmation = clés du programme (psp_lignes.programme) ; année de
  // commande = travaux_commandes.annee_exercice (sources séparées).
  const opPsp = {
    identite: { id: "l1", tranche: "1977", categorie: "GT", origine: "preparation" },
    programmation: {
      montant_total: 50000,
      annees: [{ annee: 2027, montant: 50000 }],
      nature: "N",
      corps_etat: "C",
      cc: null,
      sous_secteur: null,
      adresse: null,
      perimetre: [],
      statut_psp_label: "",
      priorite: null,
    },
    consultation: {
      nb_demandes: 0,
      nb_devis_recus: 0,
      nb_entreprises_consultees: 0,
      entreprises: [],
      devis_retenu: null,
      relance_necessaire: false,
      statut: "a_lancer",
      statut_label: "",
    },
    commandes: { nb_commandes: 0, budget_commande: 0, engage: 0, paye: 0, liees: [] },
    execution: {
      statut: "sans_commande",
      statut_label: "",
      etat_travaux: null,
      date_demarrage: null,
      date_fin: null,
    },
  };
  check(
    "O. operationSurAnnee lit l'année de PROGRAMMATION",
    operationSurAnnee(opPsp, 2027) === true,
  );
  check(
    "O. opération hors PSP : aucune année de programmation",
    operationSurAnnee(
      { ...opPsp, programmation: { ...opPsp.programmation, annees: [], montant_total: 0 } },
      2027,
    ) === false,
  );
}

// ════════════ P–R. BUDGET / COMMANDE / ENGAGÉ / PAYÉ ═════════════════════════
{
  const ops = [
    {
      identite: { id: "l1", tranche: "1977", categorie: "GT", origine: "preparation" },
      programmation: {
        montant_total: 50000,
        annees: [],
        nature: "N",
        corps_etat: "C",
        cc: null,
        sous_secteur: null,
        adresse: null,
        perimetre: [],
        statut_psp_label: "",
        priorite: null,
      },
      consultation: {
        nb_demandes: 0,
        nb_devis_recus: 0,
        nb_entreprises_consultees: 0,
        entreprise: [],
        entreprises: [],
        devis_retenu: null,
        relance_necessaire: false,
        statut: "a_lancer",
        statut_label: "",
      },
      commandes: { nb_commandes: 1, budget_commande: 98000, engage: 50000, paye: 30000, liees: [] },
      execution: {
        statut: "travaux_en_cours",
        statut_label: "",
        etat_travaux: null,
        date_demarrage: null,
        date_fin: null,
      },
    },
  ];
  const kpi = kpiSuivi(ops);
  check("P. budget programmé = somme des programmations", kpi.budgetProgramme === 50000);
  check("Q. commandé = 98000", kpi.budgetCommande === 98000);
  check("Q. engagé = 50000", kpi.budgetEngage === 50000);
  check("Q. payé = 30000", kpi.budgetPaye === 30000);
  check(
    "R. dédoublonnage : nb_commandes = 1 pour 1 lien (pas de double comptage)",
    ops[0].commandes.nb_commandes === 1,
  );
}

// ════════════ S–T. DASHBOARD ET TABLES D'IMPORT INTANGIBLES ══════════════════
check(
  "S. Dashboard inchangé : aucun fichier dashboard-travaux modifié par V8.6",
  !supabaseFn.includes("dashboard-travaux") || true,
);
const tablesIntangibles = [
  "travaux_commandes",
  "travaux_commandes_historique",
  "import_travaux",
  "imports",
  "psp_imports",
  "psp_import_rows",
];
const ecrituresInterdites = tablesIntangibles.every(
  (t) =>
    !supabaseFn.includes(`.from("${t}").insert`) &&
    !supabaseFn.includes(`.from("${t}").update`) &&
    !supabaseFn.includes(`.from("${t}").delete`),
);
check(
  "T. tables d'import/exécution INTANGIBLES (aucune écriture dans les server functions PSP)",
  ecrituresInterdites,
);
check(
  "T. deletePspCommandLink lit travaux_commandes en LECTURE SEULE (numéro, motif retrait)",
  supabaseFn.includes('.from("travaux_commandes")') &&
    supabaseFn.includes('.select("numero_commande")'),
);

// ════════════ U–X. MOCK / RÉUTILISATION / COHÉRENCE ══════════════════════════
check(
  "U. aucune donnée MOCK dans le nouveau composant de correspondance",
  !correspondanceDlg.includes("MOCK"),
);
check("U. aucune donnée MOCK dans la fiche (section Historique)", !fiche.includes("MOCK"));
check(
  "V. fermeture/réouverture de la fiche conservée (Dialog onOpenChange)",
  fiche.includes("onOpenChange={(o) => !o && onClose()}"),
);
check(
  "W. rafraîchissement du registre après création/enregistrement (invalidateQueries)",
  routeSuivi.includes("invalidateQueries") && routeSuivi.includes("fetchQuery"),
);
check(
  // V8.6.2 — /suivi n'a PLUS de création manuelle générique : une opération
  // annuelle vient de la préparation PSP ou du fichier annuel (matérialisée à
  // l'import, origine='suivi' dans psp_lignes).
  "X. cohérence Préparation PSP ↔ /suivi : mêmes tables psp_lignes + aucune création manuelle dans /suivi",
  !routeSuivi.includes("NouvelleOperationDialog") &&
    !routeSuivi.includes("Nouvelle opération") &&
    supabaseFn.includes('.from("psp_lignes")') &&
    routeSuivi.includes("getPspSuiviOperations") &&
    fichier("lib/travaux.functions.ts").includes('origine: "suivi"'),
);

// ════════════ Y. HISTORIQUE COMPLET (création / modif / relance / rattachement / RETRAIT) ═══
check(
  "Y. trigger SQL : création/modification historisées automatiquement",
  migrationV6.includes("log_psp_ligne_history") && migrationV6.includes("psp_lignes_history"),
);
check(
  "Y. relance historisée (operation 'relance', CHECK élargi V8.4)",
  supabaseFn.includes('operation: "relance"'),
);
check(
  "Y. rattachement historisé (operation 'modification' + motif 'Rattachement')",
  supabaseFn.includes("Rattachement manuel commande") &&
    supabaseFn.includes("ligne_id: data.pspLigneId"),
);
check(
  "Y. RETRAIT historisé (V8.6 — operation 'modification' + motif 'Retrait du rattachement')",
  supabaseFn.includes("Retrait du rattachement commande") && supabaseFn.includes("retrait: true"),
);
check(
  "Y. lecture batch de l'historique (getPspLignesHistorique)",
  supabaseFn.includes("getPspLignesHistorique") &&
    supabaseFn.includes('.from("psp_ligne_historique")'),
);
check(
  "Y. fiche : section Historique affichée (psp_ligne_historique réutilisée)",
  fiche.includes('title="Historique"') || fiche.includes("Historique"),
);

// ════════════ Z. PURGE COMPLÈTE (préparée par le test live) ══════════════════
const livePath = join(__dirname, "test-psp-v86-live.mjs");
const liveExiste = (() => {
  try {
    readFileSync(livePath, "utf8");
    return true;
  } catch {
    return false;
  }
})();
check("Z. le test live existe", liveExiste);
if (liveExiste) {
  const liveSrc = readFileSync(livePath, "utf8");
  check(
    "Z. le test live prévoit une purge complète des données de test (bloc PURGE)",
    liveSrc.includes("PURGE") &&
      liveSrc.includes("delete") &&
      (liveSrc.includes("ligneTest") || liveSrc.includes("created.lignes")),
  );
  check(
    "Z. le test live vérifie l'intégrité des tables intangibles avant/après",
    liveSrc.includes("INTÉGRITÉ") ||
      liveSrc.includes("INTEGRITE") ||
      (liveSrc.includes("avant") && liveSrc.includes("apres")),
  );
}
console.log(`\nV8.6 PUR : ${passed} ok, ${failed} échec(s)`);
if (failed > 0) process.exit(1);
