/**
 * PSP — Socle logique (types + parsing / normalisation).
 *
 * Module ISOLÉ du module PSP Analytics : il ne dépend d'aucun autre fichier de
 * l'application PAT S11 (pas de `@/lib/travaux.ts`, pas d'alias `@/`) afin de
 * pouvoir être testé directement par Node (type stripping) et réutilisé par le
 * futur moteur d'analyse PSP.
 *
 * Règles de conception respectées :
 *  - le numéro de commande est la clé métier UNIQUE (jamais un UUID Supabase) ;
 *  - les références ER. sont extraites mais JAMAIS inventées ;
 *  - en cas de plusieurs ER. la ligne est marquée ambiguë, aucun choix arbitraire ;
 *  - le code corps d'état entre parenthèses "(j)" est la clé de classification ;
 *  - aucune catégorie GE / GT / CP n'est codée ici (elle sera déduite plus tard
 *    à partir des données existantes) ;
 *  - aucune ligne n'est supprimée : les anomalies sont marquées
 *    `valide` / `a_controler` / `erreur` et listées dans `erreurs_psp`.
 */
import * as XLSX from "xlsx";

// ── Types PSP ────────────────────────────────────────────────────────────────

/** Statut de contrôle d'une ligne analysée. */
export type PspStatutLigne = "valide" | "a_controler" | "erreur";

/** Niveau de rattachement patrimonial (hiérarchie S11 > Ville > Tranche > Bâtiment > Entrée > Lot). */
export type PspNiveauRattachement =
  "tranche" | "batiment" | "entree" | "lot" | "unknown" | "ambiguous";

/**
 * Types d'intervention retenus pour l'analyse future des commandes.
 * Utilisé par `PspClassification` ; le moteur d'analyse (étape ultérieure)
 * décidera, il n'est PAS déduit par le parser.
 */
export type PspTypeIntervention =
  | "renouvellement"
  | "rehabilitation"
  | "entretien"
  | "reparation"
  | "sinistre"
  | "diagnostic"
  | "mise_en_securite"
  | "remise_a_niveau"
  | "reglementation"
  | "report"
  | "autre";

/** Codes d'anomalies détectées par le parser (message explicite à chaque fois). */
export type PspParseIssueCode =
  | "commande_manquante"
  | "doublon_identique"
  | "doublon_conflit"
  | "er_ambigu"
  | "corps_etat_non_reconnu"
  | "montant_invalide"
  | "montant_negatif"
  | "montant_incoherent";

/** Anomalie explicite sur une ligne (ou une série de lignes). */
export type PspParseIssue = {
  code: PspParseIssueCode;
  message: string;
  ligne: number | null;
  numero_commande: string | null;
  champ: string | null;
  valeur: string | null;
};

/**
 * Ligne de commande de travaux parsée et normalisée.
 * `numero_commande` est l'identifiant métier UNIQUE ("" si absent → statut erreur).
 */
export type PspParsedRow = {
  ligne: number;
  numero_commande: string;
  /** Numéro de commande interne (identifiant technique ISIS, ex COMN_NUM) — jamais utilisé comme clé métier. */
  numero_commande_interne: string | null;
  secteur: string | null;
  tranche_code: string | null;
  batiment: string | null;
  lot_code: string | null;
  entree: string | null;
  nature_analytique: string | null;
  /** Corps d'état (texte brut, ex "(j) Couvertures" ou "PLOMBERIE"). */
  corps_etat: string | null;
  descriptif: string | null;
  observations: string | null;
  /** Chargé d'opération (colonne UTIC_CODE.Ana_comd_trav_er) — source réelle. */
  charge_operation: string | null;
  /** Référence patrimoine brute issue de la colonne WPATRIMOINE (ex "ER.T1427"). */
  patrimoine: string | null;
  etat: string | null;
  date_commande: string | null;
  fournisseur: string | null;
  adresse: string | null;
  commune: string | null;
  budget: number | null;
  engage: number | null;
  paye: number | null;
  ecart: number | null;
  er_reference: string | null;
  tranche_er: string | null;
  batiment_er: string | null;
  entree_er: string | null;
  lot_er: string | null;
  er_references: string[];
  er_ambigue: boolean;
  niveau_rattachement: PspNiveauRattachement;
  corps_etat_code: string | null;
  corps_etat_libelle: string | null;
  montant_financier_valide: boolean;
  statut: PspStatutLigne;
  erreurs_psp: PspParseIssue[];
};

