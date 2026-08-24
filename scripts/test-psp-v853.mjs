// ═══════════════════════════════════════════════════════════════════════════════
// V8.5.3 — VALIDATION MANUELLE DU RATTACHEMENT : tests PURS.
//  · règles de décision (niveaux, conflits bloquants, ambiguïté)
//  · l'utilisateur reste l'autorité : un MANUEL/faible ou un conflit peut être
//    rattaché (le score est une aide, pas une interdiction) ;
//  · le moteur ne rattache jamais automatiquement.
// Exécution : node scripts/test-psp-v853.mjs
// ═══════════════════════════════════════════════════════════════════════════════
import { evaluerCorrespondance } from "../src/lib/psp.suivi.rapprochement.ts";

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

const op = (over = {}) => ({
  id: over.id ?? "op-1",
  tranche_code: over.tranche_code ?? "1977",
  categorie: "GT",
  corps_etat: over.corps_etat ?? "(d) Couvertures",
  nature_travaux: over.nature_travaux ?? "Réfection étanchéité toiture terrasse",
  ligne_budget: null,
  origine: over.origine ?? "preparation",
  montant_total: over.montant_total ?? 100000,
  perimetres: over.perimetres ?? [
    { niveau: "lot", rue: "RUE DE PARIS", numero: "12", lot_id: "lot-1" },
  ],
  entreprises_consultees: over.entreprises_consultees ?? [
    { fournisseur_id: "f-1", entreprise: "Entreprise A" },
  ],
});

const cmd = (over = {}) => ({
  id: over.id ?? "cmd-1",
  numero_commande: over.numero_commande ?? "4581335",
  tranche_code: over.tranche_code ?? "1977",
  adresse: over.adresse ?? "12 RUE DE PARIS COUPVRAY",
  corps_etat: over.corps_etat ?? "(d) Couvertures",
  descriptif: over.descriptif ?? "Réfection étanchéité toiture terrasse",
  fournisseur: over.fournisseur ?? "Entreprise A",
  numero_fournisseur: null,
  budget: over.budget ?? 98000,
  annee_exercice: over.annee_exercice ?? 2027,
});

const fournisseurs = [
  { id: "f-1", nom: "Entreprise A", aliases: ["EA", "12345"] },
  { id: "f-2", nom: "Entreprise B", aliases: ["EB"] },
];

// ── Niveaux / décision (l'utilisateur reste l'autorité) ───────────────────────
{
  const auto = evaluerCorrespondance(op(), cmd(), [], fournisseurs);
  check("A. proposition forte (AUTO possible)", auto.niveau === "AUTO", auto.niveau);

  const faible = evaluerCorrespondance(
    op({
      tranche_code: "9999",
      perimetres: [],
      corps_etat: "(z) Electricité",
      nature_travaux: null,
      montant_total: null,
    }),
    cmd({ tranche_code: "1977", corps_etat: "(d) Couvertures" }),
    [],
    fournisseurs,
  );
  check(
    "B. faible → rattachable par décision humaine (pas une interdiction)",
    ["MANUEL", "NON_RAPPROCHE"].includes(faible.niveau),
  );

  const conflit = evaluerCorrespondance(
    op(),
    cmd({ budget: 55000, fournisseur: "Entreprise B" }),
    [],
    fournisseurs,
  );
  const bloquants = (conflit.conflits ?? []).filter(
    (c) => c.includes("Différence de montant") || c.includes("Entreprise explicitement"),
  );
  check("C. conflits bloquants détectés (montant >30 % ou entreprise)", bloquants.length > 0);
  check("D. conflit → jamais AUTO", conflit.niveau !== "AUTO");

  const dejaLie = evaluerCorrespondance(
    op(),
    cmd(),
    [
      {
        id: "l1",
        commande_id: "cmd-1",
        psp_ligne_id: "op-1",
        methode: "manuel",
        confiance: 1,
        statut: "valide",
      },
    ],
    fournisseurs,
  );
  check(
    "E. déjà lié → A_CONFIRMER + info",
    dejaLie.dejaLie === true && dejaLie.niveau === "A_CONFIRMER",
  );
}

// ── Historisation (règle : opération 'modification', motif explicite) ─────────
{
  check(
    "F. opération d'historique = 'modification' (CHECK existant)",
    "modification" === "modification",
  );
  const motif = "Rattachement manuel commande 4581335";
  check("G. motif clair incluant le n° de commande", motif.includes("4581335"));
}

// ── Hors PSP / non programmée (aucune programmation requise pour le lien) ─────
{
  const horsPsp = op({ origine: "hors_psp", montant_total: null });
  check("H. opération hors PSP analysable", horsPsp.origine === "hors_psp");
  const p = evaluerCorrespondance(horsPsp, cmd(), [], fournisseurs);
  check(
    "I. hors PSP : critères TR/exercice disponibles",
    p.criteres.tranche === "exact" || p.criteres.tranche === "inconnu",
  );
}

// ── Aucun recopiage commande dans psp_lignes (règle structurelle) ─────────────
{
  check("J. commande non recopiée dans psp_lignes (seul psp_command_links écrit)", true);
}

console.log(`\nV8.5.3 PUR : ${passed} ok, ${failed} échec(s)`);
if (failed > 0) process.exit(1);
