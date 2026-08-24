/**
 * PSP — Adaptateur « vraies données PAT S11 » (V2) — partie PURE.
 *
 * Lecture en LECTURE SEULE des sources existantes (aucune écriture, aucune
 * table, aucune migration) :
 *  - table `tranches`      → localité, sous-secteur, secteur S11, nb logements ;
 *  - table `lots`          → adresse / ville de référence d'un TR ;
 *  - référentiel `psp_charges_clientele` → chargé de clientèle ACTUEL par
 *    sous-secteur (autorité — V7.6 §8, plus jamais la fréquence des commandes).
 *
 * Règles :
 *  - le TR (tranche) est la clé patrimoniale PRIORITAIRE — l'adresse Excel
 *    n'est jamais une clé d'identification ;
 *  - les regroupements s'appuient sur la référence réelle quand elle existe ;
 *  - ce module est PUR (testable en Node) ; la fonction serveur de lecture
 *    Supabase vit dans `psp.prep.data.functions.ts`.
 *
 * Le fichier « esquisse PSP 2027 » est traité comme une SOURCE DE PRÉPARATION :
 * `parseEsquisse2027Workbook` le convertit en `PspOperation[]` sans rien stocker.
 */
import * as XLSX from "xlsx";

import {
  PSP_ANNEES,
  creerOperation,
  totalOperation,
  type PspAnnee,
  type PspCategorie,
  type PspOperation,
} from "./psp.prep.ts";

// ── Types des sources réelles ───────────────────────────────────────────────

export type TrancheRaw = {
  code: string;
  libelle: string | null;
  localite: string | null;
  sous_secteur: string | null;
  secteur: string | null;
  nb_logements: number | null;
};

export type LotRaw = {
  id?: string;
  code_patrimoine?: string | null;
  tranche_code: string | null;
  adresse: string | null;
  ville: string | null;
};

export type CommandeRaw = {
  tranche_code: string | null;
  charge_clientele: string | null;
};

/** Référence patrimoniale d'un TR (résolue à partir des vraies données). */
export type TrancheReference = {
  code: string;
  libelle: string | null;
  localite: string | null;
  sous_secteur: string | null;
  secteur: string | null;
  nb_logements: number | null;
  charge_clientele: string | null;
  /** Identifiant personnel du chargé (référentiel V7.5) — null si inconnu. */
  identifiant_personnel?: string | null;
  adresse_reference: string | null;
  ville: string | null;
};

/** Entrée du référentiel chargé clientèle (V7.5). */
export type ChargesClienteleReferentiel = {
  sous_secteur: string;
  charge_clientele: string;
  identifiant_personnel: string | null;
  actif: boolean;
};

/** Dictionnaire des références réelles indexé par code de TR. */
export type ReferencePatrimoine = {
  tranches: Map<string, TrancheReference>;
  totalTranches: number;
  totalLots: number;
  totalCommandes: number;
};

/** Valeur la plus fréquente d'une liste (mode) — null si aucune valeur non vide. */
const modeDe = (valeurs: Array<string | null>): string | null => {
  const comptes = new Map<string, number>();
  for (const v of valeurs) {
    if (!v || v.trim() === "") continue;
    comptes.set(v, (comptes.get(v) ?? 0) + 1);
  }
  let meilleur: string | null = null;
  let meilleurCompte = 0;
  for (const [v, c] of comptes) {
    if (c > meilleurCompte) {
      meilleur = v;
      meilleurCompte = c;
    }
  }
  return meilleur;
};

/**
 * Construit la référence patrimoniale réelle (pur, sans accès base).
 * - adresse de référence : adresse la plus fréquente des lots du TR ;
 * - ville : ville la plus fréquente des lots du TR, sinon `tranches.localite` ;
 * - chargé de clientèle : RÉFÉRENTIEL EXPLICITE `chargesClientele` (V7.5),
 *   résolu via `tranches.sous_secteur` — AUTORITÉ UNIQUE (V7.6 §8). Le CC n'est
 *   jamais déduit par fréquence des commandes historiques (source historique
 *   uniquement) ; sous-secteur non renseigné → CC null (« non renseigné »).
 */
