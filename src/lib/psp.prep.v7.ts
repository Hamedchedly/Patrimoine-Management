/**
 * PSP V7 — Logique PUR réutilisable pour la préparation (saisie directe,
 * recherche patrimoine, enveloppes, filtres annuels, export).
 *
 * Aucune dépendance Supabase / React : testable en Node (type stripping).
 *
 * Règle absolue V7 : ne JAMAIS dupliquer les moteurs existants. Ce module :
 *  · centralise la règle corps d'état → catégorie GE/GT/CP (dérivée des 114
 *    lignes réelles du fichier « Prog_Secteur_11_2026.xlsx ») ;
 *  · filtre annuel CUMULATIF avec désélection individuelle (visualisation seule,
 *    ne modifie JAMAIS la programmation) ;
 *  · calcule l'enveloppe (programmé / restant / %) — rien n'est stocké ;
 *  · formate l'adresse d'export depuis les relations structurées
 *    (psp_ligne_patrimoine) — la chaîne n'est jamais stockée.
 */
import {
  PSP_ANNEES,
  totalOperation,
  type PspAnnee,
  type PspCategorie,
  type PspOperation,
} from "./psp.prep.ts";
import { entreeDe, rueDe } from "./adresses.ts";
import { extraireErTexte, normaliserCodeEr } from "./commande.rattachement.lots.ts";
// ── 1. Corps d'état → catégorie (mapping centralisé, réutilisable) ──────────────
// Source : fichier de programmation 2026 réel (code lettre entre parenthèses).
/** V7.5 §5 — types « garage » identifiés par le champ métier `lots.type_lot`. */
const TYPES_GARAGE_V75 = new Set(["GAR", "BOX"]);

/**
 * V7.5 §5 — vrai si un lot est un garage/box (filtre d'affichage uniquement,
 * jamais une suppression en base). Source métier : `lots.type_lot`.
 */
export const estLotGarage = (l: { type_lot?: string | null }): boolean =>
  Boolean(l.type_lot && TYPES_GARAGE_V75.has(String(l.type_lot).toUpperCase()));

/** V7.5 §5 — filtre les garages d'une liste de lots (sans muter la liste). */
export const sansGarages = <T extends { type_lot?: string | null }>(
  lots: T[],
  afficherGarages: boolean,
): T[] => (afficherGarages ? lots : lots.filter((l) => !estLotGarage(l)));

export const CORPS_ETAT_CATEGORIE: Record<string, PspCategorie> = {
  // GT
  c: "GT",
  d: "GT",
  e: "GT",
  // GE
  f: "GE",
  g: "GE",
  h: "GE",
  i: "GE",
  j: "GE",
  // CP
  m: "CP",
  o: "CP",
  p: "CP",
  q: "CP",
  r: "CP",
  u: "CP",
  w: "CP",
  y: "CP",
  z: "CP",
};

export const CATEGORIE_CORPS_ETAT_DEFAUT: PspCategorie = "GT";

/**
 * V7.4 — Corps d'état structurés GE/GT/CP pour la liste déroulante (sélection
 * UNIQUE). Réutilise `categorieDepuisCorpsEtat` — jamais de second mapping.
 */
export function corpsEtatsGroupes(
  liste: string[],
): Array<{ categorie: PspCategorie; items: string[] }> {
  const groupes = new Map<PspCategorie, string[]>();
  for (const c of liste) {
    const cat = categorieDepuisCorpsEtat(c);
    groupes.set(cat, [...(groupes.get(cat) ?? []), c]);
  }
  return (["GT", "GE", "CP"] as PspCategorie[])
    .map((categorie) => ({
      categorie,
      items: [...(groupes.get(categorie) ?? [])].sort((a, b) => a.localeCompare(b, "fr")),
    }))
    .filter((g) => g.items.length > 0);
}

/** Extrait le code lettre d'un libellé corps d'état : « (u) Etanchéité » → « u ». */
export function extraireCodeCorpsEtat(corpsEtat: string | null | undefined): string | null {
  const m = /\(([A-Za-zÀ-ÿ]+)\)/.exec(corpsEtat ?? "");
  if (!m?.[1]) return null;
  const code = m[1].toLowerCase();
  return code in CORPS_ETAT_CATEGORIE ? code : null;
}

/** Catégorie GE/GT/CP depuis le corps d'état (règle unique — jamais dupliquée dans l'UI). */
export function categorieDepuisCorpsEtat(corpsEtat: string | null | undefined): PspCategorie {
  const code = extraireCodeCorpsEtat(corpsEtat);
  return (code ? CORPS_ETAT_CATEGORIE[code] : undefined) ?? CATEGORIE_CORPS_ETAT_DEFAUT;
}

