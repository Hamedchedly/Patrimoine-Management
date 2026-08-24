/**
 * PSP — Module « Préparation PSP » (V2).
 *
 * PROTOTYPE : logique PUR + données de préparation. Aucune écriture en base.
 * Ce module est PUR (pas de React, pas d'alias `@/`) : testable en Node
 * (type stripping). La lecture des vraies données PAT S11 est isolée dans
 * l'adaptateur `psp.prep.data.ts` (+ `psp.prep.data.functions.ts` côté serveur).
 *
 * Contrat de conception :
 *  - les totaux sont TOUJOURS calculés, jamais saisis ;
 *  - `C` = catégorie budgétaire (GE / GT / CP) — JAMAIS le code corps d'état ;
 *  - le champ « Corps d'état » (code + libellé) reste indépendant de C ;
 *  - le TR (tranche) est la clé patrimoniale prioritaire ; l'adresse Excel
 *    n'est jamais une clé d'identification ;
 *  - les mutations locales (ajout / modification / déplacement) ne touchent
 *    jamais Supabase — elles restent en mémoire ;
 *  - la source budgétaire est clairement identifiée (`BUDGET_SOURCE`).
 */

// ── Constantes de programmation ─────────────────────────────────────────────

/** Années couvertes par la programmation pluriannuelle (2027 → 2031). */
export const PSP_ANNEES = [2027, 2028, 2029, 2030, 2031] as const;
export type PspAnnee = (typeof PSP_ANNEES)[number];

/** Catégorie budgétaire (colonne « C » du fichier de programmation) : GE / GT / CP. */
export const PSP_CATEGORIES = ["GE", "GT", "CP"] as const;
export type PspCategorie = (typeof PSP_CATEGORIES)[number];

/** Alias historique : la catégorie budgétaire C = GE/GT/CP (anciennement « secteur »). */
export type PspSecteur = PspCategorie;

/**
 * Source de l'enveloppe budgétaire. Tant que la dotation budgétaire officielle
 * n'est pas définie, les enveloppes annuelles restent MOCK (aucune invention).
 */
export const BUDGET_SOURCE = "MOCK" as const;

/**
 * Enveloppe budgétaire annuelle disponible (mock V2 — BUDGET_SOURCE = MOCK).
 * « Budget disponible » = somme des enveloppes ; « Écart disponible » =
 * disponible − programmé.
 */
export const PSP_BUDGET_DISPONIBLE_PAR_ANNEE: Record<string, number> = {
  "2027": 3_200_000,
  "2028": 3_200_000,
  "2029": 3_200_000,
  "2030": 3_200_000,
  "2031": 3_200_000,
};

// ── Types ───────────────────────────────────────────────────────────────────

/** Devis d'une opération — structuré (V6+ : psp_devis), entreprise + montant + références. */
export type PspDevis = {
  /** Identifiant Supabase (psp_devis.id) — présent dès lors que le devis est persisté. */
  id?: string;
  /** Fournisseur rattaché (psp_devis.fournisseur_id) — V7.8 §7. */
  fournisseur_id?: string | null;
  entreprise: string;
  /**
   * Date de la DEMANDE de devis = psp_devis.created_at (V7.10 §8). Distincte de
   * `date_devis` (date du devis reçu, nullable). Disponible pour le futur Suivi.
   */
  date_demande?: string | null;
  /** Montant nullable (V7.10 §6) — une demande de devis peut être sans montant. */
  montant: number | null;
  date_devis?: string | null;
  /** Statut structuré devis (psp_devis.statut). */
  statut?: string;
  remarque: string | null;
  /** Commentaire libre (psp_devis.commentaire). */
  commentaire?: string | null;
  /** Numéro / référence du devis (psp_devis.document_reference). */
  document_reference?: string | null;
};

/**
 * Opération programmée.
 * `programme` : montants par année — clé = "2027"…"2031" (0 si non programmé).
 * `categorie` : colonne « C » du fichier de programmation = GE / GT / CP.
 * `reportee`  : opération issue de l'ancienne programmation (ex. 2026).
 * `budget`    : enveloppe totale de l'opération (recalculée si non fournie).
 * `sous_secteur` : référence patrimoniale réelle (table tranches) — enrichie
 *                  par l'adaptateur `psp.prep.data.ts` quand disponible.
 */
export type PspOperation = {
  id: string;
  annee: PspAnnee;
  tranche: string;
  charge_clientele: string;
  charge_operation: string;
  categorie: PspCategorie;
  corps_etat_code: string;
  corps_etat: string;
  adresse: string;
  ville: string;
  sous_secteur: string | null;
  nature_travaux: string;
  budget: number;
  programme: Record<string, number>;
  remarques: string | null;
  devis: PspDevis[];
  reportee: boolean;
  ancienne_annee: number | null;
  ancien_montant: number | null;
  /** Ligne budgétaire réellement disponible (psp_lignes.ligne_budget) — V7.7 : jamais inventée à l'export. */
  ligne_budget?: string | null;
  /** Statut structuré (psp_lignes.statut) : a_definir | attente_agence | attente_confirmation. */
  statut?: string;
  /** Priorité (psp_lignes.priorite) : prioritaire | normale | non_prioritaire. */
  priorite?: string;
};

/** Ligne de l'ancienne programmation (modal « Ancienne programmation »). */
export type AncienneProgrammationItem = {
  id: string;
  nature_travaux: string;
  adresse: string;
  ville: string;
  tranche: string;
  annee: number;
  montant: number;
};

// ── Calculs purs ────────────────────────────────────────────────────────────

/** Montant d'une opération pour une année donnée (0 si non programmé). */
export const montantAnnee = (op: PspOperation, annee: string | number): number =>
  op.programme[String(annee)] ?? 0;

/** Total programmé d'une opération (somme des 5 années, jamais saisi). */
export const totalOperation = (op: PspOperation): number =>
  PSP_ANNEES.reduce((s, a) => s + montantAnnee(op, a), 0);

/**
 * Construit un programme annuel normalisé depuis un état local de saisie.
 * Les cinq années PSP restent toujours présentes, même à 0.
 */
export const construireProgrammeDepuisMontants = (
  montants: Record<string, number>,
): Record<string, number> => {
  const programme: Record<string, number> = {};
  for (const annee of PSP_ANNEES) {
    programme[String(annee)] = Number(montants[String(annee)]) || 0;
  }
  return programme;
};

/** Variante pratique pour la saisie PSP (tableau 2027→2031). */
export const construireProgrammeDepuisSaisie = (programme: number[]): Record<string, number> => {
  const montants: Record<string, number> = {};
  for (const [index, annee] of PSP_ANNEES.entries()) {
    montants[String(annee)] = Number(programme[index]) || 0;
  }
  return construireProgrammeDepuisMontants(montants);
};

/**
 * Normalise les périmètres saisis vers le format persistant utilisé par les
 * mutations Supabase.
 */
export const construirePerimetresDepuisSaisie = (
  perimetres: SaisieOperation["perimetres"],
): Array<{
  niveau: "tranche" | "rue" | "adresse" | "lot";
  rue: string | null;
  numero: string | null;
  lotId: string | null;
}> =>
  (perimetres ?? []).map((p) => ({
    niveau: p.niveau as "tranche" | "rue" | "adresse" | "lot",
    rue: p.rue,
    numero: p.numero,
    lotId: p.lot_id,
  }));

