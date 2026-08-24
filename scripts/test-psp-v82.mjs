// ═══════════════════════════════════════════════════════════════════════════════
// V8.2 — SUIVI OPÉRATION (tests PURS) :
//  A. filtres · B. KPI · C. comparatif devis · D. tri · E. année programmation ·
//  F. aucune collision TR+C (identité = id) · G. aucun MOCK · H. statsDevis élargi ·
//  I. structure de la route (arborescence) · J. etatMetier inchangé · K. mailto.
// Exécution : node scripts/test-psp-v82.mjs
// ═══════════════════════════════════════════════════════════════════════════════
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  construireSuiviOperation,
  construireMailto,
  composerMail,
  MAIL_MODELES,
} from "../src/lib/psp.suivi.foundation.ts";
import {
  FILTRES_SUIVI_VIDES,
  comparatifDevis,
  filtrerOperationsSuivi,
  kpiSuivi,
  operationSurAnnee,
  trierOperationsSuivi,
} from "../src/lib/psp.suivi.view.ts";
import { statsDevis } from "../src/lib/psp.prep.ts";
import { etatMetier } from "../src/lib/travaux.ts";

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
  corps_etat_code: "ce-couv",
  corps_etat: "Couverture",
  nature_travaux: "Réfection toiture",
  programme: { 2027: 150000, 2028: 0, 2029: 0, 2030: 0, 2031: 0 },
  ligne_budget: null,
  remarques: null,
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
  patrimoine: { adresse: "10 rue des Lilas", cc: "CC1977" },
  programmationStatut: "brouillon",
  exercice: 2026,
});

const opChauffage = construireSuiviOperation({
  ligne: ligne({
    id: "ligne-2",
    corps_etat: "Chauffage",
    nature_travaux: "Remplacement chaudières",
    programme: { 2027: 0, 2028: 95000 },
  }),
  patrimoine: { adresse: "20 rue des Roses", cc: "CC1977" },
  exercice: 2026,
});

const opSansCommande = construireSuiviOperation({
  ligne: ligne({
    id: "ligne-3",
    tranche_code: "1950",
    categorie: "CP",
    programme: { 2027: 0, 2028: 0, 2029: 0, 2030: 0, 2031: 0 },
  }),
  exercice: 2026,
});

