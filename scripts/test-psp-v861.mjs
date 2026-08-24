// ═══════════════════════════════════════════════════════════════════════════════
// V8.6.1 — RECADRAGE MÉTIER DU SUIVI ANNUEL + CORRECTION PRÉPARATION : tests PURS.
// Exécution : node scripts/test-psp-v861.mjs
// ═══════════════════════════════════════════════════════════════════════════════
// Vérifie :
//  A–H. correction du BUG ADRESSE (préparation PSP) : le champ de recherche et
//       la hiérarchie adresse sont réinitialisés depuis le périmètre existant ;
//  E–M. registre opérationnel ANNUEL : année (défaut 2026), états dérivés
//       financiers (Sans commande / En cours / Terminées / À vérifier), filtres ;
//  N.   préparation 2027 visible dans la préparation mais PAS dans le suivi 2026 ;
//  O–V. devis / commande / rapprochement / hors PSP (réutilisation stricte) ;
//  W–AD. état de suivi dérivé, données importées READ-ONLY, Dashboard intact,
//       tables d'import intangibles, aucun MOCK, purge complète.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  deriverEtatSuiviAnnuel,
  construireLigneRegistreAnnuel,
  filtrerRegistreAnnuel,
  kpiRegistreAnnuel,
  FILTRES_REGISTRE_DEFAUT,
} from "../src/lib/psp.suivi.view.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = (p) => join(__dirname, "..", "src", p);
const fichier = (p) => readFileSync(src(p), "utf8");

const hookRecherche = fichier("components/preparation-psp/useRecherchePatrimoine.ts");
const routeSuivi = fichier("routes/suivi.tsx");
const suiviTable = fichier("components/suivi/SuiviTable.tsx");
const supabaseFn = fichier("lib/psp.prep.supabase.functions.ts");
const travauxFn = fichier("lib/travaux.functions.ts");
const suiviView = fichier("lib/psp.suivi.view.ts");
const fiche = fichier("components/suivi/SuiviOperationFiche.tsx");

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

// ════════════ A–H. CORRECTION DU BUG ADRESSE (§3) ════════════════════════════
check(
  "A. le champ de recherche des rues est initialisé avec la rue du périmètre (qRue)",
  hookRecherche.includes('const [qRue, setQRue] = useState(rueInitiale ?? "")'),
);
check(
  "A2. la rue initiale est déduite du périmètre existant (modification)",
  hookRecherche.includes("initialPerimetres.find((p) => p.rue)?.rue ?? null"),
);
check(
  "B. une rue existante ouvre directement le niveau « numéros » (sélection modifiable)",
  hookRecherche.includes('niveauAdresse, setNiveauAdresse] = useState<"rues" | "numeros">(') &&
    hookRecherche.includes('rueInitiale ? "numeros" : "rues"'),
);
check(
  "C. les numéros de la rue existante sont rechargés au montage (actualisation navigateur)",
  hookRecherche.includes("V8.6.1 §3") &&
    hookRecherche.includes("rechercheNumerosFn({ data: { tranche: trInit, rue: rueInit } })"),
);
check(
  "D. la sélection de rue est bien restaurée depuis le périmètre (rue state)",
  hookRecherche.includes(
    "const [rue, setRue] = useState<string | null>(initialPerimetres.find((p) => p.rue)?.rue ?? null)",
  ),
);
check(
  "E. le résumé de sélection (rue + numéros + lots) reste affiché (V7.6)",
  hookRecherche.includes("resumeSelection"),
);
check(
  "F. les lots du périmètre sont restaurés en modification (V8.2.1 conservé)",
  hookRecherche.includes("suggestionsLotsDepuisPerimetres"),
);
check(
  "G. « Modifier la sélection » possible (réouverture au niveau numéros)",
  hookRecherche.includes("reouvrirNumeros") &&
    hookRecherche.includes('setNiveauAdresse("numeros")'),
);
check(
  "H. aucune donnée écrite par la restauration (lecture seule, aucun insert)",
  !hookRecherche.includes(".insert") && !hookRecherche.includes(".update"),
);