// ── 2. Filtre annuel CUMULATIF (visualisation seule) ────────────────────────────
/** Une opération est concernée par une année si son montant y est > 0. */
export const operationConcerneAnnee = (op: PspOperation, annee: PspAnnee): boolean =>
  (op.programme?.[String(annee)] ?? 0) > 0;

/**
 * Filtre cumulatif : les années sélectionnées sont réunies (2027+2028 = lignes
 * avec montant > 0 en 2027 OU 2028). Chaque année est désélectionnable.
 * Aucune sélection → toutes les opérations. Ne modifie JAMAIS la programmation.
 */
export function filtrerParAnneesCumulatif(ops: PspOperation[], annees: PspAnnee[]): PspOperation[] {
  if (!annees || annees.length === 0) return ops;
  const set = new Set(annees.map(String));
  return ops.filter((op) =>
    PSP_ANNEES.some((a) => set.has(String(a)) && operationConcerneAnnee(op, a)),
  );
}

// ── 3. Enveloppes (calculs — jamais stockés) ────────────────────────────────────
export type CalculEnveloppe = {
  enveloppe: number;
  programme: number;
  restant: number;
  pourcentage: number | null; // null si enveloppe = 0 (non définie)
  depassement: boolean;
};

export function calculEnveloppe(enveloppe: number, programme: number): CalculEnveloppe {
  const restant = enveloppe - programme;
  return {
    enveloppe,
    programme,
    restant,
    pourcentage: enveloppe > 0 ? programme / enveloppe : null,
    depassement: enveloppe > 0 && restant < 0,
  };
}

const CATEGORIES_BUDGET = ["GE", "GT", "CP"] as const;

/**
 * V7.8 §3 — Budget DISPONIBLE d'une année : somme des enveloppes GE/GT/CP
 * renseignées ; sinon repli sur la dotation par défaut (MOCK). Distinction
 * stricte : « enveloppe » (par catégorie) vs « budget disponible » (par année).
 * Règle UNIQUE utilisée par le KPI et la simulation — jamais stockée.
 */
export function budgetDisponibleParAnnee(
  annee: PspAnnee,
  enveloppes: EnveloppeMap,
  defautParAnnee: Record<string, number> = {},
): number {
  const envAnnee = CATEGORIES_BUDGET.reduce((s, c) => s + (enveloppes[`${annee}|${c}`] ?? 0), 0);
  return envAnnee > 0 ? envAnnee : (defautParAnnee[String(annee)] ?? 0);
}

/** V7.8 §3 — Budget disponible TOTAL de la période (somme des années). */
export function budgetDisponibleTotalReel(
  enveloppes: EnveloppeMap,
  defautParAnnee: Record<string, number> = {},
): number {
  return PSP_ANNEES.reduce(
    (s, a) => s + budgetDisponibleParAnnee(a, enveloppes, defautParAnnee),
    0,
  );
}

// ── 4. Export — chaîne d'adresse depuis les relations structurées ───────────────
export type PerimetreExport = {
  niveau: "tranche" | "rue" | "adresse" | "lot";
  rue?: string | null;
  numero?: string | null;
  ville?: string | null;
  /** Adresse enrichie du lot ou de la tranche (affichage) — jamais stockée en base. */
  adresseReference?: string | null;
  lots?: Array<{ code_patrimoine: string | null }>;
};

/**
 * « 12 RUE CORNILLIOT, THORIGNY-SUR-MARNE - ER.123456 / ER.123457 »
 * Toute une rue → « RUE CORNILLIOT, THORIGNY-SUR-MARNE ».
 * Lot / tranche → adresse de référence enrichie (sinon ville seule).
 * La chaîne est calculée, JAMAIS stockée en base.
 */
export function adresseExportPatrimoine(p: PerimetreExport): string {
  const ville = p.ville?.trim() ?? "";
  const rue = p.rue?.trim() ?? "";
  const numero = p.numero?.trim() ?? "";
  let base: string;
  if (p.niveau === "adresse") base = `${numero} ${rue}`.trim();
  else if (p.niveau === "rue") base = rue;
  else base = p.adresseReference?.trim() ?? "";
  const adresse = base ? (ville ? `${base}, ${ville}` : base) : ville;
  const codes = (p.lots ?? []).map((l) => l.code_patrimoine).filter((c): c is string => !!c);
  const lotsPart = codes.length > 0 ? ` - ${codes.join(" / ")}` : "";
  return `${adresse}${lotsPart}`.trim();
}

