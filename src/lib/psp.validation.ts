/**
 * PSP — Module PUR de validation des classifications.
 *
 * Aucune dépendance Supabase / Vite / React : testable en Node pur.
 * Contient :
 *  - le score de priorité de validation (formule TRANSPARENTE et explicable) ;
 *  - la construction du feedback (aligné sur psp_feedback / savePspFeedback) ;
 *  - les champs modifiables vs source (garde anti-modification) ;
 *  - les filtres et la recherche (purs) ;
 *  - le calcul de montants de groupes.
 *
 * Aucune écriture ici.
 */
import type { PspClassificationResult } from "./psp.classification.ts";

// ── Priorité ────────────────────────────────────────────────────────────────

export type PspNiveauPriorite = "elevee" | "moyenne" | "faible";

export interface PspScorePriorite {
  /** 0..100. */
  score: number;
  niveau: PspNiveauPriorite;
  /** Raisons humainement lisibles (« Pourquoi cette priorité ? »). */
  raisons: string[];
}

export interface PspScorePrioriteInput {
  montant_engage: number | null;
  confiance: number;
  exceptionnelle: boolean;
  multi_domaine: boolean;
  domaine_technique: string;
  type_intervention: string;
}

const DOMAINES_STRATEGIQUES = [
  "couverture",
  "etancheite",
  "facade",
  "ascenseur",
  "ssi",
  "electricite",
];

const fmtMontant = (v: number): string => new Intl.NumberFormat("fr-FR").format(Math.round(v));

/**
 * Score de priorité de validation — formule EXPLICABLE (aucune boîte noire).
 *
 * Pondération :
 *  1. Montant engagé         : 0..30 points (seuils 10k / 50k / 150k €)
 *  2. Confiance IA           : 0..30 points (0.30→30, 0.50→20, 0.75→10, 0.90→0)
 *  3. Caractère exceptionnel : 0..20 points
 *  4. Multi-domaines         : 0..15 points
 *  5. Importance du domaine  : 0..10 points (enveloppe/ascenseur/SSI/élec = stratégiques)
 *  6. Type d'intervention    : 0..10 points (sinistre/urgence/réhabilitation/indéterminé)
 *
 * Niveau : score ≥ 60 → ÉLEVÉE · score ≥ 35 → MOYENNE · sinon FAIBLE.
 */
export function calculerScorePriorite(input: PspScorePrioriteInput): PspScorePriorite {
  const raisons: string[] = [];
  let score = 0;

  const m = input.montant_engage ?? 0;
  if (m >= 150000) {
    score += 30;
    raisons.push(`montant très élevé (${fmtMontant(m)} €)`);
  } else if (m >= 50000) {
    score += 22;
    raisons.push(`montant élevé (${fmtMontant(m)} €)`);
  } else if (m >= 10000) {
    score += 14;
    raisons.push(`montant moyen (${fmtMontant(m)} €)`);
  } else if (m > 0) {
    score += 5;
  }

  if (input.confiance < 0.5) {
    score += 30;
    raisons.push(`confiance faible (${input.confiance.toFixed(2)})`);
  } else if (input.confiance < 0.6) {
    score += 20;
    raisons.push(`confiance à contrôler (${input.confiance.toFixed(2)})`);
  } else if (input.confiance < 0.9) {
    score += 10;
    raisons.push(`confiance à contrôler (${input.confiance.toFixed(2)})`);
  }

  if (input.exceptionnelle) {
    score += 20;
    raisons.push("commande exceptionnelle");
  }

  if (input.multi_domaine) {
    score += 15;
    raisons.push("multi-domaines");
  }

  if (DOMAINES_STRATEGIQUES.includes(input.domaine_technique)) {
    score += 10;
    raisons.push(`domaine stratégique (${input.domaine_technique})`);
  } else if (input.domaine_technique === "indetermine") {
    score += 10;
    raisons.push("domaine indéterminé");
  } else if (input.domaine_technique === "multi_domaine") {
    score += 8;
    raisons.push("domaine multiple");
  } else if (input.domaine_technique) {
    score += 5;
  }

  if (input.type_intervention === "sinistre" || input.type_intervention === "urgence") {
    score += 10;
    raisons.push("type sinistre/urgence");
  } else if (input.type_intervention === "rehabilitation") {
    score += 8;
    raisons.push("type réhabilitation");
  } else if (input.type_intervention === "indetermine") {
    score += 8;
    raisons.push("type indéterminé");
  }

  score = Math.min(100, score);
  const niveau: PspNiveauPriorite = score >= 60 ? "elevee" : score >= 35 ? "moyenne" : "faible";
  return { score, niveau, raisons };
}

