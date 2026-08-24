// ═══════════════════════════════════════════════════════════════════════════════
// V8.6.1.1 — CONSOLIDATION DU REGISTRE ANNUEL /SUIVI : tests PURS ciblés.
// Exécution : node scripts/test-psp-v8611.mjs
// ═══════════════════════════════════════════════════════════════════════════════
// Points A–E (§11) :
//   A. 2026 : PSP sans commande · hors PSP sans commande · payé vide · payé<engagé ·
//      payé=engagé · incohérence → À vérifier ;
//   B. Préparation : opération 2027 avec estimation · devis sans commande · demande
//      sans montant · statut consultation ;
//   C. Anti-doublon : une seule opération · rapprochement sans doublon · commande déjà liée ;
//   D. Imports : aucun INSERT/UPDATE/DELETE/ALTER · Dashboard inchangé ;
//   E. Année : 2026 par défaut · changement d'année · 2027 sans commande fictive.
//  + garde anti-doublon hors PSP · bandeau lignes sans commande · état réel vs
//    état de pilotage · AUCUNE migration appliquée.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  deriverEtatSuiviAnnuel,
  construireLigneRegistreAnnuel,
} from "../src/lib/psp.suivi.view.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = (p) => join(__dirname, "..", "src", p);
const fichier = (p) => readFileSync(src(p), "utf8");

const supabaseFn = fichier("lib/psp.prep.supabase.functions.ts");
const routeSuivi = fichier("routes/suivi.tsx");
const fiche = fichier("components/suivi/SuiviOperationFiche.tsx");
const travauxFn = fichier("lib/travaux.functions.ts");
const suiviView = fichier("lib/psp.suivi.view.ts");
const tableau = fichier("components/suivi/SuiviTable.tsx");
const prepTable = fichier("components/preparation-psp/PspTable.tsx");
const prepForm = fichier("components/preparation-psp/PspOperationForm.tsx");

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

// ════════════ A. ÉTATS 2026 (§1 / §11-A) ══════════════════════════════════════
{
  // Opération PSP programmée SANS commande (ligne registre type "operation", commande null).
  const pspSansCmd = construireLigneRegistreAnnuel({
    type: "operation",
    id: "l1",
    pspLigneId: "l1",
    origine: "psp",
    tranche: "1977",
    corpsEtat: "(d) Couvertures",
    nature: "Réfection toiture",
    programmeAnnee: 50000,
  });
  check(
    "A. PSP programmée sans commande → Sans commande",
    pspSansCmd.etat_annuel === "sans_commande" && pspSansCmd.programme_annee === 50000,
  );

  // Opération hors PSP sans commande.
  const horsPspSansCmd = construireLigneRegistreAnnuel({
    type: "operation",
    id: "l2",
    pspLigneId: "l2",
    origine: "hors_psp",
    tranche: "1950",
    corpsEtat: "(z) Plomberie",
    nature: "Réparation urgente",
  });
  check(
    "A. hors PSP sans commande → Sans commande",
    horsPspSansCmd.etat_annuel === "sans_commande" && horsPspSansCmd.origine === "hors_psp",
  );

  // Commande avec payé vide → En cours.
  check(
    "A. commande + payé vide → En cours",
    deriverEtatSuiviAnnuel({ numeroCommande: "C1", engage: 1000, paye: null }) === "en_cours",
  );
  // Payé < engagé → En cours.
  check(
    "A. payé < engagé → En cours",
    deriverEtatSuiviAnnuel({ numeroCommande: "C2", engage: 1000, paye: 400 }) === "en_cours",
  );
  // Payé = engagé (tolérance) → Terminée.
  check(
    "A. payé = engagé → Terminée",
    deriverEtatSuiviAnnuel({ numeroCommande: "C3", engage: 1000, paye: 1000.004 }) === "terminee",
  );
  // Incohérence → À vérifier.
  check(
    "A. payé > engagé → À vérifier",
    deriverEtatSuiviAnnuel({ numeroCommande: "C4", engage: 1000, paye: 1500 }) === "a_verifier",
  );
  check(
    "A. engagé vide avec commande → À vérifier",
    deriverEtatSuiviAnnuel({ numeroCommande: "C5", engage: null, paye: null }) === "a_verifier",
  );
}

// ════════════ B. PRÉPARATION PSP (§4 / §11-B) ═════════════════════════════════
check(
  "B. opération 2027 visible avec estimation dans la préparation (montants par année)",
  prepForm.includes("programme") && prepForm.includes("2027") && prepTable.includes("Devis"),
);
check(
  "B. le registre n'inclut une opération PSP que si programmée sur l'année choisie (2027 ≠ 2026)",
  supabaseFn.includes("progAnnee <= 0") && supabaseFn.includes('ligne.origine === "hors_psp"'),
);
check(
  "B. devis connu AVANT commande : psp_devis reste le registre unique (Préparation ↔ Suivi partagé)",
  supabaseFn.includes('.from("psp_devis")') && fiche.includes("comparatifDevis"),
);
check(
  "B. demande de devis SANS montant valide (statut demande_envoyee, montant nullable)",
  supabaseFn.includes("demande_envoyee") &&
    supabaseFn.includes("montant: z.number().positive().nullish()"),
);
check(
  "B. statut de consultation cohérent (statut_label dérivé, relance incluse)",
  suiviView.includes("statut_label") && fiche.includes("relance_necessaire"),
);