// ── 5. Statut / priorité — libellés UNIQUES (affichage + tri partagent ces valeurs) ──
export const STATUT_LABELS: Record<string, string> = {
  a_definir: "À définir",
  attente_agence: "Attente retour agence",
  attente_confirmation: "Attente confirmation",
};
export const PRIORITE_LABELS: Record<string, string> = {
  prioritaire: "Prioritaire",
  normale: "Normale",
  non_prioritaire: "Non prioritaire",
};

/** Libellés des statuts de devis (psp_devis.statut) — affichage + édition. */
export const DEVIS_STATUT_LABELS: Record<string, string> = {
  a_demander: "À demander",
  demande_envoyee: "Demande envoyée",
  recu: "Reçu",
  a_analyser: "À analyser",
  retenu: "Retenu",
  non_retenu: "Non retenu",
  expire: "Expiré",
  annule: "Annulé",
};

/**
 * V8.7 §3.2 — STATUT DE CONSULTATION affiché dans la préparation (colonne
 * « Devis »). DÉRIVÉ exclusivement des `psp_devis.statut` existants — aucun
 * état stocké, aucun moteur parallèle (même ordre de priorité que le suivi
 * V8.1 : retenu > reçu > demande envoyée > à demander > aucune). Le montant du
 * devis reste DISTINCT du budget estimatif et des montants de commande.
 */
export type ConsultationPrepCode =
  "aucune" | "a_demander" | "demande_envoyee" | "devis_recu" | "devis_retenu";

/** Libellés du statut consultation (clé = ConsultationPrepCode — accès typé). */
export const STATUT_CONSULTATION_PREP_LABELS: Record<ConsultationPrepCode, string> = {
  aucune: "Aucune demande",
  a_demander: "Demande à envoyer",
  demande_envoyee: "Demande envoyée",
  devis_recu: "Devis reçu",
  devis_retenu: "Devis retenu",
};

export const statutConsultationDepuisDevis = (
  devis: Array<{ statut?: string }>,
): { code: ConsultationPrepCode; label: string } => {
  const s = devis.map((d) => d.statut ?? "");
  if (s.includes("retenu"))
    return { code: "devis_retenu", label: STATUT_CONSULTATION_PREP_LABELS.devis_retenu };
  if (s.some((x) => x === "recu" || x === "a_analyser"))
    return { code: "devis_recu", label: STATUT_CONSULTATION_PREP_LABELS.devis_recu };
  if (s.includes("demande_envoyee"))
    return { code: "demande_envoyee", label: STATUT_CONSULTATION_PREP_LABELS.demande_envoyee };
  if (s.includes("a_demander"))
    return { code: "a_demander", label: STATUT_CONSULTATION_PREP_LABELS.a_demander };
  return { code: "aucune", label: STATUT_CONSULTATION_PREP_LABELS.aucune };
};

/**
 * V8.8 §1 — LIBELLÉ D'ENTREPRISE robuste : ne jamais afficher de valeur vide.
 *   · nom présent          → nom ;
 *   · nom absent + n°      → « Fournisseur n°123456 » ;
 *   · nom absent + id UUID → « Entreprise non renseignée — Fournisseur n°… » si
 *     un numéro est disponible, sinon « Entreprise non renseignée ».
 * Aucun nom inventé.
 */
export const libelleEntreprise = (
  nom: string | null | undefined,
  numeroFournisseur?: string | null | undefined,
): string => {
  const n = (nom ?? "").trim();
  const num = (numeroFournisseur ?? "").trim();
  if (n) return n;
  if (num) return `Fournisseur n°${num}`;
  return "Entreprise non renseignée";
};

/**
 * V8.8 §1 — variante avec fournisseur_id (UUID) : si aucun numéro lisible,
 * affiche « Entreprise non renseignée » (jamais un UUID brut).
 */
export const libelleEntrepriseAvecId = (
  nom: string | null | undefined,
  numeroFournisseur?: string | null | undefined,
  fournisseurId?: string | null | undefined,
): string => {
  const base = libelleEntreprise(nom, numeroFournisseur);
  if (base !== "Entreprise non renseignée") return base;
  return fournisseurId ? "Entreprise non renseignée" : base;
};

/**
 * V8.16p — libellé avec le NUMÉRO TOUJOURS affiché à côté du nom (suggestions
 * de devis) : « Nom n°XXXX ». Nom seul si aucun numéro ; repli robuste sinon.
 */
export const libelleEntrepriseAvecNumero = (
  nom: string | null | undefined,
  numeroFournisseur?: string | null | undefined,
): string => {
  const n = (nom ?? "").trim();
  const num = (numeroFournisseur ?? "").trim();
  if (!n) return num ? `Fournisseur n°${num}` : "Entreprise non renseignée";
  return num ? `${n} n°${num}` : n;
};

// ── 6. Enveloppes — type de la carte clé `${annee}|${categorie}` (jamais stocké) ──
export type EnveloppeMap = Record<string, number>;