export const niveauPriorite = (score: number): PspNiveauPriorite =>
  score >= 60 ? "elevee" : score >= 35 ? "moyenne" : "faible";

// ── Feedback (aligné sur psp_feedback / savePspFeedback) ────────────────────

export type PspDecisionUtilisateur =
  "validate" | "modify" | "reject" | "indeterminate" | "proposer_regle";

export interface PspFeedbackPayload {
  cible_type: "commande" | "import" | "patrimoine" | "autre";
  cible_id: string;
  proposition_initiale: Record<string, unknown> | null;
  decision_utilisateur: string;
  correction: Record<string, unknown> | null;
  motif: string | null;
}

export interface PspFeedbackInput {
  cible_id: string;
  proposition_initiale: Record<string, unknown> | null;
  decision: PspDecisionUtilisateur;
  correction?: Record<string, unknown> | null;
  motif?: string | null;
  cible_type?: "commande" | "import" | "patrimoine" | "autre";
}

/** Construit le payload exact attendu par savePspFeedback (colonnes réelles). */
export function construireFeedbackPsp(opts: PspFeedbackInput): PspFeedbackPayload {
  return {
    cible_type: opts.cible_type ?? "commande",
    cible_id: opts.cible_id,
    proposition_initiale: opts.proposition_initiale ?? null,
    decision_utilisateur: opts.decision,
    correction: opts.correction ?? null,
    motif: opts.motif ?? null,
  };
}

// ── Champs modifiables vs source (garde) ─────────────────────────────────────

/** Valeurs possibles pour chaque champ de classification (formulaire de modif). */
export const OPTIONS_TYPE_INTERVENTION = [
  "diagnostic",
  "controle",
  "prestation_intellectuelle",
  "mise_en_conformite",
  "mise_en_securite",
  "urgence",
  "sinistre",
  "rehabilitation",
  "remplacement",
  "reparation",
  "entretien",
  "amelioration",
  "amenagement",
  "indetermine",
] as const;

export const OPTIONS_DOMAINE_TECHNIQUE = [
  "plomberie",
  "chauffage",
  "ventilation",
  "electricite",
  "ssi",
  "ascenseur",
  "couverture",
  "etancheite",
  "facade",
  "menuiserie",
  "serrurerie_acces",
  "peinture_pc",
  "vrd_exterieur",
  "diagnostic",
  "multi_domaine",
  "indetermine",
] as const;

export const OPTIONS_FAMILLE_PSP = [
  "enveloppe",
  "couverture_toiture",
  "parties_communes",
  "equipements_techniques",
  "securite",
  "plomberie",
  "electricite",
  "menuiseries",
  "amenagements_exterieurs",
  "diagnostics",
  "autre",
  "indetermine",
] as const;

export const OPTIONS_ELEMENT_PATRIMONIAL = [
  "tranche",
  "batiment",
  "entree",
  "lot",
  "couverture",
  "toiture",
  "facade",
  "hall",
  "cage_escalier",
  "equipement",
  "autre",
] as const;

export const OPTIONS_NATURE_EXCEPTIONNELLE = [
  "sinistre",
  "signalement",
  "urgence",
  "acquisition_patrimoine_ancien",
  "commande_exceptionnelle",
  "aucune",
  "indetermine",
] as const;

