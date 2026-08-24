// Tests purs du référentiel fournisseur (src/lib/fournisseurs.ts)
// Exécution : node scripts/test-fournisseurs.mjs
import {
  NOM_A_RENSEIGNER,
  estValeurEtatPlausible,
  normaliserCodeFournisseur,
  monterIdentifiantsFournisseur,
  premierePropositionCorpsEtat,
  refIsisDepuisAliases,
  libelleEntreprise,
  matchRechercheEntreprise,
  planifierMajContacts,
  rechercherFournisseurs,
  filtrerParCorpsEtat,
  montantReference,
  calculerKpisFournisseur,
  resoudreFournisseursParCommande,
} from "../src/lib/fournisseurs.ts";

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) {
    passed += 1;
    console.log("PASS ", name);
  } else {
    failed += 1;
    console.log("FAIL ", name, detail);
  }
}

// ── Fixtures ──────────────────────────────────────────────────────────────────
const f = (id, nom) => ({
  id,
  nom,
  adresse: null,
  complement_adresse: null,
  code_postal: null,
  ville: null,
  pays: null,
  site_web: null,
  notes: null,
  created_at: null,
  updated_at: null,
  identifiants: [],
  nb_commandes: 0,
  total_engage: 0,
  nb_commandes_historique: 0,
  total_historique: 0,
});
const fA = f("a", "Entreprise Dupont");
const fB = f("b", "BATI FRANCE");
// Les identifiants proviennent UNIQUEMENT de fournisseur_aliases (le fournisseur est son UUID).
const aliases = [
  { id: "al1", fournisseur_id: "a", source: "travaux_commandes", identifiant_source: "12562" },
  { id: "al2", fournisseur_id: "a", source: "psp_import_rows", identifiant_source: "218021" },
  { id: "al3", fournisseur_id: "b", source: "travaux_commandes", identifiant_source: "12562" },
  { id: "al4", fournisseur_id: "b", source: "psp_import_rows", identifiant_source: "218021" },
];
const aliasesPar = new Map();
aliasesPar.set(
  "a",
  aliases.filter((x) => x.fournisseur_id === "a"),
);
aliasesPar.set(
  "b",
  aliases.filter((x) => x.fournisseur_id === "b"),
);

// ── 1. Normalisation ──────────────────────────────────────────────────────────
{
  check("T1 normalise : espaces retirés", normaliserCodeFournisseur(" 125 62 ") === "12562");
  check("T1 normalise : null -> ''", normaliserCodeFournisseur(null) === "");
  check("T1 normalise : vide -> ''", normaliserCodeFournisseur("") === "");
}

// ── 2. Identifiants multi-sources (via fournisseur_aliases uniquement) ────────
{
  const idsA = monterIdentifiantsFournisseur(aliasesPar.get("a"));
  const idsB = monterIdentifiantsFournisseur(aliasesPar.get("b"));
  check(
    "T2 A = 12562 + 218021",
    idsA.includes("12562") && idsA.includes("218021") && idsA.length === 2,
  );
  check(
    "T2 B = 12562 + 218021",
    idsB.includes("12562") && idsB.includes("218021") && idsB.length === 2,
  );
  check("T2 sans alias = aucun identifiant", monterIdentifiantsFournisseur([]).length === 0);
  check(
    "T2 doublons dédupliqués",
    monterIdentifiantsFournisseur([aliases[0], aliases[0]]).length === 1,
  );
}

// ── 3. Recherche par nom / code ───────────────────────────────────────────────
{
  const all = [fA, fB];
  check("T3 recherche par nom", rechercherFournisseurs(all, aliasesPar, "dupont").length === 1);
  check(
    "T3 recherche par code (alias)",
    rechercherFournisseurs(all, aliasesPar, "218021").length === 2,
  );
  check("T3 recherche vide = tout", rechercherFournisseurs(all, aliasesPar, "").length === 2);
  check("T3 aucune correspondance", rechercherFournisseurs(all, aliasesPar, "zzz").length === 0);
}

// ── 4. Filtre par corps d'état (suivi) ────────────────────────────────────────
{
  const fC = f("c", "SARL Plomberie");
  const aliasC = {
    id: "al5",
    fournisseur_id: "c",
    source: "travaux_commandes",
    identifiant_source: "7777",
  };
  const aliasesParAll = new Map(aliasesPar);
  aliasesParAll.set("c", [aliasC]);
  const all3 = [fA, fB, fC];
  // A et B possèdent tous deux l'identifiant suivi 12562 (alias).
  check(
    "T4 corps 12562 -> A et B (alias)",
    filtrerParCorpsEtat(all3, aliasesParAll, new Set(["12562"])).length === 2,
  );
  check(
    "T4 corps 7777 -> uniquement C",
    filtrerParCorpsEtat(all3, aliasesParAll, new Set(["7777"])).length === 1 &&
      filtrerParCorpsEtat(all3, aliasesParAll, new Set(["7777"]))[0].id === "c",
  );
  check("T4 aucun code -> []", filtrerParCorpsEtat(all3, aliasesParAll, new Set()).length === 0);
}

