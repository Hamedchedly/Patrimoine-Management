// ═══════════════════════════════════════════════════════════════════════════════
// V8.8 — CORRECTIONS UX + REGISTRE + STATUT MANUEL : tests PURS ciblés.
// Exécution : node scripts/test-psp-v88.mjs
// ═══════════════════════════════════════════════════════════════════════════════
// Points A–G :
//   A. entreprise sans nom → « Fournisseur n°… » / « Entreprise non renseignée » ;
//   B. recherche entreprise (suggestions + libre, sans dropdown auto à l'ouverture) ;
//   C. consultation : « Devis demandé » vert dans /suivi ;
//   D. lignes sans commande : matérialisation (origine='suivi') + affichage ;
//   E. tableau : Sous-secteur absent, Adresse/Descriptif présents, tri asc/desc ;
//   F. statut manuel : valeurs autorisées, séparation état réel / importé ;
//   G. années : 2026 réel, 2027 préparation uniquement.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { libelleEntreprise, statutConsultationDepuisDevis } from "../src/lib/psp.prep.v7.ts";
import {
  deriverEtatSuiviAnnuel,
  construireLigneRegistreAnnuel,
  trierLignesRegistre,
  valeurTriRegistre,
} from "../src/lib/psp.suivi.view.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = (p) => join(__dirname, "..", "src", p);
const fichier = (p) => readFileSync(src(p), "utf8");