/** Somme des montants programmés d'un ensemble d'opérations. */
export const totalProgramme = (ops: PspOperation[]): number =>
  ops.reduce((s, op) => s + totalOperation(op), 0);

/** Somme par année d'un ensemble d'opérations (clé "2027"…"2031"). */
export const sommeParAnnee = (ops: PspOperation[]): Record<string, number> => {
  const result: Record<string, number> = {};
  for (const a of PSP_ANNEES) result[String(a)] = 0;
  for (const op of ops) {
    for (const a of PSP_ANNEES) result[String(a)] = (result[String(a)] ?? 0) + montantAnnee(op, a);
  }
  return result;
};

/** Statistiques d'un groupe d'opérations (totaux calculés automatiquement). */
export type StatsGroupe = {
  nbOperations: number;
  parAnnee: Record<string, number>;
  total: number;
};

export const statsOperations = (ops: PspOperation[]): StatsGroupe => {
  const parAnnee = sommeParAnnee(ops);
  return {
    nbOperations: ops.length,
    parAnnee,
    total: PSP_ANNEES.reduce((s, a) => s + (parAnnee[String(a)] ?? 0), 0),
  };
};

/** Budget disponible total sur la période (mock V1). */
export const budgetDisponibleTotal = (): number =>
  PSP_ANNEES.reduce((s, a) => s + (PSP_BUDGET_DISPONIBLE_PAR_ANNEE[String(a)] ?? 0), 0);

/** KPI globaux du module : disponible / programmé / écart / nb opérations. */
export const kpiGlobal = (ops: PspOperation[]) => {
  const stats = statsOperations(ops);
  const disponible = budgetDisponibleTotal();
  return {
    disponible,
    programme: stats.total,
    ecart: disponible - stats.total,
    nbOperations: stats.nbOperations,
    parAnnee: stats.parAnnee,
  };
};

// ── Regroupements (modes d'affichage) ───────────────────────────────────────

/** Tri métier stable : numériquement pour les tranches, alphabétique sinon. */
const comparerValeurs = (a: string, b: string): number => {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return a.localeCompare(b, "fr", { sensitivity: "base" });
};

/** Trie les opérations d'un groupe : année croissante, puis tranche, puis nature. */
const trierOperations = (ops: PspOperation[]): PspOperation[] =>
  [...ops].sort(
    (a, b) =>
      a.annee - b.annee ||
      comparerValeurs(a.tranche, b.tranche) ||
      a.nature_travaux.localeCompare(b.nature_travaux, "fr"),
  );

/** Niveau 2 (par tranche) : chargé de clientèle → opérations. */
export type SousGroupeCharge = {
  charge_clientele: string;
  operations: PspOperation[];
  stats: StatsGroupe;
};

/** Niveau 1 (par tranche) : tranche → chargés de clientèle. */
export type GroupeTranche = {
  tranche: string;
  charges: SousGroupeCharge[];
  stats: StatsGroupe;
};

/** Mode « Par tranche » : TRANCHE → Chargé de clientèle → opérations. */
export const grouperParTranche = (ops: PspOperation[]): GroupeTranche[] => {
  const map = new Map<string, Map<string, PspOperation[]>>();
  for (const op of ops) {
    const parCharge = map.get(op.tranche) ?? new Map<string, PspOperation[]>();
    const liste = parCharge.get(op.charge_clientele) ?? [];
    liste.push(op);
    parCharge.set(op.charge_clientele, liste);
    map.set(op.tranche, parCharge);
  }
  return [...map.entries()]
    .sort(([a], [b]) => comparerValeurs(a, b))
    .map(([tranche, parCharge]) => {
      const charges = [...parCharge.entries()]
        .sort(([a], [b]) => comparerValeurs(a, b))
        .map(([charge_clientele, liste]) => ({
          charge_clientele,
          operations: trierOperations(liste),
          stats: statsOperations(liste),
        }));
      return {
        tranche,
        charges,
        stats: statsOperations(charges.flatMap((c) => c.operations)),
      };
    });
};

/** Niveau 2 (par chargé de clientèle) : tranche → opérations. */
export type SousGroupeTranche = {
  tranche: string;
  operations: PspOperation[];
  stats: StatsGroupe;
};

/** Niveau 1 (par chargé de clientèle) : chargé → tranches. */
export type GroupeChargé = {
  charge_clientele: string;
  tranches: SousGroupeTranche[];
  stats: StatsGroupe;
};

/** Mode « Par chargé de clientèle » : CHARGÉ → Tranche → opérations. */
export const grouperParChargéClientele = (ops: PspOperation[]): GroupeChargé[] => {
  const map = new Map<string, Map<string, PspOperation[]>>();
  for (const op of ops) {
    const parTranche = map.get(op.charge_clientele) ?? new Map<string, PspOperation[]>();
    const liste = parTranche.get(op.tranche) ?? [];
    liste.push(op);
    parTranche.set(op.tranche, liste);
    map.set(op.charge_clientele, parTranche);
  }
  return [...map.entries()]
    .sort(([a], [b]) => comparerValeurs(a, b))
    .map(([charge_clientele, parTranche]) => {
      const tranches = [...parTranche.entries()]
        .sort(([a], [b]) => comparerValeurs(a, b))
        .map(([tranche, liste]) => ({
          tranche,
          operations: trierOperations(liste),
          stats: statsOperations(liste),
        }));
      return {
        charge_clientele,
        tranches,
        stats: statsOperations(tranches.flatMap((t) => t.operations)),
      };
    });
};

// ── Filtres (mode Détail) ───────────────────────────────────────────────────

/** Filtres du tableau Détail (chaîne vide = filtre inactif). */
export type FiltresDetail = {
  q: string;
  categorie: string;
  tranche: string;
  charge_clientele: string;
  corps_etat: string;
  annee: string;
};

export const FILTRES_VIDES: FiltresDetail = {
  q: "",
  categorie: "",
  tranche: "",
  charge_clientele: "",
  corps_etat: "",
  annee: "",
};

/** Normalisation de recherche : majuscules, sans accents, ponctuation → espace. */
const normaliser = (v: string): string =>
  v
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();

/** Applique les filtres du mode Détail (pur, déterministe). */
export const filtrerOperations = (ops: PspOperation[], filtres: FiltresDetail): PspOperation[] => {
  const q = normaliser(filtres.q);
  return ops.filter((op) => {
    if (filtres.categorie && op.categorie !== filtres.categorie) return false;
    if (filtres.tranche && op.tranche !== filtres.tranche) return false;
    if (filtres.charge_clientele && op.charge_clientele !== filtres.charge_clientele) return false;
    if (filtres.corps_etat && op.corps_etat !== filtres.corps_etat) return false;
    if (filtres.annee && montantAnnee(op, filtres.annee) <= 0) return false;
    if (!q) return true;
    const cible = normaliser(
      [
        op.nature_travaux,
        op.adresse,
        op.ville,
        op.corps_etat,
        op.tranche,
        op.charge_clientele,
      ].join(" "),
    );
    return cible.includes(q);
  });
};

