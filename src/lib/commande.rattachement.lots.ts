/**
 * V8.17 — RATTACHEMENT des commandes de travaux à leur LOT (logement ER).
 *
 * Problème : `travaux_commandes.lot_code` est vide (le fichier de suivi annuel ANM n'a pas de
 * colonne « lot ») alors que la commande concerne un logement précis — l'ER du lot est noyé
 * dans l'`adresse`/`descriptif` de la ligne suivi (« ... - ER.39351 ») et/ou renseigné dans
 * l'Historique CMD (psp_import_rows, colonnes patrimoine / lot_er / er_reference).
 *
 * Règles (décision utilisateur) :
 *  · source du lot = Historique CMD d'abord, sinon ER de la ligne suivi (adresse/descriptif) ;
 *  · on ne retient QUE les ER présents dans le référentiel `lots` (jamais inventés) ;
 *  · `lot_code` (mono) n'est rempli que si EXACTEMENT UN lot distinct ; plusieurs → multi_lots ;
 *  · un ER présent mais absent du référentiel → hors_referentiel ; aucun ER → non_rattache.
 *
 * Module 100 % PUR (aucun import) : la partie base (chargement lots / psp_import_rows) vit dans
 * `commande.rattachement.supabase.functions.ts`.
 */
// ── Types ────────────────────────────────────────────────────────────────────

/** Lot du référentiel `lots` (champs utiles au rattachement). */
export type LotPatrimoine = {
  code_patrimoine: string;
  tranche_code: string | null;
  adresse: string | null;
  ville: string | null;
  actif: boolean;
};

/** Source qui a permis le rattachement. */
export type SourceRattachementLot = "historique" | "suivi" | null;

/** Statut de la résolution. */
export type StatutRattachementLot =
  | "rattache" // 1 lot distinct → lot_code remplissable
  | "multi_lots" // N lots distincts → non remplissable en mono
  | "hors_referentiel" // des ER présents mais aucun dans `lots`
  | "non_rattache"; // aucun ER détecté

export type ResolutionRattachementLot = {
  statut: StatutRattachementLot;
  source: SourceRattachementLot;
  /** Lots réels du référentiel (distincts) rattachés à la commande. */
  lots: LotPatrimoine[];
  /** Codes ER rattachés (code_patrimoine des lots). */
  codes: string[];
  /** Codes ER candidats non trouvés dans le référentiel (diagnostic). */
  refsNonTrouvees: string[];
};

// ── Extraction / normalisation ER ─────────────────────────────────────────────

/** Motif d'une référence patrimoine ISIS « ER.xxxxx » (lot, ER.G…, ER.T…). */
export const ER_PATTERN = /ER\.[A-Za-z0-9][A-Za-z0-9._-]*/gi;

/**
 * Références ER présentes dans un texte, dédupliquées, normalisées en majuscules
 * (les « ER. » isolés et les points de fin sont ignorés/nettoyés).
 */
export const extraireErTexte = (texte: string | null | undefined): string[] => {
  if (!texte) return [];
  const vues = new Set<string>();
  const refs: string[] = [];
  for (const m of String(texte).matchAll(ER_PATTERN)) {
    const brut = (m[0] ?? "").replace(/\.+$/, "").toUpperCase();
    if (brut.length < 4) continue; // « ER. » seul → non fiable
    if (vues.has(brut)) continue;
    vues.add(brut);
    refs.push(brut);
  }
  return refs;
};

/** Références ER combinées d'une ligne de suivi (adresse + descriptif). */
export const refsErSuivi = (
  adresse: string | null | undefined,
  descriptif: string | null | undefined,
): string[] => {
  const set = new Set<string>([...extraireErTexte(adresse), ...extraireErTexte(descriptif)]);
  return [...set];
};

/** Références ER combinées d'une ligne Historique CMD (texte + champs structurés). */
export const refsErHistorique = (sources: Array<string | null | undefined>): string[] => {
  const set = new Set<string>();
  for (const s of sources) for (const r of extraireErTexte(s)) set.add(r);
  return [...set];
};