const operations = [opToiture, opChauffage, opSansCommande]; // ── A. Filtres simplifiés (V8.2.2 : recherche / origine / état) ─────────────
console.log("\nA. filtres (recherche / origine / état)");
{
  check(
    "tous (aucun filtre)",
    filtrerOperationsSuivi(operations, FILTRES_SUIVI_VIDES).length === 3,
  );
  check(
    "recherche Chauffage → 1",
    filtrerOperationsSuivi(operations, { ...FILTRES_SUIVI_VIDES, recherche: "Chauffage" })
      .length === 1,
  );
  check(
    "recherche ENTREPRISE A → 1 (commande liée)",
    filtrerOperationsSuivi(operations, { ...FILTRES_SUIVI_VIDES, recherche: "ENTREPRISE A" })
      .length === 1,
  );
  check(
    "recherche 123456 (n° commande) → 1",
    filtrerOperationsSuivi(operations, { ...FILTRES_SUIVI_VIDES, recherche: "123456" }).length ===
      1,
  );
  check(
    "origine PSP → 3",
    filtrerOperationsSuivi(operations, { ...FILTRES_SUIVI_VIDES, origine: "psp" }).length === 3,
  );
  check(
    "origine hors_psp → 0 (aucune ligne hors PSP en base)",
    filtrerOperationsSuivi(operations, { ...FILTRES_SUIVI_VIDES, origine: "hors_psp" }).length ===
      0,
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

// ── B. KPI (V8.2.2 : 7 KPI limités) ────────────────────────────────────────
console.log("\nB. KPI");
{
  const k = kpiSuivi(operations);
  check("opérations = 3", k.operations === 3);
  check("budget programmé = 245000", k.budgetProgramme === 245000);
  check("commandé = 143500", k.budgetCommande === 143500);
  check("engagé = 140000", k.budgetEngage === 140000);
  check("payé = 75000", k.budgetPaye === 75000);
  check("travaux en cours = 1", k.travauxEnCours === 1);
  check("terminées = 0", k.terminees === 0);
  check("aucun MOCK (3200000 absent)", JSON.stringify(k).includes("3200000") === false);
}

// ── C. Comparatif devis ──────────────────────────────────────────────────────
console.log("\nC. comparatif devis");
{
  const c = comparatifDevis([
    devis({ id: "d1", montant: 80000, statut: "recu", date_devis: "2026-08-27" }),
    devis({ id: "d2", montant: 90000, statut: "recu", date_devis: "2026-08-28" }),
    devis({ id: "d3", montant: null, statut: "demande_envoyee" }),
    devis({ id: "d4", montant: 95000, statut: "retenu", date_devis: "2026-08-29" }),
  ]);
  check("2 devis reçus", c.nb_devises === 2);
  check("1 demande sans montant (normal)", c.nb_sans_montant === 1);
  check("min = 80000", c.min === 80000);
  check("max = 95000 (retenu inclus)", c.max === 95000);
  check("devis retenu identifié", c.retenu?.id === "d4");
  const vide = comparatifDevis([]);
  check("aucun devis → min/moy/max null", vide.min === null && vide.max === null);
}
// ── D. Tri ───────────────────────────────────────────────────────────────────
console.log("\nD. tri");
{
  const parTranche = trierOperationsSuivi(operations, "tranche", true);
  check(
    "tri TR asc → 1950, 1977, 1977",
    parTranche.map((o) => o.identite.tranche).join(",") === "1950,1977,1977",
  );
  const parMontantDesc = trierOperationsSuivi(operations, "montant", false);
  check(
    "tri montant desc → 150000 en premier",
    parMontantDesc[0]?.programmation.montant_total === 150000,
  );
}

// ── E. Année de programmation ────────────────────────────────────────────────
console.log("\nE. année de programmation");
{
  check("toiture sur 2027", operationSurAnnee(opToiture, 2027) === true);
  check("toiture pas sur 2028", operationSurAnnee(opToiture, 2028) === false);
  check("chauffage sur 2028", operationSurAnnee(opChauffage, 2028) === true);
}

// ── F. aucune collision TR+C (identité = id) ─────────────────────────────────
console.log("\nF. aucune collision TR+C");
{
  check("ids distincts (même TR+C)", opToiture.identite.id !== opChauffage.identite.id);
  check(
    "natures distinctes conservées",
    opToiture.programmation.nature === "Réfection toiture" &&
      opChauffage.programmation.nature === "Remplacement chaudières",
  );
}

// ── G. aucun MOCK ────────────────────────────────────────────────────────────
console.log("\nG. aucun MOCK");
{
  check("aucune valeur 3200000", JSON.stringify(operations).includes("3200000") === false);
  check(
    "sources réelles",
    operations.every((o) => o.source.donnees_reelles === true && o.source.mock === false),
  );
}

// ── H. statsDevis élargi (V7.10 réutilisé) ───────────────────────────────────
console.log("\nH. statsDevis élargi");
{
  const s = statsDevis([
    { montant: 100 },
    { montant: 200 },
    { montant: null },
    { montant: undefined },
  ]);
  check("ignore les montants null", s?.min === 100 && s?.max === 200 && s?.moyenne === 150);
  check("tous null → null", statsDevis([{ montant: null }]) === null);
}

// ── I. structure de la route /suivi (arborescence) ───────────────────────────
console.log("\nI. structure de la route /suivi");
{
  const route = source("src/routes/suivi.tsx");
  const fiche = source("src/components/suivi/SuiviOperationFiche.tsx");
  const tableau = source("src/components/suivi/SuiviTable.tsx");
  check("route /suivi définie", route.includes('"/suivi"'));
  check("arborescence : Programmation", fiche.includes("Programmation"));
  check(
    "arborescence : Consultation + Entreprises suggérées",
    fiche.includes("Consultation") && fiche.includes("Entreprises suggérées"),
  );
  check(
    "arborescence : Devis (comparatif)",
    fiche.includes("Devis") && fiche.includes("comparatif"),
  );
  check("arborescence : Commandes", fiche.includes("Commandes"));
  check("arborescence : Travaux / Exécution", fiche.includes("Travaux"));
  check("aucun MOCK dans la route", route.includes("SUIVI_2026_MOCK") === false);
  check("tableau : KPI + filtres", tableau.includes("KPI") && tableau.includes("recherche"));
  check("tableau : état vide explicite", tableau.includes("Aucune donnée disponible.") === true);
}

// ── J. moteur état (etatMetier) inchangé ─────────────────────────────────────
console.log("\nJ. Dashboard inchangé (etatMetier)");
{
  check(
    "Terminés → Terminés",
    etatMetier({ etat_travaux: "Terminés", etat_commande: null, engage: 0 }, 2026) === "Terminés",
  );
  check(
    "En cours + engagé → En cours",
    etatMetier({ etat_travaux: "En cours", etat_commande: null, engage: 12000 }, 2026) ===
      "En cours",
  );
}

// ── K. moteur mailto/mail intact ─────────────────────────────────────────────
console.log("\nK. moteur mailto/mail intact");
{
  const compose = composerMail(
    MAIL_MODELES.find((m) => m.id === "demande_devis"),
    {
      TR: "1977",
      NATURE_TRAVAUX: "Toiture",
      CORPS_ETAT: "Couverture",
      ADRESSE: "10 rue des Lilas",
      DATE_RETOUR: "2026-09-10",
    },
  );
  check("sujet composé", compose.sujet === "Demande de devis – 1977 – Toiture");
  const mailto = construireMailto({ email: null, sujet: compose.sujet, corps: compose.corps });
  check("mailto généré", mailto.startsWith("mailto:") && mailto.includes("subject="));
}

// ── Résultat ──────────────────────────────────────────────────────────────────
console.log(`\nRésultat : ${passed} ok, ${failed} échec(s)`);
if (failed > 0) process.exit(1);
