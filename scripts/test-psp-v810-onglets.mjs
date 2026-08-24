// ═══════════════════════════════════════════════════════════════════════════════
// V8.10 — ONGLETS /suivi : SUIVI ANNUEL 2026 (sans commande) + PSP 2027,
// avec filtres d'avancement devis (sans devis / attente de devis / devis reçus).
// Exécution : node scripts/test-psp-v810-onglets.mjs
// ═══════════════════════════════════════════════════════════════════════════════
// Points :
//   A. avancementDevis : 3 états dérivés (sans / attente / reçus) ;
//   B. filtrerAvancementDevis : filtre générique + « toutes » ;
//   C. operationSurAnnee : sélection des opérations programmées 2027 ;
//   D. mapping LigneDemandeDevis depuis le registre annuel (sans commande) ;
//   E. mapping LigneDemandeDevis depuis une vue opération (PSP 2027) ;
//   F. /suivi : deux onglets (Tabs), années figées, sélecteur d'année retiré ;
//   G. /suivi : onglet 1 = opérations 2026 sans commande (registre V8.8.3) ;
//   H. import : invalidation du cache /suivi après import (mise à jour onglet 1).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  avancementDevis,
  AVANCEMENT_DEVIS_LABELS,
  filtrerAvancementDevis,
  ligneDemandeDevisDepuisOperation,
  ligneDemandeDevisDepuisRegistre,
  operationSurAnnee,
} from "../src/lib/psp.suivi.view.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = (p) => join(__dirname, "..", "src", p);
const fichier = (p) => readFileSync(src(p), "utf8");

const vueFn = fichier("lib/psp.suivi.view.ts");
const suiviFn = fichier("routes/suivi.tsx");
const importFn = fichier("routes/import-travaux.tsx");
const tableau = fichier("components/suivi/TableauDemandesDevis.tsx");

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

// ════════════ A. AVANCEMENT DEVIS (dérivé — aucun état inventé) ══════════════
check(
  "A1. aucune demande ni devis → « sans_devis »",
  avancementDevis({ nb_demandes: 0, nb_devis_recus: 0 }) === "sans_devis",
);
check(
  "A2. demande(s) envoyée(s), aucun devis reçu → « attente_devis »",
  avancementDevis({ nb_demandes: 2, nb_devis_recus: 0 }) === "attente_devis",
);
check(
  "A3. au moins un devis reçu → « devis_recus » (même si d'autres demandes en attente)",
  avancementDevis({ nb_demandes: 3, nb_devis_recus: 1 }) === "devis_recus",
);
check(
  "A4. labels français des 3 états",
  AVANCEMENT_DEVIS_LABELS.sans_devis === "Sans devis" &&
    AVANCEMENT_DEVIS_LABELS.attente_devis === "Attente de devis" &&
    AVANCEMENT_DEVIS_LABELS.devis_recus === "Devis reçus",
);

// ════════════ B. FILTRE D'AVANCEMENT (générique) ═════════════════════════════
const lignesTest = [
  { key: "a", consultation: { nb_demandes: 0, nb_devis_recus: 0 } },
  { key: "b", consultation: { nb_demandes: 1, nb_devis_recus: 0 } },
  { key: "c", consultation: { nb_demandes: 2, nb_devis_recus: 1 } },
  { key: "d", consultation: { nb_demandes: 0, nb_devis_recus: 2 } },
];
check(
  "B1. filtre « sans_devis » → uniquement les lignes sans demande",
  filtrerAvancementDevis(lignesTest, "sans_devis")
    .map((l) => l.key)
    .join() === "a",
);
check(
  "B2. filtre « attente_devis » → demandes envoyées sans devis reçu",
  filtrerAvancementDevis(lignesTest, "attente_devis")
    .map((l) => l.key)
    .join() === "b",
);
check(
  "B3. filtre « devis_recus » → au moins un devis reçu (c et d)",
  filtrerAvancementDevis(lignesTest, "devis_recus")
    .map((l) => l.key)
    .join() === "c,d",
);
check(
  "B4. filtre « toutes » → aucune exclusion",
  filtrerAvancementDevis(lignesTest, "toutes").length === lignesTest.length,
);

// ════════════ C. OPÉRATION SUR ANNÉE (PSP 2027) ═════════════════════════════
const operation2027 = {
  identite: { id: "op-2", tranche: "TR2", origine: "psp" },
  programmation: {
    adresse: "2 rue B",
    cc: "CC-B",
    corps_etat: "VRD",
    nature: "Voirie",
    annees: [
      { annee: 2027, montant: 30000 },
      { annee: 2028, montant: 10000 },
    ],
  },
  consultation: {
    nb_demandes: 1,
    nb_devis_recus: 0,
    statut: "demande_envoyee",
    statut_label: "Demande envoyée",
  },
};
check(
  "C1. opération programmée 2027 → sélectionnée",
  operationSurAnnee(operation2027, 2027) === true,
);
check(
  "C2. opération non programmée 2026 → exclue",
  operationSurAnnee(operation2027, 2026) === false,
);
check(
  "C3. opération programmée 2028 seulement → exclue de 2027",
  operationSurAnnee({ programmation: { annees: [{ annee: 2028, montant: 5000 }] } }, 2027) ===
    false,
);

