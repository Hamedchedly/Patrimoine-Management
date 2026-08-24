/**
 * PSP — Classification métier normalisée (module PUR).
 *
 * Aucune dépendance Supabase / Vite / React : utilisable en Node pur
 * (type stripping) et testable directement. Ne lit et n'écrit RIEN.
 *
 * Principe :
 *  - `NAAC_CODE` est la SOURCE DE VÉRITÉ budgétaire (GE/GT/CP/AC/HO) et n'est
 *    JAMAIS utilisé pour déduire le domaine technique ni modifié.
 *  - `WNATURE` (corps_etat_libelle) est la source principale de
 *    type_intervention et domaine_technique.
 *  - descriptif / observations : contexte SECONDAIRE uniquement (utilisé
 *    seulement si WNATURE ne donne rien) ; un mot présent uniquement dans le
 *    descriptif ne peut jamais écraser une classification fiable de WNATURE.
 *  - Hiérarchie stricte du type d'intervention (ordre de priorité).
 *  - Multi-domaines → `multi_domaine` + validation humaine obligatoire.
 *  - Libellés génériques → validation humaine obligatoire (type non inventé).
 *  - Cas exceptionnels (réhabilitation, restructuration, remplacement complet
 *    d'équipement majeur, sinistre, urgence, acquisition…) → signalés.
 *  - Projet « RELAIS DE CHELLES » traité comme cas particulier (lots distincts).
 */

// ── Types ───────────────────────────────────────────────────────────────────

export type PspTypeIntervention =
  | "diagnostic"
  | "controle"
  | "prestation_intellectuelle"
  | "mise_en_conformite"
  | "mise_en_securite"
  | "urgence"
  | "sinistre"
  | "rehabilitation"
  | "remplacement"
  | "reparation"
  | "entretien"
  | "amelioration"
  | "amenagement"
  | "indetermine";

export type PspDomaineTechnique =
  | "plomberie"
  | "chauffage"
  | "ventilation"
  | "electricite"
  | "ssi"
  | "ascenseur"
  | "couverture"
  | "etancheite"
  | "facade"
  | "menuiserie"
  | "serrurerie_acces"
  | "peinture_pc"
  | "vrd_exterieur"
  | "diagnostic"
  | "multi_domaine"
  | "indetermine";

export type PspFamillePsp =
  | "enveloppe"
  | "couverture_toiture"
  | "parties_communes"
  | "equipements_techniques"
  | "securite"
  | "plomberie"
  | "electricite"
  | "menuiseries"
  | "amenagements_exterieurs"
  | "diagnostics"
  | "autre"
  | "indetermine";

export type PspElementPatrimonial =
  | "tranche"
  | "batiment"
  | "entree"
  | "lot"
  | "couverture"
  | "toiture"
  | "facade"
  | "hall"
  | "cage_escalier"
  | "equipement"
  | "autre";

export type PspNatureExceptionnelle =
  | "sinistre"
  | "signalement"
  | "urgence"
  | "acquisition_patrimoine_ancien"
  | "commande_exceptionnelle"
  | "aucune"
  | "indetermine";

export interface PspClassificationInput {
  /** COMN_NUM — identifiant unique de la ligne. */
  comn: string;
  /** COMC_NOLIG — numéro lisible, nullable, non unique. */
  comc?: string | null;
  /** NAAC_CODE — catégorie budgétaire (source de vérité, jamais modifiée). */
  naac?: string | null;
  /** WNATURE — corps_etat_libelle (source principale). */
  wnature: string;
  /** WPATRIMOINE (ex ER.T1396) — pour le niveau patrimonial. */
  patrimoine?: string | null;
  montant_engage?: number | null;
  descriptif?: string | null;
  observations?: string | null;
}

export interface PspClassificationResult {
  comn: string;
  type_intervention: PspTypeIntervention;
  domaine_technique: PspDomaineTechnique;
  /** Domaines techniques détectés (bruts), avant décision multi/unique. */
  domaines_detectes: string[];
  famille_psp: PspFamillePsp;
  element_patrimonial: PspElementPatrimonial;
  nature_exceptionnelle: PspNatureExceptionnelle;
  /** 0.90 | 0.75 | 0.50 | 0.30 (échelle discrète). */
  confiance: number;
  besoin_validation_humaine: boolean;
  /** Règle appliquée (id court, pour regroupement de validation). */
  regle_appliquee: string;
  justification: string;
  /** NAAC_CODE réflété tel quel (jamais modifié). */
  naac_source: string | null;
  /** Vrai si la commande appartient au projet global RELAIS DE CHELLES. */
  projet_relais_chelles: boolean;
  /** Libellé WNATURE normalisé (pour regroupement strictement identique). */
  libelle_normalise: string;
  /** Montant engagé réflété (pour totaux de groupes), null si inconnu. */
  montant_engage: number | null;
}