/** Correspondance colonne source (nom Excel exact) → champ normalisé PSP. */
export type PspMappingColonne = {
  /** Nom exact de la colonne dans le fichier source (conservé tel quel). */
  sourceColumn: string;
  /** Champ normalisé PSP ; null si la colonne n'est pas reconnue. */
  normalizedField: keyof PspParsedRow | null;
};

/** Résultat global du parsing d'un classeur PSP. */
export type PspParsedTravaux = {
  /** Feuille Excel utilisée (celle dont l'en-tête du numéro de commande apparaît le plus tôt). */
  feuille: string | null;
  /** Mapping complet des colonnes détectées (debuggable). */
  mapping_colonnes: PspMappingColonne[];
  lignes: PspParsedRow[];
  doublons: PspParsedRow[];
  total_lignes: number;
  doublons_identiques: number;
  doublons_conflits: number;
  valides: number;
  a_controler: number;
  erreurs: number;
  issues: PspParseIssue[];
};

/**
 * Classification d'une commande (structure préparée pour le futur moteur d'analyse).
 * Le parser ne remplit PAS ce type : il prépare uniquement des données propres.
 */
export type PspClassification = {
  type_intervention: PspTypeIntervention | null;
  cause_probable: string | null;
  phase_patrimoniale: string | null;
  composant: string | null;
  niveau_rattachement: PspNiveauRattachement;
  er_reference: string | null;
  utilisable_cycle: boolean;
  confiance: number | null;
  justification: string | null;
  indices: string[];
};

/**
 * Contexte de gestion d'un élément patrimonial (tranche / bâtiment / entrée / lot).
 * Structure préparée pour le futur chargement du périmètre PSP ;
 * le parser ne remplit PAS ce type.
 */
export type PspPatrimoineContext = {
  er_id: string;
  niveau: PspNiveauRattachement;
  type_patrimoine: string | null;
  date_reference_gestion: string | null;
  source_date_reference: string | null;
  perimetre_psp: boolean;
  parent_er_id: string | null;
  exception: boolean;
  justification: string | null;
};

// ── Helpers de normalisation ─────────────────────────────────────────────────

type Raw = Record<string, unknown>;

/** Texte nettoyé d'une cellule (null si vide). Garde le guillemet simple initial. */
const text = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  let result = String(value).trim();
  if (result.startsWith("'")) result = result.substring(1);
  return result === "" || result === "..." ? null : result;
};

/**
 * Normalise un intitulé d'en-tête : minuscules, accents supprimés,
 * caractères non alphanumériques remplacés par un espace, espaces trimés.
 * Ex : "N° COMMANDE" → "n commande", "BÂTIMENT" → "batiment".
 */
export const normalizePspHeader = (value: unknown): string =>
  text(value)
    ?.toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim() ?? "";

/**
 * Alias d'en-têtes « classiques » → champ de PspParsedRow.
 * Clé = intitulé normalisé complet (voir normalizePspHeader).
 */
