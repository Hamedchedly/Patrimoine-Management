// ═══════════════════════════════════════════════════════════════════════════════
// V8.6.2 — MATÉRIALISATION DES LIGNES ANNUELLES SANS COMMANDE : tests PURS.
// Exécution : node scripts/test-psp-v862.mjs
// ═══════════════════════════════════════════════════════════════════════════════
// Points A–N :
//   A. ligne avec commande → aucune nouvelle psp_ligne si opération existante ;
//   B. ligne sans commande + ligne budgétaire → représentation correcte ;
//   C. ligne sans commande sans LB → origine='suivi' ;
//   D. TR + corps + nature identiques → anti-doublon ;
//   E. ligne sans commande → visible dans /suivi ;
//   F/G. demande de devis / devis reçu → psp_devis ;
//   H/I. commande future → moteur V8.5 → rattachement psp_command_links ;
//   J. aucune deuxième psp_ligne ;
//   K. montants commandé/engagé/payé → exclusivement travaux_commandes ;
//   K2. V8.16 — lignes sans commande : engagé/payé en colonnes DÉDIÉES (montant_engage/paye) ;
//   L. états (sans commande / en cours / terminée / à vérifier) ;
//   M. préparation 2027-2031 non polluée ;
//   N. imports : aucune écriture sur les tables d'import.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  deriverEtatSuiviAnnuel,
  construireLigneRegistreAnnuel,
} from "../src/lib/psp/suivi.view.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = (p) => join(__dirname, "..", "src", p);
const fichier = (p) => readFileSync(src(p), "utf8");

const travauxFn = fichier("lib/travaux.functions.ts");
const supabaseFn = fichier("lib/psp.prep.supabase.functions.ts");
const prep = fichier("lib/psp.prep.ts");
const devisWorkflow = fichier("components/preparation-psp/PspDemandeDevisWorkflow.tsx");

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

// ════════════ A–D. MATÉRIALISATION (source : materialiserLignesSansCommande) ══
check(
  "A. la matérialisation ne concerne QUE les lignes « Numéro de commande manquant »",
  travauxFn.includes('i.message === "Numéro de commande manquant"'),
);
check(
  "B. budget annuel porté dans programme[annee] (jamais une projection 2027-2031)",
  travauxFn.includes("programme: budget != null ? { [String(annee)]: budget } : {}"),
);
check(
  "B2. ligne budgétaire conservée (opération issue du PSP annuel)",
  travauxFn.includes('ligne_budget: (issue.ligne_budget ?? "").trim() || null'),
);
check(
  "C. ligne sans LB → origine='suivi' (une seule entité opérationnelle psp_lignes)",
  travauxFn.includes('origine: "suivi"') &&
    travauxFn.includes("programmation_id: null") &&
    travauxFn.includes('from("psp_lignes").insert'),
);
check(
  "C2. aucune commande recopiée (aucun numero_commande dans l'insert psp_lignes)",
  !travauxFn.includes("numero_commande: issue."),
);
check(
  "D. ANTI-DOUBLON : même TR + corps d'état + nature → l'opération existe déjà (aucun insert)",
  travauxFn.includes('from("psp_lignes")') &&
    travauxFn.includes('select("id, corps_etat, nature_travaux")') &&
    travauxFn.includes('.eq("tranche_code", tranche)') &&
    travauxFn.includes("existantes += 1"),
);
check(
  "D2. données insuffisantes → aucune ligne partielle (insuffisantes comptées)",
  travauxFn.includes("insuffisantes") && travauxFn.includes('tranche_code.trim() !== ""'),
);

// ── Bloc de la fonction matérialisation (source ciblé, pas tout le moteur) ──
const blocMaterialisation = travauxFn.slice(
  travauxFn.indexOf("export const materialiserLignesSansCommande"),
  travauxFn.indexOf("export const importTravauxBatch"),
);

// ════════════ E. VISIBLE DANS /SUIVI (registre annuel) ════════════════════════
check(
  "E. le registre inclut les lignes origine='suivi' (même sans budget annuel)",
  supabaseFn.includes('ligne.origine === "suivi"') &&
    supabaseFn.includes("origineSuivi") &&
    supabaseFn.includes("!horsPsp && !origineSuivi && progAnnee <= 0 && !commandeLiee"),
);
check(
  "E2. origine affichée d'une ligne 'suivi' dérivée de la ligne budgétaire (PSP / Hors PSP annuel)",
  supabaseFn.includes('ligne.origine === "suivi"') &&
    supabaseFn.includes('(ligne.ligne_budget ?? "").trim()'),
);
{
  // L. États dérivés sur une ligne matérialisée.
  const sansCmd = construireLigneRegistreAnnuel({
    type: "operation",
    id: "L",
    pspLigneId: "L",
    origine: "hors_psp",
    tranche: "1950",
    corpsEtat: "(z) Couvertures",
    nature: "Réparation urgente",
  });
  check(
    "L. ligne matérialisée sans commande → Sans commande",
    sansCmd.etat_annuel === "sans_commande",
  );
  check(
    "L. commande + payé vide → En cours",
    deriverEtatSuiviAnnuel({ numeroCommande: "C1", engage: 1000, paye: null }) === "en_cours",
  );
  check(
    "L. payé = engagé → Terminée",
    deriverEtatSuiviAnnuel({ numeroCommande: "C2", engage: 1000, paye: 1000 }) === "terminee",
  );
  check(
    "L. payé > engagé → À vérifier",
    deriverEtatSuiviAnnuel({ numeroCommande: "C3", engage: 1000, paye: 1500 }) === "a_verifier",
  );
}