const tableSrc = fichier("components/suivi/SuiviTable.tsx");
const ficheSrc = fichier("components/suivi/SuiviOperationFiche.tsx");
const fournisseurSearch = fichier("components/preparation-psp/PspFournisseurSearch.tsx");
const workflowSrc = fichier("components/preparation-psp/PspDemandeDevisWorkflow.tsx");
const devisPanel = fichier("components/preparation-psp/PspDevisPanel.tsx");
const supabaseFn = fichier("lib/psp.prep.supabase.functions.ts");
const suiviView = fichier("lib/psp.suivi.view.ts");
const migrationSql = readFileSync(
  join(__dirname, "..", "supabase", "migrations", "20260818_psp_etat_pilotage.sql"),
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

// ════════════ A. ENTREPRISE SANS NOM ══════════════════════════════════════════
console.log("\n=== A. Entreprise sans nom ===");
check("A1. nom présent → nom", libelleEntreprise("ACME", "123456") === "ACME");
check(
  "A2. nom absent + n° → « Fournisseur n°123456 »",
  libelleEntreprise("", "123456") === "Fournisseur n°123456",
);
check(
  "A3. nom absent + n° → idem (null)",
  libelleEntreprise(null, "123456") === "Fournisseur n°123456",
);
check(
  "A4. nom absent + pas de n° → « Entreprise non renseignée »",
  libelleEntreprise("", null) === "Entreprise non renseignée",
);
check(
  "A5. PspDevisPanel utilise le libellé robuste",
  devisPanel.includes("libelleEntrepriseAvecId"),
);
check(
  "A6. la recherche fournisseur ne se déclenche que sur frappe (rechercheActive)",
  fournisseurSearch.includes("rechercheActive") && fournisseurSearch.includes("setRechercheActive"),
);

// ════════════ B. RECHERCHE ENTREPRISE ═════════════════════════════════════════
console.log("\n=== B. Recherche entreprise (suggestions + libre) ===");
check(
  "B1. le workflow conserve les suggestions existantes",
  workflowSrc.includes("getPspEntreprisesSuggestions") && workflowSrc.includes("suggestions"),
);
check(
  "B2. ajout d'une recherche libre d'entreprise (PspFournisseurSearch)",
  workflowSrc.includes("PspFournisseurSearch") &&
    workflowSrc.includes("Rechercher une autre entreprise"),
);
check(
  "B3. l'entreprise libre conserve fournisseur_id",
  workflowSrc.includes("fournisseur_id: entrepriseLibre.id"),
);
check(
  "B4. aucune nouvelle table (référentiel existant : rechercherFournisseursDevis)",
  fournisseurSearch.includes("rechercherFournisseursDevis"),
);

// ════════════ C. CONSULTATION « DEVIS DEMANDÉ » VERT ══════════════════════════
console.log("\n=== C. Consultation « Devis demandé » ===");
check(
  "C1. badge vert pour demande_envoyee dans SuiviTable",
  tableSrc.includes('demande_envoyee: "bg-emerald-600 text-white"'),
);
check(
  "C2. états positifs verts (en_attente, devis_recu, devis_retenu)",
  tableSrc.includes('en_attente: "bg-emerald-600 text-white"') &&
    tableSrc.includes('devis_recu: "bg-emerald-600 text-white"') &&
    tableSrc.includes('devis_retenu: "bg-emerald-700 text-white"'),
);
check(
  "C3. la source de vérité reste psp_devis (aucun nouveau système)",
  supabaseFn.includes('.from("psp_devis")'),
);

// ════════════ D. LIGNES SANS COMMANDE ═════════════════════════════════════════
console.log("\n=== D. Lignes annuelles sans commande ===");
check(
  "D1. matérialisation : origine='suivi' et anti-doublon TR+corps+nature",
  fichier("lib/travaux.functions.ts").includes('origine: "suivi"') &&
    fichier("lib/travaux.functions.ts").includes("materialiserLignesSansCommande"),
);
check(
  "D2. le registre inclut les lignes 'suivi' (getPspSuiviAnnuel)",
  supabaseFn.includes('ligne.origine === "suivi"'),
);
check(
  "D3. compteur sans commande par exercice — dernier import de l'exercice (V8.13)",
  supabaseFn.includes('.eq("annee_exercice", annee)') &&
    supabaseFn.includes('.order("demarre_at", { ascending: false })') &&
    supabaseFn.includes('.limit(1)') &&
    supabaseFn.includes('.eq("import_id", dernierImportExercice)'),
);
check(
  "D4. script de matérialisation one-shot créé (workflow d'import, pas à l'affichage)",
  readFileSync(join(__dirname, "..", "scripts", "materialiser-lignes-2026.mjs"), "utf8").includes(
    "parseTravauxWorkbook",
  ),
);

// ════════════ E. TABLEAU / TRI ════════════════════════════════════════════════
console.log("\n=== E. Tableau / tri ===");
check("E1. Sous-secteur absent du tableau", !tableSrc.includes("Sous-secteur"));
check("E2. Adresse présente", tableSrc.includes("Adresse") && tableSrc.includes("l.adresse"));
check("E3. Descriptif présent", tableSrc.includes("Descriptif") && tableSrc.includes("l.nature"));
check(
  "E4. tri cliquable branché (trierLignesRegistre + fleches)",
  tableSrc.includes("trierLignesRegistre") && tableSrc.includes("fleche("),
);
{
  const ligne = (id, tranche, adresse, cc) =>
    construireLigneRegistreAnnuel({
      type: "operation",
      id,
      pspLigneId: id,
      origine: "psp",
      tranche,
      adresse,
      cc,
      nature: "toiture",
      corpsEtat: "(p) Toitures",
    });
  const lignes = [ligne("b", "1200", "RUE B", "CC2"), ligne("a", "1100", "RUE A", "CC1")];
  const asc = trierLignesRegistre(lignes, "tranche", true);
  const desc = trierLignesRegistre(lignes, "tranche", false);
  check("E5. tri ascendant TR", asc[0].tranche === "1100" && asc[1].tranche === "1200");
  check("E6. tri descendant TR", desc[0].tranche === "1200" && desc[1].tranche === "1100");
  check(
    "E7. changement de colonne → nouveau tri",
    trierLignesRegistre(lignes, "adresse", true)[0].adresse === "RUE A",
  );
  check(
    "E8. valeurTriRegistre existe (extension du moteur)",
    typeof valeurTriRegistre === "function",
  );
}
check(
  "E9. le moteur existant trierOperationsSuivi reste intact (aucun moteur parallèle)",
  suiviView.includes("export const trierOperationsSuivi"),
);

// ════════════ F. STATUT MANUEL ════════════════════════════════════════════════
console.log("\n=== F. Statut de pilotage manuel ===");
check(
  "F1. migration SQL additive etat_pilotage créée (non appliquée)",
  migrationSql.includes("etat_pilotage") &&
    migrationSql.includes("add column if not exists") &&
    migrationSql.includes("psp_lignes_etat_pilotage_check"),
);
check(
  "F2. valeurs autorisées bornées (a_traiter … a_cloturer)",
  [
    "a_traiter",
    "devis_a_demander",
    "devis_demande",
    "devis_recu",
    "commande_a_passer",
    "en_cours",
    "bloquee",
    "prioritaire",
    "a_cloturer",
  ].every((v) => migrationSql.includes(`'${v}'`)),
);
check(
  "F3. server function dédiée avec validation",
  supabaseFn.includes("export const updatePspLigneEtatPilotage") &&
    supabaseFn.includes("etatPilotageInput") &&
    supabaseFn.includes('.from("psp_lignes")') &&
    supabaseFn.includes(".update({ etat_pilotage: data.etatPilotage })"),
);
check(
  "F4. historisation dans psp_ligne_historique (table existante)",
  supabaseFn.includes('.from("psp_ligne_historique")') &&
    supabaseFn.includes("Changement de l'état de pilotage"),
);
check(
  "F5. séparation : deriverEtatSuiviAnnuel intact (état réel dérivé)",
  suiviView.includes("Math.abs(p - e) < 0.01") &&
    suiviView.includes("export const deriverEtatSuiviAnnuel"),
);
check(
  "F6. la fiche propose le sélecteur de pilotage distinct",
  ficheSrc.includes("Statut de pilotage (manuel)") &&
    ficheSrc.includes("ETAT_PILOTAGE_LABELS") &&
    ficheSrc.includes("updatePspLigneEtatPilotage"),
);
check(
  "F7. ne touche jamais travaux_commandes / tables d'import",
  !supabaseFn.includes('.from("travaux_commandes").update') &&
    !supabaseFn.includes('.from("import_travaux").update'),
);

// ════════════ G. ANNÉES ═══════════════════════════════════════════════════════
console.log("\n=== G. Années (2026 réel / 2027 préparation) ===");
check(
  "G1. /suivi : onglet « Suivi annuel » figé sur 2026 (V8.10 — années par onglet)",
  fichier("routes/suivi.tsx").includes("ANNEE_SUIVI = 2026"),
);
check(
  "G2. préparation PSP centrée 2027-2031 (PSP_ANNEES)",
  fichier("lib/psp.prep.ts").includes("[2027, 2028, 2029, 2030, 2031]"),
);
check(
  "G3. état dérivé : payé vide → En cours ; sans commande → Sans commande",
  deriverEtatSuiviAnnuel({ numeroCommande: "C", engage: 1000, paye: null }) === "en_cours" &&
    deriverEtatSuiviAnnuel({ numeroCommande: null, engage: null, paye: null }) === "sans_commande",
);

// ════════════ RÉSUMÉ ══════════════════════════════════════════════════════════
console.log(`\nV8.8 — ${passed} ok / ${failed} échec(s)`);
if (failed > 0) process.exit(1);
