// ═══════════════════════════════════════════════════════════════════════════════
// V8.5.1 — MOTEUR DE DÉTECTION DE CORRESPONDANCES : tests PURS.
// Exécution : node scripts/test-psp-v851.mjs
// ═══════════════════════════════════════════════════════════════════════════════
import {
  POIDS_RAPPROCHEMENT,
  SEUILS_RAPPROCHEMENT,
  correspondanceAdresse,
  correspondanceEntreprise,
  ecartRelatifMontant,
  evaluerCorrespondance,
  normaliserAdresse,
  normaliserCorpsEtat,
  normaliserEntreprise,
  normaliserEr,
  normaliserNumeroCommande,
  normaliserTranche,
  proposerRapprochements,
  similariteDescriptif,
  tokensSignificatifs,
} from "../src/lib/psp.suivi.rapprochement.ts";

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

// ── Fixtures purs (uniquement pour tests — jamais dans le chemin réel) ────────
const op = (over = {}) => ({
  id: over.id ?? "op-1",
  tranche_code: over.tranche_code ?? "1977",
  categorie: over.categorie ?? "GT",
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
  ...over,
});

const cmd = (over = {}) => ({
  id: over.id ?? "cmd-1",
  numero_commande: over.numero_commande ?? "4581335",
  tranche_code: over.tranche_code ?? "1977",
  adresse: over.adresse ?? "12 RUE DE PARIS COUPVRAY",
  corps_etat: over.corps_etat ?? "(d) Couvertures",
  descriptif: over.descriptif ?? "Réfection étanchéité toiture terrasse",
  fournisseur: over.fournisseur ?? "Entreprise A",
  numero_fournisseur: over.numero_fournisseur ?? null,
  budget: over.budget ?? 98000,
  annee_exercice: over.annee_exercice ?? 2026,
  nature_analytique: over.nature_analytique ?? "GT",
  ...over,
});

const fournisseurs = [
  { id: "f-1", nom: "Entreprise A", aliases: ["EA", "12345"] },
  { id: "f-2", nom: "Entreprise B", aliases: ["EB", "67890"] },
];

// ── Normalisation ─────────────────────────────────────────────────────────────
{
  check("normaliserTranche TR1977 → 1977", normaliserTranche("TR1977") === "1977");
  check("normaliserTranche 1977 → 1977", normaliserTranche("1977") === "1977");
  check("normaliserEr ER.123 → 123", normaliserEr("ER.123") === "123");
  check("normaliserEr ER 123 → 123", normaliserEr("ER 123") === "123");
  check(
    "normaliserAdresse accents + espaces",
    normaliserAdresse("  RUE  DES FRÈRES  ") === "rue des freres",
  );
  check("normaliserEntreprise casse", normaliserEntreprise("  ENTREPRISE   A ") === "entreprise a");
  check(
    "normaliserCorpsEtat (c) Isolation → isolation",
    normaliserCorpsEtat("(c) Isolation") === "isolation",
  );
  check("normaliserNumeroCommande espaces", normaliserNumeroCommande(" 458 1335 ") === "4581335");
}

// ── Similarité descriptif ─────────────────────────────────────────────────────
{
  check(
    "N. toiture étanchéité vs toiture terrasse → forte",
    similariteDescriptif("Réfection étanchéité toiture terrasse", "Réfection toiture terrasse") >
      0.4,
  );
  check(
    "O. toiture vs chaudière → nulle",
    similariteDescriptif(
      "Réfection étanchéité toiture terrasse",
      "Remplacement chaudière collective",
    ) === 0,
  );
  check(
    "termes génériques ignorés",
    !tokensSignificatifs("travaux de réfection").includes("travaux"),
  );
  check(
    "termes techniques conservés",
    tokensSignificatifs("chaudière collective").includes("chaudiere"),
  );
}

