// ═══════════════════════════════════════════════════════════════════════════════
// V8.2.2 — RESTRUCTURATION (tests PURS + source) :
//  A. origine dérivée (psp / hors_psp) · B. sous_secteur exposé ·
//  C. filtres simplifiés (recherche / origine / état) · D. KPI limités (7) ·
//  E. tableau 10 colonnes sans financier · F. route renommée « Opérations » ·
//  G. pas de duplication (enveloppes/commandes restent ailleurs) ·
//  H. identité psp_lignes.id (aucune clé TR+C) · I. aucun MOCK.
// Exécution : node scripts/test-psp-v822.mjs
// ═══════════════════════════════════════════════════════════════════════════════
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { construireSuiviOperation } from "../src/lib/psp.suivi.foundation.ts";
import {
  FILTRES_SUIVI_VIDES,
  filtrerOperationsSuivi,
  kpiSuivi,
} from "../src/lib/psp.suivi.view.ts";

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

const lien = (over = {}) => ({
  id: "44444444-4444-4444-8444-444444444444",
  commande_id: "55555555-5555-4555-8555-555555555555",
  psp_ligne_id: "11111111-1111-4111-8111-111111111111",
  type_relation: "rattachement_ligne",
  methode: "auto",
  confiance: 1,
  statut: "valide",
  justification: "test",
  ...over,
});

const commande = (over = {}) => ({
  id: "55555555-5555-4555-8555-555555555555",
  numero_commande: "123456",
  tranche_code: "1977",
  fournisseur: "ENTREPRISE A",
  descriptif: "Réfection toiture",
  corps_etat: "Couverture",
  etat_commande: "En cours",
  etat_travaux: "En cours",
  budget: 143500,
  engage: 140000,
  paye: 75000,
  solde: 65000,
  date_import: "2026-03-15T09:00:00Z",
  date_demarrage: "2026-04-01",
  date_fin_travaux: null,
  annee_exercice: 2026,
  ...over,
});

const opToiture = construireSuiviOperation({
  ligne: ligne(),
  devis: [devis()],
  liens: [lien()],
  commandes: [commande()],
  patrimoine: { adresse: "10 rue des Lilas", cc: "CC1977", sous_secteur: "MEAUX-NORD" },
  programmationStatut: "brouillon",
  exercice: 2026,
});

const opChauffage = construireSuiviOperation({
  ligne: ligne({
    id: "ligne-2",
    corps_etat: "Chauffage",
    nature_travaux: "Chauffage",
    programme: { 2028: 95000 },
  }),
  patrimoine: { adresse: "20 rue des Roses", cc: "CC1977", sous_secteur: "MEAUX-NORD" },
  exercice: 2026,
});

const opHorsPsp = construireSuiviOperation({
  ligne: ligne({
    id: "ligne-3",
    tranche_code: "1950",
    categorie: "CP",
    origine: "hors_psp",
    programme: {},
  }),
  exercice: 2026,
});

const operations = [opToiture, opChauffage, opHorsPsp]; // ── A/B — origine + sous-secteur ─────────────────────────────────────────────
console.log("\nA/B. origine + sous-secteur");
{
  check("A. origine PSP dérivée (preparation)", opToiture.identite.origine === "psp");
  check("A. origine HORS_PSP dérivée", opHorsPsp.identite.origine === "hors_psp");
  check("B. sous_secteur exposé", opToiture.programmation.sous_secteur === "MEAUX-NORD");
  check("B. sous_secteur null si absent", opHorsPsp.programmation.sous_secteur === null);
  check(
    "B. identité inchangée (id)",
    opToiture.identite.id === "11111111-1111-4111-8111-111111111111",
  );
}