const headerAliases: Record<string, keyof PspParsedRow> = {
  "no commande": "numero_commande",
  "numero commande": "numero_commande",
  "n commande": "numero_commande",
  "num commande": "numero_commande",
  "n de commande": "numero_commande",
  commande: "numero_commande",
  secteur: "secteur",
  tranche: "tranche_code",
  "code tranche": "tranche_code",
  batiment: "batiment",
  bat: "batiment",
  bim: "batiment",
  immeuble: "batiment",
  lot: "lot_code",
  "code lot": "lot_code",
  "no lot": "lot_code",
  "numero lot": "lot_code",
  entree: "entree",
  escalier: "entree",
  "nature analytique": "nature_analytique",
  "corps d etat": "corps_etat",
  "corps etat": "corps_etat",
  descriptif: "descriptif",
  "descriptif des travaux": "descriptif",
  observations: "observations",
  observation: "observations",
  budget: "budget",
  engage: "engage",
  "montant engage": "engage",
  paye: "paye",
  "montant paye": "paye",
  "date commande": "date_commande",
  "date de commande": "date_commande",
  etat: "etat",
  "etat commande": "etat",
  "etat de la commande": "etat",
  patrimoine: "patrimoine",
  fournisseur: "fournisseur",
  adresse: "adresse",
  commune: "commune",
  ville: "commune",
  "numero commande interne": "numero_commande_interne",
  ecart: "ecart",
};

/**
 * Alias d'en-têtes ISIS → champ de PspParsedRow.
 * Clé = nom de champ ISIS normalisé SANS espaces (forme compacte), c'est-à-dire
 * la partie AVANT le point du nom technique (ex "COMC_NOLIG.Ana_comd_trav_er" →
 * "comcnolig"). La comparaison est insensible à la casse, aux accents, aux
 * espaces et aux séparateurs (_ . -) : "COMC_NOLIG", "COMC NOLIG", "comc nolig"
 * sont équivalents. Le suffixe (ex ".Ana_comd_trav_er") identifie l'export et
 * est ignoré. Ce mapping est volontairement extensible pour plusieurs exports.
 */
const isisAliases: Record<string, keyof PspParsedRow> = {
  comcnolig: "numero_commande",
  comnnum: "numero_commande_interne",
  wpatrimoine: "patrimoine",
  percsecteur: "secteur",
  entnnum: "entree",
  bainnum: "batiment",
  comddate: "date_commande",
  naaccode: "nature_analytique",
  comcetat: "etat",
  comnmtdevis: "budget",
  wmtrappro: "engage",
  wmtecart: "ecart",
  frannum: "fournisseur",
  wnature: "corps_etat",
  wnotes: "descriptif",
  wadresse: "adresse",
  wcommune: "commune",
  uticcode: "charge_operation",
};

/** Normalise un intitulé d'en-tête en forme compacte (sans espaces ni séparateurs). */
const compact = (token: string): string => token.replace(/\s+/g, "");

/**
 * Résout une cellule d'en-tête vers un champ normalisé PSP.
 *  - conserve le nom de colonne ORIGINAL (sourceColumn) ;
 *  - reconnaît les alias classiques (token complet) ;
 *  - reconnaît les en-têtes ISIS « CHAMP.Table » via la partie avant le point,
 *    en forme compacte (insensible aux espaces/séparateurs) ;
 *  - casse/accents/espaces/caractères spéciaux sont normalisés.
 * Le mapping est debuggable : { sourceColumn, normalizedField }.
 */
export const resolveHeaderAlias = (
  brut: unknown,
): { sourceColumn: string | null; normalizedField: keyof PspParsedRow | null } => {
  const sourceColumn = text(brut);
  if (sourceColumn === null) return { sourceColumn: null, normalizedField: null };
  const token = normalizePspHeader(sourceColumn);
  if (!token) return { sourceColumn, normalizedField: null };

  // 1) Alias classique sur l'intitulé complet normalisé.
  const direct = headerAliases[token];
  if (direct) return { sourceColumn, normalizedField: direct };

  // 2) Format ISIS « CHAMP.Table » : partie avant le point, forme compacte.
  const avantPoint = sourceColumn.split(".")[0] ?? "";
  const prefixCompact = compact(normalizePspHeader(avantPoint));
  if (prefixCompact) {
    const isis = isisAliases[prefixCompact];
    if (isis) return { sourceColumn, normalizedField: isis };
  }

  // 3) Motif ISIS inclus dans le token compact (variantes sans point).
  const tokenCompact = compact(token);
  let meilleur: keyof PspParsedRow | null = null;
  let meilleureTaille = 0;
  for (const [motif, champ] of Object.entries(isisAliases)) {
    if (tokenCompact.includes(motif) && motif.length > meilleureTaille) {
      meilleur = champ;
      meilleureTaille = motif.length;
    }
  }
  if (meilleur) return { sourceColumn, normalizedField: meilleur };

  return { sourceColumn, normalizedField: null };
};