/** Colonnes triables du mode Détail (années incluses, pour comparer facilement). */
export type CleTri =
  | "annee"
  | "tranche"
  | "charge_clientele"
  | "secteur"
  | "corps_etat"
  | "adresse"
  | "nature_travaux"
  | "statut"
  | "priorite"
  | "2027"
  | "2028"
  | "2029"
  | "2030"
  | "2031"
  | "total";

/** Valeur numérique comparée pour le tri d'une opération (0 sinon). */
export const valeurTriOperation = (op: PspOperation, cle: CleTri): string | number => {
  if (cle === "total") return totalOperation(op);
  if (cle === "annee") return op.annee;
  if (cle === "secteur") return op.categorie;
  if (cle === "tranche") return op.tranche;
  if (cle === "charge_clientele") return op.charge_clientele;
  if (cle === "corps_etat") return op.corps_etat;
  if (cle === "adresse") return op.adresse;
  if (cle === "nature_travaux") return op.nature_travaux;
  if (cle === "statut") return op.statut ?? "a_definir";
  if (cle === "priorite") return op.priorite ?? "normale";
  return montantAnnee(op, cle);
};

/** Tri des opérations du mode Détail (pur). */
export const trierOperationsDetail = (
  ops: PspOperation[],
  cle: CleTri,
  asc: boolean,
): PspOperation[] => {
  const result = [...ops];
  result.sort((a, b) => {
    const va = valeurTriOperation(a, cle);
    const vb = valeurTriOperation(b, cle);
    const cmp =
      typeof va === "number" && typeof vb === "number"
        ? va - vb
        : String(va).localeCompare(String(vb), "fr", { numeric: true, sensitivity: "base" });
    return asc ? cmp : -cmp;
  });
  return result;
};

// ── Devis (fiche opération) ─────────────────────────────────────────────────

export type StatsDevis = { min: number; moyenne: number; max: number };

/** Min / moyenne / max d'une liste de devis (toujours calculés, jamais saisis). */
export const statsDevis = (devis: Array<{ montant: number | null }>): StatsDevis | null => {
  // V7.10 §6 — les devis sans montant (demandes) ne participent pas aux stats.
  const montants = devis.map((d) => d.montant).filter((m): m is number => typeof m === "number");
  if (montants.length === 0) return null;
  return {
    min: Math.min(...montants),
    moyenne: montants.reduce((s, m) => s + m, 0) / montants.length,
    max: Math.max(...montants),
  };
};

// ── Export CSV (client, aucune écriture serveur) ────────────────────────────

/** Construit le CSV (séparateur « ; » pour Excel FR) des opérations fournies. */
export const construireCsvProgrammation = (ops: PspOperation[]): string => {
  const entete = [
    "Année",
    "Tranche",
    "Chargé clientèle",
    "Secteur",
    "C",
    "Corps d'état",
    "Adresse",
    "Nature des travaux",
    ...PSP_ANNEES.map(String),
    "Total",
  ];
  const cell = (v: string | number): string => `"${String(v).replace(/"/g, '""')}"`;
  const lignes = ops.map((op) =>
    [
      op.annee,
      op.tranche,
      op.charge_clientele,
      op.categorie,
      op.categorie,
      op.corps_etat,
      `${op.adresse}, ${op.ville}`,
      op.nature_travaux,
      ...PSP_ANNEES.map((a) => String(montantAnnee(op, a))),
      String(totalOperation(op)),
    ]
      .map(cell)
      .join(";"),
  );
  return [entete.map(cell).join(";"), ...lignes].join("\r\n");
};

// ── Export XLSX (V7.7) — 13 colonnes exactes, pur et testable ──────────────────
/**
 * Colonnes EXACTES de l'export Excel direction (V7.7 §1) — ordre et intitulés
 * imposés, aucune autre colonne : TR | Arl/sect | ADRESSE | C | CORPS D'ETAT |
 * Ch. Op. | Ligne budgétaire | NATURE TRAVAUX | 2027 → 2031.
 */
export const ENTETES_EXPORT_XLSX: string[] = [
  "TR",
  "Arl/sect",
  "ADRESSE",
  "C",
  "CORPS D'ETAT",
  "Ch. Op.",
  "Ligne budgétaire",
  "NATURE TRAVAUX",
  ...PSP_ANNEES.map(String),
];

export type DonneesExportXlsx = {
  entetes: string[];
  lignes: Array<Array<string | number>>;
};

/**
 * V7.7 §1-2 — Construit les données de l'export Excel à partir des opérations du
 * brouillon réel (adresse déjà enrichie du périmètre par l'appelant) :
 *  · TR          → code tranche ;
 *  · Arl/sect    → IDENTIFIANT PERSONNEL du référentiel CC (V7.8 §9) — jamais le
 *    nom du CC, jamais le sous-secteur, jamais inventé ;
 *  · ADRESSE     → périmètre réel (lot → « adresse - ER.xxx », rue entière…) ;
 *  · C           → catégorie GE/GT/CP (référentiel corps d'état) ;
 *  · CORPS D'ETAT→ valeur du référentiel (placeholder « — » → vide) ;
 *  · Ch. Op.     → HCHEDLY par défaut (règle actuelle) ;
 *  · Ligne budgétaire → valeur réellement disponible (jamais inventée) ;
 *  · NATURE TRAVAUX → saisie de l'opération ;
 *  · 2027-2031   → montants programmés.
 */
export const construireDonneesExportXlsx = (
  ops: PspOperation[],
  options: {
    secteurDeTranche?: (tranche: string) => string | null;
    chargeOperationDefaut?: string;
  } = {},
): DonneesExportXlsx => {
  const secteurDe = options.secteurDeTranche ?? (() => null);
  const chOpDefaut = options.chargeOperationDefaut ?? "HCHEDLY";
  const lignes: Array<Array<string | number>> = ops.map((op) => {
    const corps = (op.corps_etat ?? "").trim();
    return [
      op.tranche,
      secteurDe(op.tranche) ?? "",
      (op.adresse ?? "").trim(),
      op.categorie,
      corps === "—" ? "" : corps,
      op.charge_operation || chOpDefaut,
      op.ligne_budget ?? "",
      (op.nature_travaux ?? "").trim(),
      ...PSP_ANNEES.map((a) => montantAnnee(op, a)),
    ];
  });
  return { entetes: ENTETES_EXPORT_XLSX, lignes };
};

// ── Données MOCK (prototype V1 — inspirées des fichiers Secteur 11) ─────────

/**
 * Constructeur compact des opérations mock. `programme` = 5 montants pour les
 * années 2027→2031. `budget` est déduit du total programmé si non fourni :
 * les totaux ne sont JAMAIS saisis à la main.
 */
const O = (
  id: string,
  annee: PspAnnee,
  tranche: string,
  charge_clientele: string,
  charge_operation: string,
  categorie: PspCategorie,
  corps_etat_code: string,
  corps_etat: string,
  adresse: string,
  ville: string,
  nature_travaux: string,
  programme: number[],
  extra?: {
    devis?: PspDevis[];
    remarques?: string | null;
    reportee?: boolean;
    ancienne_annee?: number | null;
    ancien_montant?: number | null;
  },
  budget?: number,
): PspOperation => {
  const parAnnee: Record<string, number> = {};
  PSP_ANNEES.forEach((a, i) => {
    parAnnee[String(a)] = programme[i] ?? 0;
  });
  const total = PSP_ANNEES.reduce((s, a) => s + (parAnnee[String(a)] ?? 0), 0);
  return {
    id,
    annee,
    tranche,
    charge_clientele,
    charge_operation,
    categorie,
    corps_etat_code,
    corps_etat,
    adresse,
    ville,
    sous_secteur: null,
    nature_travaux,
    budget: budget ?? total,
    programme: parAnnee,
    remarques: null,
    devis: [],
    reportee: false,
    ancienne_annee: null,
    ancien_montant: null,
    ...extra,
  };
};