// ── 7. Hiérarchie patrimoniale d'une tranche (rues → numéros → lots) ────────────
export type LotAdresse = { adresse: string | null; ville?: string | null };

/**
 * Rues distinctes d'une tranche (réutilise `rueDe` : « 25-27 RUE DE RUZE » →
 * « RUE DE RUZE »). Le libellé d'affichage est le libellé complet (majuscules).
 */
export function ruesDeTranche(
  lots: LotAdresse[],
  q?: string,
): Array<{ rue: string; ville: string | null; nb_lots: number }> {
  const map = new Map<string, { ville: string | null; nb_lots: number }>();
  for (const l of lots) {
    const rue = rueDe(l.adresse);
    if (!rue || rue === "Adresse inconnue") continue;
    const cle = rue.toUpperCase();
    const cur = map.get(cle) ?? { ville: l.ville ?? null, nb_lots: 0 };
    cur.nb_lots += 1;
    if (!cur.ville && l.ville) cur.ville = l.ville;
    map.set(cle, cur);
  }
  const liste = [...map.entries()]
    .map(([rue, v]) => ({ rue, ville: v.ville, nb_lots: v.nb_lots }))
    .sort((a, b) => a.rue.localeCompare(b.rue, "fr", { numeric: true, sensitivity: "base" }));
  const qq = (q ?? "").trim().toLowerCase();
  return qq ? liste.filter((x) => x.rue.toLowerCase().includes(qq)) : liste;
}

/**
 * Numéros/entrées disponibles d'une rue (adresses complètes distinctes).
 * « 12 RUE CORNILLIOT », « 14 RUE CORNILLIOT », « 25-27 RUE DE RUZE »…
 */
export function numerosDeRue(lots: LotAdresse[], rue: string): string[] {
  const cible = rue.trim().toUpperCase();
  const set = new Set<string>();
  for (const l of lots) {
    const entree = entreeDe(l.adresse);
    if (!entree) continue;
    if (rueDe(l.adresse).toUpperCase() !== cible) continue;
    set.add(entree);
  }
  return [...set].sort((a, b) => a.localeCompare(b, "fr", { numeric: true, sensitivity: "base" }));
}

/** Lots correspondant à une entrée précise (« 12 RUE CORNILLIOT »). */
export function lotsDeAdresse<T extends { adresse: string | null }>(
  lots: T[],
  entree: string,
): T[] {
  const cible = entree.trim().toUpperCase();
  return lots.filter((l) => entreeDe(l.adresse).toUpperCase() === cible);
}

// ── 8. Libellé d'adresse affiché dans le tableau depuis le périmètre structuré ──
export type LotInfo = {
  code_patrimoine: string | null;
  adresse: string | null;
  ville: string | null;
};
export type PerimetreLigne = {
  niveau: string;
  rue: string | null;
  numero: string | null;
  lot_id: string | null;
};

/**
 * « RUE CORNILLIOT, THORIGNY-SUR-MARNE » / « 12 RUE CORNILLIOT, … - ER.123456 ».
 * Utilise `adresseExportPatrimoine` (règle unique). Sans périmètre : repli
 * adresse/ville de la ligne. Multi-périmètres : jointure « ; ».
 */
export function libelleAdressePerimetre(
  perimetres: PerimetreLigne[],
  lotsParId: Map<string, LotInfo>,
  contexte: { adresse: string; ville: string },
): string {
  if (!perimetres || perimetres.length === 0) {
    const base = [contexte.adresse, contexte.ville].filter(Boolean).join(", ");
    return base || "—";
  }
  // Les lots d'une MÊME adresse sont regroupés : codes séparés par « / ».
  const lotsParBase = new Map<string, { base: string; ville: string; codes: string[] }>();
  const autres: PerimetreExport[] = [];
  for (const p of perimetres) {
    if (p.niveau === "lot") {
      const lot = p.lot_id ? lotsParId.get(p.lot_id) : undefined;
      const base = lot?.adresse ?? contexte.adresse;
      const ville = lot?.ville ?? contexte.ville;
      const cle = `${base}|${ville}`;
      const cur = lotsParBase.get(cle) ?? { base, ville, codes: [] };
      if (lot?.code_patrimoine) cur.codes.push(lot.code_patrimoine);
      lotsParBase.set(cle, cur);
    } else if (p.niveau === "rue") {
      autres.push({ niveau: "rue", rue: p.rue, ville: contexte.ville });
    } else if (p.niveau === "adresse") {
      autres.push({ niveau: "adresse", rue: p.rue, numero: p.numero, ville: contexte.ville });
    } else {
      autres.push({ niveau: "tranche", adresseReference: contexte.adresse, ville: contexte.ville });
    }
  }
  const parts: string[] = [];
  for (const g of lotsParBase.values()) {
    parts.push(
      adresseExportPatrimoine({
        niveau: "lot",
        adresseReference: g.base,
        ville: g.ville,
        lots: g.codes.map((c) => ({ code_patrimoine: c })),
      }),
    );
  }
  for (const e of autres) parts.push(adresseExportPatrimoine(e));
  return parts.join(" ; ");
}