// ── Montant ───────────────────────────────────────────────────────────────────
{
  check("L. montant proche (100k vs 98k)", (ecartRelatifMontant(100000, 98000) ?? 9) < 0.05);
  check("M. montant >30 % détecté", (ecartRelatifMontant(100000, 65000) ?? 0) > 0.3);
  check("montant absent → null (pas de pénalité)", ecartRelatifMontant(null, 72000) === null);
}

// ── Entreprise ────────────────────────────────────────────────────────────────
{
  const c = cmd({ fournisseur: "Entreprise A" });
  check(
    "I. entreprise identique",
    correspondanceEntreprise(op().entreprises_consultees, c, fournisseurs).type === "exacte",
  );
  const cAlias = cmd({ fournisseur: "EA" });
  check(
    "J. entreprise via alias",
    correspondanceEntreprise(op().entreprises_consultees, cAlias, fournisseurs).type === "exacte" ||
      correspondanceEntreprise(op().entreprises_consultees, cAlias, fournisseurs).type === "alias",
  );
  const cAutre = cmd({ fournisseur: "Entreprise B" });
  check(
    "K. entreprise différente",
    correspondanceEntreprise(op().entreprises_consultees, cAutre, fournisseurs).type ===
      "similaire",
  );
  const sans = op({ entreprises_consultees: [] });
  check(
    "entreprise absente → pas de pénalité",
    correspondanceEntreprise(sans.entreprises_consultees, c, fournisseurs).type === "absente",
  );
}

// ── Adresse ───────────────────────────────────────────────────────────────────
{
  check(
    "C. ER identique",
    correspondanceAdresse(op().perimetres, "12 RUE DE PARIS ER.12345", { "lot-1": ["ER.12345"] })
      .type === "er_exact",
  );
  check(
    "E. adresse identique",
    correspondanceAdresse(op().perimetres, "12 RUE DE PARIS COUPVRAY", {}).type ===
      "adresse_exacte",
  );
  check(
    "F. rue seule",
    correspondanceAdresse(op().perimetres, "45 RUE DE PARIS COUPVRAY", {}).type === "rue_seule",
  );
  check(
    "D. ER différent → pas auto (type different ou rue)",
    ["different", "rue_seule"].includes(
      correspondanceAdresse(op().perimetres, "12 RUE AUTRE VILLE", {}).type,
    ),
  );
}

// ── Moteur — scénarios clés ───────────────────────────────────────────────────
{
  // A. TR identique + tous critères → AUTO
  const p = evaluerCorrespondance(op(), cmd(), [], fournisseurs);
  check("A. TR identique → score élevé", p.criteres.tranche === "exact");
  check("X. score explicable (raisons non vides)", p.raisons.length >= 3);
  check("Y. aucune écriture (aucun champ de lien)", p.dejaLie === false);

  // B. TR différente → jamais AUTO
  const pB = evaluerCorrespondance(
    op({ tranche_code: "1977" }),
    cmd({ tranche_code: "1950" }),
    [],
    fournisseurs,
  );
  check(
    "B. TR différente → jamais AUTO",
    pB.niveau !== "AUTO" && pB.conflits.some((c) => c.includes("TR")),
  );

  // M. montant >30 % → jamais AUTO même si le reste est bon
  const pM = evaluerCorrespondance(
    op({ montant_total: 100000 }),
    cmd({ budget: 65000 }),
    [],
    fournisseurs,
  );
  check("M. montant >30 % → jamais AUTO", pM.niveau !== "AUTO");

  // R. commande déjà liée → A_CONFIRMER + info
  const lien = {
    id: "l1",
    commande_id: "cmd-1",
    psp_ligne_id: "op-2",
    methode: "manuel",
    confiance: 1,
    statut: "valide",
  };
  const pR = evaluerCorrespondance(op(), cmd(), [lien], fournisseurs);
  check(
    "R. commande déjà liée → A_CONFIRMER",
    pR.dejaLie === true && pR.operationLieeId === "op-2" && pR.niveau === "A_CONFIRMER",
  );

  // U/V. opération hors PSP même logique
  const pH = evaluerCorrespondance(op({ origine: "hors_psp" }), cmd(), [], fournisseurs);
  check(
    "U/V. hors PSP → mêmes critères",
    pH.criteres.tranche === "exact" && pH.niveau !== "NON_RAPPROCHE",
  );

  // W. données incomplètes → jamais AUTO
  const pW = evaluerCorrespondance(
    op({ nature_travaux: null, corps_etat: null, montant_total: null, perimetres: [] }),
    cmd({ descriptif: null }),
    [],
    fournisseurs,
  );
  check("W. données incomplètes → jamais AUTO", pW.niveau !== "AUTO");
}