/** Champs de classification modifiables par l'humain. */
export const CHAMPS_MODIFIABLES = [
  "type_intervention",
  "domaine_technique",
  "famille_psp",
  "element_patrimonial",
  "nature_exceptionnelle",
] as const;

/** Champs SOURCE (historique) — jamais modifiables par la validation. */
export const CHAMPS_SOURCE_IMMUABLES = [
  "comn",
  "comc",
  "naac",
  "montant_budget",
  "montant_engage",
  "patrimoine",
  "adresse",
  "commune",
  "wnature",
  "fournisseur",
  "date_commande",
  "numero_commande_interne",
  "numero_commande",
  "corps_etat_libelle",
  "nature_analytique",
  "donnees_brutes",
] as const;

/**
 * Vérifie qu'une modification ne touche QUE des champs de classification.
 * Retourne la liste des champs interdits tentés (vide = OK).
 */
export function champsInterditsModification(modification: Record<string, unknown>): string[] {
  const interdits = CHAMPS_SOURCE_IMMUABLES.filter((f) => f in modification);
  const inconnus = Object.keys(modification).filter(
    (k) =>
      !CHAMPS_MODIFIABLES.includes(k as (typeof CHAMPS_MODIFIABLES)[number]) &&
      !CHAMPS_SOURCE_IMMUABLES.includes(k as (typeof CHAMPS_SOURCE_IMMUABLES)[number]),
  );
  return [...interdits, ...inconnus];
}

// ── Filtres ─────────────────────────────────────────────────────────────────

export type PspFiltreValidation =
  | "toutes"
  | "haute_priorite"
  | "moyenne_priorite"
  | "faible_priorite"
  | "multi_domaines"
  | "exceptionnelles"
  | "faible_confiance";

export interface PspFiltresValidation {
  filtre: PspFiltreValidation;
  naac?: string | null;
  domaine?: string | null;
  type?: string | null;
  commune?: string | null;
  tranche?: string | null;
  batiment?: string | null;
  /** Restreindre aux commandes nécessitant une validation. */
  aValiderSeulement?: boolean;
  /** Périmètre PSP. */
  perimetre?: PspPerimetre | null;
  /** Motif d'exclusion. */
  motif_exclusion?: PspMotifExclusion | null;
  /** Ne garder que les commandes PMR. */
  pmr_seulement?: boolean;
  /** Chargés d'opération (multi) — vide = tous. */
  charges_operation?: string[] | null;
}

/** Filtre une liste de commandes validées selon les critères demandés. */
export function filtrerCommandesValidation(
  commandes: PspCommandeValidation[],
  f: PspFiltresValidation,
): PspCommandeValidation[] {
  return commandes.filter((c) => {
    if (f.aValiderSeulement && !c.besoin_validation_humaine) return false;
    if (f.filtre === "haute_priorite" && c.niveau_priorite !== "elevee") return false;
    if (f.filtre === "moyenne_priorite" && c.niveau_priorite !== "moyenne") return false;
    if (f.filtre === "faible_priorite" && c.niveau_priorite !== "faible") return false;
    if (f.filtre === "multi_domaines" && c.domaine_technique !== "multi_domaine") return false;
    if (f.filtre === "exceptionnelles" && c.nature_exceptionnelle === "aucune") return false;
    if (f.filtre === "faible_confiance" && c.confiance >= 0.6) return false;
    if (f.naac && c.naac !== f.naac) return false;
    if (f.domaine && c.domaine_technique !== f.domaine) return false;
    if (f.type && c.type_intervention !== f.type) return false;
    if (f.commune && (c.commune ?? "") !== f.commune) return false;
    if (f.tranche && !(c.patrimoine ?? "").toUpperCase().startsWith("ER.T")) return false;
    if (f.batiment && !(c.patrimoine ?? "").toUpperCase().startsWith("ER.B")) return false;
    if (f.perimetre && c.perimetre_psp !== f.perimetre) return false;
    if (f.motif_exclusion && c.motif_exclusion !== f.motif_exclusion) return false;
    if (f.pmr_seulement && !c.est_pmr) return false;
    if (f.charges_operation && f.charges_operation.length > 0) {
      const ch = c.charge_operation ?? "";
      if (!f.charges_operation.includes(ch)) return false;
    }
    return true;
  });
}

