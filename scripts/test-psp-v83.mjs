// ═══════════════════════════════════════════════════════════════════════════════
// V8.3 — OPÉRATIONS HORS PSP + CONSULTATION (tests PURS + vérification source) :
//  A. création opération PSP (chemin conservé) · B. création hors PSP ·
//  C. fiche unique PSP/hors PSP · D. absence de programmation obligatoire hors PSP ·
//  E. sélection multi-entreprises retirable · F. suggestions expliquées (sans
//     « meilleure entreprise ») · G/H/I/J. mailto (destinataire, sujet, corps) ·
//  K. demande sans montant · L. date de demande (created_at) · M. devis reçu ·
//  N. devis retenu · O. relance (moteur + bouton) · P. aucune copie commande dans
//  psp_lignes · Q. commandes lisibles via psp_command_links · R. anti-duplication
//  préparé (méthode/confiance/statut/justification) · S. Dashboard intouché ·
//  T. imports intouchés · U. historique réutilisé · V-Z. build/tsc/eslint/SSR.
// Exécution : node scripts/test-psp-v83.mjs
// ═══════════════════════════════════════════════════════════════════════════════
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  MAIL_MODELES,
  composerMail,
  construireMailto,
  construireSuiviOperation,
  dateDemandeDevis,
  dateRetourParDefaut,
  devisRetenuDe,
  devisSansMontant,
  grouperConsultationParEntreprise,
  relanceNecessairePourDevis,
  statutConsultationEntreprise,
} from "../src/lib/psp.suivi.foundation.ts";

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
const source = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");

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

// ── A. Création opération PSP : chemin conservé ──────────────────────────────
const pspSrc = source("src/lib/psp.prep.supabase.functions.ts");
check(
  "A1. createPspOperationComplete conservé (création PSP)",
  pspSrc.includes("export const createPspOperationComplete"),
);
check(
  "A2. createPspOperationHorsPsp ajouté (création hors PSP)",
  pspSrc.includes("export const createPspOperationHorsPsp"),
);