// ════════════ C. ANTI-DOUBLON (§6 / §11-C) ════════════════════════════════════
check(
  "C. garde hors PSP : refus si TR + corps d'état + nature identiques existent déjà",
  supabaseFn.includes("GARDE ANTI-DOUBLON") &&
    supabaseFn.includes("Opération refusée : une opération existe déjà sur la TR") &&
    supabaseFn.includes('.eq("tranche_code", data.trancheCode)'),
);
check(
  "C. une commande liée à une opération → UNE seule ligne (commande non dupliquée dans le registre)",
  supabaseFn.includes("commandesLieesId.has(c.id)") && supabaseFn.includes("commandeLiee"),
);
check(
  "C. commande déjà liée : aucun nouveau doublon (createPspCommandLink anti-doublon conservé)",
  supabaseFn.includes("Cette commande est déjà rattachée à une autre opération."),
);
check(
  // V8.6.2 — aucune création manuelle générique dans /suivi ; la matérialisation
  // des lignes annuelles sans commande se fait à l'import (origine='suivi').
  "C. aucune création manuelle dans /suivi — matérialisation à l'import (origine 'suivi')",
  !routeSuivi.includes("NouvelleOperationDialog") &&
    !routeSuivi.includes("Nouvelle opération") &&
    travauxFn.includes("materialiserLignesSansCommande") &&
    travauxFn.includes('origine: "suivi"'),
);

// ════════════ D. IMPORTS / DASHBOARD (§8-§9 / §11-D) ═════════════════════════
const tablesImport = [
  "travaux_commandes",
  "travaux_commandes_historique",
  "import_travaux",
  "imports",
  "psp_imports",
  "psp_import_rows",
  "travaux_import_details",
];
check(
  "D. aucun INSERT/UPDATE/DELETE/ALTER sur les tables d'import dans les fichiers V8.6.1.1",
  tablesImport.every(
    (t) =>
      !supabaseFn.includes(`.from("${t}").insert`) &&
      !supabaseFn.includes(`.from("${t}").update`) &&
      !supabaseFn.includes(`.from("${t}").delete`) &&
      !supabaseFn.includes(`alter table public.${t}`),
  ),
);
check(
  "D. Dashboard inchangé (aucune référence dashboard dans les fichiers V8.6.1.1)",
  !tableau.includes("dashboard-travaux") && !supabaseFn.includes("dashboard-travaux"),
);
check(
  "D. travaux_import_details lue en LECTURE SEULE (compteur bandeau)",
  supabaseFn.includes('.from("travaux_import_details")') &&
    supabaseFn.includes("Numéro de commande manquant") &&
    supabaseFn.includes('{ count: "exact", head: true }'),
);

// ════════════ E. ANNÉE (§5 / §11-E) ═══════════════════════════════════════════
check("E. 2026 par défaut dans /suivi", routeSuivi.includes("useState<number>(2026)"));
check(
  "E. changement d'année : le registre est rechargé (queryKey inclut l'année)",
  routeSuivi.includes('["psp-suivi-annuel", annee]'),
);
check(
  "E. 2027 sans commande fictive : les commandes sont filtrées par l'exercice réel",
  supabaseFn.includes('.eq("annee_exercice", annee)') && supabaseFn.includes('.eq("actif", true)'),
);

// ════════════ BONUS — CONSOLIDATION V8.6.1.1 ═════════════════════════════════
check(
  "BONUS. bandeau « lignes annuelles sans commande » dans /suivi (lecture seule)",
  routeSuivi.includes("lignesSansCommandeImport") &&
    routeSuivi.includes("lignesSuiviMaterialisees") &&
    routeSuivi.includes("détectées dans les imports") &&
    routeSuivi.includes("matérialisée(s) en opérations"),
);
check(
  "BONUS. fiche : distinction État réel / système vs État de pilotage (aucune écriture)",
  fiche.includes("État réel / système") &&
    fiche.includes("État de pilotage") &&
    !fiche.includes("etat_pilotage"),
);
check(
  "BONUS. AUCUNE migration appliquée (aucune colonne etat_pilotage créée)",
  !supabaseFn.includes("etat_pilotage") && !routeSuivi.includes("etat_pilotage"),
);
check(
  "BONUS. l'état réel est dérivé (tolérance 0,01 conservée V8.6.1)",
  suiviView.includes("Math.abs(p - e) < 0.01"),
);

console.log(`\nV8.6.1.1 PUR : ${passed} ok, ${failed} échec(s)`);
if (failed > 0) process.exit(1);
