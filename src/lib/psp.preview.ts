/**
 * PSP — Helpers purs d'aperçu / analyse / import (route /import-psp).
 *
 * Module ISOLÉ, sans JSX ni dépendance d'environnement : il peut être testé
 * directement par Node (type stripping). La route `import-psp.tsx` réutilise
 * ces fonctions pour construire l'écran d'analyse et la validation d'import.
 * Aucune écriture Supabase ici — uniquement de la logique pure.
 */
import type { PspParsedTravaux, PspParsedRow } from "./psp";

/** Catégories du tableau de synthèse (lignes + anomalies du fichier). */
export type PspStatutSynthese =
  | "valide"
  | "a_controler"
  | "erreur"
  | "doublon"
  | "conflit";

/** Synthèse calculée après lecture d'un classeur (aucune écriture). */
export type PspAnalyse = {
  feuille: string | null;
  total_lignes: number;
  lignes_valides: number;
  lignes_a_controler: number;
  lignes_erreur: number;
  doublons: number;
  conflits: number;
  commandes_detectees: number;
  er_detectes: number;
  corps_etat_detectes: number;
  synthese: Record<PspStatutSynthese, number>;
};

/**
 * Calcule l'analyse d'un classeur parsé :
 *  - compteurs de lignes (valides / à contrôler / erreur) ;
 *  - doublons et conflits (anomalies intra-fichier) ;
 *  - commandes uniques détectées (numéro non vide) ;
 *  - références ER uniques détectées ;
 *  - codes corps d'état distincts détectés.
 */
export const construireAnalyse = (parsed: PspParsedTravaux): PspAnalyse => {
  const lignes = parsed.lignes;
  const conflits = parsed.doublons.filter((d) =>
    d.erreurs_psp.some((i) => i.code === "doublon_conflit"),
  ).length;
  const commandes = lignes.filter((l) => l.numero_commande !== "").length;
  const erDetectes = new Set(lignes.flatMap((l) => l.er_references)).size;
  const corpsDetectes = new Set(
    lignes.map((l) => l.corps_etat_code).filter((c): c is string => Boolean(c)),
  ).size;

  return {
    feuille: parsed.feuille,
    total_lignes: parsed.total_lignes,
    lignes_valides: parsed.valides,
    lignes_a_controler: parsed.a_controler,
    lignes_erreur: parsed.erreurs,
    doublons: parsed.doublons_identiques,
    conflits,
    commandes_detectees: commandes,
    er_detectes: erDetectes,
    corps_etat_detectes: corpsDetectes,
    synthese: {
      valide: parsed.valides,
      a_controler: parsed.a_controler,
      erreur: parsed.erreurs,
      doublon: parsed.doublons_identiques,
      conflit: conflits,
    },
  };
};

/** Filtres de l'aperçu des lignes. */
export type PspFiltre = "tous" | "erreurs" | "doublons" | "conflits" | "ambiguites" | "valides";

/** Filtre les lignes affichées selon la catégorie choisie. */
export const filtrerLignesPsp = (
  parsed: PspParsedTravaux,
  filtre: PspFiltre,
): PspParsedRow[] => {
  switch (filtre) {
    case "valides":
      return parsed.lignes.filter((l) => l.statut === "valide");
    case "erreurs":
      return parsed.lignes.filter((l) => l.statut === "erreur");
    case "ambiguites":
      return parsed.lignes.filter((l) => l.er_ambigue);
    case "doublons":
      return parsed.doublons;
    case "conflits":
      return parsed.doublons.filter((d) =>
        d.erreurs_psp.some((i) => i.code === "doublon_conflit"),
      );
    case "tous":
    default:
      return parsed.lignes;
  }
};

/** Taille d'un lot d'écriture (cohérente avec le pattern des imports existants). */
export const TAILLE_LOT_PSP = 100;

/** Résumé affiché avant validation de l'import (toutes les lignes sont conservées). */
export type PspResumeImport = {
  lignes_a_importer: number;
  lignes_valides: number;
  lignes_a_controler: number;
  lignes_erreur: number;
  lots: number;
};

/**
 * Construit le résumé de l'import. Toutes les lignes primaires sont importées
 * (y compris celles en erreur : elles restent visibles, jamais supprimées).
 */
export const construireResumeImport = (parsed: PspParsedTravaux): PspResumeImport => {
  const lignes = parsed.lignes;
  const lignesValides = lignes.filter((l) => l.statut === "valide").length;
  const lignesAControler = lignes.filter((l) => l.statut === "a_controler").length;
  const lignesErreur = lignes.filter((l) => l.statut === "erreur").length;
  return {
    lignes_a_importer: lignes.length,
    lignes_valides: lignesValides,
    lignes_a_controler: lignesAControler,
    lignes_erreur: lignesErreur,
    lots: Math.ceil(lignes.length / TAILLE_LOT_PSP),
  };
};

/**
 * Statut de finalisation de l'import :
 *  - « a_controler » si au moins une ligne est en erreur ou à contrôler ;
 *  - « termine » sinon. Le statut « erreur » est réservé à failPspImport.
 */
export const statutFinalImport = (
  resume: Pick<PspResumeImport, "lignes_erreur" | "lignes_a_controler">,
): "termine" | "a_controler" =>
  resume.lignes_erreur > 0 || resume.lignes_a_controler > 0 ? "a_controler" : "termine";

/** Découpe un tableau en lots de `taille` éléments (écriture par lots). */
export const decouperEnLots = <T,>(arr: T[], taille: number): T[][] =>
  Array.from({ length: Math.ceil(arr.length / taille) }, (_, i) =>
    arr.slice(i * taille, i * taille + taille),
  );

/** Vérifie que le fichier sélectionné est bien un Excel (.xlsx / .xls). */
export const estFichierExcel = (nom: string): boolean => /\.(xlsx|xls)$/i.test(nom);

/** Structure détectée conservée dans psp_imports.structure_detectee (JSONB). */
export const construireStructureDetectee = (parsed: PspParsedTravaux) => ({
  feuille: parsed.feuille ?? null,
});
