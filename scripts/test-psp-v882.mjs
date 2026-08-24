// ═══════════════════════════════════════════════════════════════════════════════
// V8.8.2 — RECETTE MÉTIER FINALE : tests PURS (correction entreprise sans nom).
// Exécution : node scripts/test-psp-v882.mjs
// ═══════════════════════════════════════════════════════════════════════════════
// Vérifie :
//   · libellé robuste entreprise appliqué dans la fiche opération (consultation +
//     commandes) et dans les dialogues de correspondance/recherche ;
//   · numero_fournisseur porté jusqu'à la vue (CommandeLieeSuivi) ;
//   · aucune valeur vide affichée ;
//   · colonnes du tableau (Sous-secteur absent, Adresse/Descriptif présents) ;
//   · tri réutilise le moteur existant ;
//   · état réel dérivé intact (pilotage ne le modifie pas).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { libelleEntreprise } from "../src/lib/psp.prep.v7.ts";
import { deriverEtatSuiviAnnuel } from "../src/lib/psp.suivi.view.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = (p) => join(__dirname, "..", "src", p);
const fichier = (p) => readFileSync(src(p), "utf8");

const fiche = fichier("components/suivi/SuiviOperationFiche.tsx");
const corrDialog = fichier("components/suivi/PspCorrespondanceCommandeDialog.tsx");
const rechDialog = fichier("components/suivi/PspRechercheCommandeDialog.tsx");
const table = fichier("components/suivi/SuiviTable.tsx");
const foundation = fichier("lib/psp.suivi.foundation.ts");
const view = fichier("lib/psp.suivi.view.ts");
const supabaseFn = fichier("lib/psp.prep.supabase.functions.ts");

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

// ════════════ 1. ENTREPRISE SANS NOM — AFFICHAGE ROBUSTE ══════════════════════
console.log("\n=== 1. Entreprise sans nom (affichage robuste) ===");
check("1.1. libellé : nom présent → nom", libelleEntreprise("ACME", "123456") === "ACME");
check(
  "1.2. libellé : nom absent + n° → « Fournisseur n°123456 »",
  libelleEntreprise(null, "123456") === "Fournisseur n°123456",
);
check(
  "1.3. libellé : nom absent sans n° → « Entreprise non renseignée »",
  libelleEntreprise("", null) === "Entreprise non renseignée",
);
check(
  "1.4. fiche opération — consultation : libelleEntreprise appliqué",
  fiche.includes("libelleEntreprise(e.entreprise)"),
);
check(
  "1.5. fiche opération — commandes liées : libelleEntreprise(l.entreprise, l.numero_fournisseur)",
  fiche.includes("libelleEntreprise(l.entreprise, l.numero_fournisseur)"),
);
check(
  "1.6. dialogue correspondance : libelleEntreprise appliqué (3 occurrences)",
  (corrDialog.match(/libelleEntreprise\(commande/g) ?? []).length >= 3,
);
check(
  "1.7. dialogue recherche commande : libelleEntreprise appliqué",
  rechDialog.includes("libelleEntreprise(c.fournisseur, c.numero_fournisseur)"),
);
check(
  "1.8. aucune valeur vide restante dans les listes corrigées",
  !fiche.includes('{l.entreprise ?? "—"}') &&
    !corrDialog.includes('commande?.fournisseur ?? "—"') &&
    !rechDialog.includes('?? "Entreprise —"'),
);

// ════════════ 2. NUMERO_FOURNISSEUR PORTÉ JUSQU'À LA VUE ══════════════════════
console.log("\n=== 2. numero_fournisseur jusqu'à la vue ===");
check(
  "2.1. CommandeTravauxSuivi porte numero_fournisseur",
  foundation.includes("numero_fournisseur: string | null;"),
);
check(
  "2.2. CommandeLieeSuivi porte numero_fournisseur",
  foundation.includes("numero_fournisseur: string | null;") &&
    foundation.includes("numero_fournisseur: cmd.numero_fournisseur,"),
);
check(
  "2.3. getPspSuiviOperation sélectionne numero_fournisseur (travaux_commandes)",
  supabaseFn.includes("numero_fournisseur, descriptif"),
);
check(
  "2.4. aucune copie de commande dans psp_lignes (lecture seule respectée)",
  !supabaseFn.includes('.from("psp_lignes").insert') ||
    !supabaseFn.includes("numero_commande: c.numero_commande"),
);

// ════════════ 3. TABLEAU /SUIVI ═══════════════════════════════════════════════
console.log("\n=== 3. Tableau /suivi ===");
check("3.1. Sous-secteur absent", !table.includes("Sous-secteur"));
check(
  "3.2. Adresse + Descriptif présents",
  table.includes("Adresse") && table.includes("Descriptif"),
);
check(
  "3.3. colonnes lisibles (min-w du tableau conservé)",
  table.includes("min-w-[900px]") || table.includes("min-w-["),
);

// ════════════ 4. TRI ══════════════════════════════════════════════════════════
console.log("\n=== 4. Tri (moteur existant réutilisé) ===");
check(
  "4.1. trierOperationsSuivi intact (pas de moteur parallèle)",
  view.includes("export const trierOperationsSuivi"),
);
check(
  "4.2. tri du registre via extension du même moteur (trierLignesRegistre)",
  view.includes("export const trierLignesRegistre") && view.includes("valeurTriRegistre"),
);
check(
  "4.3. tri appliqué APRÈS filtres (table)",
  table.includes("trierLignesRegistre(filtrerRegistreAnnuel(lignes, filtres)"),
);

// ════════════ 5. ÉTATS ════════════════════════════════════════════════════════
console.log("\n=== 5. États réels + pilotage ===");
check(
  "5.1. état réel : sans commande",
  deriverEtatSuiviAnnuel({ numeroCommande: null, engage: null, paye: null }) === "sans_commande",
);
check(
  "5.2. état réel : En cours (payé vide / payé<engagé)",
  deriverEtatSuiviAnnuel({ numeroCommande: "C", engage: 1000, paye: null }) === "en_cours" &&
    deriverEtatSuiviAnnuel({ numeroCommande: "C", engage: 1000, paye: 400 }) === "en_cours",
);
check(
  "5.3. état réel : Terminée (payé=engagé)",
  deriverEtatSuiviAnnuel({ numeroCommande: "C", engage: 1000, paye: 1000 }) === "terminee",
);
check(
  "5.4. état réel : À vérifier (incohérence)",
  deriverEtatSuiviAnnuel({ numeroCommande: "C", engage: 1000, paye: 1500 }) === "a_verifier",
);
check(
  "5.5. fiche : statut pilotage séparé de l'état réel",
  fiche.includes("Statut de pilotage (manuel)") &&
    fiche.includes("État réel / système") &&
    !fiche.includes("etat_pilotage: l.etat_annuel"),
);

// ════════════ 6. ANTI-DOUBLON + INTÉGRITÉ ═════════════════════════════════════
console.log("\n=== 6. Anti-doublon + intégrité ===");
check(
  "6.1. dialogue correspondance : message « semble correspondre à une opération existante »",
  corrDialog.includes("semble correspondre à une opération existante"),
);
check(
  "6.2. aucune création d'opération dans le flux de correspondance",
  !corrDialog.includes("Nouvelle opération") && !corrDialog.includes("createPspLigne"),
);
check(
  "6.3. le rattachement passe par createPspCommandLink (un seul lien)",
  corrDialog.includes("createPspCommandLink") &&
    supabaseFn.includes("export const createPspCommandLink"),
);

console.log(`\nV8.8.2 PUR — ${passed} ok / ${failed} échec(s)`);
if (failed > 0) process.exit(1);
