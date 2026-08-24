// ═══════════════════════════════════════════════════════════════════════════════
// V8.8.1 — VALIDATION LIVE DU STATUT DE PILOTAGE : tests PURS.
// Exécution : node scripts/test-psp-v881.mjs
// ═══════════════════════════════════════════════════════════════════════════════
// Points :
//   · migration attendue (colonne + CHECK + valeurs) ;
//   · valeurs autorisées / interdites (zod server function) ;
//   · séparation état réel / pilotage / consultation / importé ;
//   · absence de deuxième moteur / table ;
//   · UI utilisant la server function existante ;
//   · historique via psp_ligne_historique (aucun parallèle).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { deriverEtatSuiviAnnuel } from "../src/lib/psp.suivi.view.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = (p) => join(__dirname, "..", "src", p);
const fichier = (p) => readFileSync(src(p), "utf8");

const supabaseFn = fichier("lib/psp.prep.supabase.functions.ts");
const fiche = fichier("components/suivi/SuiviOperationFiche.tsx");
const migration = readFileSync(
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

const VALEURS_AUTORISEES = [
  "a_traiter",
  "devis_a_demander",
  "devis_demande",
  "devis_recu",
  "commande_a_passer",
  "en_cours",
  "bloquee",
  "prioritaire",
  "a_cloturer",
];

// ════════════ 1. MIGRATION ════════════════════════════════════════════════════
console.log("\n=== 1. Migration etat_pilotage ===");
check(
  "1.1. colonne additive (add column if not exists)",
  migration.includes("add column if not exists etat_pilotage"),
);
check("1.2. type text (colonne text)", migration.includes("etat_pilotage text"));
check("1.3. CHECK actif", migration.includes("psp_lignes_etat_pilotage_check"));
check(
  "1.4. valeurs autorisées (9)",
  VALEURS_AUTORISEES.every((v) => migration.includes(`'${v}'`)),
);
check("1.5. NULL autorisé (etat_pilotage is null)", migration.includes("etat_pilotage is null"));
check(
  "1.6. strictement additif (aucune table / alter de contrainte existante)",
  !migration.includes("create table") &&
    !migration.includes("drop ") &&
    !migration.includes("alter table public.travaux_"),
);

// ════════════ 2. SERVER FUNCTION ══════════════════════════════════════════════
console.log("\n=== 2. Server function (validation + historique) ===");
check(
  "2.1. fonction existante et unique",
  (supabaseFn.match(/export const updatePspLigneEtatPilotage/g) ?? []).length === 1,
);
check(
  "2.2. validateur zod borné",
  supabaseFn.includes("etatPilotageInput") && supabaseFn.includes(".enum(["),
);
check(
  "2.3. valeurs autorisées dans le validateur",
  VALEURS_AUTORISEES.every((v) => supabaseFn.includes(`"${v}"`)),
);
check(
  "2.4. interdites refusées (zod enum — aucune valeur hors liste)",
  supabaseFn.includes(".enum([") &&
    !supabaseFn.includes('"test"') &&
    !supabaseFn.includes('"terminee"'),
);
check(
  "2.5. mise à jour ciblée psp_lignes (id)",
  supabaseFn.includes('.from("psp_lignes")') &&
    supabaseFn.includes(".update({ etat_pilotage: data.etatPilotage })") &&
    supabaseFn.includes('.eq("id", data.id)'),
);
check(
  "2.6. historisation psp_ligne_historique (opération 'modification')",
  supabaseFn.includes('.from("psp_ligne_historique")') &&
    supabaseFn.includes('operation: "modification"') &&
    supabaseFn.includes("Changement de l'état de pilotage"),
);
check(
  "2.7. erreur métier explicite si colonne absente",
  supabaseFn.includes("Colonne etat_pilotage absente"),
);
check(
  "2.8. aucune écriture directe depuis le composant (UI → server function)",
  !fiche.includes('from("psp_lignes")') &&
    !fiche.includes(".update({") &&
    fiche.includes("updatePspLigneEtatPilotage"),
);

// ════════════ 3. SÉPARATION DES ÉTATS ═════════════════════════════════════════
console.log("\n=== 3. Séparation état réel / pilotage / consultation / importé ===");
check(
  "3.1. état réel dérivé intact (deriverEtatSuiviAnnuel, tolérance 0,01)",
  fichier("lib/psp.suivi.view.ts").includes("Math.abs(p - e) < 0.01") &&
    fichier("lib/psp.suivi.view.ts").includes("export const deriverEtatSuiviAnnuel"),
);
check(
  "3.2. état réel : En cours si payé vide",
  deriverEtatSuiviAnnuel({ numeroCommande: "C1", engage: 1000, paye: null }) === "en_cours",
);
check(
  "3.3. état réel : Terminée si payé = engagé",
  deriverEtatSuiviAnnuel({ numeroCommande: "C1", engage: 1000, paye: 1000 }) === "terminee",
);
check(
  "3.4. fiche : 4 blocs distincts (État réel / Statut de pilotage / État importé / Consultation)",
  fiche.includes("État réel / système") &&
    fiche.includes("Statut de pilotage (manuel)") &&
    fiche.includes("État importé") &&
    fiche.includes("Consultation"),
);
check(
  "3.5. libellés UI professionnels (aucun code brut)",
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
  ].every((v) => supabaseFn.includes(`  ${v}: `)) &&
    supabaseFn.includes("À traiter") &&
    supabaseFn.includes("À clôturer"),
);
check(
  "3.6. la préparation n'est pas transformée par le statut (l'update ne touche QUE etat_pilotage)",
  supabaseFn.includes(".update({ etat_pilotage: data.etatPilotage })") &&
    !supabaseFn.includes(".update({ programme") &&
    !supabaseFn.includes(".update({ origine"),
);

// ════════════ 4. AUCUN MOTEUR / TABLE PARALLÈLE ════════════════════════════════
console.log("\n=== 4. Absence de moteur / table parallèle ===");
check(
  "4.1. une seule définition de server function (aucun doublon)",
  (supabaseFn.match(/export const updatePspLigneEtatPilotage/g) ?? []).length === 1,
);
check(
  "4.2. aucune nouvelle table (pas de 'etat_pilotage' en table)",
  !migration.includes("create table") && !migration.includes("etat_pilotage_historique"),
);
check(
  "4.3. historique réutilise psp_ligne_historique (aucun parallèle)",
  supabaseFn.includes('.from("psp_ligne_historique")') &&
    !supabaseFn.includes("psp_pilotage_historique"),
);
check(
  "4.4. tables d'import non référencées en écriture par la fonction",
  !supabaseFn.includes('.from("travaux_commandes").update') &&
    !supabaseFn.includes('.from("import_travaux").update') &&
    !supabaseFn.includes('.from("travaux_import_details").insert'),
);

// ════════════ RÉSUMÉ ══════════════════════════════════════════════════════════
console.log(`\nV8.8.1 PUR — ${passed} ok / ${failed} échec(s)`);
if (failed > 0) process.exit(1);