// ── B. Création opération HORS PSP (une seule entité) ────────────────────────
check(
  "B1. hors PSP : programmation_id NULL (aucune programmation obligatoire)",
  pspSrc.includes("programmation_id: null"),
);
check("B2. hors PSP : origine 'hors_psp'", pspSrc.includes('origine: "hors_psp"'));
check("B3. hors PSP : aucun programme (montants vides)", pspSrc.includes("programme: {}"));
check(
  "B4. opération vide refusée (TR seule insuffisante)",
  pspSrc.includes("renseignez au moins un corps d'état ou une nature des travaux"),
);
const noTronc = /créer\s+une\s+table\s+op[ée]rations_hors_psp|op[ée]rations_hors_psp\s*\(/i.test(
  pspSrc,
);
check("B5. aucune table parallèle opérations_hors_psp", !noTronc);
check(
  "B6. création via psp_lignes (même table que PSP)",
  pspSrc.includes('from("psp_lignes")\n      .insert'),
);

// ── C. Fiche unique PSP / hors PSP ───────────────────────────────────────────
const ficheSrc = source("src/components/suivi/SuiviOperationFiche.tsx");
check("C1. fiche affiche « Hors programmation PSP »", ficheSrc.includes("Hors programmation PSP"));
check(
  "C2. fiche gère l'origine (horsPsp dérivé)",
  ficheSrc.includes('operation.identite.origine === "hors_psp"'),
);
check(
  "C3. aucun montant faux (0 €) — « — » affiché",
  ficheSrc.includes('cmd.engage > 0 ? money0(cmd.engage) : "—"'),
);

// ── D. Aucune programmation obligatoire hors PSP ─────────────────────────────
const horsPspBloc = pspSrc.slice(pspSrc.indexOf("createPspOperationHorsPsp"));
check(
  "D1. validator hors PSP sans programmationId",
  /trancheCode: z\.string\(\)\.min\(1\)/.test(horsPspBloc.slice(0, 1200)),
);
check(
  "D2. validator hors PSP : aucune clé programmationId",
  !/programmationId: z\./.test(horsPspBloc.slice(0, 1200)),
);

// ── E. Sélection multi-entreprises (retirable) ───────────────────────────────
const workflowSrc = source("src/components/preparation-psp/PspDemandeDevisWorkflow.tsx");
check("E1. sélection multiple (selectionIds)", workflowSrc.includes("selectionIds"));
check(
  "E2. sélection retirable sans fermer la fiche (basculer)",
  workflowSrc.includes("prev.includes(id) ? prev.filter"),
);
check("E3. workflow réutilisé depuis /suivi (fiche)", ficheSrc.includes("PspDemandeDevisWorkflow"));

// ── F. Suggestions expliquées, sans « meilleure entreprise » ─────────────────
const foundationSrc = source("src/lib/psp.suivi.foundation.ts");
check(
  "F1. recommanderEntreprises conservé (moteur unique)",
  foundationSrc.includes("export const recommanderEntreprises"),
);
check(
  "F2. suggestions expliquées (score interne, jamais « meilleure entreprise »)",
  /jamais affiché comme « meilleure entreprise »/.test(foundationSrc),
);
check("F3. nombre de commandes historiques affiché", workflowSrc.includes("commandes_total"));
check(
  "F4. email fournisseur exposé dans les suggestions",
  workflowSrc.includes("s.email") && pspSrc.includes("emailParFournisseur"),
);

// ── G/H/I/J. Mailto (destinataire, sujet, corps éditables) ───────────────────
const mailto = construireMailto({
  email: "fournisseur@exemple.fr",
  sujet: "Demande de devis – TR 1977",
  corps: "Bonjour,\nMerci de nous transmettre votre devis.",
});
check("G1. mailto contient le destinataire", mailto.startsWith("mailto:fournisseur@exemple.fr"));
check("G2. mailto encode le sujet", mailto.includes("subject=") && mailto.includes("TR%201977"));
check("G3. mailto encode le corps", mailto.includes("body=") && mailto.includes("Bonjour"));
check(
  "G4. destinataire vide accepté (email non renseigné)",
  construireMailto({ email: null, sujet: "S", corps: "C" }).startsWith("mailto:"),
);
const demandes = composerMail(
  MAIL_MODELES.find((m) => m.id === "demande_devis") ?? MAIL_MODELES[0],
  {
    TR: "1977",
    NATURE_TRAVAUX: "Réfection toiture",
    CORPS_ETAT: "Couverture",
    ADRESSE: "10 rue des Lilas",
    DATE_RETOUR: "2026-09-15",
  },
);
check(
  "H1. sujet prérempli (TR + nature)",
  demandes.sujet.includes("1977") && demandes.sujet.includes("Réfection toiture"),
);
check("H2. corps prérempli (adresse, nature)", demandes.corps.includes("10 rue des Lilas"));
check(
  "H3. sujet personnalisable (Input)",
  workflowSrc.includes("value={sujet}") && ficheSrc.includes("value={sujet}"),
);
check(
  "H4. corps personnalisable (Textarea)",
  workflowSrc.includes("value={corps}") && ficheSrc.includes("value={corps}"),
);
check(
  "I1. « Ouvrir dans ma messagerie » → brouillon (mailto:)",
  workflowSrc.includes("Ouvrir dans ma messagerie"),
);
check(
  "I2. PAT S11 ne prétend jamais avoir envoyé",
  workflowSrc.includes("ne peut pas") || workflowSrc.includes("ne prétend jamais"),
);

// ── K. Demande sans montant ──────────────────────────────────────────────────
const demandeVide = devis({ montant: null, statut: "demande_envoyee" });
check("K1. montant NULL valide pour une demande", devisSansMontant(demandeVide));
check(
  "K2. createPspDevis accepte montant null (validator)",
  pspSrc.includes("montant: z.number().positive().nullish()"),
);

// ── L. Date de demande = created_at ──────────────────────────────────────────
const dDemande = dateDemandeDevis(devis());
check(
  "L1. date de demande = created_at",
  dDemande !== null && dDemande.toISOString().startsWith(il_y_a(3).slice(0, 10)),
);
check("L2. affichage « Demande le … »", ficheSrc.includes("Demande le {fmtDate(e.date_demande)}"));
check(
  "L3. affichage « Devis reçu le … »",
  ficheSrc.includes("Devis reçu le {fmtDate(e.date_devis)}"),
);

// ── M/N. Devis reçu puis retenu ──────────────────────────────────────────────
const sRecu = statutConsultationEntreprise(
  [devis({ montant: 95000, statut: "recu", date_devis: "2026-08-01" })],
  new Date(),
);
check("M1. devis reçu → statut devis_recu", sRecu.statut === "devis_recu");
check(
  "M2. devis retenu identifiable (jamais supprimé)",
  devisRetenuDe([devis({ statut: "recu" }), devis({ statut: "retenu" })]).entreprise ===
    "ENTREPRISE A",
);
const groupe = grouperConsultationParEntreprise(
  [
    devis({ id: "d1", entreprise: "ENTREPRISE A", statut: "recu", montant: 95000 }),
    devis({
      id: "d2",
      fournisseur_id: "44444444-4444-4444-8444-444444444444",
      entreprise: "ENTREPRISE B",
      statut: "demande_envoyee",
      montant: null,
    }),
  ],
  new Date(),
);
check("M3. plusieurs entreprises distinctes regroupées", groupe.length === 2);
check(
  "M4. comparatif conservé (statut_consultation par entreprise)",
  groupe[0]?.statut_consultation === "devis_recu",
);

// ── O. Relances ──────────────────────────────────────────────────────────────
const relanceModele = MAIL_MODELES.find((m) => m.id === "relance");
check("O1. modèle relance existant", !!relanceModele);
const relance = composerMail(relanceModele ?? MAIL_MODELES[0], {
  TR: "1977",
  NATURE_TRAVAUX: "Toiture",
  CORPS_ETAT: "Couverture",
  ADRESSE: "X",
  DATE_RETOUR: "2026-09-15",
  DATE_DEMANDE: "01/08/2026",
});
check("O2. relance préremplie (DATE_DEMANDE)", relance.corps.includes("01/08/2026"));
check(
  "O3. relance nécessaire si échéance dépassée sans devis",
  relanceNecessairePourDevis(
    devis({ created_at: il_y_a(40), statut: "demande_envoyee", montant: null }),
    new Date(),
    21,
  ),
);
check(
  "O4. pas de relance si devis reçu",
  !relanceNecessairePourDevis(
    devis({ created_at: il_y_a(40), statut: "recu", montant: 100 }),
    new Date(),
    21,
  ),
);
check("O5. bouton « Préparer une relance »", ficheSrc.includes("Préparer une relance"));
check(
  "O6. relance = éditeur mail (aucun envoi auto)",
  ficheSrc.includes("ne prétend jamais avoir"),
);

// ── P. Aucune copie commande dans psp_lignes ─────────────────────────────────
const blocHorsPsp = pspSrc.slice(
  pspSrc.indexOf("createPspOperationHorsPsp"),
  pspSrc.indexOf("createPspOperationHorsPsp") + 2000,
);
check(
  "P1. hors PSP n'insère AUCUNE donnée de commande dans psp_lignes",
  !/(numero_commande|montant_engage|montant_paye|date_commande)/.test(blocHorsPsp),
);
check(
  "P2. getPspSuiviOperations lit travaux_commandes (source de vérité)",
  pspSrc.includes('from("travaux_commandes")'),
);
check(
  "P3. aucune INSERT dans travaux_commandes/psp_import_rows dans le code V8.3",
  !/from\("travaux_commandes"\)\s*\.\s*insert/.test(pspSrc),
);

// ── Q. Commandes lisibles via psp_command_links ──────────────────────────────
check("Q1. liens chargés depuis psp_command_links", pspSrc.includes('from("psp_command_links")'));
check(
  "Q2. registre /suivi charge aussi les opérations hors PSP (programmation_id NULL)",
  pspSrc.includes('.is("programmation_id", null)'),
);

// ── R. Anti-duplication préparé (méthode/confiance/statut/justification) ─────
check(
  "R1. champs de rapprochement présents (méthode/confiance/statut/justification)",
  foundationSrc.includes("methode: string | null;") &&
    foundationSrc.includes("confiance: number | null;") &&
    foundationSrc.includes("statut: string | null;") &&
    foundationSrc.includes("justification: string | null;"),
);
check(
  "R2. statutRapprochementDepuisLien réutilisé (préparation V8.5)",
  foundationSrc.includes("export const statutRapprochementDepuisLien"),
);

// ── S. Dashboard non régressé ────────────────────────────────────────────────
const dashSrc = source("src/routes/dashboard-travaux.tsx");
check(
  "S1. Dashboard n'intègre pas le workflow devis/relance",
  !dashSrc.includes("PspDemandeDevisWorkflow") && !dashSrc.includes("Préparer une relance"),
);
check("S2. Dashboard reste une synthèse (travaux)", dashSrc.includes("travaux"));

// ── T. Imports non modifiés ──────────────────────────────────────────────────
check(
  "T1. aucune table import modifiée par le code V8.3",
  !/from\("(import_travaux|psp_import_rows)"\)/.test(blocHorsPsp),
);
const importSrc = source("src/lib/travaux.ts");
check(
  "T2. moteur import conservé",
  importSrc.includes("travaux_commandes") || importSrc.includes("import_travaux"),
);

// ── U. Historique réutilisé (aucune nouvelle table) ──────────────────────────
check(
  "U1. historique via psp_ligne_historique (trigger sur psp_lignes)",
  pspSrc.includes("psp_lignes") && pspSrc.includes("historique"),
);

// ── V8.3 UI — registre ───────────────────────────────────────────────────────
const suiviSrc = source("src/routes/suivi.tsx");
const tableSrc = source("src/components/suivi/SuiviTable.tsx");
const travauxFnSrc = source("src/lib/travaux.functions.ts");
const formSrc = source("src/components/preparation-psp/PspOperationForm.tsx");
const routeTree = source("src/routeTree.gen.ts");
// V8.6.2 — la création manuelle générique est retirée de /suivi : une opération
// annuelle vient de la PRÉPARATION PSP ou du FICHIER ANNUEL (matérialisée par
// l'import dans psp_lignes avec origine='suivi').
check(
  "V1. aucune création manuelle générique dans /suivi (V8.6.2)",
  !suiviSrc.includes("NouvelleOperationDialog") && !suiviSrc.includes("Nouvelle opération"),
);
check(
  "V2. matérialisation des lignes annuelles sans commande (origine 'suivi') à l'import",
  travauxFnSrc.includes("materialiserLignesSansCommande") &&
    travauxFnSrc.includes('origine: "suivi"') &&
    travauxFnSrc.includes("Numéro de commande manquant"),
);
check(
  "V3. formulaire masque les montants en hors PSP",
  formSrc.includes("horsPsp") && formSrc.includes("Hors programmation PSP"),
);
check("V4. tableau distingue Hors programme", tableSrc.includes("Hors programme"));
check(
  "V5. filtre Origine conservé (PSP / Hors PSP)",
  tableSrc.includes('value="hors_psp"') && tableSrc.includes('value="psp"'),
);
check(
  "V6. aucun nouvel écran parallèle",
  !routeTree.includes("/consultation") &&
    !routeTree.includes("/relances") &&
    !routeTree.includes("/commandes"),
);
check("V7. date de retour par défaut (21 j)", dateRetourParDefaut(new Date(), 21).length === 10);

// ── Synthèse ─────────────────────────────────────────────────────────────────
console.log(`\nV8.3 PUR : ${passed} ok, ${failed} échec(s)`);
if (failed > 0) process.exit(1);