// ── Recherche ───────────────────────────────────────────────────────────────

const normRecherche = (s: string | null | undefined): string =>
  (s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

/** Recherche globale sur COMN_NUM, COMC_NOLIG, ER, WNATURE, adresse, commune. */
export function rechercherCommandes(
  commandes: PspCommandeValidation[],
  query: string,
): PspCommandeValidation[] {
  const q = normRecherche(query.trim());
  if (!q) return commandes;
  return commandes.filter((c) =>
    [c.comn, c.comc, c.patrimoine, c.wnature, c.adresse, c.commune]
      .map((v) => normRecherche(v))
      .some((v) => v.includes(q)),
  );
}

// ── Montants de groupes ─────────────────────────────────────────────────────

export const montantTotalCommandes = (
  commandes: Pick<PspCommandeValidation, "montant_engage">[],
): number => commandes.reduce((s, c) => s + (c.montant_engage ?? 0), 0);

/** Montant total PSP = uniquement les commandes de périmètre « eligible ». */
export const montantTotalEligible = (
  commandes: Pick<PspCommandeValidation, "montant_engage" | "perimetre_psp">[],
): number =>
  commandes
    .filter((c) => c.perimetre_psp === "eligible")
    .reduce((s, c) => s + (c.montant_engage ?? 0), 0);

export const montantTotalGroupes = (groupes: Pick<PspGroupeApercu, "montant_total">[]): number =>
  groupes.reduce((s, g) => s + g.montant_total, 0);

// ── Périmètre PSP (règles métier) ───────────────────────────────────────────

/**
 * Périmètre PSP d'une commande :
 *  - eligible    : intégrée aux travaux PSP (vieillissement, récurrences,
 *                  propositions, arbitrages budgétaires) ;
 *  - hors_psp    : conservée dans l'historique mais EXCLUE des travaux PSP ;
 *  - a_examiner  : cas ambigu nécessitant une décision humaine.
 */
export type PspPerimetre = "eligible" | "hors_psp" | "a_examiner";

export type PspMotifExclusion = "pmr" | "autre_charge_operation" | "naac_hors_psp" | null;

/** Catégorie PSP : source = NAAC_CODE ; « PMR » pour les travaux PMR. */
export type PspCategoriePsp = "PMR" | "GE" | "GT" | "CP" | "AC" | "HO" | null;

export interface PspPerimetreResult {
  perimetre_psp: PspPerimetre;
  motif_exclusion: PspMotifExclusion;
  categorie_psp: PspCategoriePsp;
  est_pmr: boolean;
}

export interface PspPerimetreInput {
  /** NAAC_CODE — source de vérité budgétaire (jamais modifiée). */
  naac: string | null;
  /** WNATURE (libellé) — pour la détection PMR. */
  wnature: string;
  /** Chargé d'opération (UTIC_CODE) ; null si inconnu / non importé. */
  charge_operation: string | null;
  /** Chargés d'opération exclus — décision humaine configurable. */
  charges_operation_exclus: string[];
  /** Override manuel : réintègre exceptionnellement la commande dans le PSP. */
  override_eligible?: boolean;
}

/** Libellés identifiant un travail PMR (toujours hors périmètre PSP). */
const REGEX_PMR = /(^|\s)PMR($|\s)|ADAPT|ADAPTATION|DAAT|BARRE D APPUI|SDB ET WC SURELEVE|REHAUSSE/;

/** Détection PMR (sur libellé normalisé). */
export const detecterPmr = (wnature: string): boolean => REGEX_PMR.test(wnature);

/**
 * Chargés d'opération exclus du périmètre PSP (décision humaine).
 * VIDE PAR DÉFAUT : on ne déduit JAMAIS l'exclusion à partir du nom. À
 * configurer explicitement (décision humaine).
 */
export const CHARGES_OPERATION_EXCLUS_PAR_DEFAUT: string[] = [];

const NAAC_PSP = ["GE", "GT", "CP"];
const NAAC_HORS_PSP = ["AC", "HO"];

/**
 * Résout le périmètre PSP d'une commande, dans l'ordre de priorité :
 *  1. PMR                        → hors_psp (motif « pmr »)
 *  2. Chargé d'opération exclu   → hors_psp (motif « autre_charge_operation »)
 *  3. NAAC_CODE AC / HO          → hors_psp (motif « naac_hors_psp »)
 *  4. NAAC_CODE GE / GT / CP     → eligible
 *  5. Sinon (inconnu)            → a_examiner
 * L'override manuel (override_eligible) réintègre exceptionnellement la
 * commande dans le PSP (perimetre = eligible, motif = null).
 */
export function resoudrePerimetrePsp(input: PspPerimetreInput): PspPerimetreResult {
  const estPmr = detecterPmr(input.wnature);
  const naac = (input.naac ?? "").trim().toUpperCase();
  const charge = (input.charge_operation ?? "").trim();
  const chargeExclu = charge !== "" && input.charges_operation_exclus.includes(charge);

  let perimetre: PspPerimetre;
  let motif: PspMotifExclusion;
  let categorie: PspCategoriePsp;

  if (estPmr) {
    perimetre = "hors_psp";
    motif = "pmr";
    categorie = "PMR";
  } else if (chargeExclu) {
    perimetre = "hors_psp";
    motif = "autre_charge_operation";
    categorie =
      (NAAC_PSP as string[]).includes(naac) || NAAC_HORS_PSP.includes(naac)
        ? (naac as PspCategoriePsp)
        : null;
  } else if (NAAC_HORS_PSP.includes(naac)) {
    perimetre = "hors_psp";
    motif = "naac_hors_psp";
    categorie = naac as PspCategoriePsp;
  } else if (NAAC_PSP.includes(naac)) {
    perimetre = "eligible";
    motif = null;
    categorie = naac as PspCategoriePsp;
  } else {
    perimetre = "a_examiner";
    motif = null;
    categorie = null;
  }

  if (input.override_eligible === true) {
    perimetre = "eligible";
    motif = null;
  }

  return {
    perimetre_psp: perimetre,
    motif_exclusion: motif,
    categorie_psp: categorie,
    est_pmr: estPmr,
  };
}

// ── Types d'affichage (partagés serveur → UI) ───────────────────────────────

/** Ligne de validation affichable (source + classification + score). */
export interface PspCommandeValidation {
  comn: string;
  comc: string | null;
  naac: string | null;
  patrimoine: string | null;
  adresse: string | null;
  commune: string | null;
  wnature: string;
  montant_budget: number | null;
  montant_engage: number | null;
  fournisseur: string | null;
  date_commande: string | null;
  er_reference: string | null;
  // classification
  type_intervention: string;
  domaine_technique: string;
  domaines_detectes: string[];
  famille_psp: string;
  element_patrimonial: string;
  nature_exceptionnelle: string;
  confiance: number;
  besoin_validation_humaine: boolean;
  regle_appliquee: string;
  justification: string;
  projet_relais_chelles: boolean;
  libelle_normalise: string;
  // score
  score_priorite: number;
  niveau_priorite: PspNiveauPriorite;
  raisons_priorite: string[];
  /** Motifs humainement lisibles indiquant pourquoi la validation est demandée. */
  motif_validation: string[];
  // périmètre PSP
  charge_operation: string | null;
  perimetre_psp: PspPerimetre;
  motif_exclusion: PspMotifExclusion;
  categorie_psp: PspCategoriePsp;
  est_pmr: boolean;
}

/** Groupe de validation (règle + libellé normalisé + domaine + type + famille). */
export interface PspGroupeApercu {
  cle: string;
  libelle_normalise: string;
  regle_appliquee: string;
  domaine_technique: string;
  type_intervention: string;
  famille_psp: string;
  occurrences: number;
  montant_total: number;
  confiance_moyenne: number;
  niveau_priorite: PspNiveauPriorite;
  score_priorite: number;
  raisons_priorite: string[];
  comn_liste: string[];
}

/** Construit un groupe d'aperçu à partir d'un groupe de validation + commandes. */
export function construireGroupeApercu(
  groupe: {
    cle: string;
    libelle_normalise: string;
    regle_appliquee: string;
    domaine_technique: string;
    type_intervention: string;
    famille_psp: string;
    occurrences: number;
    montant_total: number;
    comn_liste: string[];
  },
  membres: PspCommandeValidation[],
): PspGroupeApercu {
  const conf = membres.length ? membres.reduce((s, c) => s + c.confiance, 0) / membres.length : 0;
  const score = calculerScorePriorite({
    montant_engage: groupe.montant_total,
    confiance: Math.min(...membres.map((c) => c.confiance), 0.99),
    exceptionnelle: membres.some((c) => c.nature_exceptionnelle !== "aucune"),
    multi_domaine: membres.some((c) => c.domaine_technique === "multi_domaine"),
    domaine_technique: groupe.domaine_technique,
    type_intervention: groupe.type_intervention,
  });
  return {
    ...groupe,
    confiance_moyenne: conf,
    niveau_priorite: score.niveau,
    score_priorite: score.score,
    raisons_priorite: score.raisons,
  };
}

/** Détection de corrections récurrentes (apprentissage progressif, sans règle auto). */
export interface PspSuggestionRegle {
  domaine: string;
  type: string;
  occurrences: number;
  motif_exemple: string | null;
}

export const SEUIL_SUGGESTION_REGLE = 3;

/**
 * Analyse les feedbacks enregistrés : si ≥ SEUIL corrections « modify » avec le
 * même domaine/type corrigé, propose une règle générale (TOUJOURS soumise à
 * validation humaine — cette fonction ne crée jamais de règle).
 */
export function detecterCorrectionsRecurrentes(
  feedbacks: Array<{
    cible_id: string;
    proposition_initiale: Record<string, unknown> | null;
    decision_utilisateur: string;
    correction: Record<string, unknown> | null;
  }>,
  seuil = SEUIL_SUGGESTION_REGLE,
): PspSuggestionRegle[] {
  const compteur = new Map<
    string,
    { domaine: string; type: string; n: number; motif: string | null }
  >();
  for (const fb of feedbacks) {
    if (fb.decision_utilisateur !== "modify" || !fb.correction) continue;
    const domaine = String((fb.correction as Record<string, unknown>)?.["domaine_technique"] ?? "");
    const type = String((fb.correction as Record<string, unknown>)?.["type_intervention"] ?? "");
    if (!domaine) continue;
    const cle = `${domaine}::${type}`;
    const cur = compteur.get(cle) ?? { domaine, type, n: 0, motif: null };
    cur.n += 1;
    if (
      !cur.motif &&
      typeof (fb.proposition_initiale as Record<string, unknown> | null)?.["libelle_normalise"] ===
        "string"
    ) {
      cur.motif = (fb.proposition_initiale as Record<string, unknown>)[
        "libelle_normalise"
      ] as string;
    }
    compteur.set(cle, cur);
  }
  return [...compteur.values()]
    .filter((c) => c.n >= seuil)
    .map((c) => ({ domaine: c.domaine, type: c.type, occurrences: c.n, motif_exemple: c.motif }));
}

// ── Helpers d'enrichissement Historique CMD (purs, partagés Dashboard + adresses) ──
// Aucune écriture ici. Ces fonctions ne font que du formatage / de la détection :
// les données sources (psp_import_rows, travaux_commandes, Excel) restent intactes.

const MOIS_EN = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * Formate une date Historique CMD en français (DD/MM/YYYY).
 * Accepte les formats réellement rencontrés : chaîne locale JS
 * (« Wed Feb 01 2023 23:59:39 GMT+0100 … »), ISO (YYYY-MM-DD) et française.
 * Retourne null si non convertible — ne lève jamais.
 */
export function formatDateCommandeFr(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s) return null;
  const pad = (n: number) => String(n).padStart(2, "0");

  // YYYY-MM-DD[ T…]
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})([ T]|$)/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;

  // DD/MM/YYYY · DD-MM-YYYY · DD.MM.YYYY
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return `${pad(Number(m[1]))}/${pad(Number(m[2]))}/${m[3]}`;

  // Weekday Mon DD YYYY …
  m = s.match(/^[A-Za-z]+,? ([A-Za-z]{3}) (\d{1,2}) (\d{4})/);
  if (m) {
    const mois = MOIS_EN.indexOf(m[1] ?? "");
    if (mois >= 0) return `${pad(Number(m[2]))}/${pad(mois + 1)}/${m[3]}`;
  }

  // Repli : Date.parse générique.
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  }
  return null;
}