// ── 8bis. Adresse d'une ligne PSP : ER (lot) prioritaire + détection texte ──────

/** Index code patrimoine → LotInfo (depuis lotsParId, valeurs). */
const indexLotsParCode = (lotsParId: Map<string, LotInfo>): Map<string, LotInfo> => {
  const index = new Map<string, LotInfo>();
  for (const l of lotsParId.values()) {
    if (!l.code_patrimoine) continue;
    const cle = normaliserCodeEr(l.code_patrimoine);
    if (cle && !index.has(cle)) index.set(cle, l);
  }
  return index;
};

export type AdresseLigneResolue = {
  adresse: string;
  /** Interférence : ER du texte ≠ ER du périmètre (null sinon). */
  ambiguite: string | null;
};

/**
 * V8.18 — ADRESSE d'une ligne PSP / demande de devis : privilégie l'ER (lot) réel.
 *  1. lots du PÉRIMÈTRE (niveau lot) → adresse du/des lots (format « adresse - ER.xxx ») ;
 *  2. sinon, ER détecté dans le texte (nature/descriptif) et résolu dans `lots` ;
 *  3. interférence : ER du texte ≠ ER du périmètre → `ambiguite` renseignée (l'adresse
 *     affichée reste celle du périmètre, source structurée prioritaire) ;
 *  4. repli : adresse/ville de la tranche (contexte).
 * Pure — ne modifie aucune donnée.
 */
export function libelleAdresseLigne(
  perimetres: PerimetreLigne[],
  lotsParId: Map<string, LotInfo>,
  texte: string | null | undefined,
  contexte: { adresse: string; ville: string },
): AdresseLigneResolue {
  const lotsPerimetre: LotInfo[] = [];
  for (const p of perimetres) {
    if (p.niveau !== "lot" || !p.lot_id) continue;
    const lot = lotsParId.get(p.lot_id);
    if (lot) lotsPerimetre.push(lot);
  }

  const indexParCode = indexLotsParCode(lotsParId);
  const lotsTexte: LotInfo[] = [];
  for (const ref of extraireErTexte(texte)) {
    const lot = indexParCode.get(normaliserCodeEr(ref));
    if (lot && !lotsTexte.includes(lot)) lotsTexte.push(lot);
  }

  const adresseTranche = [contexte.adresse, contexte.ville].filter(Boolean).join(", ") || "—";

  // 1) Périmètre avec des lots → adresse du/des lots + détection d'interférence texte.
  if (lotsPerimetre.length > 0) {
    const libelle = libelleAdressePerimetre(perimetres, lotsParId, contexte);
    const codesPerim = new Set(lotsPerimetre.map((l) => l.code_patrimoine));
    const codesTexte = lotsTexte.filter(
      (l) => l.code_patrimoine && !codesPerim.has(l.code_patrimoine),
    );
    const ambiguite =
      codesTexte.length > 0
        ? `ER du texte (${codesTexte
            .map((l) => l.code_patrimoine)
            .filter(Boolean)
            .join(", ")}) ≠ ER du périmètre (${[...codesPerim].filter(Boolean).join(", ")})`
        : null;
    return { adresse: libelle, ambiguite };
  }

  // 2) Aucun lot au périmètre mais un ER résolu dans le texte → adresse de ces lots.
  if (lotsTexte.length > 0) {
    const groupes = new Map<string, { base: string; ville: string; codes: string[] }>();
    for (const lot of lotsTexte) {
      const base = lot.adresse ?? contexte.adresse;
      const ville = lot.ville ?? contexte.ville;
      const cle = `${base}|${ville}`;
      const g = groupes.get(cle) ?? { base, ville, codes: [] };
      if (lot.code_patrimoine) g.codes.push(lot.code_patrimoine);
      groupes.set(cle, g);
    }
    const parts: string[] = [];
    for (const g of groupes.values()) {
      parts.push(
        adresseExportPatrimoine({
          niveau: "lot",
          adresseReference: g.base,
          ville: g.ville,
          lots: g.codes.map((c) => ({ code_patrimoine: c })),
        }),
      );
    }
    return { adresse: parts.join(" ; "), ambiguite: null };
  }

  // 3) Repli : adresse de la tranche (aucun ER exploitable).
  return { adresse: adresseTranche, ambiguite: null };
}