/**
 * Clé de comparaison d'un code ER : retire le préfixe « ER. » puis tous les caractères
 * non alphanumériques (insensible à la casse/ponctuation) → « ER.39351 » et « ER. 39351 »
 * donnent « 39351 » ; « ER.G2273.01023 » donne « G227301023 ».
 */
export const normaliserCodeEr = (code: string | null | undefined): string =>
  (code ?? "")
    .trim()
    .replace(/^er[.\s-]*/i, "")
    .replace(/[^a-z0-9]/gi, "")
    .toUpperCase();

/** Indexe les lots par clé normalisée (plusieurs lots → un seul retenu par clé). */
export const creerIndexLots = (lots: LotPatrimoine[]): Map<string, LotPatrimoine> => {
  const index = new Map<string, LotPatrimoine>();
  for (const l of lots) {
    const cle = normaliserCodeEr(l.code_patrimoine);
    if (cle && !index.has(cle)) index.set(cle, l);
  }
  return index;
};

// ── Résolution ────────────────────────────────────────────────────────────────

/**
 * Résout le rattachement d'une commande à ses lots.
 *
 * @param refsHistorique Réfs ER issues de l'Historique CMD (PRIORITAIRES).
 * @param refsSuivi      Réfs ER issues de la ligne de suivi annuel (repli).
 * @param lotsIndex      Index `lots` (voir creerIndexLots).
 */
export const resoudreRattachement = ({
  refsHistorique,
  refsSuivi,
  lotsIndex,
}: {
  refsHistorique: string[];
  refsSuivi: string[];
  lotsIndex: Map<string, LotPatrimoine>;
}): ResolutionRattachementLot => {
  const trouvesDepuis = (refs: string[]): { lots: LotPatrimoine[]; nonTrouvees: string[] } => {
    const parCle = new Map<string, LotPatrimoine>();
    const nonTrouvees = new Set<string>();
    for (const ref of refs) {
      const cle = normaliserCodeEr(ref);
      if (!cle) continue;
      const lot = lotsIndex.get(cle);
      if (lot) parCle.set(cle, lot);
      else nonTrouvees.add(ref);
    }
    return { lots: [...parCle.values()], nonTrouvees: [...nonTrouvees] };
  };

  const hist = trouvesDepuis(refsHistorique);
  const suivi = trouvesDepuis(refsSuivi);

  // Source Historique CMD en priorité (dès qu'au moins un de ses ER existe dans `lots`) ;
  // sinon la ligne de suivi. Les ER présents mais hors référentiel ne bloquent pas le repli.
  let lots = hist.lots;
  let source: SourceRattachementLot = hist.lots.length > 0 ? "historique" : null;
  let refsNonTrouvees = hist.nonTrouvees;
  if (lots.length === 0 && suivi.lots.length > 0) {
    lots = suivi.lots;
    source = "suivi";
    refsNonTrouvees = hist.nonTrouvees;
  }

  const codes = lots.map((l) => l.code_patrimoine);
  let statut: StatutRattachementLot;
  if (lots.length === 0) {
    const aDesEr = refsHistorique.length > 0 || refsSuivi.length > 0;
    statut = aDesEr ? "hors_referentiel" : "non_rattache";
    refsNonTrouvees = [...new Set([...hist.nonTrouvees, ...suivi.nonTrouvees])];
  } else if (codes.length === 1) {
    statut = "rattache";
  } else {
    statut = "multi_lots";
  }

  return { statut, source, lots, codes, refsNonTrouvees };
};

/** Lot unique d'une résolution « rattache », sinon null. */
export const lotUniqueDe = (
  resolution: ResolutionRattachementLot | null | undefined,
): LotPatrimoine | null =>
  resolution?.statut === "rattache" && resolution.lots.length === 1
    ? (resolution.lots[0] ?? null)
    : null;