/** Colonnes numériques (finances). */
const moneyFields = new Set(["budget", "engage", "paye", "ecart"]);

/**
 * Parse une valeur monétaire : nombre, texte avec espace(s) de milliers,
 * virgule décimale, symbole €. Ne lève jamais ; signale seulement l'invalidité.
 */
export type PspMoney = { nombre: number | null; invalide: boolean };

export const parsePspMoney = (value: unknown): PspMoney => {
  const t = text(value);
  if (t === null) return { nombre: null, invalide: false };
  const cleaned = t
    .replace(/[€$]/g, "")
    .replace(/[eE][uU][rR]/g, "")
    .replace(/\s+/g, "")
    .replace(",", ".");
  if (cleaned === "" || cleaned === ".") return { nombre: null, invalide: true };
  if (cleaned === "-") return { nombre: null, invalide: false };
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return { nombre: null, invalide: true };
  return { nombre: parsed, invalide: false };
};

// ── Catégorie budgétaire ─────────────────────────────────────────────────────

/** Résultat de la catégorie budgétaire dérivée de NAAC_CODE (source ISIS). */
export type PspCategorieBudget = {
  categorie: string | null;
  statut: "valide" | "a_confirmer";
};

/**
 * Catégorie budgétaire issue de NAAC_CODE (source de vérité pour cet export).
 *  - GE / GT / CP → catégorie connue (statut "valide") ;
 *  - AC / HO / toute autre valeur → catégorie conservée telle quelle (statut "a_confirmer") ;
 *  - null / vide → catégorie null (statut "a_confirmer").
 * NE PAS déduire GE/GT/CP depuis WNATURE lorsque NAAC_CODE existe.
 */
export const getCategorieBudget = (naacCode: string | null | undefined): PspCategorieBudget => {
  const code = naacCode?.trim().toUpperCase() ?? null;
  if (code === "GE" || code === "GT" || code === "CP") {
    return { categorie: code, statut: "valide" };
  }
  if (code === null || code === "") {
    return { categorie: null, statut: "a_confirmer" };
  }
  return { categorie: code, statut: "a_confirmer" };
};

// ── Extraction ER. ───────────────────────────────────────────────────────────

/** Référence ER. détectée, avec le champ source et le niveau inféré. */
export type PspErRef = {
  reference: string;
  champ: string;
  niveau: PspNiveauRattachement;
};

/**
 * Infère le niveau d'une référence ER.
 *  - colonne structurée (tranche / bâtiment / entrée / lot) → niveau fiable ;
 *  - texte libre → heuristique de préfixe (E = entrée, B = bâtiment, T = tranche),
 *    sinon `unknown`. L'inférence par préfixe est volontairement prudente :
 *    elle ne permet jamais d'inventer un niveau.
 */
export const inferErLevel = (ref: string, champ: string): PspNiveauRattachement => {
  if (champ === "tranche_code") return "tranche";
  if (champ === "batiment") return "batiment";
  if (champ === "entree") return "entree";
  if (champ === "lot_code") return "lot";
  const prefix = ref.match(/^ER\.([A-Za-z])/)?.[1]?.toUpperCase();
  if (prefix === "E") return "entree";
  if (prefix === "B") return "batiment";
  if (prefix === "T") return "tranche";
  return "unknown";
};

/**
 * Extrait toutes les références ER. présentes dans les cellules fournies.
 * Déduplique (une référence n'apparaît qu'une fois), normalise en majuscules,
 * ignore les "ER." isolés (trop courts, non fiables) et les points de fin.
 */