// ── 9. Construction du périmètre patrimonial depuis la sélection UI (pure) ─────
/** Extrait le numéro d'une entrée : « 25-27 RUE DE RUZE » → « 25-27 ». */
export function numeroDeEntree(entree: string): string {
  const m = entree.match(/^([\d.\-/]+)\s*(BIS|TER|QUATER)?\s/i);
  return m ? `${m[1]?.trim() ?? ""}${m[2] ? ` ${m[2].toUpperCase()}` : ""}` : entree;
}

/**
 * Construit les lignes `psp_ligne_patrimoine` depuis la sélection de la ligne de
 * saisie. Règle : une seule tranche ; lots prioritaire sur adresse ; adresses
 * prioritaire sur rue ; rue prioritaire sur tranche. Tous les niveaux sont
 * structurés (vérifiés par CHECK en base).
 */
export function construirePerimetres(input: {
  lots: Array<{ id: string; adresse?: string | null; code_patrimoine?: string | null }>;
  adresses: string[];
  rue: string | null;
  mode: "auto" | "force";
}): PerimetreLigne[] {
  if (input.mode === "force" && input.lots.length === 0) {
    // Périmètre "toute la tranche" (toujours exprimé avec tranche_code).
    return [{ niveau: "tranche", rue: null, numero: null, lot_id: null }];
  }
  if (input.lots.length > 0) {
    return input.lots.map((l) => ({
      niveau: "lot",
      rue: null,
      numero: null,
      lot_id: l.id,
    }));
  }
  if (input.adresses.length > 0 && input.rue) {
    return input.adresses.map((a) => ({
      niveau: "adresse",
      rue: input.rue,
      numero: numeroDeEntree(a),
      lot_id: null,
    }));
  }
  if (input.rue) {
    return [{ niveau: "rue", rue: input.rue, numero: null, lot_id: null }];
  }
  return [{ niveau: "tranche", rue: null, numero: null, lot_id: null }];
}

/**
 * Programmé par année × catégorie — règle unique utilisée par la répartition
 * annuelle (PspKpi) et testable. Clé `${annee}|${categorie}`. Jamais stocké.
 */
/**
 * V8.2.1 — Restauration du périmètre en MODIFICATION : transforme les périmètres
 * « lot » (lot_id) en suggestions affichables (chips) via `lotsParId`
 * (code_patrimoine, adresse, ville). Retourne [] si l'info lot est absente —
 * les champs TR / rue / adresses restent restaurés indépendamment.
 */
export function suggestionsLotsDepuisPerimetres(
  perimetres: PerimetreLigne[],
  lotsParId: Map<string, LotInfo> | null,
  tranche: string | null,
): Array<{
  id: string;
  code_patrimoine: string;
  tranche_code: string;
  adresse: string | null;
  ville: string | null;
  locataire_nom?: string | null;
  type_lot?: string | null;
}> {
  if (!lotsParId || !perimetres) return [];
  const result: Array<{
    id: string;
    code_patrimoine: string;
    tranche_code: string;
    adresse: string | null;
    ville: string | null;
    locataire_nom?: string | null;
    type_lot?: string | null;
  }> = [];
  const vus = new Set<string>();
  for (const p of perimetres) {
    if (p.niveau !== "lot" || !p.lot_id) continue;
    if (vus.has(p.lot_id)) continue;
    vus.add(p.lot_id);
    const info = lotsParId.get(p.lot_id);
    if (!info?.code_patrimoine) continue;
    result.push({
      id: p.lot_id,
      code_patrimoine: info.code_patrimoine,
      tranche_code: tranche ?? "",
      adresse: info.adresse,
      ville: info.ville,
    });
  }
  return result;
}

export function programmeParAnneeCategorie(ops: PspOperation[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const op of ops) {
    for (const a of PSP_ANNEES) {
      const v = op.programme?.[String(a)] ?? 0;
      if (v > 0) m[`${a}|${op.categorie}`] = (m[`${a}|${op.categorie}`] ?? 0) + v;
    }
  }
  return m;
}

// ── 10. Détection du type de recherche patrimoine (TR vs ER/locataire) ─────────
export type TypeRecherchePatrimoine = "tranche" | "lot" | "mixte";

/**
 * V7.3 — Détection PROPRE du type de recherche (plus uniquement /^\d/) :
 *  · « ER.123 » / « ER123 »      → lot (code patrimoine) ;
 *  · « 1976 », « 19 », « TR1976 » → tranche (code/numéro) ;
 *  · tout autre texte (« REIMS », « CHESS », « DUPONT »…) → mixte : on cherche
 *    les tranches (ville/libellé) ET les lots (locataire/adresse) en parallèle,
 *    regroupés et étiquetés dans l'UI.
 */