// ── Normalisation (analyse uniquement) ──────────────────────────────────────

/** Normalise pour l'analyse : minuscule→MAJ, accents retirés, ponctuation→espace. */
export const normaliserTexte = (s: string | null | undefined): string =>
  (s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// ── Règles de domaine technique (mots-clés normalisés) ──────────────────────
// Note : « BAL » (éclairage de sécurité) et « DAD » sont traités par tokens
// (règles spéciales) pour éviter les faux positifs (ex. BALCONS).

const REGLES_DOMAINE: Array<[string, string[]]> = [
  ["couverture", ["COUVERTURE", "TOITURE", "TOIT", "TUIL", "ZINC", "CHENEAU", "GOUTTIERE", "NOUE", "FAITAGE", "ARETIER", "DEMOUSSAGE", "DESCENTE", "VELUX", "LIERE", "ARDOISE"]],
  ["ascenseur", ["ASCENSEUR", "TREUIL", "VERIN"]],
  ["chauffage", ["CHAUFFAGE", "CHAUDIERE", "RADIATEUR", "THERMOSTATIQUE", "VANNES", "PRODUCTION ECS", "BRASSAGE", "GAZ", "GRDF", "GAINE", "BALLON SOLAIRE", "BALLON THEROMDYNAMIQUE", "BALLON THERMODYNAMIQUE"]],
  ["etancheite", ["ETANCHEITE", "TERRASSE", "BALCON", "DALLE SUR PLOT", "RELEVE", "BATARDEAU", "INFILTRATION", "GRAVILLONNE"]],
  ["facade", ["FACADE", "RAVALEMENT", " ITE", "ISOLATION THERMIQUE PAR L EXTERIEUR", "PONT THERMIQUE"]],
  ["plomberie", ["PLOMBERIE", "FUITE", "CANALISATION", "COLONNE", "ROBINET", "DISCONNECTEUR", "REDUCTEUR DE PRESSION", "SDB", "WC", "DOUCHE", "EVIER", "ALIM ", "ASSAINISSEMENT", "RELEVAGE", "STATION DE", "POMPE"]],
  ["menuiserie", ["MENUISERIE", "FENETRE", "PORTE", "VOLET", "PERSIENNE", "CHASSIS", "VITRINE", "RIDEAU", "JOINTS", "OUVRANT", "BLOC PORTE", "PORTILLON", "PORTAIL", "L EQUIPEMENT"]],
  ["electricite", ["ELECTRI", "LED", "ECLAIRAGE", "PLAFONNIER", "DETECTEUR", "HORLOGE", "COMPTEUR", "REGLETTE", "CABLES", "COURANT FAIBLE", "ANTENNE", "MODEM", "BILAN DE PUISSANCE"]],
  ["ventilation", ["VMC", "VENTILATION", "RAMONAGE", "DESENFUMAGE", "EXTRACTION", "HYGRO", "CAISSON", "COLONNE SECHE"]],
  ["ssi", ["SSI", "DETECTION", "ALARME", "BAES", "BAEH"]],
  ["serrurerie_acces", ["CONTROLE D ACCES", "HEXACT", "INTERPHONIE", "VISIOPHONIE", "PLATINE", "TELESURVEILLANCE", "VIDEOPROTECTION", "INTRATONE", "ANEP", "CAMERA", "LAPI", "PC SERVEUR", "VERROU", "POIGNEE", "GACHE", "PORTE AUTOMATIQUE", "RIDEAU METALLIQUE"]],
  ["peinture_pc", ["PARTIES COMMUNES", "CAGE D ESCALIER", "CAGE D ESCALIERS", "HALL", "COULOIR", "PEINTURE", "PAPIER", "EMBELLISSEMENT", "FAUX PLAFOND", "TAPIS", "CARRELAGE", "REVETEMENT", "REV SOL", "ESPACES COMMUNS"]],
  ["vrd_exterieur", ["PARKING", "ENROBE", "ESPACE EXT", "ESPACES EXTERIEURS", "CLOTURE", "AIRE DE JEUX", "ABRI", "JARDIN", "ELAGAGE", "ABATTAGE", "ESPACES VERTS", "RATELIER", "STOP PARK", "SEPARATIF", "DALLE", "LOCAL VELO", "CHEMIN", "MARQUAGE AU SOL", "PLACES DE PARKING"]],
  ["diagnostic", ["DIAGNOSTIC", "DIAG ", "AUDIT", "INVESTIGATION", "FUMIGENE", "CAMERA VIDEO"]],
];

/** Règles spéciales (tokens exacts) pour éviter les faux positifs. */
const REGLES_DOMAINE_TOKENS: Array<{ domaine: string; regex: RegExp }> = [
  { domaine: "ssi", regex: /(^|\s)BAL($|\s)/ }, // Bloc Autonome de Luminescence (éclairage sécurité)
  { domaine: "ssi", regex: /(^|\s)DAD($|\s)/ }, // Dispositif Actionné de Désenfumage
  { domaine: "plomberie", regex: /(^|\s)EAUX?($|\s)/ }, // eau / eaux (évite RIDEAUX, CHENEAUX)
];

// ── Hiérarchie stricte du type d'intervention ───────────────────────────────

const REGLES_TYPE: Array<[string, string[]]> = [
  ["diagnostic", ["DIAGNOSTIC", "DIAG ", "RECHERCHE DE FUITE", "INVESTIGATION", "INSPECTION", "AUDIT", "CAMERA VIDEO", "FUMIGENE"]],
  ["controle", ["ATTESTATION", "CONTROLE DE", "CONTROLE DES", "CONSTAT", "VERIFICATION", "MAJ DPE", "DPE"]],
  ["prestation_intellectuelle", ["HONORAIRE", "MISSION MOE", "MOE EXE", "MISSION SPS", "SPS ", "MAITRISE", "ASSISTANCE", "ETUDE", "PRESTATION COMPLEMENTAIRE", "VISUEL", "PRECONISATION", "MODIFICATIONS PRECONISATIONS"]],
  ["mise_en_conformite", ["MISE AUX NORMES", "MISE AUX NOMRES", "MISE EN CONFORMITE", "CONFORMITE"]],
  ["mise_en_securite", ["MISE EN SECURITE", "SECURISATION", "AMELIORATION SECURITE", "CONDAMNATION", "MESURE CONSERVATOIRE"]],
  ["urgence", ["URGENT", "URGENCE"]],
  ["sinistre", ["SUITE FUITE", "SUITE DEGAT", "DEGAT DES EAUX", "SUITE DDE", "MOISSISURE", "INFILTRATION", "TERRASSE HS", "CONSERVATOIRE", "SINISTRE", "SUITE INFILTRATION"]],
  ["rehabilitation", ["REHABILIT", "RESTRUCTURATION", "RENOVATION", "DEMOLITION", "GROS OEUVRE"]],
  ["remplacement", ["REMPLACEMENT", "REMPLACEMENTS", "REMPLACER", "CHANGEMENT"]],
  ["reparation", ["REPARATION", "REPARER", "REPRISE", "REMANIEMENT", "REMISE EN ETAT", "REVISION", "COLMATAGE", "CONSOLIDATION", "RESTAURATION"]],
  ["entretien", ["ENTRETIEN", "MAINTENANCE", "NETTOYAGE", "RAMONAGE", "DEMOUSSAGE", "DEGIVRAGE"]],
  ["amelioration", ["AMELIORATION", "OPTIMIS", "ISOLATION", "THERMOSTATIQUE", "ECONOMIE D ENERGIE", "HYGRO", "THERMODYNAMIQUE", "LED", "PERFORMANCE", "TELEGESTION", "BILAN DE PUISSANCE"]],
  ["amenagement", ["CREATION", "MISE EN PLACE", "POSE DE", "INSTALLATION", "AMENAGEMENT", "EMBELLISSEMENT", "NUMEROTATION", "MARQUAGE", "PEINTURE DE SOL", "FAUX PLAFOND", "PLAFONNIER", "CLOTURE", "PORTAIL", "RATELIER", "AIRE DE JEUX", "ABRI", "PEINTURE", "DECALAGE", "STOP PARK", "HABILLAGE", "FOURNITURE", "ADAPT", "ADAPTATION", "ACCESSIBIL", "BARRE D APPUI"]],
];

/** Libellés génériques : validation obligatoire, type non inventé. */
const GENERIQUES = new Set([
  "TRAVAUX GENERAUX",
  "TRAVAUX DIVERS",
  "POLYVALENCE",
  "TRAVAUX DE REMISE EN ETAT",
  "TRAVAUX",
  "ASCENSEUR",
  "ASCENSEURS",
  "MENUISERIE",
  "PLOMBERIE",
  "EMBELLISSEMENT",
]);

/** Projet global RELAIS DE CHELLES (détection par libellé). */
const REGEX_RELAIS_CHELLES =
  /RELAIS DE CHELLES|FOYER RELAIS|169 LOGEMENTS|BROU SUR CHANTEREINE/;

/** Correspondance lot → domaine technique (Relais de Chelles). */
const LOT_DOMAINE: Record<string, string> = {
  "LOT 01": "facade",
  "LOT 02": "etancheite",
  "LOT 03": "menuiserie",
  "LOT 04": "menuiserie",
  "LOT 06": "electricite",
  "LOT 07": "vrd_exterieur",
  "LOT 08": "peinture_pc",
};

const FAMILLE: Record<string, PspFamillePsp> = {
  couverture: "couverture_toiture",
  ascenseur: "equipements_techniques",
  chauffage: "equipements_techniques",
  etancheite: "enveloppe",
  facade: "enveloppe",
  plomberie: "plomberie",
  menuiserie: "menuiseries",
  electricite: "electricite",
  ventilation: "equipements_techniques",
  ssi: "securite",
  serrurerie_acces: "securite",
  peinture_pc: "parties_communes",
  vrd_exterieur: "amenagements_exterieurs",
  diagnostic: "diagnostics",
};

// ── Helpers internes ────────────────────────────────────────────────────────

function premiers(texte: string, regles: Array<[string, string[]]>): string | null {
  for (const [nom, mots] of regles) if (mots.some((m) => texte.includes(m))) return nom;
  return null;
}

function domainesDe(texte: string): string[] {
  const dom: string[] = [];
  for (const [nom, mots] of REGLES_DOMAINE) if (mots.some((m) => texte.includes(m))) dom.push(nom);
  for (const r of REGLES_DOMAINE_TOKENS) if (r.regex.test(texte)) dom.push(r.domaine);
  return [...new Set(dom)];
}

function elementPatrimonial(patrimoine: string | null | undefined, libelle: string): PspElementPatrimonial {
  const p = (patrimoine ?? "").toUpperCase();
  if (/^ER\.T/.test(p)) return "tranche";
  if (/^ER\.B/.test(p)) return "batiment";
  if (/^ER\.E/.test(p)) return "entree";
  if (/^ER\.L/.test(p)) return "lot";
  const L = libelle;
  if (/COUVERTURE|TOITURE|TOIT|TUIL|ZINC|NOUE|CHENEAU|GOUTTIERE/.test(L)) return "couverture";
  if (/FACADE|RAVALEMENT| ITE/.test(L)) return "facade";
  if (/HALL/.test(L)) return "hall";
  if (/CAGE D ESCALIER/.test(L)) return "cage_escalier";
  if (/TOITURE|TERRASSE/.test(L)) return "toiture";
  if (/ASCENSEUR/.test(L)) return "equipement";
  if (/PARTIES COMMUNES/.test(L)) return "hall";
  return "autre";
}

// ── Classifieur principal ───────────────────────────────────────────────────

export function classifierCommande(input: PspClassificationInput): PspClassificationResult {
  const L = normaliserTexte(input.wnature);
  const F = normaliserTexte([input.descriptif, input.observations].join(" "));
  const texte = L + " " + F;
  const naac = input.naac ?? null;
  const montant = typeof input.montant_engage === "number" ? input.montant_engage : null;

  // Projet global RELAIS DE CHELLES ?
  const relais = REGEX_RELAIS_CHELLES.test(L);

  // ── Domaines : WNATURE d'abord, descriptif en secours uniquement ──
  const domWNature = domainesDe(L);
  const domSecours = domWNature.length === 0 ? domainesDe(texte) : [];
  const domaines = domWNature.length ? domWNature : domSecours;

  // ── Type : hiérarchie stricte sur WNATURE, descriptif en secours ──
  const typeWNature = premiers(L, REGLES_TYPE);
  const type = typeWNature ?? premiers(texte, REGLES_TYPE);

  // ── Cas particuliers / corrections obligatoires ──
  const corrTreuil = /TREUIL|VERIN/.test(L);
  const corrDad = /(^|\s)DAD($|\s)/.test(texte);
  const corrBal = /(^|\s)BAL($|\s)/.test(L);
  const corrVitrines = /VITRINE|PORTE AUTOMATIQUE|RIDEAU METALLIQUE/.test(L);
  const corrChaudiereVmcGaz = /CHAUDIERE.*VMC|VMC.*GAZ/.test(L);
  const corrDiagToiture = /DIAG.*(TOITURE|TERRASSE)/.test(L);
  const corrAdaptPmr = /ADAPT.*PMR|ADAPTATION.*PMR|TRAVAUX PMR/.test(L);
  const corrRevSolPc = /REV SOL|REVETEMENT.*ESPACES COMMUNS|SOL.*ESPACES COMMUNS/.test(L);
  const corrAmiante = /AMIANTE/.test(texte);

  // ── Libellés génériques ──
  const generique = GENERIQUES.has(L);

  // ── Nature exceptionnelle ──
  let nature: PspNatureExceptionnelle = "aucune";
  if (relais) nature = "commande_exceptionnelle";
  else if (/SUITE FUITE|SUITE DEGAT|DEGAT DES EAUX|SUITE DDE|MOISSISURE|INFILTRATION|TERRASSE HS|CONSERVATOIRE|SINISTRE/.test(texte)) nature = "sinistre";
  else if (/URGENT|URGENCE/.test(texte)) nature = "urgence";
  else if (/SIGNALEMENT/.test(texte)) nature = "signalement";
  else if (/RACHAT|EX LOGE|ACQUISITION|ANCIEN/.test(texte)) nature = "acquisition_patrimoine_ancien";
  else if (/REMPLACEMENT COMPLET ASCENSEUR/.test(L) || /REHABILIT|RESTRUCTURATION/.test(L)) nature = "commande_exceptionnelle";
  else if (montant !== null && montant >= 200000) nature = "commande_exceptionnelle";

  // ── Relais de Chelles : traitement particulier (lots) ──
  let typeFinal: PspTypeIntervention = (type ?? "indetermine") as PspTypeIntervention;
  let domaineFinal: PspDomaineTechnique;
  let regle: string;
  let conf: number;

  if (relais) {
    typeFinal = "rehabilitation";
    nature = "commande_exceptionnelle";
    let dom: string[] = [];
    for (const [lot, d] of Object.entries(LOT_DOMAINE)) if (L.includes(lot)) dom.push(d);
    if (dom.length === 0) dom = domaines;
    const uniques = [...new Set(dom)];
    if (uniques.length > 1) { domaineFinal = "multi_domaine"; conf = 0.5; }
    else if (uniques.length === 1) { domaineFinal = uniques[0] as PspDomaineTechnique; conf = 0.75; }
    else { domaineFinal = "indetermine"; conf = 0.3; }
    regle = "relais_chelles";
  } else {
    // domaine unique / multi / indéterminé
    if (domaines.length > 1) {
      domaineFinal = "multi_domaine";
      regle = "multi:" + domaines.join("+");
    } else if (domaines.length === 1) {
      domaineFinal = domaines[0] as PspDomaineTechnique;
      regle = "domaine:" + domaineFinal;
    } else {
      domaineFinal = "indetermine";
      regle = "domaine:indetermine";
    }

    // confiance (échelle discrète)
    if (generique && typeFinal === "indetermine") conf = 0.3;
    else if (!type || domaineFinal === "indetermine") conf = 0.3;
    else if (generique) conf = 0.5; // ex. EMBELLISSEMENT (aménagement) mais à valider
    else if (domaineFinal === "multi_domaine") conf = 0.5;
    else if (corrTreuil || corrDad || corrBal || corrAdaptPmr || corrRevSolPc) conf = 0.5;
    else if (corrChaudiereVmcGaz || corrDiagToiture) conf = 0.5;
    else if (!typeWNature || domWNature.length === 0) conf = 0.75; // secours descriptif
    else if (nature !== "aucune") conf = 0.75; // exception, sinon fiable
    else conf = 0.9;
  }

  // ── Element patrimonial ──
  const elt = elementPatrimonial(input.patrimoine, L);

  // ── Famille ──
  const famille: PspFamillePsp =
    relais ? FAMILLE[domaineFinal] ?? "autre"
    : domaineFinal === "multi_domaine" ? "indetermine"
    : domaineFinal === "indetermine" ? "indetermine"
    : FAMILLE[domaineFinal] ?? "autre";

  // ── Besoin de validation humaine ──
  const raisons: string[] = [];
  if (conf < 0.6) raisons.push("confiance_faible");
  if (domaineFinal === "multi_domaine") raisons.push("multi_domaine");
  if (generique) raisons.push("libelle_generique");
  if (nature !== "aucune") raisons.push("exception");
  if (relais) raisons.push("projet_global");
  if (corrTreuil || corrDad || corrBal || corrAdaptPmr || corrRevSolPc || corrChaudiereVmcGaz || corrDiagToiture || corrVitrines) raisons.push("cas_particulier");
  if (corrAmiante) raisons.push("diagnostic_lie");
  if (typeFinal === "indetermine" || domaineFinal === "indetermine") raisons.push("indetermine");
  const besoin = raisons.length > 0;

  // ── Règle appliquée (id court, pour regroupement) ──
  const regleApp = regle + (relais ? "" : (typeFinal !== "indetermine" ? "+type:" + typeFinal : ""));

  // ── Justification ──
  const just = [
    `WNATURE «${input.wnature}»`,
    typeFinal !== "indetermine" ? `type ${typeFinal}` : "type indéterminé",
    domaineFinal === "indetermine" ? "domaine indéterminé" : domaineFinal === "multi_domaine" ? `multi-domaines (${domaines.join(", ")})` : `domaine ${domaineFinal}`,
    raisons.length ? "→ validation: " + raisons.join(", ") : "",
  ].filter(Boolean).join(" · ");

  return {
    comn: input.comn,
    type_intervention: typeFinal,
    domaine_technique: domaineFinal,
    domaines_detectes: domaines,
    famille_psp: famille,
    element_patrimonial: elt,
    nature_exceptionnelle: nature,
    confiance: conf,
    besoin_validation_humaine: besoin,
    regle_appliquee: regleApp,
    justification: just,
    naac_source: naac,
    projet_relais_chelles: relais,
    libelle_normalise: L,
    montant_engage: montant,
  };
}

// ── Regroupement pour validation (décision propagable à l'identique) ───────

export interface PspGroupeValidation {
  cle: string;
  libelle_normalise: string;
  regle_appliquee: string;
  domaine_technique: string;
  type_intervention: string;
  famille_psp: string;
  occurrences: number;
  montant_total: number;
  comn_liste: string[];
}

/**
 * Regroupe les commandes nécessitant validation par (règle appliquée +
 * libellé normalisé + domaine + type + famille). Une décision humaine sur un
 * groupe peut être propagée aux occurrences STRICTEMENT identiques (même
 * règle + même libellé normalisé), jamais aux libellés seulement similaires.
 */
export function construireGroupesValidation(
  classifications: PspClassificationResult[],
): PspGroupeValidation[] {
  const groupes = new Map<string, PspGroupeValidation>();
  for (const c of classifications) {
    if (!c.besoin_validation_humaine) continue;
    const cle = [
      c.regle_appliquee,
      c.libelle_normalise,
      c.domaine_technique,
      c.type_intervention,
      c.famille_psp,
    ].join("||");
    if (!groupes.has(cle)) {
      groupes.set(cle, {
        cle,
        libelle_normalise: c.libelle_normalise,
        regle_appliquee: c.regle_appliquee,
        domaine_technique: c.domaine_technique,
        type_intervention: c.type_intervention,
        famille_psp: c.famille_psp,
        occurrences: 0,
        montant_total: 0,
        comn_liste: [],
      });
    }
    const g = groupes.get(cle)!;
    g.occurrences += 1;
    g.montant_total += c.montant_engage ?? 0;
    g.comn_liste.push(c.comn);
  }
  return [...groupes.values()].sort((a, b) => b.occurrences - a.occurrences);
}