/** Devis typés : entreprise + montant (mock). */
const D = (entreprise: string, montant: number, remarque: string | null = null): PspDevis => ({
  entreprise,
  montant,
  remarque,
});

/** Liste des opérations de la programmation 2027-2031 (mock V1). */
export const PSP_OPERATIONS: PspOperation[] = [
  // ── Tranche 1976 ─────────────────────────────────────────────────────────
  O(
    "op-001",
    2027,
    "1976",
    "ALOTHORE",
    "HALLEL",
    "CP",
    "(d)",
    "(d) Couvertures",
    "3 RUE DE PARIS",
    "COUPVRAY",
    "Réfection toiture",
    [210000, 0, 0, 0, 0],
    {
      devis: [D("Entreprise A", 198500), D("Entreprise B", 214000), D("Entreprise C", 205800)],
      remarques: "Opération reportée de la programmation 2026 (toiture en urgence).",
      reportee: true,
      ancienne_annee: 2026,
      ancien_montant: 170000,
    },
  ),
  O(
    "op-002",
    2027,
    "1976",
    "ALOTHORE",
    "HALLEL",
    "CP",
    "(o)",
    "(o) Plomberie",
    "3 RUE DE PARIS",
    "COUPVRAY",
    "Remplacement colonnes d'évacuation EU/EP",
    [120000, 0, 0, 0, 0],
    { devis: [D("Entreprise A", 114500), D("Entreprise B", 118900)] },
  ),
  O(
    "op-003",
    2027,
    "1976",
    "ALOTHORE",
    "BOUZID",
    "GE",
    "(r)",
    "(r) Ascenseurs",
    "3 RUE DE PARIS",
    "COUPVRAY",
    "Modernisation ascenseurs",
    [105000, 60000, 0, 0, 0],
    {
      devis: [D("Entreprise A", 158000), D("Entreprise B", 149500), D("Entreprise C", 172000)],
      remarques: "Sur 2 ascenseurs ; le 2e passage en 2028.",
    },
  ),
  O(
    "op-004",
    2027,
    "1976",
    "ALOTHORE",
    "HALLEL",
    "GE",
    "(g)",
    "(g) Halls",
    "BOUCLE BELLE JOSEPHINE",
    "MAGNY-LE-HONGRE",
    "Reprise halls d'entrée",
    [40000, 0, 0, 0, 0],
  ),
  O(
    "op-005",
    2027,
    "1976",
    "ALOTHORE",
    "MAHMOUDI",
    "GT",
    "(a)",
    "(a) Maçonnerie",
    "BOUCLE BELLE JOSEPHINE",
    "MAGNY-LE-HONGRE",
    "Reprise maçonnerie soubassements",
    [28000, 0, 0, 0, 0],
  ),
  O(
    "op-006",
    2028,
    "1976",
    "ALOTHORE",
    "HALLEL",
    "CP",
    "(l)",
    "(l) Chauffage",
    "3 RUE DE PARIS",
    "COUPVRAY",
    "Remplacement chaudières",
    [0, 145000, 0, 0, 0],
    { devis: [D("Entreprise A", 138500), D("Entreprise B", 141200), D("Entreprise C", 152000)] },
  ),
  O(
    "op-007",
    2028,
    "1976",
    "ALOTHORE",
    "CARON",
    "GE",
    "(k)",
    "(k) Électricité",
    "3 RUE DE PARIS",
    "COUPVRAY",
    "Mise en sécurité électricité parties communes",
    [0, 52000, 0, 0, 0],
    { devis: [D("Entreprise A", 49500), D("Entreprise B", 51300)] },
  ),
  O(
    "op-008",
    2029,
    "1976",
    "ALOTHORE",
    "HALLEL",
    "GE",
    "(f)",
    "(f) Façades",
    "3 RUE DE PARIS",
    "COUPVRAY",
    "Ravalement façades",
    [0, 0, 240000, 60000, 0],
    { devis: [D("Entreprise A", 285000), D("Entreprise B", 296500), D("Entreprise C", 311000)] },
  ),
  O(
    "op-009",
    2030,
    "1976",
    "ALOTHORE",
    "BOUZID",
    "CP",
    "(i)",
    "(i) Menuiseries",
    "3 RUE DE PARIS",
    "COUPVRAY",
    "Remplacement menuiseries extérieures",
    [0, 0, 0, 190000, 0],
    { devis: [D("Entreprise A", 178000), D("Entreprise B", 185000)] },
  ),
  O(
    "op-010",
    2031,
    "1976",
    "ALOTHORE",
    "MAHMOUDI",
    "CP",
    "(c)",
    "(c) Isolation",
    "3 RUE DE PARIS",
    "COUPVRAY",
    "Isolation toiture sarking",
    [0, 0, 0, 0, 135000],
    { devis: [D("Entreprise A", 129000), D("Entreprise B", 133500)] },
  ),
  O(
    "op-011",
    2027,
    "1976",
    "BAILLY",
    "HALLEL",
    "GT",
    "(d)",
    "(d) Espaces Ext",
    "PARKING AERIEN 1 FILOIRS",
    "DAMMARTIN EN GOELE",
    "Aménagement espaces extérieurs",
    [32000, 0, 0, 0, 0],
  ),
  O(
    "op-012",
    2028,
    "1976",
    "BAILLY",
    "CARON",
    "GE",
    "(j)",
    "(j) Couvertures",
    "PARKING AERIEN 1 FILOIRS",
    "DAMMARTIN EN GOELE",
    "Réfection couverture atelier",
    [0, 68000, 0, 0, 0],
  ),
  O(
    "op-013",
    2030,
    "1976",
    "BAILLY",
    "HALLEL",
    "GE",
    "(k)",
    "(k) Électricité",
    "PARKING AERIEN 1 FILOIRS",
    "DAMMARTIN EN GOELE",
    "Rénovation éclairage communs",
    [0, 0, 0, 21000, 0],
  ),

  // ── Tranche 2086 ─────────────────────────────────────────────────────────
  O(
    "op-014",
    2027,
    "2086",
    "CHARPENTIER",
    "HALLEL",
    "CP",
    "(o)",
    "(o) Plomberie",
    "10 CORNILLES",
    "CHESSY",
    "Remplacement canalisations eau",
    [115000, 40000, 0, 0, 0],
    { devis: [D("Entreprise A", 147000), D("Entreprise B", 151800), D("Entreprise C", 159000)] },
  ),
  O(
    "op-015",
    2027,
    "2086",
    "CHARPENTIER",
    "BOUZID",
    "GE",
    "(r)",
    "(r) Ascenseurs",
    "10 CORNILLES",
    "CHESSY",
    "Remplacement ascenseur",
    [230000, 0, 0, 0, 0],
    {
      devis: [D("Entreprise A", 218500), D("Entreprise B", 224000), D("Entreprise C", 236500)],
      remarques: "Devis en cours — arbitrage entreprise attendu.",
      reportee: true,
      ancienne_annee: 2026,
      ancien_montant: 215000,
    },
  ),
  O(
    "op-016",
    2028,
    "2086",
    "CHARPENTIER",
    "HALLEL",
    "CP",
    "(d)",
    "(d) Couvertures",
    "10 CORNILLES",
    "CHESSY",
    "Reprise étanchéité toiture-terrasse",
    [0, 175000, 0, 0, 0],
    { devis: [D("Entreprise A", 164000), D("Entreprise B", 170500), D("Entreprise C", 181000)] },
  ),
  O(
    "op-017",
    2028,
    "2086",
    "CHARPENTIER",
    "MAHMOUDI",
    "GE",
    "(g)",
    "(g) Halls",
    "10 CORNILLES",
    "CHESSY",
    "Réfection halls et cages d'escalier",
    [0, 74000, 0, 0, 0],
  ),
  O(
    "op-018",
    2029,
    "2086",
    "CHARPENTIER",
    "HALLEL",
    "GE",
    "(k)",
    "(k) Électricité",
    "10 CORNILLES",
    "CHESSY",
    "Rénovation installation électrique",
    [0, 0, 135000, 0, 0],
    { devis: [D("Entreprise A", 128000), D("Entreprise B", 133000)] },
  ),
  O(
    "op-019",
    2030,
    "2086",
    "CHARPENTIER",
    "CARON",
    "CP",
    "(i)",
    "(i) Menuiseries",
    "10 CORNILLES",
    "CHESSY",
    "Remplacement portes palières",
    [0, 0, 0, 82000, 0],
  ),
  O(
    "op-020",
    2027,
    "2086",
    "DUVAL",
    "HALLEL",
    "GT",
    "(a)",
    "(a) Maçonnerie",
    "10 CORNILLES",
    "CHESSY",
    "Reprise maçonnerie garde-corps",
    [24000, 0, 0, 0, 0],
  ),
  O(
    "op-049",
    2027,
    "2086",
    "CHARPENTIER",
    "HALLEL",
    "CP",
    "(e)",
    "(e) Divers",
    "10 CORNILLES",
    "CHESSY",
    "Remplacement grilles de ventilation",
    [58000, 0, 0, 0, 0],
  ),
  O(
    "op-021",
    2031,
    "2086",
    "DUVAL",
    "BOUZID",
    "GE",
    "(f)",
    "(f) Façades",
    "10 CORNILLES",
    "CHESSY",
    "Ravalement façade sud",
    [0, 0, 0, 0, 88000],
  ),

  // ── Tranche 2100 ─────────────────────────────────────────────────────────
  O(
    "op-022",
    2027,
    "2100",
    "ALOTHORE",
    "HALLEL",
    "CP",
    "(l)",
    "(l) Chauffage",
    "2 IMPASSE CALVILLE",
    "VILLENEUVE SAINT DENIS",
    "Modernisation chaufferie collective",
    [95000, 92000, 0, 0, 0],
    { devis: [D("Entreprise A", 178500), D("Entreprise B", 184000), D("Entreprise C", 192500)] },
  ),
  O(
    "op-023",
    2028,
    "2100",
    "ALOTHORE",
    "MAHMOUDI",
    "GE",
    "(m)",
    "(m) Ventilation",
    "2 IMPASSE CALVILLE",
    "VILLENEUVE SAINT DENIS",
    "Mise en place VMC",
    [0, 43000, 0, 0, 0],
  ),
  O(
    "op-024",
    2029,
    "2100",
    "ALOTHORE",
    "HALLEL",
    "CP",
    "(c)",
    "(c) Isolation",
    "2 IMPASSE CALVILLE",
    "VILLENEUVE SAINT DENIS",
    "Isolation thermique des combles",
    [0, 0, 56000, 0, 0],
  ),
  O(
    "op-025",
    2031,
    "2100",
    "ALOTHORE",
    "CARON",
    "GE",
    "(h)",
    "(h) Peinture",
    "2 IMPASSE CALVILLE",
    "VILLENEUVE SAINT DENIS",
    "Peinture des parties communes",
    [0, 0, 0, 0, 26000],
  ),
  O(
    "op-026",
    2027,
    "2100",
    "GRIMALDI",
    "HALLEL",
    "GE",
    "(d)",
    "(d) Couvertures",
    "2 IMPASSE CALVILLE",
    "VILLENEUVE SAINT DENIS",
    "Réfection toiture bâtiment B",
    [180000, 50000, 0, 0, 0],
    {
      devis: [D("Entreprise A", 219000), D("Entreprise B", 227000)],
      reportee: true,
      ancienne_annee: 2026,
      ancien_montant: 148000,
    },
  ),
  O(
    "op-027",
    2028,
    "2100",
    "GRIMALDI",
    "BOUZID",
    "CP",
    "(o)",
    "(o) Plomberie",
    "2 IMPASSE CALVILLE",
    "VILLENEUVE SAINT DENIS",
    "Remplacement chauffe-eau collectifs",
    [0, 61000, 0, 0, 0],
  ),
  O(
    "op-028",
    2030,
    "2100",
    "GRIMALDI",
    "HALLEL",
    "GT",
    "(d)",
    "(d) Espaces Ext",
    "2 IMPASSE CALVILLE",
    "VILLENEUVE SAINT DENIS",
    "Clôtures et portails",
    [0, 0, 0, 35000, 0],
  ),
  O(
    "op-051",
    2030,
    "2100",
    "GRIMALDI",
    "CARON",
    "GE",
    "(m)",
    "(m) Ventilation",
    "2 IMPASSE CALVILLE",
    "VILLENEUVE SAINT DENIS",
    "Reprise VMC sanitaires",
    [0, 0, 0, 62000, 0],
  ),

  // ── Tranche 2178 ─────────────────────────────────────────────────────────
  O(
    "op-029",
    2027,
    "2178",
    "DUVAL",
    "HALLEL",
    "CP",
    "(d)",
    "(d) Couvertures",
    "3H PL THOMAS LE PILLEUR",
    "SERRIS",
    "Réfection toiture",
    [165000, 0, 0, 0, 0],
    { devis: [D("Entreprise A", 157000), D("Entreprise B", 161500), D("Entreprise C", 171000)] },
  ),
  O(
    "op-030",
    2027,
    "2178",
    "DUVAL",
    "CARON",
    "GE",
    "(k)",
    "(k) Électricité",
    "3H PL THOMAS LE PILLEUR",
    "SERRIS",
    "Rénovation éclairage de sécurité",
    [32000, 0, 0, 0, 0],
  ),
  O(
    "op-031",
    2028,
    "2178",
    "DUVAL",
    "HALLEL",
    "GE",
    "(g)",
    "(g) Halls",
    "3H PL THOMAS LE PILLEUR",
    "SERRIS",
    "Réfection des halls",
    [0, 68000, 0, 0, 0],
  ),
  O(
    "op-032",
    2029,
    "2178",
    "DUVAL",
    "MAHMOUDI",
    "CP",
    "(i)",
    "(i) Menuiseries",
    "3H PL THOMAS LE PILLEUR",
    "SERRIS",
    "Remplacement menuiseries",
    [0, 0, 98000, 0, 0],
    { devis: [D("Entreprise A", 92500), D("Entreprise B", 96000)] },
  ),
  O(
    "op-050",
    2029,
    "2178",
    "DUVAL",
    "HALLEL",
    "GE",
    "(f)",
    "(f) Façades",
    "3H PL THOMAS LE PILLEUR",
    "SERRIS",
    "Ravalement façade nord",
    [0, 0, 110000, 0, 0],
    { devis: [D("Entreprise A", 104500), D("Entreprise B", 108900)] },
  ),
  O(
    "op-033",
    2031,
    "2178",
    "DUVAL",
    "BOUZID",
    "GE",
    "(r)",
    "(r) Ascenseurs",
    "3H PL THOMAS LE PILLEUR",
    "SERRIS",
    "Modernisation ascenseurs (contrôles)",
    [0, 0, 0, 0, 72000],
  ),
  O(
    "op-034",
    2029,
    "2178",
    "BAILLY",
    "HALLEL",
    "GT",
    "(a)",
    "(a) Maçonnerie",
    "3H PL THOMAS LE PILLEUR",
    "SERRIS",
    "Reprise soubassements",
    [0, 0, 38000, 0, 0],
  ),
  O(
    "op-035",
    2030,
    "2178",
    "BAILLY",
    "CARON",
    "CP",
    "(l)",
    "(l) Chauffage",
    "3H PL THOMAS LE PILLEUR",
    "SERRIS",
    "Remplacement chaudières",
    [0, 0, 0, 135000, 0],
    { devis: [D("Entreprise A", 128000), D("Entreprise B", 131500), D("Entreprise C", 139000)] },
  ),

  // ── Tranche 2217 ─────────────────────────────────────────────────────────
  O(
    "op-036",
    2027,
    "2217",
    "CHARPENTIER",
    "HALLEL",
    "CP",
    "(c)",
    "(c) Isolation",
    "10 BIS RUE D'ORSOY",
    "VARREDDES",
    "Isolation des murs ITE",
    [195000, 120000, 0, 0, 0],
    {
      devis: [D("Entreprise A", 301000), D("Entreprise B", 309500), D("Entreprise C", 322000)],
      remarques: "ITE partielle façade nord ; façade sud à chiffrer.",
    },
  ),
  O(
    "op-037",
    2028,
    "2217",
    "CHARPENTIER",
    "BOUZID",
    "GE",
    "(f)",
    "(f) Façades",
    "10 BIS RUE D'ORSOY",
    "VARREDDES",
    "Ravalement façades",
    [0, 130000, 40000, 0, 0],
    { devis: [D("Entreprise A", 162000), D("Entreprise B", 168500)] },
  ),
  O(
    "op-038",
    2030,
    "2217",
    "CHARPENTIER",
    "HALLEL",
    "GE",
    "(m)",
    "(m) Ventilation",
    "10 BIS RUE D'ORSOY",
    "VARREDDES",
    "Reprise ventilation collective",
    [0, 0, 0, 46000, 0],
  ),
  O(
    "op-039",
    2031,
    "2217",
    "CHARPENTIER",
    "MAHMOUDI",
    "CP",
    "(o)",
    "(o) Plomberie",
    "10 BIS RUE D'ORSOY",
    "VARREDDES",
    "Remplacement colonnes",
    [0, 0, 0, 0, 84000],
  ),

  // ── Tranche 3049 ─────────────────────────────────────────────────────────
  O(
    "op-040",
    2027,
    "3049",
    "GRIMALDI",
    "HALLEL",
    "GE",
    "(g)",
    "(g) Halls",
    "12 RUE GAMBETTA",
    "MEAUX",
    "Réfection halls d'entrée",
    [36000, 0, 0, 0, 0],
  ),
  O(
    "op-041",
    2028,
    "3049",
    "GRIMALDI",
    "CARON",
    "GE",
    "(k)",
    "(k) Électricité",
    "12 RUE GAMBETTA",
    "MEAUX",
    "Mise en conformité SSI",
    [0, 58000, 0, 0, 0],
    { devis: [D("Entreprise A", 54900), D("Entreprise B", 56600)] },
  ),
  O(
    "op-042",
    2029,
    "3049",
    "GRIMALDI",
    "HALLEL",
    "CP",
    "(d)",
    "(d) Couvertures",
    "12 RUE GAMBETTA",
    "MEAUX",
    "Reprise étanchéité",
    [0, 0, 92000, 0, 0],
    { devis: [D("Entreprise A", 86500), D("Entreprise B", 90500), D("Entreprise C", 94000)] },
  ),
  O(
    "op-043",
    2030,
    "3049",
    "GRIMALDI",
    "BOUZID",
    "CP",
    "(i)",
    "(i) Menuiseries",
    "12 RUE GAMBETTA",
    "MEAUX",
    "Remplacement fenêtres caves",
    [0, 0, 0, 29000, 0],
  ),
  O(
    "op-044",
    2027,
    "3049",
    "ALOTHORE",
    "MAHMOUDI",
    "GT",
    "(d)",
    "(d) Espaces Ext",
    "12 RUE GAMBETTA",
    "MEAUX",
    "Réfection allées et parkings",
    [45000, 30000, 0, 0, 0],
  ),
  O(
    "op-045",
    2031,
    "3049",
    "ALOTHORE",
    "HALLEL",
    "GE",
    "(h)",
    "(h) Peinture",
    "12 RUE GAMBETTA",
    "MEAUX",
    "Peinture cages d'escalier",
    [0, 0, 0, 0, 22000],
  ),

  // ── Tranche 3329 ─────────────────────────────────────────────────────────
  O(
    "op-046",
    2027,
    "3329",
    "DUVAL",
    "HALLEL",
    "CP",
    "(o)",
    "(o) Plomberie",
    "14 RUE DE LA LIBERTE",
    "OTHIS",
    "Remplacement canalisations",
    [85000, 0, 0, 0, 0],
    { devis: [D("Entreprise A", 80800), D("Entreprise B", 84200)] },
  ),
  O(
    "op-047",
    2029,
    "3329",
    "DUVAL",
    "CARON",
    "GE",
    "(r)",
    "(r) Ascenseurs",
    "14 RUE DE LA LIBERTE",
    "OTHIS",
    "Maintenance lourde ascenseurs",
    [0, 0, 66000, 0, 0],
  ),
  O(
    "op-048",
    2031,
    "3329",
    "DUVAL",
    "BOUZID",
    "GT",
    "(a)",
    "(a) Maçonnerie",
    "14 RUE DE LA LIBERTE",
    "OTHIS",
    "Reprise maçonnerie balcons",
    [0, 0, 0, 0, 46000],
  ),
];