export function detecterRecherchePatrimoine(q: string): TypeRecherchePatrimoine {
  const texte = (q ?? "").trim();
  if (!texte) return "mixte";
  if (/^ER[.\s\d-]*$/i.test(texte) || /^ER[.\s\d-]/.test(texte)) return "lot";
  // V8.2.1 — un ER numérique (ex. « 33334 ») reste classé « tranche » (compat V7.3) ;
  // la requête côté serveur élargit la recherche aux lots pour les entrées numériques.
  if (/^\d/.test(texte)) return "tranche";
  if (/^TR\s*\d/i.test(texte)) return "tranche";
  return "mixte";
}

// ── 12. V7.6 — Référentiels métier, brouillon et complétude d'export ───────────
/**
 * Entrée du RÉFÉRENTIEL corps d'état (table `psp_corps_etats` — V7.6).
 * Le référentiel est l'autorité des corps disponibles et de leur catégorie ;
 * l'historique des commandes n'a servi qu'à l'initialiser.
 */
export type CorpsEtatReferentiel = {
  id?: string;
  code: string | null;
  libelle: string;
  categorie: PspCategorie;
  actif: boolean;
};

/**
 * V7.6 — Catégorie GE/GT/CP d'un corps d'état depuis le RÉFÉRENTIEL
 * (`psp_corps_etats`), avec repli sur le mapping historique si le corps n'y est
 * pas encore (valeurs libres saisies dans un brouillon). Jamais de second mapping.
 */
export function categorieCorpsEtatReferentiel(
  corps: string | null | undefined,
  referentiel: CorpsEtatReferentiel[],
): PspCategorie {
  if (corps) {
    const entree = referentiel.find((r) => r.libelle === corps && r.actif);
    if (entree) return entree.categorie;
  }
  return categorieDepuisCorpsEtat(corps);
}

/** V7.6 — Corps d'état groupés GE/GT/CP depuis le RÉFÉRENTIEL (actifs), avec recherche. */
export function corpsEtatsGroupesReferentiel(
  referentiel: CorpsEtatReferentiel[],
  q = "",
): Array<{ categorie: PspCategorie; items: string[] }> {
  const filtre = q.trim().toLowerCase();
  const actifs = referentiel
    .filter((r) => r.actif)
    .filter((r) => !filtre || r.libelle.toLowerCase().includes(filtre))
    .map((r) => r.libelle);
  return (["GT", "GE", "CP"] as PspCategorie[])
    .map((categorie) => ({
      categorie,
      items: actifs
        .filter((libelle) => categorieCorpsEtatReferentiel(libelle, referentiel) === categorie)
        .sort((a, b) => a.localeCompare(b, "fr")),
    }))
    .filter((g) => g.items.length > 0);
}

/**
 * V7.6 §1 — Règle brouillon : la TR seule suffit pour ENREGISTRER une ligne.
 * Corps d'état, montant et année sont FACULTATIFS à la saisie (vérifiés à
 * l'export). Restent bloquantes les incohérences structurelles (conflit de TR).
 */
export function brouillonEnregistrable(tranche: string | null, conflit?: string | null): boolean {
  return Boolean(tranche) && !conflit;
}

/**
 * V7.6 — Ligne incomplète pour l'export (champs obligatoires manquants). */
export type LigneIncompleteExport = {
  id: string;
  tranche: string;
  manquants: string[];
};

/**
 * V7.6 — Analyse de complétude AVANT export. Les champs obligatoires de
 * l'export direction sont repris des colonnes déjà définies du CSV :
 *  · TR            (toujours présent — une ligne a forcément un TR) ;
 *  · Corps d'état  ;
 *  · Nature travaux ;
 *  · Adresse / périmètre ;
 *  · au moins une année programmée avec montant > 0 ;
 *  · Catégorie (GE/GT/CP — toujours calculée, contrôlée par précaution).
 * Le brouillon reste PERMISSIF : ces champs ne sont exigés qu'ici.
 */
export function analyserCompletudeExport(ops: PspOperation[]): LigneIncompleteExport[] {
  const incompletes: LigneIncompleteExport[] = [];
  for (const op of ops) {
    const manquants: string[] = [];
    // « — » est la convention de placeholder de `creerOperation` (corps vide) —
    // considéré comme manquant à l'export.
    const corps = (op.corps_etat ?? "").trim();
    if (!corps || corps === "—") manquants.push("Corps d'état");
    if (!(op.nature_travaux ?? "").trim()) manquants.push("Nature travaux");
    if (!(op.adresse ?? "").trim() && !(op.ville ?? "").trim()) {
      manquants.push("Adresse / périmètre");
    }
    if (totalOperation(op) <= 0) manquants.push("Montant programmé (au moins une année)");
    if (!op.categorie) manquants.push("Catégorie");
    if (manquants.length > 0) {
      incompletes.push({ id: op.id, tranche: op.tranche, manquants });
    }
  }
  return incompletes;
}