export const extractErReferences = (
  sources: Array<{ champ: string; valeur: unknown }>,
): PspErRef[] => {
  const pattern = /(?<![A-Za-z0-9])ER\.[A-Za-z0-9][A-Za-z0-9._-]*/g;
  const found: PspErRef[] = [];
  const seen = new Set<string>();
  for (const { champ, valeur } of sources) {
    const t = text(valeur);
    if (t === null) continue;
    for (const match of t.matchAll(pattern)) {
      const raw = match[0] ?? "";
      const ref = raw.replace(/\.+$/, "").toUpperCase();
      if (ref.length < 4) continue; // "ER." seul → non fiable, jamais retenu
      if (seen.has(ref)) continue;
      seen.add(ref);
      found.push({ reference: ref, champ, niveau: inferErLevel(ref, champ) });
    }
  }
  return found;
};

// ── Corps d'état ─────────────────────────────────────────────────────────────

/**
 * Extrait le code (entre parenthèses) et le libellé d'un corps d'état.
 * Formats reconnus : "(j) Couvertures", "Couvertures (j)".
 * Le code entre parenthèses est prioritaire (clé de classification).
 */
export const extractCorpsEtat = (
  value: unknown,
): { code: string | null; libelle: string | null } => {
  const v = text(value);
  if (v === null) return { code: null, libelle: null };
  const strict = v.match(/^\(([A-Za-z0-9]+)\)\s*(.*)$/);
  if (strict) return { code: strict[1] ?? null, libelle: strict[2]?.trim() || null };
  const loose = v.match(/^\(([^)]+)\)\s*(.*)$/);
  if (loose) return { code: loose[1]?.trim() || null, libelle: loose[2]?.trim() || null };
  const trailing = v.match(/^(.*?)\s*\(([A-Za-z0-9]+)\)$/);
  if (trailing) return { code: trailing[2] ?? null, libelle: trailing[1]?.trim() || null };
  return { code: null, libelle: v };
};

// ── Finances ─────────────────────────────────────────────────────────────────

/**
 * Valide les montants d'une ligne. Ne supprime jamais la ligne : les anomalies
 * sont renvoyées en issues (a_controler). "Montant vide" → null (absence, sans
 * erreur : une commande peut légitimement ne pas avoir de budget renseigné).
 */
function validerFinances(raw: Raw): {
  budget: number | null;
  engage: number | null;
  paye: number | null;
  montantFinancierValide: boolean;
  issues: PspParseIssue[];
} {
  const issues: PspParseIssue[] = [];
  const budget = parsePspMoney(raw["budget"]);
  const engage = parsePspMoney(raw["engage"]);
  const paye = parsePspMoney(raw["paye"]);

  const champs: Array<{ champ: string; parsed: PspMoney; brut: unknown }> = [
    { champ: "budget", parsed: budget, brut: raw["budget"] },
    { champ: "engage", parsed: engage, brut: raw["engage"] },
    { champ: "paye", parsed: paye, brut: raw["paye"] },
  ];
  for (const c of champs) {
    if (c.parsed.invalide) {
      issues.push({
        code: "montant_invalide",
        message: `Montant invalide dans la colonne ${c.champ} (valeur non numérique)`,
        ligne: null,
        numero_commande: null,
        champ: c.champ,
        valeur: text(c.brut),
      });
    } else if (c.parsed.nombre !== null && c.parsed.nombre < 0) {
      issues.push({
        code: "montant_negatif",
        message: `Montant négatif dans la colonne ${c.champ} (à contrôler)`,
        ligne: null,
        numero_commande: null,
        champ: c.champ,
        valeur: String(c.parsed.nombre),
      });
    }
  }

  // Incohérences manifestes (uniquement quand les deux valeurs sont présentes).
  if (budget.nombre !== null && engage.nombre !== null && engage.nombre > budget.nombre) {
    issues.push({
      code: "montant_incoherent",
      message: "Engagement supérieur au budget (incohérence à contrôler)",
      ligne: null,
      numero_commande: null,
      champ: "engage",
      valeur: `${engage.nombre} > ${budget.nombre}`,
    });
  }
  if (engage.nombre !== null && paye.nombre !== null && paye.nombre > engage.nombre) {
    issues.push({
      code: "montant_incoherent",
      message: "Payé supérieur à l'engagé (incohérence à contrôler)",
      ligne: null,
      numero_commande: null,
      champ: "paye",
      valeur: `${paye.nombre} > ${engage.nombre}`,
    });
  }

  return {
    budget: budget.nombre,
    engage: engage.nombre,
    paye: paye.nombre,
    montantFinancierValide: issues.length === 0,
    issues,
  };
}