// ════════════ E–M. REGISTRE OPÉRATIONNEL ANNUEL (§4-§8) ═══════════════════════
check(
  "E. année 2026 sélectionnée par défaut au chargement de /suivi",
  routeSuivi.includes("useState<number>(2026)") &&
    routeSuivi.includes("Année") &&
    routeSuivi.includes("setAnnee"),
);
check(
  "F. filtre État par défaut = Sans commande (vue par défaut §8)",
  suiviTable.includes("FILTRES_REGISTRE_DEFAUT") &&
    suiviView.includes('etat: "sans_commande"') &&
    suiviTable.includes("Sans commande"),
);
check(
  "G. filtre État disponible : Sans commande / En cours / Terminées / À vérifier / Toutes",
  suiviTable.includes('"sans_commande"') &&
    suiviTable.includes('"en_cours"') &&
    suiviTable.includes('"terminee"') &&
    suiviTable.includes('"a_verifier"') &&
    suiviTable.includes('"toutes"'),
);
check(
  "H. filtre Origine : Toutes / PSP / Hors PSP",
  suiviTable.includes('value="psp"') && suiviTable.includes('value="hors_psp"'),
);
check(
  "H2. recherche TR / adresse / CC / corps / commande / fournisseur / nature",
  suiviTable.includes("TR / adresse / CC"),
);
check(
  "I. état SANS COMMANDE : aucune commande",
  deriverEtatSuiviAnnuel({ numeroCommande: null, engage: null, paye: null }) === "sans_commande",
);
check(
  "I2. état EN COURS : commande + payé vide",
  deriverEtatSuiviAnnuel({ numeroCommande: "4581335", engage: 1000, paye: null }) === "en_cours",
);
check(
  "J. état EN COURS : payé < engagé",
  deriverEtatSuiviAnnuel({ numeroCommande: "4581335", engage: 1000, paye: 400 }) === "en_cours",
);
check(
  "K. état TERMINÉE : payé = engagé (tolérance 0,01)",
  deriverEtatSuiviAnnuel({ numeroCommande: "4581335", engage: 1000, paye: 1000 }) === "terminee" &&
    deriverEtatSuiviAnnuel({ numeroCommande: "4581335", engage: 1000.004, paye: 1000 }) ===
      "terminee",
);
check(
  "L. état À VÉRIFIER : payé > engagé",
  deriverEtatSuiviAnnuel({ numeroCommande: "4581335", engage: 1000, paye: 1500 }) === "a_verifier",
);
check(
  "L2. état À VÉRIFIER : engagé vide alors qu'une commande existe",
  deriverEtatSuiviAnnuel({ numeroCommande: "4581335", engage: null, paye: null }) === "a_verifier",
);
check(
  "L3. état À VÉRIFIER : montants non numériques",
  deriverEtatSuiviAnnuel({ numeroCommande: "4581335", engage: "abc", paye: 10 }) === "a_verifier",
);
check(
  "M. changement d'année : le registre est rechargé (queryKey inclut l'année)",
  routeSuivi.includes('["psp-suivi-annuel", annee]'),
);
check(
  "M2. années disponibles = exercices réels des commandes + années de préparation",
  supabaseFn.includes("anneesDisponibles") && supabaseFn.includes("annee_exercice"),
);

// ════════════ N. PRÉPARATION 2027 ≠ SUIVI 2026 (§9/§19) ══════════════════════
check(
  "N. le registre n'inclut une opération PSP que si elle est programmée sur l'année ou hors PSP",
  supabaseFn.includes("progAnnee <= 0") &&
    supabaseFn.includes('ligne.origine === "hors_psp"') &&
    supabaseFn.includes("commandeLiee"),
);
check(
  "N2. les commandes sont filtrées par l'exercice (jamais une commande 2026 en 2027)",
  supabaseFn.includes('.eq("annee_exercice", annee)') && supabaseFn.includes('.eq("actif", true)'),
);
check(
  "N3. les commandes non liées apparaissent avec leur année réelle (source annuelle)",
  suiviView.includes("annee_exercice: number | null"),
);