// ── C — filtres simplifiés ───────────────────────────────────────────────────
console.log("\nC. filtres simplifiés (recherche / origine / état)");
{
  check(
    "tous (aucun filtre) → 3",
    filtrerOperationsSuivi(operations, FILTRES_SUIVI_VIDES).length === 3,
  );
  check(
    "recherche Chauffage → 1",
    filtrerOperationsSuivi(operations, { ...FILTRES_SUIVI_VIDES, recherche: "Chauffage" })
      .length === 1,
  );
  check(
    "recherche ENTREPRISE A → 1",
    filtrerOperationsSuivi(operations, { ...FILTRES_SUIVI_VIDES, recherche: "ENTREPRISE A" })
      .length === 1,
  );
  check(
    "recherche 123456 (n° commande) → 1",
    filtrerOperationsSuivi(operations, { ...FILTRES_SUIVI_VIDES, recherche: "123456" }).length ===
      1,
  );
  check(
    "recherche MEAUX-NORD (sous-secteur) → 2",
    filtrerOperationsSuivi(operations, { ...FILTRES_SUIVI_VIDES, recherche: "MEAUX-NORD" })
      .length === 2,
  );
  check(
    "origine PSP → 2",
    filtrerOperationsSuivi(operations, { ...FILTRES_SUIVI_VIDES, origine: "psp" }).length === 2,
  );
  check(
    "origine hors_psp → 1",
    filtrerOperationsSuivi(operations, { ...FILTRES_SUIVI_VIDES, origine: "hors_psp" }).length ===
      1,
  );
  check(
    "état consultation → 1",
    filtrerOperationsSuivi(operations, { ...FILTRES_SUIVI_VIDES, etat: "consultation" }).length ===
      1,
  );
  check(
    "état commande → 1",
    filtrerOperationsSuivi(operations, { ...FILTRES_SUIVI_VIDES, etat: "commande" }).length === 1,
  );
  check(
    "état travaux_en_cours → 1",
    filtrerOperationsSuivi(operations, { ...FILTRES_SUIVI_VIDES, etat: "travaux_en_cours" })
      .length === 1,
  );
  check(
    "état travaux_termines → 0",
    filtrerOperationsSuivi(operations, { ...FILTRES_SUIVI_VIDES, etat: "travaux_termines" })
      .length === 0,
  );
}

// ── D — KPI limités (7) ──────────────────────────────────────────────────────
console.log("\nD. KPI limités (7)");
{
  const k = kpiSuivi(operations);
  check("opérations = 3", k.operations === 3);
  check("budget programmé = 245000", k.budgetProgramme === 245000);
  check("commandé = 143500", k.budgetCommande === 143500);
  check("engagé = 140000", k.budgetEngage === 140000);
  check("payé = 75000", k.budgetPaye === 75000);
  check("travaux en cours = 1", k.travauxEnCours === 1);
  check("terminées = 0", k.terminees === 0);
  check(
    "aucun champ redondant (sansCommande/relances absents)",
    "sansCommande" in k === false && "relances" in k === false,
  );
}

// ── E/F/G — source : tableau simplifié + route « Opérations » ────────────────
console.log("\nE/F/G. tableau + route (source)");
{
  const tableau = source("src/components/suivi/SuiviTable.tsx");
  const route = source("src/routes/suivi.tsx");
  const fiche = source("src/components/suivi/SuiviOperationFiche.tsx");
  check(
    "E. colonnes simplifiées (10)",
    [
      "Opération",
      "TR",
      "Sous-secteur",
      "CC",
      "Corps d&apos;état",
      "Programmation",
      "Consultation",
      "Devis",
      "Commande",
      "Travaux",
    ].every((c) => tableau.includes(c)),
  );
  check(
    "E. aucun financier par ligne (budget/engagé/payé absents du tableau)",
    tableau.includes("Cmd ") === false && tableau.includes("Eng ") === false,
  );
  check(
    "E. 7 KPI seulement",
    [
      "Opérations",
      "Budget programmé",
      "Commandé",
      "Engagé",
      "Payé",
      "Travaux en cours",
      "Terminées",
    ].every((c) => tableau.includes(c)),
  );
  check(
    "E. 3 filtres (recherche/origine/état)",
    tableau.includes("Recherche") && tableau.includes("Origine") && tableau.includes("État"),
  );
  check(
    "F. route nommée « Opérations »",
    route.includes("Opérations") && route.includes("Suivi opérations") === false,
  );
  check("F. navigation « Opérations »", source("src/routes/index.tsx").includes("Opérations"));
  check(
    "G. fiche organisée par parcours (Identité/Programmation/Consultation/Devis/Commandes/Travaux)",
    ["Identité", "Programmation", "Consultation", "Devis", "Commandes", "Travaux"].every((s) =>
      fiche.includes(s),
    ),
  );
  check(
    "G. pas de gestion d'enveloppes dans /suivi",
    fiche.includes("Enveloppes") === false && tableau.includes("Enveloppes") === false,
  );
  check(
    "G. aucune page d'import dans /suivi",
    route.includes("/import-travaux") === false && route.includes("/import-psp") === false,
  );
}

// ── H/I — identité + aucun MOCK ──────────────────────────────────────────────
console.log("\nH/I. identité + aucun MOCK");
{
  const l2 = ligne({ id: "autre-id", corps_etat: "Chauffage", nature_travaux: "Chauffage" });
  check(
    "H. identités distinctes (jamais TR+C)",
    construireSuiviOperation({ ligne: l2, exercice: 2026 }).identite.id !== opToiture.identite.id,
  );
  check("I. aucune valeur MOCK", JSON.stringify(operations).includes("3200000") === false);
  check(
    "I. sources réelles",
    operations.every((o) => o.source.donnees_reelles === true),
  );
}

// ── Résultat ──────────────────────────────────────────────────────────────────
console.log(`\nRésultat : ${passed} ok, ${failed} échec(s)`);
if (failed > 0) process.exit(1);