// ── 5. Montant de référence (engage > psp_montant_engage > aucun) ─────────────
{
  const m1 = montantReference(1000, 500);
  check("T5 engage prioritaire", m1.montant === 1000 && m1.type === "engage");
  const m2 = montantReference(null, 500);
  check("T5 repli psp_montant_engage", m2.montant === 500 && m2.type === "psp_montant_engage");
  const m3 = montantReference(undefined, undefined);
  check("T5 aucun", m3.montant === null && m3.type === "aucun");
}

// ── 6. KPI (total, par année, par corps d'état, dernières) ────────────────────
{
  const commandes = [
    {
      numero_commande: "1",
      annee: 2026,
      corps_etat: "(j) Couvertures",
      montant: 100,
      montant_type: "engage",
    },
    {
      numero_commande: "2",
      annee: 2026,
      corps_etat: "(j) Couvertures",
      montant: 200,
      montant_type: "engage",
    },
    {
      numero_commande: "3",
      annee: 2025,
      corps_etat: "(r) Fermetures",
      montant: 300,
      montant_type: "psp_montant_engage",
    },
  ];
  const kpi = calculerKpisFournisseur(commandes);
  check("T6 total commandes = 3", kpi.total_commandes === 3);
  check("T6 total montant = 600", kpi.total_montant === 600);
  const annee2026 = kpi.par_annee.find((a) => a.annee === "2026");
  check("T6 2026 : 2 commandes / 300", annee2026?.commandes === 2 && annee2026?.montant === 300);
  const corpsCouverture = kpi.par_corps_etat.find((c) => c.corps_etat === "(j) Couvertures");
  check(
    "T6 Couvertures : 2 / 300",
    corpsCouverture?.commandes === 2 && corpsCouverture?.montant === 300,
  );
  check("T6 dernières non vides", kpi.dernieres.length === 3);
  check("T6 KPI vide", calculerKpisFournisseur([]).total_commandes === 0);
}

// ── 7. Résolution commande → fournisseur (suivi + psp) ────────────────────────
{
  const commandes = [
    { id: "c1", numero_commande: "4570115", numero_fournisseur: "6492" },
    { id: "c2", numero_commande: "4581335", numero_fournisseur: "12562" },
    { id: "c3", numero_commande: "9999999", numero_fournisseur: null },
  ];
  const pspPar = { c2: ["218021"] };
  const res = resoudreFournisseursParCommande(commandes, pspPar, [fA, fB], aliases);
  check("T7 c1 : aucun", !res.c1);
  check("T7 c2 : résolu vers A (suivi 12562)", res.c2?.id === "a");
  check("T7 c2 : nom = Entreprise Dupont", res.c2?.nom === "Entreprise Dupont");
  check("T7 c3 : aucun", !res.c3);
}

// ── 8. Absence de fournisseur / référentiel vide ──────────────────────────────
{
  const commandes = [{ id: "c2", numero_commande: "4581335", numero_fournisseur: "12562" }];
  const res = resoudreFournisseursParCommande(commandes, {}, [], []);
  check("T8 référentiel vide -> aucun", !res.c2);
  check("T8 liste vide", rechercherFournisseurs([], aliasesPar, "dupont").length === 0);
}

// ── 9. Conservation des données sources (fonctions pures) ─────────────────────
{
  const source = { numero_fournisseur: " 12562 " };
  const norm = normaliserCodeFournisseur(source.numero_fournisseur);
  check("T9 source inchangée", source.numero_fournisseur === " 12562 " && norm === "12562");
  const cmd = { montant: 100 };
  const ref = montantReference(cmd.montant, 50);
  check("T9 montant source inchangé", cmd.montant === 100 && ref.montant === 100);
}

// ── 10. Ref ISIS (alias source 'travaux_commandes') ───────────────────────────
{
  const aliases = [
    { id: "a1", fournisseur_id: "x", source: "travaux_commandes", identifiant_source: " 5832 " },
    { id: "a2", fournisseur_id: "x", source: "psp_import_rows", identifiant_source: "218021" },
  ];
  check("T10 refIsis = 5832 (normalisé)", refIsisDepuisAliases(aliases) === "5832");
  check("T10 sans alias suivi → null", refIsisDepuisAliases([]) === null);
  check("T10 alias psp seul → null", refIsisDepuisAliases([aliases[1]]) === null);
}

// ── 11. Libellé entreprise (jamais de faux nom) ───────────────────────────────
{
  check("T11 nom réel conservé", libelleEntreprise("ENTREPRISE DUPONT") === "ENTREPRISE DUPONT");
  check(
    "T11 À renseigner → Entreprise non renseignée",
    libelleEntreprise(NOM_A_RENSEIGNER) === "Entreprise non renseignée",
  );
  check(
    "T11 nom vide → Entreprise non renseignée",
    libelleEntreprise("") === "Entreprise non renseignée",
  );
  check(
    "T11 null → Entreprise non renseignée",
    libelleEntreprise(null) === "Entreprise non renseignée",
  );
}