// ════════════ D. MAPPING DEPUIS LE REGISTRE ANNUEL (sans commande) ═══════════
const registreSansCommande = {
  id: "reg-1",
  pspLigneId: "op-1",
  tranche: "TR1",
  adresse: "1 rue A",
  cc: "CC-A",
  corps_etat: "Étanchéité",
  nature: "Réfection toiture",
  origine: "psp",
  programme_annee: 25000,
  budget: null,
  consultation: {
    nb_demandes: 0,
    nb_devis_recus: 0,
    statut: "pas_consulte",
    statut_label: "Aucune demande",
  },
};
const d = ligneDemandeDevisDepuisRegistre(registreSansCommande);
check("D1. pspLigneId conservé (fiche ouvrable)", d.pspLigneId === "op-1");
check("D2. montant = programme_annee (programmé 2026)", d.montant === 25000);
check("D3. avancement dérivé = sans_devis", d.avancement === "sans_devis");
check(
  "D4. opération hors programme → montant nul",
  ligneDemandeDevisDepuisRegistre({ ...registreSansCommande, programme_annee: null, budget: null })
    .montant === null,
);

// ════════════ E. MAPPING DEPUIS UNE VUE OPÉRATION (PSP 2027) ════════════════
const e = ligneDemandeDevisDepuisOperation(operation2027, 2027);
check("E1. montant = programmé 2027 (pas 2028)", e.montant === 30000);
check("E2. avancement dérivé = attente_devis", e.avancement === "attente_devis");
check("E3. pspLigneId = id de l'opération", e.pspLigneId === "op-2");

// ════════════ F. /suivi — DEUX ONGLETS, ANNÉES FIGÉES ═══════════════════════
check(
  "F1. deux onglets Tabs (Suivi annuel + PSP)",
  suiviFn.includes('<Tabs defaultValue="suivi-annuel">') &&
    suiviFn.includes('<TabsTrigger value="suivi-annuel">') &&
    suiviFn.includes('<TabsTrigger value="psp-2027">'),
);
check(
  "F2. années figées par onglet",
  suiviFn.includes("ANNEE_SUIVI = 2026") && suiviFn.includes("ANNEE_PSP = 2027"),
);
check(
  "F3. sélecteur d'année retiré",
  !suiviFn.includes("setAnnee(") && !suiviFn.includes("Select value={String(annee)}"),
);
check(
  "F4. onglet 1 alimenté par le registre annuel (annee=ANNEE_SUIVI)",
  suiviFn.includes('queryKey: ["psp-suivi-annuel", ANNEE_SUIVI]') &&
    suiviFn.includes("fetchRegistre({ data: { annee: ANNEE_SUIVI } })"),
);

// ════════════ G. ONGLET 1 = OPÉRATIONS 2026 SANS COMMANDE ═══════════════════
check(
  "G1. filtre « opération + sans_commande » sur les lignes du registre",
  suiviFn.includes('l.type === "operation" && l.etat_annuel === "sans_commande"'),
);
check(
  "G2. tableau partagé TableauDemandesDevis + onglet 2 = operationSurAnnee 2027",
  suiviFn.includes("TableauDemandesDevis") &&
    suiviFn.includes("operationSurAnnee(o, ANNEE_PSP)") &&
    suiviFn.includes("ligneDemandeDevisDepuisOperation(o, ANNEE_PSP)"),
);
check(
  "G3. vue pure exposée : avancementDevis + LigneDemandeDevis + mapping registre",
  vueFn.includes("export const avancementDevis") &&
    vueFn.includes("export type LigneDemandeDevis") &&
    vueFn.includes("export const ligneDemandeDevisDepuisRegistre"),
);

// ════════════ H. IMPORT → INVALIDATION DU CACHE /suivi ══════════════════════
check(
  "H1. après import, invalidation du registre annuel + opérations",
  importFn.includes('invalidateQueries({ queryKey: ["psp-suivi-annuel"] })') &&
    importFn.includes('invalidateQueries({ queryKey: ["psp-suivi-operations"] })'),
);

// ════════════ I. TABLEAU — FILTRE AVANCEMENT VISIBLE (3 états) ══════════════
check(
  "I1. le tableau expose les 3 états du filtre d'avancement",
  tableau.includes("AVANCEMENT_DEVIS_OPTIONS") &&
    tableau.includes("AVANCEMENT_DEVIS_LABELS") &&
    tableau.includes("filtrerAvancementDevis"),
);

console.log(`\nV8.10 ONGLETS PUR — ${passed} ok / ${failed} échec(s)`);
process.exit(failed === 0 ? 0 : 1);