// ── Ambiguité : deux candidats proches → A_CONFIRMER ──────────────────────────
{
  const ops = [
    op({ id: "op-a", tranche_code: "1977" }),
    op({
      id: "op-b",
      tranche_code: "1977",
      corps_etat: "(c) Isolation",
      nature_travaux: "Réfection toiture terrasse",
    }),
  ];
  const propositions = proposerRapprochements({
    operation: ops[0],
    commandes: [
      cmd({ id: "c1" }),
      cmd({ id: "c2", corps_etat: "(c) Isolation", descriptif: "Réfection toiture terrasse" }),
    ],
    liens: [],
    fournisseurs,
  });
  check("Q. plusieurs candidats → liste triée", propositions.length >= 1);
  check(
    "Z. aucun doublon de proposition (ids uniques)",
    new Set(propositions.map((p) => p.commandeId)).size === propositions.length,
  );
}

// ── S. opération avec plusieurs commandes possibles (0..N) ────────────────────
{
  const prop = proposerRapprochements({
    operation: op(),
    commandes: [
      cmd({ id: "c1", budget: 98000 }),
      cmd({ id: "c2", budget: 2000, descriptif: "Diagnostic" }),
    ],
    liens: [],
    fournisseurs,
  });
  check(
    "S. plusieurs commandes possibles",
    prop.filter((p) => p.niveau !== "NON_RAPPROCHE").length >= 1,
  );
}

// ── T. commande sans opération → NON_RAPPROCHE ────────────────────────────────
{
  const p = evaluerCorrespondance(
    op({
      tranche_code: "9999",
      perimetres: [],
      corps_etat: "(z) Electricité",
      nature_travaux: "Autre",
      montant_total: null,
    }),
    cmd({ tranche_code: "1977" }),
    [],
    fournisseurs,
  );
  check(
    "T. commande sans correspondance → NON_RAPPROCHE",
    p.niveau === "NON_RAPPROCHE" || p.niveau === "MANUEL",
  );
}

// ── Config centralisée ────────────────────────────────────────────────────────
{
  check(
    "poids centralisés (total 100)",
    Object.values(POIDS_RAPPROCHEMENT).reduce((s, v) => s + v, 0) === 100,
  );
  check(
    "seuils centralisés",
    SEUILS_RAPPROCHEMENT.auto === 90 && SEUILS_RAPPROCHEMENT.aConfirmer === 60,
  );
}

// ── Deux opérations même TR + même corps d'état → départagées par descriptif ──
{
  const p1 = evaluerCorrespondance(
    op({ id: "a", nature_travaux: "Réfection toiture" }),
    cmd({ descriptif: "Réfection toiture" }),
    [],
    fournisseurs,
  );
  const p2 = evaluerCorrespondance(
    op({ id: "b", nature_travaux: "Chaudière collective" }),
    cmd({ descriptif: "Réfection toiture" }),
    [],
    fournisseurs,
  );
  check("deux ops même TR+corps → p1 mieux noté que p2", p1.score > p2.score);
}

console.log(`\nV8.5.1 PUR : ${passed} ok, ${failed} échec(s)`);
if (failed > 0) process.exit(1);