/** Ancienne programmation (mock) : lignes visibles dans la modal « Ancienne programmation ». */
export const ANCIENNE_PROGRAMMATION: AncienneProgrammationItem[] = [
  {
    id: "anc-001",
    nature_travaux: "Réfection toiture",
    adresse: "3 RUE DE PARIS",
    ville: "COUPVRAY",
    tranche: "1976",
    annee: 2026,
    montant: 35000,
  },
  {
    id: "anc-002",
    nature_travaux: "Remplacement ascenseur",
    adresse: "10 CORNILLES",
    ville: "CHESSY",
    tranche: "2086",
    annee: 2026,
    montant: 215000,
  },
  {
    id: "anc-003",
    nature_travaux: "Reprise étanchéité toiture-terrasse",
    adresse: "2 IMPASSE CALVILLE",
    ville: "VILLENEUVE SAINT DENIS",
    tranche: "2100",
    annee: 2026,
    montant: 120000,
  },
  {
    id: "anc-004",
    nature_travaux: "Remplacement chaudières",
    adresse: "3H PL THOMAS LE PILLEUR",
    ville: "SERRIS",
    tranche: "2178",
    annee: 2026,
    montant: 95000,
  },
  {
    id: "anc-005",
    nature_travaux: "Ravalement façades",
    adresse: "10 BIS RUE D'ORSOY",
    ville: "VARREDDES",
    tranche: "2217",
    annee: 2026,
    montant: 148000,
  },
  {
    id: "anc-006",
    nature_travaux: "Remplacement menuiseries",
    adresse: "14 RUE DE LA LIBERTE",
    ville: "OTHIS",
    tranche: "3329",
    annee: 2026,
    montant: 78000,
  },
];