// ════════════ O–V. DEVIS / COMMANDE / RAPPROCHEMENT / HORS PSP ═══════════════
check(
  "O. demande de devis sans montant ≠ devis reçu (distinction psp_devis)",
  supabaseFn.includes("demande_envoyee") && supabaseFn.includes("date_devis"),
);
check(
  "P. devis reçu avec montant (CAS B — montant connu avant commande)",
  supabaseFn.includes("montant: z.number().positive().nullish()"),
);
check("Q. relance historisée (operation 'relance')", supabaseFn.includes('operation: "relance"'));
check(
  "R. préparation → ligne annuelle : même table psp_lignes, aucune ligne parallèle",
  supabaseFn.includes('.from("psp_lignes")') && routeSuivi.includes("getPspSuiviOperations"),
);
check(
  "S. commande importée lue en lecture seule (aucune écriture travaux_commandes)",
  !supabaseFn.includes('.from("travaux_commandes").insert'),
);
check(
  "T. rapprochement commande → opération existante (psp_command_links)",
  supabaseFn.includes('.from("psp_command_links")') && supabaseFn.includes("Rattachement manuel"),
);
check(
  "U. aucune deuxième opération créée par le registre (aucun insert psp_lignes dans getPspSuiviAnnuel)",
  !supabaseFn.includes('.from("psp_lignes").insert'),
);
check(
  "V. opération hors PSP : origine hors_psp + programmation_id NULL",
  supabaseFn.includes('origine: "hors_psp"') && supabaseFn.includes("programmation_id: null"),
);
check(
  // V8.6.2 — plus de création manuelle générique dans /suivi : une opération
  // annuelle sans commande est MATÉRIALISÉE par l'import (origine='suivi').
  "V2. aucune création manuelle dans /suivi — matérialisation à l'import (origine 'suivi')",
  !routeSuivi.includes("NouvelleOperationDialog") &&
    !routeSuivi.includes("Nouvelle opération") &&
    travauxFn.includes("materialiserLignesSansCommande") &&
    travauxFn.includes('origine: "suivi"'),
);

// ════════════ W–AD. ÉTAT DÉRIVÉ / INTANGIBILITÉ / MOCK / PURGE ═══════════════
check(
  "W. état de suivi DÉRIVÉ des montants réels (aucun statut stocké inventé)",
  suiviView.includes("deriverEtatSuiviAnnuel") && suiviView.includes("Math.abs(p - e) < 0.01"),
);
check(
  "X. données importées READ-ONLY (aucune écriture sur les tables d'import)",
  !supabaseFn.includes('.from("travaux_commandes").update'),
);
check(
  "Y. Dashboard inchangé : aucune référence au dashboard dans les fichiers V8.6.1",
  !suiviTable.includes("dashboard-travaux"),
);
check(
  "Z. tables d'import intangibles (aucun insert/update/delete)",
  [
    "travaux_commandes_historique",
    "import_travaux",
    "imports",
    "psp_imports",
    "psp_import_rows",
  ].every((t) => !supabaseFn.includes(`.from("${t}").insert`)),
);
check(
  "AA. aucun MOCK dans les fichiers V8.6.1 (aucune constante de fixture MOCK)",
  !routeSuivi.includes("_MOCK") &&
    !suiviView.includes("_MOCK") &&
    !suiviTable.includes("_MOCK") &&
    !supabaseFn.includes("_MOCK"),
);
check(
  "AB. rafraîchissement navigateur : le registre est rechargé via react-query (année dans la queryKey)",
  routeSuivi.includes('["psp-suivi-annuel", annee]'),
);
check(
  "AC. fermeture/réouverture fiche conservée (Dialog onOpenChange)",
  fiche.includes("onOpenChange"),
);

// ════════════ AD. PURGE COMPLÈTE (préparée par le test live) ═════════════════
const livePath = join(__dirname, "test-psp-v861-live.mjs");
const liveExiste = (() => {
  try {
    readFileSync(livePath, "utf8");
    return true;
  } catch {
    return false;
  }
})();
check("AD. le test live existe", liveExiste);
if (liveExiste) {
  const liveSrc = readFileSync(livePath, "utf8");
  check(
    "AD. le test live prévoit une purge complète (bloc PURGE + delete)",
    liveSrc.includes("PURGE") && liveSrc.includes("delete"),
  );
  check(
    "AD. le test live vérifie l'intégrité des tables intangibles avant/après",
    liveSrc.includes("INTÉGRITÉ") || liveSrc.includes("INTEGRITE"),
  );
}
console.log(`\nV8.6.1 PUR : ${passed} ok, ${failed} échec(s)`);
if (failed > 0) process.exit(1);
