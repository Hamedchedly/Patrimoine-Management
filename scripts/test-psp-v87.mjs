// ═══════════════════════════════════════════════════════════════════════════════
// V8.7 — FINALISATION UX PRÉPARATION + REGISTRE ANNUEL : tests PURS ciblés.
// Exécution : node scripts/test-psp-v87.mjs
// ═══════════════════════════════════════════════════════════════════════════════
// Points testés :
//   A. préparation : statut consultation dérivé des devis (psp_devis.statut) ;
//   B. suivi annuel : états dérivés (sans commande / en cours / terminée / à vérifier) ;
//   C. devis/consultation : jamais confondu avec commande/engagé/payé ;
//   D. rapprochement : un seul moteur V8.5 (aucun nouveau) ;
//   E. non-régression : aucune table/migration/moteur parallèle ;
//   F. fiche : chaque montant identifié par sa source (aucun « 0 € » hors PSP) ;
//   G. colonne « Devis » de la préparation affiche le statut consultation.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { statutConsultationDepuisDevis } from "../src/lib/psp.prep.v7.ts";
import { deriverEtatSuiviAnnuel, construireLigneRegistreAnnuel } from "../src/lib/psp.suivi.view.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = (p) => join(__dirname, "..", "src", p);
const fichier = (p) => readFileSync(src(p), "utf8");

const prepV7 = fichier("lib/psp.prep.v7.ts");
const rowSrc = fichier("components/preparation-psp/PspOperationRow.tsx");
const ficheSrc = fichier("components/suivi/SuiviOperationFiche.tsx");
const suiviTableSrc = fichier("components/suivi/SuiviTable.tsx");
const suiviRoute = fichier("routes/suivi.tsx");
const rapprochementSrc = fichier("lib/psp.suivi.rapprochement.ts");

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

// ════════════ A. PRÉPARATION — STATUT CONSULTATION DÉRIVÉ ═════════════════════
console.log("\n=== A. Préparation — statut consultation (dérivé des devis) ===");
{
  const d = (statut) => ({ statut });
  check(
    "A1. aucun devis → « Aucune demande »",
    statutConsultationDepuisDevis([]).label === "Aucune demande",
  );
  check(
    "A2. a_demander → « Demande à envoyer »",
    statutConsultationDepuisDevis([d("a_demander")]).label === "Demande à envoyer",
  );
  check(
    "A3. demande_envoyee → « Demande envoyée »",
    statutConsultationDepuisDevis([d("demande_envoyee")]).label === "Demande envoyée",
  );
  check(
    "A4. recu → « Devis reçu »",
    statutConsultationDepuisDevis([d("recu")]).label === "Devis reçu",
  );
  check(
    "A5. retenu → « Devis retenu »",
    statutConsultationDepuisDevis([d("retenu")]).label === "Devis retenu",
  );
  check(
    "A6. priorité retenu > recu > demande",
    statutConsultationDepuisDevis([d("demande_envoyee"), d("recu"), d("retenu")]).label ===
      "Devis retenu" &&
      statutConsultationDepuisDevis([d("demande_envoyee"), d("recu")]).label === "Devis reçu",
  );
  check(
    "A7. statut inconnu → aucune (aucun état inventé)",
    statutConsultationDepuisDevis([d("")]).label === "Aucune demande",
  );
  check(
    "A8. helper exposé dans psp.prep.v7.ts (module pur)",
    prepV7.includes("export const statutConsultationDepuisDevis"),
  );
}

// ════════════ G. COLONNE « DEVIS » DE LA PRÉPARATION ══════════════════════════
console.log("\n=== G. Colonne « Devis » (PspOperationRow) ===");
check(
  "G1. la colonne affiche le statut consultation (plus de « ☑ Oui » générique)",
  rowSrc.includes("statutConsultationDepuisDevis(op.devis)") &&
    rowSrc.includes('consultation.code === "aucune" ? "Aucune demande"'),
);
check(
  "G2. aucun montant commande/engagé/payé dans la colonne Devis",
  !rowSrc.includes("engage") && !rowSrc.includes("paye"),
);
check(
  "G3. aucun libellé « ☑ Oui (N) » / « ☐ Non » restant",
  !rowSrc.includes("Oui (${nbDevis})") && !rowSrc.includes('Non"'),
);