// ── Mutations LOCALES (aucune écriture Supabase) ────────────────────────────

/** Saisie d'une opération (formulaire ajout / modification). */
export type SaisieOperation = {
  tranche: string;
  categorie: PspCategorie;
  charge_clientele: string;
  charge_operation: string;
  corps_etat: string;
  adresse: string;
  ville: string;
  nature_travaux: string;
  annee: PspAnnee;
  /** 5 montants pour 2027→2031. */
  programme: number[];
  remarques: string | null;
  /** Périmètre patrimonial structuré (V7.2) — optionnel (reste l'existant sinon). */
  perimetres?: Array<{
    niveau: string;
    rue: string | null;
    numero: string | null;
    lot_id: string | null;
  }>;
  /** Statut / priorité (V7.2) — persistés dans psp_lignes. */
  statut?: string;
  priorite?: string;
  /** Ligne budgétaire (V7.7) — réellement disponible, jamais inventée. */
  ligne_budget?: string | null;
};

/**
 * Construit une opération à partir d'une saisie (pur, déterministe).
 * `budget` = total programmé (recalculé, jamais saisi).
 */
export const creerOperation = (saisie: SaisieOperation, id: string): PspOperation => {
  const programme: Record<string, number> = {};
  PSP_ANNEES.forEach((a, i) => {
    programme[String(a)] = Math.max(0, Number(saisie.programme[i]) || 0);
  });
  const { corps_etat_code, corps_etat } = extraireCorpsEtat(saisie.corps_etat);
  const total = PSP_ANNEES.reduce((s, a) => s + (programme[String(a)] ?? 0), 0);
  return {
    id,
    annee: saisie.annee,
    tranche: saisie.tranche,
    charge_clientele: saisie.charge_clientele,
    charge_operation: saisie.charge_operation,
    categorie: saisie.categorie,
    corps_etat_code,
    corps_etat,
    adresse: saisie.adresse,
    ville: saisie.ville,
    sous_secteur: null,
    nature_travaux: saisie.nature_travaux,
    budget: total,
    programme,
    remarques: saisie.remarques,
    ligne_budget: saisie.ligne_budget ?? null,
    devis: [],
    reportee: false,
    ancienne_annee: null,
    ancien_montant: null,
  };
};

