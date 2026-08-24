// Tests de non-régression — module « Préparation PSP » (src/lib/psp.prep.ts)
// Exécution : node scripts/test-psp-prep.mjs
// Node 24 importe directement les fichiers TypeScript (type stripping).
import {
  PSP_ANNEES,
  PSP_BUDGET_DISPONIBLE_PAR_ANNEE,
  PSP_OPERATIONS,
  ANCIENNE_PROGRAMMATION,
  ajouterOperationListe,
  budgetDisponibleTotal,
  comparerProgrammation,
  construireCsvProgrammation,
  deplacerOperation,
  filtrerOperations,
  grouperParChargéClientele,
  grouperParTranche,
  kpiGlobal,
  modifierOperationListe,
  montantAnnee,
  statsDevis,
  supprimerOperationListe,
  totalOperation,
  totauxParCategorie,
  trierOperationsDetail,
} from "../src/lib/psp.prep.ts";

let passed = 0;
let failed = 0;

function assert(name, cond, detail = "") {
  if (cond) {
    passed += 1;
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ── 1. Volume et cohérence interne des données mock ────────────────────────
assert("≥ 40 opérations mock", PSP_OPERATIONS.length >= 40, `(${PSP_OPERATIONS.length})`);
assert("≥ 5 tranches distinctes", new Set(PSP_OPERATIONS.map((o) => o.tranche)).size >= 5);
assert(
  "≥ 4 chargés clientèle distincts",
  new Set(PSP_OPERATIONS.map((o) => o.charge_clientele)).size >= 4,
);
assert(
  "≥ 3 catégories C GE/GT/CP présentes",
  new Set(PSP_OPERATIONS.map((o) => o.categorie)).size === 3,
);

const incohérents = PSP_OPERATIONS.filter((o) => totalOperation(o) !== o.budget);
assert(
  "budget === total programmé pour chaque opération",
  incohérents.length === 0,
  incohérents.map((o) => o.id).join(","),
);

const négatifs = PSP_OPERATIONS.flatMap((o) =>
  PSP_ANNEES.filter((a) => montantAnnee(o, a) < 0).map((a) => `${o.id}/${a}`),
);
assert("aucun montant négatif", négatifs.length === 0, négatifs.join(","));

// ── 2. KPI globaux ─────────────────────────────────────────────────────────
const kpi = kpiGlobal(PSP_OPERATIONS);
assert(
  "KPI : écart disponible = disponible − programmé",
  kpi.ecart === kpi.disponible - kpi.programme,
);
assert("KPI : écart strictement positif (marge disponible)", kpi.ecart > 0, `écart = ${kpi.ecart}`);
assert(
  "KPI : budget disponible = somme des enveloppes annuelles",
  kpi.disponible === budgetDisponibleTotal(),
);
assert("KPI : nb opérations > 40", kpi.nbOperations > 40, `nb = ${kpi.nbOperations}`);

const annéeProgrammée = PSP_ANNEES.filter((a) => (kpi.parAnnee[String(a)] ?? 0) > 0);
assert("chaque année 2027-2031 a un programme > 0", annéeProgrammée.length === 5);
for (const a of PSP_ANNEES) {
  const prog = kpi.parAnnee[String(a)] ?? 0;
  const dispo = PSP_BUDGET_DISPONIBLE_PAR_ANNEE[String(a)] ?? 0;
  assert(`année ${a} : programme < disponible`, prog < dispo, `${prog} >= ${dispo}`);
}

// ── 3. Regroupements — mode « Par tranche » ────────────────────────────────
const parTranche = grouperParTranche(PSP_OPERATIONS);
assert("mode tranche : au moins 5 groupes", parTranche.length >= 5);
assert(
  "mode tranche : tri ascendant des tranches",
  parTranche.every((g, i) => i === 0 || Number(parTranche[i - 1].tranche) < Number(g.tranche)),
);
const opsTranche = parTranche.reduce((s, g) => s + g.stats.nbOperations, 0);
assert(
  "mode tranche : total opérations conservé",
  opsTranche === PSP_OPERATIONS.length,
  `${opsTranche} != ${PSP_OPERATIONS.length}`,
);
const chargesTranche = parTranche.flatMap((g) => g.charges);
assert("mode tranche : au moins 1 sous-groupe chargé clientèle", chargesTranche.length >= 1);
const opsCharges = chargesTranche.reduce((s, c) => s + c.stats.nbOperations, 0);
assert("mode tranche : sous-groupes = total opérations", opsCharges === PSP_OPERATIONS.length);
const totalGroupes = parTranche.reduce((s, g) => s + g.stats.total, 0);
assert(
  "mode tranche : somme groupes === programme total",
  totalGroupes === kpi.programme,
  `${totalGroupes} != ${kpi.programme}`,
);

// ── 4. Regroupements — mode « Par chargé de clientèle » ────────────────────
const parChargé = grouperParChargéClientele(PSP_OPERATIONS);
assert("mode chargé : au moins 4 groupes", parChargé.length >= 4);
assert(
  "mode chargé : tri ascendant des chargés",
  parChargé.every(
    (g, i) =>
      i === 0 || parChargé[i - 1].charge_clientele.localeCompare(g.charge_clientele, "fr") <= 0,
  ),
);
const opsChargé = parChargé.reduce((s, g) => s + g.stats.nbOperations, 0);
assert("mode chargé : total opérations conservé", opsChargé === PSP_OPERATIONS.length);
const opsTranchesDeChargé = parChargé
  .flatMap((g) => g.tranches)
  .reduce((s, t) => s + t.stats.nbOperations, 0);
assert(
  "mode chargé : sous-groupes = total opérations",
  opsTranchesDeChargé === PSP_OPERATIONS.length,
);

// ── 5. Filtres (mode Détail) ───────────────────────────────────────────────
const filtreVide = {
  q: "",
  categorie: "",
  tranche: "",
  charge_clientele: "",
  corps_etat: "",
  annee: "",
};
const ge = filtrerOperations(PSP_OPERATIONS, { ...filtreVide, categorie: "GE" });
assert(
  "filtre catégorie C=GE : uniquement des GE",
  ge.length > 0 && ge.every((o) => o.categorie === "GE"),
);
const tr1976 = filtrerOperations(PSP_OPERATIONS, { ...filtreVide, tranche: "1976" });
assert(
  "filtre tranche 1976 : uniquement 1976",
  tr1976.length > 0 && tr1976.every((o) => o.tranche === "1976"),
);
const an2028 = filtrerOperations(PSP_OPERATIONS, { ...filtreVide, annee: "2028" });
assert("filtre année 2028 : au moins 1 opération", an2028.length > 0);
assert(
  "filtre année 2028 : chaque op a du montant en 2028",
  an2028.every((o) => montantAnnee(o, 2028) > 0),
);
const recherche = filtrerOperations(PSP_OPERATIONS, { ...filtreVide, q: "toiture" });
assert("recherche « toiture » : résultats non vides", recherche.length > 0);

// ── 6. Tri (mode Détail) ───────────────────────────────────────────────────
const triMontant = trierOperationsDetail(PSP_OPERATIONS, "total", false);
assert(
  "tri total DESC : premier >= dernier",
  triMontant[0].budget >= triMontant[triMontant.length - 1].budget,
);
const triAnnee = trierOperationsDetail(PSP_OPERATIONS, "annee", true);
assert("tri année ASC : 2027 en tête", triAnnee[0].annee === 2027);

// ── 7. Devis ───────────────────────────────────────────────────────────────
const avecDevis = PSP_OPERATIONS.filter((o) => o.devis.length >= 2);
assert("≥ 10 opérations avec devis", avecDevis.length >= 10, `(${avecDevis.length})`);
const stats = statsDevis(avecDevis[0].devis);
assert("statsDevis : min/moy/max calculés", stats !== null);
if (stats) {
  const montants = avecDevis[0].devis.map((d) => d.montant);
  assert("statsDevis : min exact", stats.min === Math.min(...montants));
  assert("statsDevis : max exact", stats.max === Math.max(...montants));
  assert(
    "statsDevis : moyenne exacte",
    Math.abs(stats.moyenne - montants.reduce((s, m) => s + m, 0) / montants.length) < 0.001,
  );
}

// ── 8. Opérations reportées ────────────────────────────────────────────────
const reportées = PSP_OPERATIONS.filter((o) => o.reportee);
assert("≥ 3 opérations reportées", reportées.length >= 3, `(${reportées.length})`);
assert(
  "reportées : ancienne_annee renseignée",
  reportées.every((o) => o.ancienne_annee !== null && o.ancien_montant !== null),
);

// ── 9. Ancienne programmation ──────────────────────────────────────────────
assert("ancienne programmation : ≥ 5 lignes", ANCIENNE_PROGRAMMATION.length >= 5);

// ── 10. Export CSV ─────────────────────────────────────────────────────────
const csv = construireCsvProgrammation(PSP_OPERATIONS.slice(0, 3));
const lignesCsv = csv.split("\r\n");
assert("CSV : 1 en-tête + 3 lignes", lignesCsv.length === 4);
assert(
  "CSV : en-tête contient les années",
  ["2027", "2031", "Total"].every((h) => lignesCsv[0].includes(h)),
);

// ── 11. Contrat des types (remplaçables Supabase) ──────────────────────────
const première = PSP_OPERATIONS[0];
assert(
  "opération : champs requis renseignés",
  Boolean(première && typeof première.id === "string" && typeof première.budget === "number"),
);
const avecRemarque = PSP_OPERATIONS.find((o) => o.remarques !== null);
assert("au moins une opération avec remarques", Boolean(avecRemarque));

console.log(`\nRésultat : ${passed} PASS, ${failed} FAIL`);

// ══════════════════════════════════════════════════════════════════════════
// ── V2 — Mutations LOCALES + déplacement + comparaison ──────────────────────
// ══════════════════════════════════════════════════════════════════════════

// C = catégorie budgétaire GE/GT/CP (jamais un code corps d'état).
const categoriesValides = PSP_OPERATIONS.every((o) => ["GE", "GT", "CP"].includes(o.categorie));
assert("C = GE/GT/CP sur toutes les opérations (jamais un code corps d'état)", categoriesValides);

// ── Ajout local ────────────────────────────────────────────────────────────
const saisieAjout = {
  tranche: "1976",
  categorie: "CP",
  charge_clientele: "ALOTHORE",
  charge_operation: "HALLEL",
  corps_etat: "(d) Couvertures",
  adresse: "32 RUE CORNILLIOT",
  ville: "THORIGNY-SUR-MARNE",
  nature_travaux: "Reprise zinguerie",
  annee: 2028,
  programme: [0, 35000, 0, 0, 0],
  remarques: null,
};
const avecAjout = ajouterOperationListe(PSP_OPERATIONS, saisieAjout, "test-ajout");
assert("ajout local : liste + 1", avecAjout.length === PSP_OPERATIONS.length + 1);
const opAjoutee = avecAjout.find((o) => o.id === "test-ajout");
assert(
  "ajout local : budget === total programmé",
  Boolean(opAjoutee && opAjoutee.budget === 35000 && opAjoutee.annee === 2028),
);
assert("ajout local : corps d'état codé « (d) »", opAjoutee?.corps_etat_code === "(d)");

// ── Modification locale ────────────────────────────────────────────────────
const modifiees = modifierOperationListe(avecAjout, "test-ajout", {
  programme: { 2027: 15000, 2028: 20000, 2029: 0, 2030: 0, 2031: 0 },
  nature_travaux: "Reprise zinguerie + gouttières",
});
const opModifiee = modifiees.find((o) => o.id === "test-ajout");
assert(
  "modification locale : totaux recalculés (budget = 35 000)",
  Boolean(opModifiee && opModifiee.budget === 35000),
);
assert(
  "modification locale : année 2027 prise en compte",
  Boolean(opModifiee && opModifiee.programme["2027"] === 15000),
);
assert(
  "modification locale : immuabilité",
  avecAjout.find((o) => o.id === "test-ajout")?.nature_travaux === "Reprise zinguerie",
);

// ── Suppression locale ─────────────────────────────────────────────────────
const apresSuppression = supprimerOperationListe(avecAjout, "test-ajout");
assert("suppression locale : liste - 1", apresSuppression.length === PSP_OPERATIONS.length);

// ── Déplacement d'année (2027 = 35 000 → 2028) ────────────────────────────
const avantDepl = modifierOperationListe(avecAjout, "test-ajout", {
  annee: 2027,
  programme: { 2027: 35000, 2028: 0, 2029: 0, 2030: 0, 2031: 0 },
});
const { ops: apresDepl, deplacement } = deplacerOperation(
  avantDepl,
  "test-ajout",
  2028,
  "Report glissant",
);
const opDeplacee = apresDepl.find((o) => o.id === "test-ajout");
assert(
  "déplacement : 2027 = 0, 2028 = 35 000",
  Boolean(
    opDeplacee &&
    opDeplacee.programme["2027"] === 0 &&
    opDeplacee.programme["2028"] === 35000 &&
    opDeplacee.annee === 2028,
  ),
);
assert(
  "déplacement : trace mémoire conservée",
  Boolean(
    deplacement &&
    deplacement.montant === 35000 &&
    deplacement.anneePrecedente === 2027 &&
    deplacement.anneeNouvelle === 2028,
  ),
);
assert("déplacement : total inchangé", opDeplacee ? totalOperation(opDeplacee) === 35000 : false);
const deplacementInchange = deplacerOperation(apresDepl, "test-ajout", 2028, null);
assert("déplacement : même année → aucun mouvement", deplacementInchange.deplacement === null);

// ── Totaux par catégorie C ─────────────────────────────────────────────────
const totauxC = totauxParCategorie(PSP_OPERATIONS);
const sommeC = totauxC.GE.total + totauxC.GT.total + totauxC.CP.total;
assert("totaux GE/GT/CP : somme = programme total", sommeC === kpi.programme);
assert(
  "totaux GE/GT/CP : nb opérations conservé",
  totauxC.GE.nbOperations + totauxC.GT.nbOperations + totauxC.CP.nbOperations ===
    PSP_OPERATIONS.length,
);

// ── Comparaison ancienne vs actuelle ───────────────────────────────────────
const { lignes: lignesComp, nouvelles } = comparerProgrammation(ANCIENNE_PROGRAMMATION, avecAjout);
assert(
  "comparaison : toutes les lignes anciennes ont un statut",
  lignesComp.length === ANCIENNE_PROGRAMMATION.length,
);
assert(
  "comparaison : 1 nouvelle (l'opération ajoutée)",
  nouvelles.some((o) => o.id === "test-ajout"),
);
const statuts = new Set(lignesComp.map((l) => l.statut));
assert(
  "comparaison : statuts ∈ {inchangee, modifiee, deplacee, supprimee}",
  [...statuts].every((s) => ["inchangee", "modifiee", "deplacee", "supprimee"].includes(s)),
);
const ancRef = ANCIENNE_PROGRAMMATION.find((i) => i.id === "anc-001");
const ligneAnc1 = lignesComp.find((l) => l.item.id === "anc-001");
assert("comparaison : anc-001 trouvée", Boolean(ancRef && ligneAnc1));

process.exit(failed === 0 ? 0 : 1);