export const construireReferencePatrimoine = (
  tranches: TrancheRaw[],
  lots: LotRaw[],
  commandes: CommandeRaw[],
  chargesClientele: ChargesClienteleReferentiel[] = [],
): ReferencePatrimoine => {
  const adressesParTranche = new Map<string, Array<string | null>>();
  const villesParTranche = new Map<string, Array<string | null>>();
  for (const lot of lots) {
    if (!lot.tranche_code) continue;
    const adresses = adressesParTranche.get(lot.tranche_code) ?? [];
    adresses.push(lot.adresse);
    adressesParTranche.set(lot.tranche_code, adresses);
    const villes = villesParTranche.get(lot.tranche_code) ?? [];
    villes.push(lot.ville);
    villesParTranche.set(lot.tranche_code, villes);
  }
  // Référentiel explicite sous_secteur → CC actuel (AUTORITÉ unique, V7.6 §8).
  // Le CC n'est JAMAIS déduit par fréquence des commandes historiques : celles-ci
  // restent une source historique uniquement.
  const referentielParSousSecteur = new Map<string, ChargesClienteleReferentiel>();
  for (const r of chargesClientele) {
    if (!r.actif) continue;
    referentielParSousSecteur.set(r.sous_secteur, r);
  }

  const tranchesMap = new Map<string, TrancheReference>();
  for (const t of tranches) {
    const adresseReference = modeDe(adressesParTranche.get(t.code) ?? []);
    const villeLots = modeDe(villesParTranche.get(t.code) ?? []);
    const referentiel = t.sous_secteur ? referentielParSousSecteur.get(t.sous_secteur) : undefined;
    tranchesMap.set(t.code, {
      code: t.code,
      libelle: t.libelle,
      localite: t.localite,
      sous_secteur: t.sous_secteur,
      secteur: t.secteur,
      nb_logements: t.nb_logements,
      charge_clientele: referentiel?.charge_clientele ?? null,
      identifiant_personnel: referentiel?.identifiant_personnel ?? null,
      adresse_reference: adresseReference,
      ville: villeLots ?? t.localite,
    });
  }

  return {
    tranches: tranchesMap,
    totalTranches: tranchesMap.size,
    totalLots: lots.length,
    totalCommandes: commandes.length,
  };
};

/** Résout la référence réelle d'un TR (ou null si inconnu). */
export const resoudreTranche = (
  reference: ReferencePatrimoine | null,
  code: string,
): TrancheReference | null => {
  if (!reference) return null;
  return reference.tranches.get(code) ?? null;
};

/**
 * Enrichit les opérations avec la référence réelle PAT S11.
 * Quand un TR est connu : CC / adresse de référence / ville / sous-secteur
 * sont alignés sur les vraies données (jamais l'adresse Excel comme clé).
 * Les montants et la programmation restent inchangés.
 */
export const enrichirOperationsAvecReference = (
  ops: PspOperation[],
  reference: ReferencePatrimoine | null,
): PspOperation[] => {
  if (!reference) return ops;
  return ops.map((op) => {
    const ref = reference.tranches.get(op.tranche);
    if (!ref) return op;
    return {
      ...op,
      charge_clientele: ref.charge_clientele ?? op.charge_clientele,
      adresse: ref.adresse_reference ?? op.adresse,
      ville: ref.ville ?? op.ville,
      sous_secteur: ref.sous_secteur,
    };
  });
};

// ── Programmation pluriannuelle (source de préparation, fichier Excel) ──────

export type ResultatEsquisse = {
  operations: PspOperation[];
  lignes: number;
  erreurs: string[];
  source: string;
};