/** Ajout local (retourne une nouvelle liste — les opérations sont immuables). */
export const ajouterOperationListe = (
  ops: PspOperation[],
  saisie: SaisieOperation,
  id: string,
): PspOperation[] => [...ops, creerOperation(saisie, id)];

/** Patch de modification d'une opération (champs partiels). */
export type PatchOperation = Partial<
  Omit<PspOperation, "id" | "programme" | "budget" | "devis" | "reportee">
> & {
  programme?: Record<string, number>;
};

/**
 * Modification locale : le budget est TOUJOURS recalculé après le patch, ce qui
 * recale immédiatement totaux annuels, totaux GE/GT/CP et écarts (calculs purs).
 */
export const modifierOperationListe = (
  ops: PspOperation[],
  id: string,
  patch: PatchOperation,
): PspOperation[] =>
  ops.map((op) => {
    if (op.id !== id) return op;
    const next: PspOperation = { ...op, ...patch };
    next.budget = totalOperation(next);
    return next;
  });

/** Suppression locale. */
export const supprimerOperationListe = (ops: PspOperation[], id: string): PspOperation[] =>
  ops.filter((op) => op.id !== id);

/**
 * Mémoire locale d'un déplacement d'opération entre deux années.
 * Conserve : opération, années précédente/nouvelle, montant, motif, date.
 * Aucune écriture Supabase.
 */
export type DeplacementMemo = {
  id: string;
  operationId: string;
  tranche: string;
  nature_travaux: string;
  anneePrecedente: PspAnnee;
  anneeNouvelle: PspAnnee;
  montant: number;
  motif: string | null;
  date: string;
};

/**
 * Déplace l'opération vers l'année cible : le montant programmé dans son année
 * principale (`op.annee`) est remis à 0 et reporté sur l'année cible.
 * Ex. 2027 = 35 000 → cible 2028 ⇒ 2027 = 0, 2028 = 35 000.
 * Retourne la nouvelle liste + la trace mémoire (ou null si aucun déplacement).
 */
export const deplacerOperation = (
  ops: PspOperation[],
  id: string,
  cible: PspAnnee,
  motif: string | null,
): { ops: PspOperation[]; deplacement: DeplacementMemo | null } => {
  const op = ops.find((o) => o.id === id);
  if (!op) return { ops, deplacement: null };
  const source = op.annee;
  if (cible === source) return { ops, deplacement: null };
  const montant = montantAnnee(op, source);
  if (montant <= 0) return { ops, deplacement: null };

  const programme: Record<string, number> = { ...op.programme };
  programme[String(source)] = 0;
  programme[String(cible)] = (programme[String(cible)] ?? 0) + montant;

  const apres = modifierOperationListe(ops, id, { annee: cible, programme });
  const next = apres.find((o) => o.id === id);
  if (!next) return { ops, deplacement: null };
  const deplacement: DeplacementMemo = {
    id: `depl-${Date.now()}-${id}`,
    operationId: id,
    tranche: op.tranche,
    nature_travaux: op.nature_travaux,
    anneePrecedente: source,
    anneeNouvelle: cible,
    montant,
    motif,
    date: new Date().toISOString(),
  };
  return { ops: apres, deplacement };
};

/** Totaux programmés par catégorie budgétaire C (GE / GT / CP). */
export const totauxParCategorie = (
  ops: PspOperation[],
): Record<PspCategorie, { total: number; nbOperations: number }> => {
  const result: Record<PspCategorie, { total: number; nbOperations: number }> = {
    GE: { total: 0, nbOperations: 0 },
    GT: { total: 0, nbOperations: 0 },
    CP: { total: 0, nbOperations: 0 },
  };
  for (const op of ops) {
    const cle = result[op.categorie];
    if (!cle) continue;
    cle.total += totalOperation(op);
    cle.nbOperations += 1;
  }
  return result;
};