/** Types de décision humaine enregistrables dans psp_decisions. */
export const TYPES_DECISION_PSP = [
  "nature",
  "corps_etat",
  "perimetre_psp",
  "rapprochement",
] as const;
export type TypeDecisionPsp = (typeof TYPES_DECISION_PSP)[number];

/** Statuts autorisés d'une décision psp_decisions. */
export const STATUTS_DECISION_PSP = ["valide", "proposition", "rejete"] as const;
export type StatutDecisionPsp = (typeof STATUTS_DECISION_PSP)[number];

/**
 * Clé métier d'une décision : COMMANDE:<numero_commande>:<type>.
 * <numero_commande> = COMN_NUM (numero_commande_interne), l'identifiant technique
 * unique de la ligne source ISIS — jamais COMC_NOLIG (nullable, non unique).
 */
export function construireCleMetierCommande(numeroCommande: string, type: TypeDecisionPsp): string {
  return `COMMANDE:${numeroCommande || "?"}:${type}`;
}

/**
 * Vrai si les deux natures sont renseignées et différentes
 * (incohérence à présenter à l'utilisateur, aucune valeur modifiée).
 */
export function detecterIncoherenceNature(
  suiviAnnuel: string | null | undefined,
  historique: string | null | undefined,
): boolean {
  const a = (suiviAnnuel ?? "").trim().toUpperCase();
  const b = (historique ?? "").trim().toUpperCase();
  return a !== "" && b !== "" && a !== b;
}