// ════════════ B. SUIVI ANNUEL — ÉTATS DÉRIVÉS ═════════════════════════════════
console.log("\n=== B. Registre annuel — états dérivés ===");
check(
  "B1. sans commande",
  deriverEtatSuiviAnnuel({ numeroCommande: null, engage: null, paye: null }) === "sans_commande",
);
check(
  "B2. en cours (payé vide)",
  deriverEtatSuiviAnnuel({ numeroCommande: "C1", engage: 1000, paye: null }) === "en_cours",
);
check(
  "B3. en cours (payé < engagé)",
  deriverEtatSuiviAnnuel({ numeroCommande: "C1", engage: 1000, paye: 400 }) === "en_cours",
);
check(
  "B4. terminée (payé = engagé, tolérance 0,01)",
  deriverEtatSuiviAnnuel({ numeroCommande: "C1", engage: 1000, paye: 1000 }) === "terminee" &&
    deriverEtatSuiviAnnuel({ numeroCommande: "C1", engage: 1000.004, paye: 1000 }) === "terminee",
);
check(
  "B5. à vérifier (payé > engagé)",
  deriverEtatSuiviAnnuel({ numeroCommande: "C1", engage: 1000, paye: 1500 }) === "a_verifier",
);
check(
  "B6. à vérifier (engagé vide avec commande)",
  deriverEtatSuiviAnnuel({ numeroCommande: "C1", engage: null, paye: null }) === "a_verifier",
);
check(
  "B7. registre : année 2026 par défaut (route)",
  suiviRoute.includes("useState<number>(2026)"),
);
check(
  "B8. filtre État : Sans commande / En cours / Terminées / À vérifier / Toutes",
  suiviTableSrc.includes("sans_commande") &&
    suiviTableSrc.includes("en_cours") &&
    suiviTableSrc.includes("terminee") &&
    suiviTableSrc.includes("a_verifier"),
);

// ════════════ C. DEVIS / CONSULTATION — DISTINCTION DES MONTANTS ══════════════
console.log("\n=== C. Devis vs commande/engagé/payé ===");
{
  const ligne = construireLigneRegistreAnnuel({
    type: "operation",
    id: "L1",
    pspLigneId: "L1",
    origine: "psp",
    tranche: "1977",
    programmeAnnee: 50000,
    consultation: {
      nb_demandes: 1,
      nb_devis_recus: 1,
      statut: "devis_recu",
      statut_label: "Devis reçu",
    },
  });
  check("C1. ligne sans commande → état « Sans commande »", ligne.etat_annuel === "sans_commande");
  check(
    "C2. consultation conservée même sans commande",
    ligne.consultation.nb_devis_recus === 1 && ligne.consultation.statut === "devis_recu",
  );
}
check(
  "C3. fiche : « Budget estimatif » étiqueté comme programmation",
  ficheSrc.includes('label="Budget estimatif"') &&
    ficheSrc.includes("Source : programmation (estimation)"),
);
check(
  "C4. fiche : Commandé/Engagé/Payé étiquetés « commandes importées liées »",
  ficheSrc.includes("Source : commandes importées liées (travaux_commandes)"),
);

// ════════════ F. FICHE — AUCUN « 0 € » POUR UNE OPÉRATION SANS PROGRAMMATION ══
console.log("\n=== F. Fiche — montants identifiés par source ===");
check(
  "F1. « — » au lieu de « 0 € » si aucun budget estimatif",
  ficheSrc.includes('value={p.montant_total > 0 ? money0(p.montant_total) : "—"}'),
);
check(
  "F2. « — » au lieu de « 0 € » si aucun commande/engagement",
  ficheSrc.includes('value={cmd.budget_commande > 0 ? money0(cmd.budget_commande) : "—"}') &&
    ficheSrc.includes('value={cmd.engage > 0 ? money0(cmd.engage) : "—"}') &&
    ficheSrc.includes('value={cmd.paye > 0 ? money0(cmd.paye) : "—"}'),
);

// ════════════ D. RAPPROCHEMENT — UN SEUL MOTEUR V8.5 ═════════════════════════
console.log("\n=== D. Rapprochement — un seul moteur ===");
check(
  "D1. moteur V8.5 intact (suggererOperationsPourCommande)",
  rapprochementSrc.includes("export const suggererOperationsPourCommande") &&
    rapprochementSrc.includes("evaluerCorrespondance"),
);
check(
  "D2. aucun nouveau moteur dans psp.prep.v7.ts",
  !prepV7.includes("rapproche"),
);

// ════════════ E. NON-RÉGRESSION — AUCUNE TABLE/MIGRATION/MOTEUR PARALLÈLE ═════
console.log("\n=== E. Non-régression architecture ===");
check(
  "E1. aucun « + Nouvelle opération » dans /suivi",
  !suiviRoute.includes("Nouvelle opération") && !suiviRoute.includes("NouvelleOperationDialog"),
);
check(
  "E2. la fiche conserve le workflow devis existant (PspDemandeDevisWorkflow)",
  ficheSrc.includes("PspDemandeDevisWorkflow"),
);
check(
  "E3. la fiche conserve l'historique existant (psp_ligne_historique)",
  ficheSrc.includes("getPspLignesHistorique"),
);
check(
  "E4. aucune table d'import référencée en écriture dans le lot",
  !rowSrc.includes("travaux_commandes") && !ficheSrc.includes("insert("),
);

// ════════════ RÉSUMÉ ══════════════════════════════════════════════════════════
console.log(`\nV8.7 — ${passed} ok / ${failed} échec(s)`);
if (failed > 0) process.exit(1);