// ── Détection de feuille et d'en-tête ────────────────────────────────────────

/**
 * Repère la feuille la plus pertinente (celle dont la ligne d'en-tête du numéro
 * de commande apparaît le plus tôt) et l'index de sa ligne d'en-tête principale.
 * La colonne « numéro de commande » est reconnue par alias classiques
 * (ex "No commande") OU par nom technique ISIS (ex "COMC_NOLIG.Ana_comd_trav_er").
 */
function detectSheetAndHeader(workbook: XLSX.WorkBook): {
  name: string;
  matrix: unknown[][];
  mainHeaderIndex: number;
} {
  const isCommandeCell = (cell: unknown) =>
    resolveHeaderAlias(cell).normalizedField === "numero_commande";

  let best: { name: string; idx: number } | null = null;
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: null,
    }) as unknown[][];
    const idx = matrix.findIndex((row) => row.some(isCommandeCell));
    if (idx >= 0 && (!best || idx < best.idx)) best = { name, idx };
  }
  if (!best) throw new Error("Colonne obligatoire introuvable : No commande.");

  const sheet = workbook.Sheets[best.name]!;
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: null,
  }) as unknown[][];
  return { name: best.name, matrix, mainHeaderIndex: best.idx };
}

// ── Parseur principal ────────────────────────────────────────────────────────

/**
 * Parse un classeur Excel de commandes de travaux pour le PSP.
 *
 * Reprend les principes de `parseTravauxWorkbook` (en-tête sur une ou deux
 * lignes, alias normalisés, Map sur le numéro de commande) SANS modifier
 * `travaux.ts` — ce module est totalement indépendant.
 *
 * Détections :
 *  - numéro absent (statut `erreur`) ;
 *  - doublon identique / doublon en conflit (le doublon est conservé dans
 *    `doublons`, la première occurrence reste dans `lignes`) ;
 *  - références ER. (toutes conservées, jamais inventées) ;
 *  - code corps d'état entre parenthèses ;
 *  - anomalies financières (invalide / négatif / incohérence) — aucune ligne
 *    supprimée.
 */