/**
 * WNOTES depuis donnees_brutes — le parser PSP mappe WNOTES.Ana_comd_trav_er
 * vers `descriptif` (et une variante vers `observations`). La donnée est lue
 * telle quelle, jamais recopiée dans travaux_commandes.
 */
export function extraireWNotes(
  donneesBrutes: Record<string, unknown> | null | undefined,
): string | null {
  const d = donneesBrutes ?? {};
  const v = d["descriptif"] ?? d["observations"] ?? null;
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/**
 * Chargé d'opération Historique CMD (UTIC_CODE.Ana_comd_trav_er normalisée en
 * `charge_operation` par le parser) depuis donnees_brutes.
 */
export function extraireChargePsp(
  donneesBrutes: Record<string, unknown> | null | undefined,
): string | null {
  const d = donneesBrutes ?? {};
  const v = d["charge_operation"] ?? d["utic_code"] ?? d["utic"] ?? d["UTIC_CODE"] ?? null;
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/**
 * RattachEment WPATRIMOINE ambigu ? Le parser ne choisit JAMAIS arbitrairement :
 * il marque er_ambigue / niveau_rattachement='ambiguous' → « À VALIDER ».
 */
export function patrimoineAmbigue(
  donneesBrutes: Record<string, unknown> | null | undefined,
): boolean {
  const d = donneesBrutes ?? {};
  return d["er_ambigue"] === true || d["niveau_rattachement"] === "ambiguous";
}