// ── 12. Recherche Ref ISIS même sans nom ──────────────────────────────────────
{
  check(
    "T12 recherche par Ref ISIS sans nom",
    matchRechercheEntreprise("", "5832", ["5832"], "5832") === true,
  );
  check(
    "T12 recherche par nom",
    matchRechercheEntreprise("ENTREPRISE DUPONT", null, [], "dupont") === true,
  );
  check(
    "T12 aucune correspondance",
    matchRechercheEntreprise("", "5832", ["5832"], "9999") === false,
  );
  check("T12 query vide → vrai", matchRechercheEntreprise("", "5832", [], "") === true);
}

// ── 13. Plan contacts (ajout / modification / suppression) ────────────────────
{
  const existants = [
    {
      id: "c1",
      fournisseur_id: "x",
      nom: "Jean",
      fonction: null,
      email: null,
      telephone: null,
      ordre: 0,
      created_at: null,
      updated_at: null,
    },
    {
      id: "c2",
      fournisseur_id: "x",
      nom: "Paul",
      fonction: "Conducteur",
      email: "p@x.fr",
      telephone: null,
      ordre: 1,
      created_at: null,
      updated_at: null,
    },
  ];
  const plan = planifierMajContacts(existants, [
    { id: "c1", nom: "Jean DUPONT" },
    { nom: "Marie" },
  ]);
  check(
    "T13 modification c1",
    plan.modifier.length === 1 &&
      plan.modifier[0].id === "c1" &&
      plan.modifier[0].contact.nom === "Jean DUPONT",
  );
  check("T13 création Marie", plan.creer.length === 1 && plan.creer[0].nom === "Marie");
  check(
    "T13 suppression c2 (absent du souhaité)",
    plan.supprimer.length === 1 && plan.supprimer[0].id === "c2",
  );
  const planVide = planifierMajContacts(existants, []);
  check("T13 tout supprimer", planVide.supprimer.length === 2);
  check(
    "T13 entrées vides ignorées",
    planifierMajContacts(existants, [{ nom: "  " }]).creer.length === 0,
  );
  check(
    "T13 trim des champs",
    planifierMajContacts(existants, [{ nom: " Alice ", email: " a@b.fr " }]).creer[0].email ===
      "a@b.fr",
  );
}

// ── 14. Recherche « Corps d'état » — saisie + ENTER (multi-sélection) ─────────
{
  const options = [
    "(j) Couvertures",
    "(o) Plomberie",
    "(p) Toitures",
    "(q) Menuiseries ext",
    "(u) Etanchéité",
  ];
  // Saisie « plomberie » + ENTER → première proposition pertinente sélectionnée.
  check(
    "T14 plomberie → (o) Plomberie",
    premierePropositionCorpsEtat("plomberie", options, []) === "(o) Plomberie",
  );
  // Recherche sur le CODE aussi (« j » → Couvertures).
  check(
    "T14 code « j » → (j) Couvertures",
    premierePropositionCorpsEtat("j", options, []) === "(j) Couvertures",
  );
  // Deuxième recherche « toiture » + ENTER → ajout, sans toucher la sélection existante.
  const sel1 = [...options.filter((o) => o === "(o) Plomberie")];
  const second = premierePropositionCorpsEtat("toiture", options, sel1);
  check(
    "T14 toiture ajouté à la sélection existante",
    second === "(p) Toitures" && [...sel1, second].length === 2,
  );
  // ENTER sur une sélection déjà active → aucune proposition déjà cochée, aucun doublon.
  const sel2 = ["(o) Plomberie", "(p) Toitures"];
  const ajoutSurActive = premierePropositionCorpsEtat("toiture", options, sel2);
  check(
    "T14 aucune proposition déjà sélectionnée renvoyée (pas de doublon)",
    ajoutSurActive === null,
  );
  check(
    "T14 ENTER n'écarte jamais les sélections précédentes",
    premierePropositionCorpsEtat("chauffage", options, sel2) === null &&
      [...sel2].join(",") === "(o) Plomberie,(p) Toitures",
  );
  // Recherche vide → aucune sélection.
  check("T14 recherche vide → null", premierePropositionCorpsEtat("  ", options, []) === null);
}

// ── 15. Valeur d'état plausible (filtre État — bruit numérique exclu) ─────────
{
  check("T15 Close plausible", estValeurEtatPlausible("Close") === true);
  check("T15 Attente validation plausible", estValeurEtatPlausible("Attente validation") === true);
  check("T15 Terminés plausible", estValeurEtatPlausible("Terminés") === true);
  check("T15 montant échappé rejeté", estValeurEtatPlausible("3493.41") === false);
  check("T15 nombre entier rejeté", estValeurEtatPlausible("2310") === false);
  check("T15 vide rejeté", estValeurEtatPlausible("") === false);
}

console.log(`\n${passed} passé(s), ${failed} échec(s)`);
process.exit(failed > 0 ? 1 : 0);