export function parsePspWorkbook(data: ArrayBuffer): PspParsedTravaux {
  const workbook = XLSX.read(data, { cellDates: true });
  const { name: feuille, matrix, mainHeaderIndex } = detectSheetAndHeader(workbook);

  // En-tête sur deux lignes : on fusionne la ligne au-dessus et la ligne principale
  // (la ligne principale a priorité, comme dans parseTravauxWorkbook).
  const rowAbove = (mainHeaderIndex > 0 ? matrix[mainHeaderIndex - 1] : []) as unknown[];
  const rowMain = (matrix[mainHeaderIndex] || []) as unknown[];
  const headers: (keyof PspParsedRow | null)[] = [];
  const mappingColonnes: PspMappingColonne[] = [];
  const maxCols = Math.max(rowAbove.length, rowMain.length);
  for (let column = 0; column < maxCols; column += 1) {
    const principal = resolveHeaderAlias(rowMain[column]);
    const auDessus = resolveHeaderAlias(rowAbove[column]);
    const sourceColumn = principal.sourceColumn ?? auDessus.sourceColumn;
    const normalizedField = principal.normalizedField ?? auDessus.normalizedField;
    if (sourceColumn !== null) {
      mappingColonnes.push({ sourceColumn, normalizedField });
    }
    headers.push(normalizedField);
  }

  const primaires = new Map<string, PspParsedRow>();
  const lignes: PspParsedRow[] = [];
  const doublons: PspParsedRow[] = [];
  const issues: PspParseIssue[] = [];
  let totalLignes = 0;
  let doublonsIdentiques = 0;
  let doublonsConflits = 0;

  for (let index = mainHeaderIndex + 1; index < matrix.length; index += 1) {
    const row = matrix[index] ?? [];
    // Ligne vide (toutes les cellules vides) → ignorée.
    if (row.every((cell) => text(cell) === null)) continue;
    totalLignes += 1;

    const raw: Raw = {};
    headers.forEach((key, column) => {
      if (key) raw[key] = row[column];
    });

    // ── Identité de l'enregistrement source ──────────────────────────────────
    // COMN_NUM = identifiant source unique. COMC_NOLIG (numero_commande) reste
    // un attribut nullable, non unique ; son absence n'est JAMAIS une erreur.
    const numero = text(raw["numero_commande"]) ?? "";
    const identifiant = text(raw["numero_commande_interne"]) ?? "";
    const base: Pick<PspParseIssue, "ligne" | "numero_commande"> = {
      ligne: index + 1,
      numero_commande: numero || null,
    };

    // ── Références ER. (scan de toutes les cellules de la ligne) ──
    const erSources: Array<{ champ: string; valeur: unknown }> = headers.map((key, column) => ({
      champ: key ? String(key) : `colonne_${column + 1}`,
      valeur: row[column],
    }));
    const erRefs = extractErReferences(erSources);
    const allRefs = erRefs.map((r) => r.reference);
    const erAmbigue = allRefs.length > 1;
    const erReference = erAmbigue ? null : (allRefs[0] ?? null);
    const niveauRattachement: PspNiveauRattachement = erAmbigue
      ? "ambiguous"
      : (erRefs[0]?.niveau ?? "unknown");
    const trancheEr = erRefs.find((r) => r.niveau === "tranche")?.reference ?? null;
    const batimentEr = erRefs.find((r) => r.niveau === "batiment")?.reference ?? null;
    const entreeEr = erRefs.find((r) => r.niveau === "entree")?.reference ?? null;
    const lotEr = erRefs.find((r) => r.niveau === "lot")?.reference ?? null;

    // ── Corps d'état ──
    const corps = extractCorpsEtat(raw["corps_etat"]);

    // ── Finances ──
    const finances = validerFinances(raw);

    // ── Anomalies de la ligne ──
    const erreursPsp: PspParseIssue[] = [];
    if (erAmbigue) {
      erreursPsp.push({
        ...base,
        code: "er_ambigu",
        message: "Plusieurs références ER détectées — rattachement à contrôler",
        champ: null,
        valeur: allRefs.join(", "),
      });
    }
    if (text(raw["corps_etat"]) !== null && corps.code === null) {
      erreursPsp.push({
        ...base,
        code: "corps_etat_non_reconnu",
        message: "Corps d'état sans code entre parenthèses — code non identifiable",
        champ: "corps_etat",
        valeur: text(raw["corps_etat"]),
      });
    }
    erreursPsp.push(
      ...finances.issues.map((issue) => ({
        ...issue,
        ligne: base.ligne,
        numero_commande: base.numero_commande,
      })),
    );

    const statut: PspStatutLigne = erreursPsp.length > 0 ? "a_controler" : "valide";

    const commande: PspParsedRow = {
      ligne: base.ligne ?? 0,
      numero_commande: numero,
      numero_commande_interne: text(raw["numero_commande_interne"]),
      secteur: text(raw["secteur"]),
      tranche_code: text(raw["tranche_code"]),
      batiment: text(raw["batiment"]),
      lot_code: text(raw["lot_code"]),
      entree: text(raw["entree"]),
      nature_analytique: text(raw["nature_analytique"]),
      corps_etat: text(raw["corps_etat"]),
      descriptif: text(raw["descriptif"]),
      observations: text(raw["observations"]),
      charge_operation: text(raw["charge_operation"]),
      patrimoine: text(raw["patrimoine"]),
      etat: text(raw["etat"]),
      date_commande: text(raw["date_commande"]),
      fournisseur: text(raw["fournisseur"]),
      adresse: text(raw["adresse"]),
      commune: text(raw["commune"]),
      budget: finances.budget,
      engage: finances.engage,
      paye: finances.paye,
      ecart: parsePspMoney(raw["ecart"]).nombre,
      er_reference: erReference,
      tranche_er: trancheEr,
      batiment_er: batimentEr,
      entree_er: entreeEr,
      lot_er: lotEr,
      er_references: allRefs,
      er_ambigue: erAmbigue,
      niveau_rattachement: niveauRattachement,
      corps_etat_code: corps.code,
      corps_etat_libelle: corps.libelle,
      montant_financier_valide: finances.montantFinancierValide,
      statut,
      erreurs_psp: erreursPsp,
    };

    // ── Chargé d'opération : conserver la valeur SOURCE originale (UTIC_CODE)
    // dans donnees_brutes, sous son nom de colonne exact (ex
    // « UTIC_CODE.Ana_comd_trav_er »), en plus du champ normalisé
    // charge_operation. La valeur source n'est ni supprimée ni modifiée.
    const uticCol = mappingColonnes.find((m) => m.normalizedField === "charge_operation");
    const chargeRaw = text(raw["charge_operation"]);
    if (uticCol?.sourceColumn && chargeRaw !== null) {
      (commande as unknown as Record<string, unknown>)[uticCol.sourceColumn] = chargeRaw;
    }

    // ── Doublon ? (clé d'identité = numero_commande_interne / COMN_NUM) ──
    // Une ligne Excel = un COMN_NUM. COMC_NOLIG n'est pas la clé : plusieurs
    // COMN_NUM peuvent partager le même COMC_NOLIG (commandes liées), ils ne
    // sont PAS fusionnés. Sans COMN_NUM, repli sur la ligne Excel (jamais perdue).
    const cle = identifiant !== "" ? identifiant : `__ligne_${base.ligne}`;
    if (primaires.has(cle)) {
      const existing = primaires.get(cle)!;
      const identique = comparable(commande) === comparable(existing);
      const code: PspParseIssueCode = identique ? "doublon_identique" : "doublon_conflit";
      commande.erreurs_psp.push({
        ...base,
        code,
        message: identique
          ? "Doublon avec des données identiques"
          : "Doublon avec des données différentes (conflit à contrôler)",
        champ: "numero_commande_interne",
        valeur: identifiant || null,
      });
      if (identique) doublonsIdentiques += 1;
      else doublonsConflits += 1;
      doublons.push(commande);
      issues.push(...commande.erreurs_psp);
      continue;
    }

    primaires.set(cle, commande);
    lignes.push(commande);
    issues.push(...commande.erreurs_psp);
  }

  return {
    feuille,
    mapping_colonnes: mappingColonnes,
    lignes,
    doublons,
    total_lignes: totalLignes,
    doublons_identiques: doublonsIdentiques,
    doublons_conflits: doublonsConflits,
    valides: lignes.filter((l) => l.statut === "valide").length,
    a_controler: lignes.filter((l) => l.statut === "a_controler").length,
    erreurs: lignes.filter((l) => l.statut === "erreur").length,
    issues,
  };
}

/** Représentation comparable d'une ligne (champs de contenu uniquement). */
const comparable = (c: PspParsedRow): string =>
  JSON.stringify({
    numero_commande_interne: c.numero_commande_interne,
    secteur: c.secteur,
    tranche_code: c.tranche_code,
    batiment: c.batiment,
    lot_code: c.lot_code,
    entree: c.entree,
    nature_analytique: c.nature_analytique,
    corps_etat: c.corps_etat,
    descriptif: c.descriptif,
    observations: c.observations,
    patrimoine: c.patrimoine,
    etat: c.etat,
    date_commande: c.date_commande,
    fournisseur: c.fournisseur,
    adresse: c.adresse,
    commune: c.commune,
    budget: c.budget,
    engage: c.engage,
    paye: c.paye,
    ecart: c.ecart,
  });