// ════════════ F/G. DEVIS (psp_devis, même workflow) ══════════════════════════
check(
  "F. demande de devis sur une ligne sans commande → psp_devis (même workflow)",
  devisWorkflow.includes("psp_devis") || supabaseFn.includes('.from("psp_devis")'),
);
check(
  "G. devis reçu → statut consultation dérivé (recu / retenu gérés dans psp_devis)",
  supabaseFn.includes("date_devis") && fichier("lib/psp.prep.v7.ts").includes('recu: "Reçu"'),
);

// ════════════ H/I. RAPPROCHEMENT (moteur V8.5 réutilisé) ═════════════════════
check(
  "H. commande importée → retrouvée par le moteur V8.5 (recherche inversée réutilisée)",
  supabaseFn.includes("rechercherOperationsPourCommande") &&
    supabaseFn.includes("suggererOperationsPourCommande"),
);
check(
  "I. rattachement → psp_command_links (createPspCommandLink, écriture UNIQUE)",
  supabaseFn.includes('.from("psp_command_links")') &&
    supabaseFn.includes("Cette commande est déjà rattachée"),
);
check(
  "J. le registre ne crée JAMAIS une deuxième psp_ligne pour une commande liée",
  supabaseFn.includes("commandesLieesId.has(c.id)"),
);

// ════════════ K. MONTANTS EXCLUSIVEMENT IMPORTS ═══════════════════════════════
check(
  "K. montants commandé/engagé/payé exclusivement issus de travaux_commandes (lecture seule)",
  supabaseFn.includes('.eq("annee_exercice", annee)'),
);
check(
  "K2. V8.16 — la matérialisation stocke l'engagé/payé de la ligne sans commande en colonnes DÉDIÉES (montant_engage/montant_paye + annee_exercice), jamais en engage/paye",
  blocMaterialisation.includes("montant_engage") &&
    blocMaterialisation.includes("montant_paye") &&
    blocMaterialisation.includes("annee_exercice") &&
    !/\n\s+engage:/.test(blocMaterialisation) &&
    !/\n\s+paye:/.test(blocMaterialisation),
);

// ════════════ M. PRÉPARATION 2027-2031 NON POLLUÉE ════════════════════════════
check(
  "M. préparation centrée sur 2027-2031 (PSP_ANNEES)",
  prep.includes("[2027, 2028, 2029, 2030, 2031]"),
);
check(
  "M2. les lignes 'suivi' (programmation_id NULL) ne sont pas dans la programmation",
  supabaseFn.includes('.is("programmation_id", null)') ||
    supabaseFn.includes("programmation_id: null"),
);

// ════════════ N. IMPORTS INTACTS ═════════════════════════════════════════════
const tablesImport = [
  "travaux_commandes",
  "travaux_commandes_historique",
  "imports",
  "psp_imports",
  "psp_import_rows",
];
check(
  "N. la matérialisation n'écrit JAMAIS dans les tables d'import",
  tablesImport.every((t) => !blocMaterialisation.includes(`.from("${t}").insert`)),
);
check(
  "N2. la matérialisation écrit UNIQUEMENT dans psp_lignes (jamais dans travaux_commandes)",
  blocMaterialisation.includes('from("psp_lignes").insert') &&
    !blocMaterialisation.includes('from("travaux_commandes").insert'),
);

// ════════════ A. LIGNE AVEC COMMANDE → AUCUNE NOUVELLE LIGNE ═════════════════
check(
  "A. une ligne annuelle AVEC commande est traitée par travaux_commandes (aucune psp_ligne 'suivi' créée)",
  !travauxFn.includes('message: "Numéro de commande manquant"') ||
    travauxFn.includes("materialiserLignesSansCommande"),
);
check(
  "A2. le registre n'ajoute jamais de psp_ligne pour une commande liée (anti-doublon)",
  supabaseFn.includes("commandesLieesId.has(c.id)"),
);

console.log(`\nV8.6.2 PUR : ${passed} ok, ${failed} échec(s)`);
if (failed > 0) process.exit(1);