/**
 * V7.6 — Résumé de la sélection d'adresse pour la cellule « Adresse / périmètre » :
 *  · rue seule            → « Toute la rue » ;
 *  · rues + numéros       → « 3, 5, 7 » ;
 *  · lots (ER)            → « ER.123 / ER.456 ».
 * La rue reste TOUJOURS affichée tant qu'une sélection d'adresse existe.
 */
export function resumeSelectionAdresse(input: {
  rue: string | null;
  adresses: string[];
  lots: Array<{ code_patrimoine: string | null }>;
}): string | null {
  if (!input.rue) return null;
  const lots = input.lots.map((l) => l.code_patrimoine).filter((c): c is string => Boolean(c));
  if (lots.length > 0) return lots.join(" / ");
  if (input.adresses.length > 0) return input.adresses.join(", ");
  return "Toute la rue";
}

/**
 * V7.6 — Message CC manquant (référentiel non renseigné pour le sous-secteur).
 * Le CC n'est JAMAIS déduit par fréquence des commandes (règle V7.6 §8).
 */
export function libelleCcManquant(
  ref:
    | {
        sous_secteur: string | null;
        charge_clientele: string | null;
      }
    | undefined,
): string | null {
  if (!ref) return null;
  if (ref.charge_clientele) return null;
  if (ref.sous_secteur) {
    return `Chargé clientèle non renseigné pour le sous-secteur ${ref.sous_secteur}.`;
  }
  return "Chargé clientèle non renseigné (sous-secteur inconnu dans le référentiel).";
}

/**
 * V7.6 — Upsert PUR du référentiel CC (une ligne par sous-secteur). Un même
 * chargé peut gérer plusieurs sous-secteurs : la clé reste `sous_secteur`.
 */
export function applicerReferentielCcUpsert<T extends { sous_secteur: string }>(
  lignes: T[],
  entree: {
    sous_secteur: string;
    charge_clientele: string;
    identifiant_personnel: string | null;
    actif: boolean;
  },
): T[] {
  const present = lignes.some((l) => l.sous_secteur === entree.sous_secteur);
  if (present) {
    return lignes.map((l) => (l.sous_secteur === entree.sous_secteur ? { ...l, ...entree } : l));
  }
  return [...lignes, entree as unknown as T];
}

// ── 13. Diff d'historique (psp_ligne_historique) pour la fiche opération ───────
export type LigneDiffHistorique = {
  champ: string;
  avant: string;
  apres: string;
};

const LIBELLE_HISTORIQUE: Record<string, string> = {
  tranche_code: "TR",
  categorie: "Catégorie",
  corps_etat: "Corps d'état",
  nature_travaux: "Nature travaux",
  programme: "Montants programmés",
  remarques: "Notes",
  statut: "Statut",
  priorite: "Priorité",
  ligne_budget: "Ligne budgétaire",
};

/**
 * Compare les snapshots avant/après (jsonb rows) d'une entrée psp_ligne_historique
 * et retourne les champs réellement modifiés (champ + ancienne + nouvelle valeur).
 * Le programme (jsonb) est résumé en « 2027:15000, 2028:0, … ».
 */
export function diffHistorique(avant: unknown, apres: unknown): LigneDiffHistorique[] {
  const a = (avant ?? {}) as Record<string, unknown>;
  const b = (apres ?? {}) as Record<string, unknown>;
  const cles = new Set([...Object.keys(a), ...Object.keys(b)]);
  const result: LigneDiffHistorique[] = [];
  for (const cle of cles) {
    if (
      cle === "id" ||
      cle === "programmation_id" ||
      cle === "created_at" ||
      cle === "updated_at"
    ) {
      continue;
    }
    const va = a[cle];
    const vb = b[cle];
    const fmt = (v: unknown): string => {
      if (v === null || v === undefined) return "—";
      if (typeof v === "object") {
        const obj = v as Record<string, unknown>;
        return (
          Object.entries(obj)
            .filter(([, val]) => Number(val) > 0)
            .map(([k, val]) => `${k}:${val}`)
            .join(", ") || "—"
        );
      }
      return String(v);
    };
    if (fmt(va) !== fmt(vb)) {
      result.push({
        champ: LIBELLE_HISTORIQUE[cle] ?? cle,
        avant: fmt(va),
        apres: fmt(vb),
      });
    }
  }
  return result;
}