/** Extrait le code « (d) » et le libellé d'un intitulé corps d'état. */
export const extraireCorpsEtat = (
  corps: string,
): { corps_etat_code: string; corps_etat: string } => {
  const texte = corps.trim();
  const m = texte.match(/^\(([^)]*)\)\s*(.*)$/);
  if (m && m[1] !== undefined) {
    return {
      corps_etat_code: `(${m[1]})`,
      corps_etat: texte,
    };
  }
  return { corps_etat_code: "", corps_etat: texte || "—" };
};

// ── Comparaison ancienne programmation vs préparation actuelle ──────────────

export type StatutComparaison = "inchangee" | "modifiee" | "deplacee" | "supprimee" | "nouvelle";

export type LigneComparaison = {
  item: AncienneProgrammationItem;
  statut: StatutComparaison;
  montantActuel: number | null;
  anneeActuelle: number | null;
};

/** Normalisation de rapprochement (majuscules, sans accents ni ponctuation). */
const normaliserRapprochement = (v: string): string =>
  v
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();

/**
 * Compare l'ancienne programmation à la préparation actuelle (mode lecture).
 * Statuts : inchangée / modifiée / déplacée / supprimée / nouvelle.
 * Rapprochement : même TR + nature normalisée (jamais l'adresse Excel).
 */
export const comparerProgrammation = (
  ancienne: AncienneProgrammationItem[],
  actuelle: PspOperation[],
): { lignes: LigneComparaison[]; nouvelles: PspOperation[] } => {
  const actuelleParCle = new Map<string, PspOperation[]>();
  for (const op of actuelle) {
    const cle = `${op.tranche}|${normaliserRapprochement(op.nature_travaux)}`;
    const liste = actuelleParCle.get(cle) ?? [];
    liste.push(op);
    actuelleParCle.set(cle, liste);
  }

  const lignes: LigneComparaison[] = ancienne.map((item) => {
    const cle = `${item.tranche}|${normaliserRapprochement(item.nature_travaux)}`;
    const candidats = actuelleParCle.get(cle) ?? [];
    const op = candidats[0] as PspOperation | undefined;
    if (!op) {
      return { item, statut: "supprimee", montantActuel: null, anneeActuelle: null };
    }
    const total = totalOperation(op);
    const memeMontant = Math.round(total) === Math.round(item.montant);
    const memeAnnee = op.annee === item.annee;
    const statut: StatutComparaison =
      memeMontant && memeAnnee ? "inchangee" : memeAnnee ? "modifiee" : "deplacee";
    return { item, statut, montantActuel: total, anneeActuelle: op.annee };
  });

  const cleAncienne = new Set(
    ancienne.map((i) => `${i.tranche}|${normaliserRapprochement(i.nature_travaux)}`),
  );
  const nouvelles = actuelle.filter((op) => {
    const cle = `${op.tranche}|${normaliserRapprochement(op.nature_travaux)}`;
    return !cleAncienne.has(cle);
  });

  return { lignes, nouvelles };
};

// ── V8.9 — CONSERVATION DES ANNÉES DE PROGRAMMATION (cycle de vie) ───────────

/**
 * V8.9.1 — EXTRAIT LES PROGRAMMATIONS HISTORIQUES réellement conservées dans
 * `psp_lignes.programme`.
 *
 * Une programmation est « ancienne » (par rapport à une année de référence)
 * uniquement si :
 *   · année programmée < année de référence ;
 *   · programme[année] > 0.
 *
 * Chaque couple (année, montant) est retourné INDÉPENDAMMENT (une opération
 * multi-années produit autant d'entrées que d'années anciennes réellement
 * présentes). Aucune donnée n'est inventée : un devis, une commande ou la
 * simple existence de la ligne ne créent PAS d'entrée.
 *
 * Exemples (référence 2027) :
 *   { "2026": 40000, "2027": 50000 } → [{ annee: 2026, montant: 40000 }]
 *   { "2027": 50000, "2028": 60000 } → []  (2027 = année courante, 2028 = future)
 *   { "2025": 0, "2026": 3000 }       → [{ annee: 2026, montant: 3000 }]
 */
export type ProgrammationHistorique = {
  annee: number;
  montant: number;
};

export const extraireProgrammationsHistoriques = (
  programme: Record<string, number>,
  anneeReference: number,
): ProgrammationHistorique[] => {
  const out: ProgrammationHistorique[] = [];
  for (const [anneeStr, montant] of Object.entries(programme ?? {})) {
    const annee = Number(anneeStr);
    const valeur = Number(montant) || 0;
    if (!Number.isFinite(annee)) continue;
    if (annee >= anneeReference) continue;
    if (valeur <= 0) continue;
    out.push({ annee, montant: valeur });
  }
  return out.sort((a, b) => a.annee - b.annee);
};

/** Années réellement programmées (montant > 0) dans un programme — indépendant de la référence. */
export const anneesProgrammees = (programme: Record<string, number>): number[] =>
  Object.entries(programme ?? {})
    .map(([a, m]) => ({ annee: Number(a), montant: Number(m) || 0 }))
    .filter((x) => Number.isFinite(x.annee) && x.montant > 0)
    .map((x) => x.annee)
    .sort((a, b) => a - b);

/**
 * Fusionne un apport de programmation avec le programme existant SANS JAMAIS
 * détruire les anciennes années :
 *  · une clé présente dans `apport` écrase la valeur existante (mise à jour
 *    explicite — un montant à 0 = déprogrammation volontaire de CETTE année) ;
 *  · une clé ABSENTE de `apport` est CONSERVÉE telle quelle.
 *
 * Exemple :
 *   existant = { "2027": 50000, "2028": 55000, "2029": 0, "2030": 30000 }
 *   apport   = { "2028": 60000, "2031": 10000 }
 *   résultat = { "2027": 50000, "2028": 60000, "2029": 0, "2030": 30000, "2031": 10000 }
 *
 * Règle métier V8.9 : « les anciennes années ne doivent jamais être détruites
 * simplement parce qu'une nouvelle année est renseignée ».
 */
export const fusionnerProgramme = (
  existant: Record<string, number>,
  apport: Record<string, number>,
): Record<string, number> => ({ ...existant, ...apport });

/**
 * Normalise un programme pour la PERSISTANCE : ne conserve que les montants
 * strictement positifs (un montant 0 ou négatif devient une clé à 0 — l'année
 * reste visible dans le JSONB, cohérent avec la projection stricte V8.8.3).
 * Ne jamais supprimer une clé d'année du périmètre PSP_ANNEES.
 */
export const normaliserProgrammePersist = (
  programme: Record<string, number>,
): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const [annee, montant] of Object.entries(programme)) {
    const valeur = Math.max(0, Number(montant) || 0);
    out[annee] = valeur;
  }
  return out;
};

/**
 * Ajoute (ou met à jour) une année de programmation dans le programme d'une
 * ligne existante : si la ligne porte déjà un montant sur cette année, il est
 * REMPLACÉ par le nouveau montant (jamais additionné — une opération = une
 * seule valeur par année). Toutes les autres années sont conservées.
 * Retourne le nouveau programme + true si une valeur a changé.
 */
export const programmerAnnee = (
  programme: Record<string, number>,
  annee: number,
  montant: number,
): { programme: Record<string, number>; change: boolean } => {
  const valeur = Math.max(0, Number(montant) || 0);
  const actuel = programme[String(annee)] ?? 0;
  if (actuel === valeur) return { programme, change: false };
  return { programme: { ...programme, [String(annee)]: valeur }, change: true };
};