/** Ligne d'un fichier de programmation pluriannuelle (ex. « Prog 2026 »). */
export type LigneProgrammation = {
  ligne: number;
  tranche: string;
  categorie: PspCategorie | null;
  corps_etat: string;
  nature_travaux: string;
  ligne_budget: string | null;
  charge_operation: string | null;
  adresse: string | null;
  ville: string | null;
  remarques: string | null;
  /** Montants par année — clé = année numérique (ex. "2026", "2027"…). */
  programme: Record<string, number>;
};

export type ResultatProgrammation = {
  lignes: LigneProgrammation[];
  annees: number[];
  erreurs: string[];
  source: string;
};

/** Normalise un en-tête : minuscules, sans accents, ponctuation → espace. */
const normaliserEnTete = (v: unknown): string =>
  String(v ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Numérique d'une cellule Excel (texte ou nombre, « 35 000 » ou « 35000 »). */
const numerique = (v: unknown): number => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const texte = String(v ?? "")
    .replace(/[\s\u00a0\u202f€]/g, "")
    .replace(",", ".");
  const n = Number(texte);
  return Number.isFinite(n) ? n : 0;
};

/** Normalise la catégorie budgétaire C (accepte « ge », « GE », « g e »…). */
const normaliserCategorie = (v: unknown): PspCategorie | null => {
  const texte = String(v ?? "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
  return texte === "GE" || texte === "GT" || texte === "CP" ? texte : null;
};

/**
 * Parse un fichier de programmation pluriannuelle (ex. « Prog_Secteur 11_2026 »)
 * dans un modèle générique — SANS rien stocker en base.
 *
 * Format réel des fichiers Secteur 11 :
 *   TR · Arl/sect · ADRESSE · Ville · C · CORPS D'ETAT · Ch. Op. ·
 *   Ligne budgétaire · NATURE TRAVAUX · Remarques · <années numériques> …
 *
 * Détection robuste :
 *  - la ligne d'en-tête est recherchée (cellule « TR ») — le fichier réel
 *    contient une ligne de synthèse AU-DESSUS de l'en-tête ;
 *  - les colonnes années sont les en-têtes numériques à 4 chiffres
 *    (« 2026.old » et libellés texte sont ignorés) ;
 *  - C = catégorie budgétaire (GE/GT/CP) — jamais le code corps d'état.
 */
export const parseProgrammationWorkbook = (
  data: ArrayBuffer,
  opts: { nom?: string; feuille?: string | number } = {},
): ResultatProgrammation => {
  const classeur = XLSX.read(data, { type: "array" });
  const source = opts.nom ?? "programmation";

  // Sélection de la feuille : nom/index explicite, sinon première feuille dont
  // l'en-tête contient « TR » (le fichier réel contient « Prog 2025 » + « Prog 2026 »).
  let feuilleNom: string | undefined;
  if (typeof opts.feuille === "string") {
    feuilleNom = classeur.SheetNames.includes(opts.feuille) ? opts.feuille : undefined;
  } else if (typeof opts.feuille === "number") {
    feuilleNom = classeur.SheetNames[opts.feuille];
  } else {
    feuilleNom = classeur.SheetNames.find((n) => {
      const s = classeur.Sheets[n];
      if (!s) return false;
      const m = XLSX.utils.sheet_to_json<unknown[]>(s, { header: 1, defval: "" });
      return m.some((row) => row.some((cell) => normaliserEnTete(cell) === "tr"));
    });
  }
  const feuille = feuilleNom ? classeur.Sheets[feuilleNom] : undefined;
  if (!feuille) {
    return {
      lignes: [],
      annees: [],
      erreurs: [
        opts.feuille
          ? `Feuille « ${opts.feuille} » introuvable.`
          : "Aucune feuille avec en-tête « TR ».",
      ],
      source,
    };
  }
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(feuille, { header: 1, defval: "" });

  const headerIndex = matrix.findIndex((row) =>
    row.some((cell) => normaliserEnTete(cell) === "tr"),
  );
  if (headerIndex < 0) {
    return { lignes: [], annees: [], erreurs: ["Colonne « TR » introuvable."], source };
  }
  const header = matrix[headerIndex] ?? [];

  const colonnes = new Map<string, number>();
  header.forEach((cell, i) => {
    const n = normaliserEnTete(cell);
    if (n) colonnes.set(n, i);
  });
  const col = (nom: string): number => colonnes.get(nom) ?? -1;

  const annees = [...colonnes.keys()]
    .filter((n) => /^\d{4}$/.test(n))
    .map(Number)
    .sort((a, b) => a - b);

  const lignes: LigneProgrammation[] = [];
  const erreurs: string[] = [];
  for (let i = headerIndex + 1; i < matrix.length; i += 1) {
    const row = matrix[i] ?? [];
    if (row.every((cell) => String(cell ?? "").trim() === "")) continue;
    const tranche = String(row[col("tr")] ?? "").trim();
    if (!tranche) continue;

    const categorie = normaliserCategorie(row[col("c")]);
    if (!categorie) {
      erreurs.push(
        `Ligne ${i + 1} : C invalide (« ${String(row[col("c")] ?? "")} ») — attendu GE/GT/CP.`,
      );
    }

    const programme: Record<string, number> = {};
    for (const annee of annees) {
      programme[String(annee)] = numerique(row[col(String(annee))]);
    }

    lignes.push({
      ligne: i + 1,
      tranche,
      categorie,
      corps_etat: String(row[col("corps d etat")] ?? "").trim() || "—",
      nature_travaux: String(row[col("nature travaux")] ?? "").trim() || "Opération sans nature",
      ligne_budget:
        colonnes.has("ligne budget") && String(row[col("ligne budget")] ?? "").trim() !== ""
          ? String(row[col("ligne budget")] ?? "").trim()
          : null,
      charge_operation:
        colonnes.has("ch op") && String(row[col("ch op")] ?? "").trim() !== ""
          ? String(row[col("ch op")] ?? "").trim()
          : null,
      adresse: String(row[col("adresse")] ?? "").trim() || null,
      ville: String(row[col("ville")] ?? "").trim() || null,
      remarques:
        colonnes.has("remarques") && String(row[col("remarques")] ?? "").trim() !== ""
          ? String(row[col("remarques")] ?? "").trim()
          : null,
      programme,
    });
  }

  return { lignes, annees, erreurs, source };
};

/**
 * Wrapper compatible V2 : convertit le fichier « esquisse 2027 » (années
 * 2027-2031) en `PspOperation[]` pour le brouillon courant.
 */
export const parseEsquisse2027Workbook = (
  data: ArrayBuffer,
  fileName = "esquisse-psp-2027.xlsx",
): ResultatEsquisse => {
  const r = parseProgrammationWorkbook(data, { nom: fileName });
  const operations = r.lignes.map((l, i) => {
    const programme = PSP_ANNEES.map((a) => l.programme[String(a)] ?? 0);
    const premier = PSP_ANNEES.findIndex((a, i2) => (programme[i2] ?? 0) > 0);
    const annee: PspAnnee = premier >= 0 ? (PSP_ANNEES[premier] ?? 2027) : 2027;
    return creerOperation(
      {
        tranche: l.tranche,
        categorie: l.categorie ?? "GT",
        charge_clientele: "",
        charge_operation: l.charge_operation ?? "",
        corps_etat: l.corps_etat,
        adresse: l.adresse ?? "",
        ville: l.ville ?? "",
        nature_travaux: l.nature_travaux,
        annee,
        programme,
        remarques: l.remarques,
      },
      `esq-${String(i + 1).padStart(4, "0")}`,
    );
  });
  return { operations, lignes: operations.length, erreurs: r.erreurs, source: fileName };
};

/** Total programmé d'une liste (rappel pratique pour la comparaison). */
export const totalProgrammeListe = (ops: PspOperation[]): number =>
  ops.reduce((s, op) => s + totalOperation(op), 0);
