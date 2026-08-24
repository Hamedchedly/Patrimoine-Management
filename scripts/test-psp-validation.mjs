// Tests purs de l'écran de validation PSP (module psp.validation.ts +
// psp.classification.ts). Aucune écriture, aucun accès base requis.
// Exécution : node scripts/test-psp-validation.mjs
import {
  calculerScorePriorite,
  niveauPriorite,
  construireFeedbackPsp,
  champsInterditsModification,
  filtrerCommandesValidation,
  rechercherCommandes,
  montantTotalCommandes,
  montantTotalGroupes,
  montantTotalEligible,
  construireGroupeApercu,
  detecterCorrectionsRecurrentes,
  detecterPmr,
  resoudrePerimetrePsp,
} from "../src/lib/psp.validation.ts";
import { classifierCommande, construireGroupesValidation } from "../src/lib/psp.classification.ts";

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) {
    passed += 1;
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ── Helper : construit une commande de validation (JS pur) ───────────────────
function cmd(over = {}) {
  const base = {
    comn: "TEST",
    comc: null,
    naac: "CP",
    patrimoine: "ER.T1396",
    adresse: null,
    commune: null,
    wnature: "",
    montant_budget: null,
    montant_engage: 0,
    fournisseur: null,
    date_commande: null,
    er_reference: null,
    type_intervention: "remplacement",
    domaine_technique: "couverture",
    domaines_detectes: [],
    famille_psp: "couverture_toiture",
    element_patrimonial: "tranche",
    nature_exceptionnelle: "aucune",
    confiance: 0.9,
    besoin_validation_humaine: false,
    regle_appliquee: "domaine:couverture+type:remplacement",
    justification: "",
    projet_relais_chelles: false,
    libelle_normalise: "",
    score_priorite: 0,
    niveau_priorite: "faible",
    raisons_priorite: [],
    motif_validation: [],
  };
  return { ...base, ...over };
}

function cls(wnature, extra = {}) {
  return classifierCommande({
    comn: "T",
    naac: "CP",
    wnature,
    patrimoine: "ER.T1396",
    montant_engage: 1000,
    ...extra,
  });
}

// ── 1. Score de priorité ────────────────────────────────────────────────────
const s0 = calculerScorePriorite({ montant_engage: 1000, confiance: 0.9, exceptionnelle: false, multi_domaine: false, domaine_technique: "peinture_pc", type_intervention: "amenagement" });
check("score faible pour cas simple", s0.niveau === "faible", `${s0.score}/${s0.niveau}`);
const sElev = calculerScorePriorite({ montant_engage: 200000, confiance: 0.3, exceptionnelle: true, multi_domaine: true, domaine_technique: "ascenseur", type_intervention: "sinistre" });
check("score élevé pour cas critique", sElev.niveau === "elevee" && sElev.score >= 60, `${sElev.score}/${sElev.niveau}`);
check("score plafonné à 100", sElev.score <= 100);
check("raisons explicables non vides (cas élevé)", sElev.raisons.length >= 3, sElev.raisons.join("|"));
const sMontant = calculerScorePriorite({ montant_engage: 97000, confiance: 0.9, exceptionnelle: false, multi_domaine: false, domaine_technique: "peinture_pc", type_intervention: "amenagement" });
check("montant élevé augmente le score", sMontant.score > s0.score, `${sMontant.score}>${s0.score}`);

// ── 2. Niveaux ──────────────────────────────────────────────────────────────
check("niveau: 60 → élevée", niveauPriorite(60) === "elevee");
check("niveau: 59 → moyenne", niveauPriorite(59) === "moyenne");
check("niveau: 35 → moyenne", niveauPriorite(35) === "moyenne");
check("niveau: 34 → faible", niveauPriorite(34) === "faible");

// ── 3 & 4. Groupes : création + absence de regroupement incorrect ──────────
const gTreuil = [cls("REMPLACEMENT DE TREUIL"), cls("REMPLACEMENT DE TREUIL")];
const gVerin = [cls("REMPLACEMENT DE VERIN"), cls("REMPLACEMENT DE VERIN")];
const gBal = [cls("REMPLACEMENT DES BAL")];
const groupes = construireGroupesValidation([...gTreuil, ...gVerin, ...gBal]);
check("2 treuil → 1 groupe (2 occurrences)", groupes.some((g) => g.occurrences === 2 && g.libelle_normalise === "REMPLACEMENT DE TREUIL"));
check("2 verin → 1 groupe distinct de treuil", groupes.some((g) => g.occurrences === 2 && g.libelle_normalise === "REMPLACEMENT DE VERIN"));
check("BAL non regroupé avec treuil (domaine différent)", !groupes.some((g) => g.comn_liste.includes("T") && g.libelle_normalise === "REMPLACEMENT DES BAL" && g.domaine_technique !== "ssi"));
const balG = groupes.find((g) => g.libelle_normalise === "REMPLACEMENT DES BAL");
check("BAL → domaine ssi", balG?.domaine_technique === "ssi", balG?.domaine_technique);

// ── 14. Montant total d'un groupe ───────────────────────────────────────────
const membres = gTreuil.map((c, i) => cmd({ comn: `T${i}`, montant_engage: 1000 + i }));
const groupeApercu = construireGroupeApercu(
  { cle: "k", libelle_normalise: "REMPLACEMENT DE TREUIL", regle_appliquee: "x", domaine_technique: "ascenseur", type_intervention: "remplacement", famille_psp: "equipements_techniques", occurrences: 2, montant_total: 2001, comn_liste: ["T0", "T1"] },
  membres,
);
check("montant total groupe (2001)", groupeApercu.montant_total === 2001);
check("montant total via helper", montantTotalGroupes([groupeApercu]) === 2001);
check("montant total commandes", montantTotalCommandes(membres) === 2001);

// ── 5–9. Feedback : validate / modify / reject / indeterminate ──────────────
const fbVal = construireFeedbackPsp({ cible_id: "C1", proposition_initiale: { a: 1 }, decision: "validate", motif: "ok" });
check("feedback validate → colonnes exactes", fbVal.cible_type === "commande" && fbVal.cible_id === "C1" && fbVal.decision_utilisateur === "validate" && fbVal.proposition_initiale?.a === 1 && fbVal.correction === null && fbVal.motif === "ok");
const fbMod = construireFeedbackPsp({ cible_id: "C2", proposition_initiale: { b: 2 }, decision: "modify", correction: { domaine_technique: "ssi" }, motif: "corrigé" });
check("feedback modify → correction conservée", fbMod.decision_utilisateur === "modify" && fbMod.correction?.domaine_technique === "ssi");
const fbRej = construireFeedbackPsp({ cible_id: "C3", proposition_initiale: null, decision: "reject" });
check("feedback reject", fbRej.decision_utilisateur === "reject");
const fbInd = construireFeedbackPsp({ cible_id: "C4", proposition_initiale: null, decision: "indeterminate" });
check("feedback indeterminate", fbInd.decision_utilisateur === "indeterminate");

// ── 11. Interdiction de modifier les champs source ──────────────────────────
const interdits = champsInterditsModification({ type_intervention: "x", domaine_technique: "y", comn: "AAA", naac: "GE", montant_engage: 5 });
check("garde: comn/naac/montant interdits", interdits.includes("comn") && interdits.includes("naac") && interdits.includes("montant_engage"), interdits.join(","));
const okChamps = champsInterditsModification({ type_intervention: "x", domaine_technique: "y", famille_psp: "z", element_patrimonial: "w", nature_exceptionnelle: "aucune" });
check("garde: 5 champs de classification autorisés", okChamps.length === 0, okChamps.join(","));

// ── 12. Filtres ─────────────────────────────────────────────────────────────
const cmdList = [
  cmd({ comn: "A", naac: "GE", domaine_technique: "couverture", type_intervention: "remplacement", niveau_priorite: "elevee", besoin_validation_humaine: true, commune: "BROU" }),
  cmd({ comn: "B", naac: "CP", domaine_technique: "ascenseur", type_intervention: "remplacement", niveau_priorite: "moyenne", besoin_validation_humaine: true }),
  cmd({ comn: "C", naac: "HO", domaine_technique: "multi_domaine", type_intervention: "controle", niveau_priorite: "faible", besoin_validation_humaine: true }),
];
check("filtre NAAC=GE", filtrerCommandesValidation(cmdList, { filtre: "toutes", naac: "GE" }).length === 1);
check("filtre haute priorité", filtrerCommandesValidation(cmdList, { filtre: "haute_priorite" }).length === 1);
check("filtre multi_domaines", filtrerCommandesValidation(cmdList, { filtre: "multi_domaines" }).length === 1);
check("filtre commune", filtrerCommandesValidation(cmdList, { filtre: "toutes", commune: "BROU" }).length === 1);
check("filtre tranche (ER.T)", filtrerCommandesValidation(cmdList, { filtre: "toutes", tranche: "x" }).length === 3);
check("filtre aValiderSeulement=false → tout", filtrerCommandesValidation(cmdList, { filtre: "toutes", aValiderSeulement: false }).length === 3);

// ── 13. Recherche ───────────────────────────────────────────────────────────
const searchList = [
  cmd({ comn: "5027280", comc: "0559/2026", patrimoine: "ER.T1950", wnature: "MISE EN PLACE DE STOP PARKS", adresse: "4 CHEMIN", commune: "BROU SUR CHANTEREINE" }),
  cmd({ comn: "4572981", comc: "0267/2023", patrimoine: "ER.T1396", wnature: "DIAGNOSTIC AMIANTE AVANT TRAVAUX", adresse: null, commune: null }),
];
check("recherche COMN_NUM", rechercherCommandes(searchList, "5027280").length === 1);
check("recherche COMC_NOLIG", rechercherCommandes(searchList, "0267/2023").length === 1);
check("recherche ER", rechercherCommandes(searchList, "ER.T1950").length === 1);
check("recherche WNATURE (sans accents)", rechercherCommandes(searchList, "amiante").length === 1);
check("recherche commune", rechercherCommandes(searchList, "chantereine").length === 1);
check("recherche vide → tout", rechercherCommandes(searchList, "  ").length === 2);

// ── Cas nominatifs ──────────────────────────────────────────────────────────
const cas = {
  "REMPLACEMENT DE TREUIL": (r) => r.domaine_technique === "ascenseur" && r.besoin_validation_humaine === true,
  "REMPLACEMENT DE VERIN": (r) => r.domaine_technique === "ascenseur" && r.besoin_validation_humaine === true,
  "REMPLACEMENT COMPLET ASCENSEUR 2025": (r) => r.type_intervention === "remplacement" && r.domaine_technique === "ascenseur" && r.nature_exceptionnelle === "commande_exceptionnelle" && r.besoin_validation_humaine === true,
  "DIAGNOSTIC AMIANTE AVANT TRAVAUX (RAVALEMENT DE FACADES)": (r) => r.type_intervention === "diagnostic" && r.besoin_validation_humaine === true,
  "ATTESTATION GAZ": (r) => r.type_intervention === "controle" && r.domaine_technique === "chauffage",
  "RÉHABILITATION DU RELAIS DE CHELLES - 169 LOGEMENTS - LOT 01 : TRAITEMENT DES FAÇADES": (r) => r.type_intervention === "rehabilitation" && r.nature_exceptionnelle === "commande_exceptionnelle" && r.besoin_validation_humaine === true,
  "TRAVAUX D'ELECTRICITE ET DE PLOMBERIE : REMISE EN ETAT DU LOGEMENT": (r) => r.domaine_technique === "multi_domaine" && r.besoin_validation_humaine === true,
};
for (const [lib, test] of Object.entries(cas)) {
  const r = cls(lib);
  check(`cas «${lib.slice(0, 40)}»`, test(r), `${r.type_intervention}/${r.domaine_technique}/${r.nature_exceptionnelle}`);
}

// Commande à fort montant / faible confiance → priorité élevée
const fort = cmd({ montant_engage: 97000, confiance: 0.3, nature_exceptionnelle: "commande_exceptionnelle", domaine_technique: "ascenseur", type_intervention: "remplacement" });
const scoreFort = calculerScorePriorite({ montant_engage: fort.montant_engage, confiance: fort.confiance, exceptionnelle: true, multi_domaine: false, domaine_technique: fort.domaine_technique, type_intervention: fort.type_intervention });
check("fort montant + faible confiance → priorité élevée", scoreFort.niveau === "elevee", `${scoreFort.score}`);

// ── Suggestions de règles récurrentes ───────────────────────────────────────
const fbRecurrent = Array.from({ length: 5 }, () => ({ cible_id: "x", proposition_initiale: { libelle_normalise: "REMPLACEMENT DES BAL" }, decision_utilisateur: "modify", correction: { domaine_technique: "ssi", type_intervention: "remplacement" } }));
const sugg = detecterCorrectionsRecurrentes(fbRecurrent, 3);
check("suggestion récurrente détectée (5 ≥ 3)", sugg.length === 1 && sugg[0].domaine === "ssi" && sugg[0].occurrences === 5);
const suggPeu = detecterCorrectionsRecurrentes(fbRecurrent.slice(0, 2), 3);
check("pas de suggestion sous le seuil", suggPeu.length === 0);

// ── Périmètre PSP : détection PMR ───────────────────────────────────────────
check("PMR détecté (ADAPT PMR)", detecterPmr("ADAPT PMR - TRAVAUX SDB") === true);
check("PMR détecté (TRAVAUX PMR SDB ET WC)", detecterPmr("TRAVAUX PMR SDB ET WC") === true);
check("PMR détecté (DAAT)", detecterPmr("DAAT TRAVAUX PMR") === true);
check("PMR détecté (ADAPTATION PMR)", detecterPmr("ADAPTATION PMR") === true);
check("PMR non détecté (treuil)", detecterPmr("REMPLACEMENT DE TREUIL") === false);
check("PMR non détecté (attestation)", detecterPmr("ATTESTATION GAZ") === false);

// ── Périmètre PSP : priorité des règles ─────────────────────────────────────
const pPmrCp = resoudrePerimetrePsp({ naac: "CP", wnature: "ADAPT PMR - TRAVAUX SDB", charge_operation: null, charges_operation_exclus: [] });
check("PMR (CP) → hors_psp / pmr / PMR", pPmrCp.perimetre_psp === "hors_psp" && pPmrCp.motif_exclusion === "pmr" && pPmrCp.categorie_psp === "PMR" && pPmrCp.est_pmr === true);
const pPmrHo = resoudrePerimetrePsp({ naac: "HO", wnature: "ADAPT PMR - DAAT", charge_operation: null, charges_operation_exclus: [] });
check("PMR (HO) → hors_psp / pmr", pPmrHo.perimetre_psp === "hors_psp" && pPmrHo.motif_exclusion === "pmr");
const pCharge = resoudrePerimetrePsp({ naac: "CP", wnature: "REMPLACEMENT DE VELUX", charge_operation: "UTIC-X", charges_operation_exclus: ["UTIC-X"] });
check("Chargé exclu (CP) → hors_psp / autre_charge_operation", pCharge.perimetre_psp === "hors_psp" && pCharge.motif_exclusion === "autre_charge_operation");
const pAc = resoudrePerimetrePsp({ naac: "AC", wnature: "REHABILITATION", charge_operation: null, charges_operation_exclus: [] });
check("AC → hors_psp / naac_hors_psp", pAc.perimetre_psp === "hors_psp" && pAc.motif_exclusion === "naac_hors_psp");
const pHo = resoudrePerimetrePsp({ naac: "HO", wnature: "ATTESTATION GAZ", charge_operation: null, charges_operation_exclus: [] });
check("HO → hors_psp / naac_hors_psp", pHo.perimetre_psp === "hors_psp" && pHo.motif_exclusion === "naac_hors_psp");
for (const naac of ["GE", "GT", "CP"]) {
  const p = resoudrePerimetrePsp({ naac, wnature: "REMPLACEMENT DE VELUX", charge_operation: null, charges_operation_exclus: [] });
  check(`${naac} → eligible`, p.perimetre_psp === "eligible" && p.motif_exclusion === null);
}
const pIndet = resoudrePerimetrePsp({ naac: null, wnature: "TRAVAUX DIVERS", charge_operation: null, charges_operation_exclus: [] });
check("NAAC inconnu → a_examiner", pIndet.perimetre_psp === "a_examiner");
const pOverride = resoudrePerimetrePsp({ naac: "AC", wnature: "REHABILITATION", charge_operation: null, charges_operation_exclus: [], override_eligible: true });
check("override → eligible", pOverride.perimetre_psp === "eligible" && pOverride.motif_exclusion === null);
const pPmrCharge = resoudrePerimetrePsp({ naac: "CP", wnature: "ADAPT PMR - TRAVAUX SDB", charge_operation: "UTIC-X", charges_operation_exclus: ["UTIC-X"] });
check("PMR + chargé exclu → PMR gagne (priorité 1)", pPmrCharge.motif_exclusion === "pmr");
const pNonExclu = resoudrePerimetrePsp({ naac: "CP", wnature: "REMPLACEMENT DE VELUX", charge_operation: "UTIC-Y", charges_operation_exclus: ["UTIC-X"] });
check("Chargé non exclu → eligible (CP)", pNonExclu.perimetre_psp === "eligible");

// ── Périmètre PSP : filtres + montant éligible ─────────────────────────────
const perimList = [
  cmd({ comn: "E1", montant_engage: 1000, perimetre_psp: "eligible", est_pmr: false, motif_exclusion: null, charge_operation: "UTIC-A" }),
  cmd({ comn: "P1", montant_engage: 2000, perimetre_psp: "hors_psp", est_pmr: true, motif_exclusion: "pmr", charge_operation: null }),
  cmd({ comn: "H1", montant_engage: 3000, perimetre_psp: "hors_psp", est_pmr: false, motif_exclusion: "naac_hors_psp", charge_operation: null }),
];
check("filtre perimetre=eligible", filtrerCommandesValidation(perimList, { filtre: "toutes", perimetre: "eligible" }).length === 1);
check("filtre perimetre=hors_psp", filtrerCommandesValidation(perimList, { filtre: "toutes", perimetre: "hors_psp" }).length === 2);
check("filtre motif=pmr", filtrerCommandesValidation(perimList, { filtre: "toutes", motif_exclusion: "pmr" }).length === 1);
check("filtre pmr_seulement", filtrerCommandesValidation(perimList, { filtre: "toutes", pmr_seulement: true }).length === 1);
check("filtre charge_operation", filtrerCommandesValidation(perimList, { filtre: "toutes", charges_operation: ["UTIC-A"] }).length === 1);
check("filtre charge inconnu (vide)", filtrerCommandesValidation(perimList, { filtre: "toutes", charges_operation: [""] }).length === 2);
const multiCharge = [
  cmd({ comn: "M1", charge_operation: "HALLEL", perimetre_psp: "eligible" }),
  cmd({ comn: "M2", charge_operation: "FME", perimetre_psp: "eligible" }),
  cmd({ comn: "M3", charge_operation: null, perimetre_psp: "hors_psp" }),
];
check("filtre multi-chargés (2 chargés)", filtrerCommandesValidation(multiCharge, { filtre: "toutes", charges_operation: ["HALLEL", "FME"] }).length === 2);
check("filtre multi-chargés (1 seul)", filtrerCommandesValidation(multiCharge, { filtre: "toutes", charges_operation: ["HALLEL"] }).length === 1);
check("filtre multi-chargés vide = aucun", filtrerCommandesValidation(multiCharge, { filtre: "toutes", charges_operation: [] }).length === 3);
check("montant éligible uniquement (1000)", montantTotalEligible(perimList) === 1000);
check("montant éligible vide", montantTotalEligible([]) === 0);

console.log(`\n${passed} passé(s), ${failed} échec(s)`);
process.exit(failed > 0 ? 1 : 0);
