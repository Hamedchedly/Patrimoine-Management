/**
 * PSP — Revue des reports (V3) : consommation des résultats EXISTANTS du suivi
 * annuel (moteur d'import) pour arbitrer les opérations programmées.
 *
 * RÈGLE DE RÉUTILISATION (aucun doublon) :
 *  - l'identité d'une ligne PSP est déterminée par TR + C (GE/GT/CP) ;
 *  - l'état d'une ligne du suivi vient de `etatMetier` / `isPasRealise`
 *    (src/lib/travaux.ts) — source unique de vérité ;
 *  - les modifications entre versions sont détectées par `champsDifferents`
 *    / `travauxComparable` (même moteur que l'import annuel) ;
 *  - la mémoire de confirmation s'appuie sur `travaux_commandes_historique.resolu`
 *    (mécanisme existant), jamais sur un deuxième système.
 *
 * Ce module est PUR (testable en Node). Aucune écriture Supabase.
 */
import { champsDifferents, etatMetier, travauxComparable } from "./travaux.ts";
import { extraireProgrammationsHistoriques } from "./psp.prep.ts";

// ── Types ───────────────────────────────────────────────────────────────────

/** Catégorie budgétaire C (GE / GT / CP) — même type que le module préparation. */
export type CategorieSuivi = "GE" | "GT" | "CP";

/** Ligne de la PROGRAMMATION d'une année N (source : programmation validée). */
export type LigneProgrammee = {
  tranche: string;
  categorie: CategorieSuivi;
  nature_travaux: string;
  montant: number;
  annee: number;
  /** Ligne budgétaire si déjà connue (sinon acquise au premier import du suivi). */
  ligne_budget?: string | null;
};

/** Ligne du SUIVI ANNUEL constaté (issue du moteur d'import / travaux_commandes). */
export type LigneSuivi = {
  id: string;
  tranche: string;
  categorie: CategorieSuivi;
  charge_clientele: string | null;
  ligne_budget: string | null;
  nature_travaux: string | null;
  numero_commande: string | null;
  fournisseur: string | null;
  budget: number | null;
  engage: number | null;
  paye: number | null;
  etat_travaux: string | null;
  etat_commande: string | null;
  annee_exercice: number | null;
};

/** Type de modification détectée (libellé affiché, aligné sur le moteur d'import). */
export type TypeModification =
  | "DESCRIPTIF MODIFIÉ"
  | "COMMANDE MODIFIÉE"
  | "MONTANT MODIFIÉ"
  | "FOURNISSEUR MODIFIÉ"
  | "ÉTAT MODIFIÉ"
  | "AUTRE MODIFICATION";

/** Modification d'une ligne entre deux versions (consomme `champsDifferents`). */
export type ModificationSuivi = {
  ligne: string;
  type: TypeModification;
  champ: string;
  ancien: string;
  nouveau: string;
  date?: string | null;
  source?: string | null;
  importId?: string | null;
};

/** Statut d'arbitrage d'une opération programmée. */
export type StatutArbitrage =
  | "non_engagee" // programmée, aucune commande (ou ligne sans commande au suivi)
  | "commande_non_terminee" // commande présente, non terminée
  | "terminee" // commande présente et terminée
  | "pas_realisee" // exercice clôturé sans engagement ni paiement
  | "hors_programmation" // ligne du suivi sans ligne PSP correspondante
  | "inconnue"; // ligne programmée absente du suivi (à arbitrer par défaut)

/** Ligne d'arbitrage : programmation N + rapprochement avec le suivi. */
export type LigneArbitrage = {
  tranche: string;
  categorie: CategorieSuivi;
  ligne_budget: string | null;
  nature_travaux: string;
  montant_programme: number;
  annee_initiale: number;
  commande: string | null;
  charge_clientele: string | null;
  etat: string;
  statut: StatutArbitrage;
  ligne_suivi: LigneSuivi | null;
};

// ── Identité d'une ligne PSP : TR + C ───────────────────────────────────────

/** Clé d'identité d'une ligne budgétaire : TR + C (jamais descriptif/adresse/commande). */
export const cleIdentitePsp = (tranche: string, categorie: CategorieSuivi): string =>
  `${tranche}|${categorie}`;

/** C différent → ligne distincte (règle métier §4). */
export const memesCle = (
  a: { tranche: string; categorie: CategorieSuivi },
  b: { tranche: string; categorie: CategorieSuivi },
): boolean => cleIdentitePsp(a.tranche, a.categorie) === cleIdentitePsp(b.tranche, b.categorie);

// ── Détection des modifications (réutilise champsDifferents) ────────────────

const LIBELLES: Record<string, TypeModification> = {
  descriptif: "DESCRIPTIF MODIFIÉ",
  numero_commande: "COMMANDE MODIFIÉE",
  fournisseur: "FOURNISSEUR MODIFIÉ",
  etat_commande: "ÉTAT MODIFIÉ",
  etat_travaux: "ÉTAT MODIFIÉ",
  budget: "MONTANT MODIFIÉ",
  engage: "MONTANT MODIFIÉ",
  paye: "MONTANT MODIFIÉ",
  solde: "MONTANT MODIFIÉ",
  ecart: "MONTANT MODIFIÉ",
};

const texte = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

/**
 * Détecte les modifications entre deux versions d'une MÊME ligne (même TR + même C).
 * Réutilise `champsDifferents` / `travauxComparable` du moteur d'import — aucune
 * nouvelle logique de comparaison.
 */
export const detecterModificationsLigne = (
  avant: Record<string, unknown>,
  apres: Record<string, unknown>,
  ligne: string,
): ModificationSuivi[] => {
  const diffs = champsDifferents(travauxComparable(avant), travauxComparable(apres));
  return diffs.map((champ) => ({
    ligne,
    type: LIBELLES[champ] ?? "AUTRE MODIFICATION",
    champ,
    ancien: texte(avant[champ]),
    nouveau: texte(apres[champ]),
  }));
};

/** Clé canonique d'une modification (champ + ancien + nouveau). */
export const cleModification = (m: ModificationSuivi): string =>
  `${m.champ}::${m.ancien}::${m.nouveau}`;

/**
 * Mémoire de confirmation : une modification déjà confirmée (mécanisme existant
 * `travaux_commandes_historique.resolu = true`, ou décision locale) ne doit pas
 * être redemandée. Aucun deuxième système de confirmation.
 */
export const modificationDejaConfirmee = (
  confirmees: ReadonlySet<string>,
  modification: ModificationSuivi,
): boolean => confirmees.has(cleModification(modification));

/** Extrait les confirmations depuis l'historique réel (rows resolu = true). */
export const extraireConfirmationsHistorique = (
  historique: Array<{ avant: unknown; apres: unknown; resolu: boolean; ligne?: string }>,
): Set<string> => {
  const confirmees = new Set<string>();
  for (const row of historique) {
    if (!row.resolu) continue;
    const a = (row.avant ?? {}) as Record<string, unknown>;
    const b = (row.apres ?? {}) as Record<string, unknown>;
    for (const modif of detecterModificationsLigne(a, b, row.ligne ?? "?")) {
      confirmees.add(cleModification(modif));
    }
  }
  return confirmees;
};

// ── Rapprochement programmation ↔ suivi ─────────────────────────────────────

/** Rapprochement par TR + C : une ligne programmée reste la même ligne si TR+C cohérents. */
export const rapprocherLignes = (
  programmees: LigneProgrammee[],
  suivi: LigneSuivi[],
): Map<string, LigneSuivi | null> => {
  const parCle = new Map<string, LigneSuivi[]>();
  for (const ligne of suivi) {
    const cle = cleIdentitePsp(ligne.tranche, ligne.categorie);
    const liste = parCle.get(cle) ?? [];
    liste.push(ligne);
    parCle.set(cle, liste);
  }
  const result = new Map<string, LigneSuivi | null>();
  for (const p of programmees) {
    const cle = cleIdentitePsp(p.tranche, p.categorie);
    const candidats = parCle.get(cle) ?? [];
    // Priorité : ligne budgétaire disponible, sinon la 1re ligne du suivi TR+C.
    const avecLB = candidats.find((l) => l.ligne_budget);
    result.set(cle, avecLB ?? candidats[0] ?? null);
  }
  return result;
};

/** Une ligne du suivi est « sans commande » (aucun numero_commande renseigné). */
export const ligneSansCommande = (ligne: LigneSuivi): boolean =>
  !ligne.numero_commande || String(ligne.numero_commande).trim() === "";

/**
 * Construit la vue « Opérations N à arbitrer » :
 * pour chaque ligne programmée, son statut réel issu du suivi (état via
 * `etatMetier` / `isPasRealise`), puis les lignes du suivi « hors programmation ».
 */
export const analyserLignesReport = (
  programmees: LigneProgrammee[],
  suivi: LigneSuivi[],
  exercice: number,
): LigneArbitrage[] => {
  const rapprochement = rapprocherLignes(programmees, suivi);

  const lignes: LigneArbitrage[] = programmees.map((p) => {
    const ligne = rapprochement.get(cleIdentitePsp(p.tranche, p.categorie)) ?? null;
    const etat = ligne ? etatMetier(ligne, exercice) : "Sans état";
    let statut: StatutArbitrage;
    if (!ligne || ligneSansCommande(ligne)) {
      statut = "non_engagee";
    } else if (etat === "Terminés") {
      statut = "terminee";
    } else if (etat === "Pas réalisé") {
      // État normalisé par `etatMetier` (déjà prioritaire sur les montants) :
      // aucun état explicite + exercice clôturé + aucun engagement/paiement.
      statut = "pas_realisee";
    } else {
      statut = "commande_non_terminee";
    }
    return {
      tranche: p.tranche,
      categorie: p.categorie,
      ligne_budget: ligne?.ligne_budget ?? p.ligne_budget ?? null,
      nature_travaux: p.nature_travaux,
      montant_programme: p.montant,
      annee_initiale: p.annee,
      commande: ligne?.numero_commande ?? null,
      charge_clientele: ligne?.charge_clientele ?? null,
      etat,
      statut,
      ligne_suivi: ligne,
    };
  });

  // Lignes du suivi sans ligne PSP correspondante → HORS PROGRAMMATION.
  const clesProgrammees = new Set(programmees.map((p) => cleIdentitePsp(p.tranche, p.categorie)));
  for (const s of suivi) {
    if (clesProgrammees.has(cleIdentitePsp(s.tranche, s.categorie))) continue;
    lignes.push({
      tranche: s.tranche,
      categorie: s.categorie,
      ligne_budget: s.ligne_budget,
      nature_travaux: s.nature_travaux ?? "Sans nature",
      montant_programme: s.budget ?? 0,
      annee_initiale: s.annee_exercice ?? exercice,
      commande: s.numero_commande,
      charge_clientele: s.charge_clientele,
      etat: etatMetier(s, exercice),
      statut: "hors_programmation",
      ligne_suivi: s,
    });
  }

  return lignes;
};

/** Résumé des comptes de la vue « à arbitrer » (KPI §13). */
export const resumeArbitrage = (lignes: LigneArbitrage[]) => {
  const compte = (s: StatutArbitrage) => lignes.filter((l) => l.statut === s).length;
  const sansCommande = compte("non_engagee");
  const pasRealisees = compte("pas_realisee");
  return {
    programmees: lignes.filter((l) => l.statut !== "hors_programmation").length,
    terminees: compte("terminee"),
    avecCommande: lignes.filter(
      (l) => l.statut !== "hors_programmation" && l.commande != null && String(l.commande) !== "",
    ).length,
    sansCommande,
    commandeNonTerminee: compte("commande_non_terminee"),
    pasRealisees,
    aReporter: sansCommande + pasRealisees,
    horsProgrammation: compte("hors_programmation"),
  };
};

/** Filtres de la revue des reports (§12). */
export type FiltresRevue = {
  categorie: string;
  tranche: string;
  charge_clientele: string;
  etat: string;
  commande: "toutes" | "avec" | "sans";
  /** KPI actif de la revue (« programmees », « sansCommande », …) — V7.4. */
  kpi: string;
};

export const FILTRES_REVUE_VIDES: FiltresRevue = {
  categorie: "",
  tranche: "",
  charge_clientele: "",
  etat: "",
  commande: "toutes",
  kpi: "",
};

/** Filtre par défaut de la revue : « Sans commande » (V7.4 §11). */
export const FILTRES_REVUE_DEFAUT: FiltresRevue = { ...FILTRES_REVUE_VIDES, kpi: "sansCommande" };

/**
 * Correspondance d'une ligne avec un KPI de la revue — MÊME logique que
 * `resumeArbitrage` (jamais dupliquée) : un KPI = un prédicat sur statut/commande.
 */
export const ligneMatchKpi = (l: LigneArbitrage, kpi: string): boolean => {
  const commandePresente = l.commande != null && String(l.commande) !== "";
  switch (kpi) {
    case "programmees":
      return l.statut !== "hors_programmation";
    case "terminees":
      return l.statut === "terminee";
    case "avecCommande":
      return l.statut !== "hors_programmation" && commandePresente;
    case "sansCommande":
      return l.statut === "non_engagee";
    case "commandeNonTerminee":
      return l.statut === "commande_non_terminee";
    case "aReporter":
      return l.statut === "non_engagee" || l.statut === "pas_realisee";
    case "horsProgrammation":
      return l.statut === "hors_programmation";
    default:
      return true;
  }
};

/** Applique les filtres de la revue (pur). */
export const filtrerLignesArbitrage = (
  lignes: LigneArbitrage[],
  filtres: FiltresRevue,
): LigneArbitrage[] =>
  lignes.filter((l) => {
    if (filtres.kpi && !ligneMatchKpi(l, filtres.kpi)) return false;
    if (filtres.categorie && l.categorie !== filtres.categorie) return false;
    if (filtres.tranche && l.tranche !== filtres.tranche) return false;
    if (filtres.charge_clientele && (l.charge_clientele ?? "") !== filtres.charge_clientele)
      return false;
    if (filtres.etat && l.etat !== filtres.etat) return false;
    if (filtres.commande === "avec" && !l.commande) return false;
    if (filtres.commande === "sans" && l.commande) return false;
    return true;
  });

/** Clés de tri du tableau de la revue des reports (V7.4 §13). */
export type CleTriRevue =
  | "tranche"
  | "categorie"
  | "ligne_budget"
  | "nature_travaux"
  | "montant"
  | "commande"
  | "etat"
  | "annee";

/** Tri stable de la revue (pur, réutilise la même règle que `trierOperationsDetail`). */
export const trierLignesRevue = (
  lignes: LigneArbitrage[],
  cle: CleTriRevue,
  asc: boolean,
): LigneArbitrage[] => {
  const valeur = (l: LigneArbitrage): string | number => {
    switch (cle) {
      case "tranche":
        return l.tranche;
      case "categorie":
        return l.categorie;
      case "ligne_budget":
        return l.ligne_budget ?? "";
      case "nature_travaux":
        return l.nature_travaux ?? "";
      case "montant":
        return l.montant_programme ?? 0;
      case "commande":
        return l.commande ?? "";
      case "etat":
        return l.etat ?? l.statut;
      case "annee":
        return l.annee_initiale ?? 0;
    }
  };
  const dir = asc ? 1 : -1;
  return [...lignes].sort((a, b) => {
    const va = valeur(a);
    const vb = valeur(b);
    if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
    return String(va).localeCompare(String(vb), "fr") * dir;
  });
};

// ── Mapping depuis les données réelles du moteur d'import ───────────────────

/**
 * Convertit une ligne de suivi BRUTE (issue du moteur d'import `parseTravauxWorkbook`
 * — commandes ET erreurs « sans commande » — ou de `getTravauxDashboard`) en
 * `LigneSuivi` exploitable par la revue des reports.
 * Le « C » du suivi est la nature analytique (GE/GT/CP) ; la ligne budgétaire
 * est `ligne_budget` (rattachée par la comptabilité au premier import).
 */
export const ligneSuiviDepuisRaw = (row: Record<string, unknown>): LigneSuivi => {
  const cat = row["nature_analytique"];
  const categorie: CategorieSuivi = cat === "GE" || cat === "GT" || cat === "CP" ? cat : "GT";
  const texte = (v: unknown): string | null =>
    v === null || v === undefined || String(v).trim() === "" ? null : String(v).trim();
  const nombre = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  return {
    id: String(row["id"] ?? row["line"] ?? "ligne"),
    tranche: texte(row["tranche_code"]) ?? "",
    categorie,
    charge_clientele: texte(row["charge_clientele"]),
    ligne_budget: texte(row["ligne_budget"]),
    nature_travaux: texte(row["descriptif"]),
    numero_commande: texte(row["numero_commande"]),
    fournisseur: texte(row["fournisseur"]),
    budget: nombre(row["budget"]),
    engage: nombre(row["engage"]),
    paye: nombre(row["paye"]),
    etat_travaux: texte(row["etat_travaux"]),
    etat_commande: texte(row["etat_commande"]),
    annee_exercice: nombre(row["annee_exercice"]),
  };
};

/** Variante typée pour les commandes `travaux_commandes` (getTravauxDashboard). */
export const ligneSuiviDepuisCommande = (cmd: {
  id: string;
  tranche_code: string | null;
  nature_analytique: string | null;
  charge_clientele: string | null;
  ligne_budget: string | null;
  descriptif: string | null;
  numero_commande: string | null;
  fournisseur: string | null;
  budget: number | null;
  engage: number | null;
  paye: number | null;
  etat_travaux: string | null;
  etat_commande: string | null;
  annee_exercice: number | null;
}): LigneSuivi => ligneSuiviDepuisRaw(cmd as unknown as Record<string, unknown>);

// ── Données MOCK (prototype V3 — remplaçables par les vrais fichiers) ───────

/** Programmation 2026 (source de référence pour la revue des reports 2027). */
export const PSP_PROGRAMMATION_2026: LigneProgrammee[] = [
  {
    tranche: "1976",
    categorie: "CP",
    nature_travaux: "Réfection toiture",
    montant: 35000,
    annee: 2026,
  },
  {
    tranche: "2086",
    categorie: "GE",
    nature_travaux: "Remplacement ascenseur",
    montant: 215000,
    annee: 2026,
  },
  {
    tranche: "2100",
    categorie: "GE",
    nature_travaux: "Reprise étanchéité toiture-terrasse",
    montant: 120000,
    annee: 2026,
  },
  {
    tranche: "2178",
    categorie: "CP",
    nature_travaux: "Remplacement chaudières",
    montant: 95000,
    annee: 2026,
  },
  {
    tranche: "2217",
    categorie: "GE",
    nature_travaux: "Ravalement façades",
    montant: 148000,
    annee: 2026,
  },
  {
    tranche: "3329",
    categorie: "CP",
    nature_travaux: "Remplacement menuiseries",
    montant: 78000,
    annee: 2026,
  },
];

/** Suivi annuel 2026 constaté (mock — reproduit les résultats du moteur d'import). */
export const SUIVI_2026_MOCK: LigneSuivi[] = [
  // anc-001 : ligne programmée SANS commande → non engagée (à reporter).
  {
    id: "suivi-001",
    charge_clientele: null,
    tranche: "1976",
    categorie: "CP",
    ligne_budget: "458721",
    nature_travaux: "Réfection toiture",
    numero_commande: null,
    fournisseur: null,
    budget: 35000,
    engage: 0,
    paye: 0,
    etat_travaux: null,
    etat_commande: null,
    annee_exercice: 2026,
  },
  // anc-002 : commande terminée → pas de report.
  {
    id: "suivi-002",
    charge_clientele: null,
    tranche: "2086",
    categorie: "GE",
    ligne_budget: "458722",
    nature_travaux: "Remplacement ascenseur",
    numero_commande: "123456",
    fournisseur: "OTIS",
    budget: 215000,
    engage: 215000,
    paye: 215000,
    etat_travaux: "Terminés",
    etat_commande: "Close",
    annee_exercice: 2026,
  },
  // anc-003 : commande non terminée → arbitrage.
  {
    id: "suivi-003",
    charge_clientele: null,
    tranche: "2100",
    categorie: "GE",
    ligne_budget: "458723",
    nature_travaux: "Reprise étanchéité toiture-terrasse",
    numero_commande: "234567",
    fournisseur: "COUVERTURE 77",
    budget: 120000,
    engage: 60000,
    paye: 20000,
    etat_travaux: "En cours",
    etat_commande: "En cours",
    annee_exercice: 2026,
  },
  // anc-004 : commande « Pas réalisé » (clôturée, aucun engagement) → report/annuler.
  {
    id: "suivi-004",
    charge_clientele: null,
    tranche: "2178",
    categorie: "CP",
    ligne_budget: "458724",
    nature_travaux: "Remplacement chaudières",
    numero_commande: "345678",
    fournisseur: "CFF",
    budget: 95000,
    engage: 0,
    paye: 0,
    etat_travaux: null,
    etat_commande: null,
    annee_exercice: 2026,
  },
  // anc-005 : aucune ligne au suivi → non engagée (programmée absente).
  // anc-006 : commande non terminée → arbitrage.
  {
    id: "suivi-006",
    charge_clientele: null,
    tranche: "3329",
    categorie: "CP",
    ligne_budget: "458726",
    nature_travaux: "Remplacement menuiseries",
    numero_commande: "567890",
    fournisseur: "MENUISERIE 77",
    budget: 78000,
    engage: 0,
    paye: 0,
    etat_travaux: "Attente validation",
    etat_commande: "Attente validation",
    annee_exercice: 2026,
  },
  // Ligne du suivi SANS ligne PSP → hors programmation.
  {
    id: "suivi-007",
    charge_clientele: null,
    tranche: "3049",
    categorie: "CP",
    ligne_budget: "455100",
    nature_travaux: "Remplacement fenêtres caves",
    numero_commande: "222111",
    fournisseur: "ALU 77",
    budget: 29000,
    engage: 29000,
    paye: 29000,
    etat_travaux: "Terminés",
    etat_commande: "Close",
    annee_exercice: 2026,
  },
];

/**
 * Historique des modifications détectées par le moteur d'import (mock V3).
 * Même forme que `travaux_commandes_historique` : operation « conflit »,
 * avant/apres, resolu (mémoire de confirmation existante).
 */
export const HISTORIQUE_MODIFICATIONS_MOCK: Array<{
  import_id: string;
  operation: string;
  avant: Record<string, unknown>;
  apres: Record<string, unknown>;
  resolu: boolean;
  created_at: string;
}> = [
  {
    import_id: "imp-2026-01",
    operation: "conflit",
    avant: {
      tranche_code: "1976",
      nature_analytique: "CP",
      ligne_budget: "458721",
      descriptif: "Réfection toiture",
      numero_commande: "123456",
      fournisseur: "ENTREPRISE A",
    },
    apres: {
      tranche_code: "1976",
      nature_analytique: "CP",
      ligne_budget: "458721",
      descriptif: "Réfection couverture",
      numero_commande: "123456",
      fournisseur: "ENTREPRISE A",
    },
    resolu: false,
    created_at: "2026-03-15T09:00:00Z",
  },
  {
    import_id: "imp-2026-02",
    operation: "conflit",
    avant: {
      tranche_code: "1976",
      nature_analytique: "CP",
      ligne_budget: "458721",
      descriptif: "Réfection couverture",
      numero_commande: "123456",
      fournisseur: "ENTREPRISE A",
    },
    apres: {
      tranche_code: "1976",
      nature_analytique: "CP",
      ligne_budget: "458721",
      descriptif: "Réfection couverture",
      numero_commande: "123789",
      fournisseur: "ENTREPRISE B",
    },
    resolu: false,
    created_at: "2026-06-20T10:30:00Z",
  },
  {
    import_id: "imp-2026-03",
    operation: "conflit",
    avant: {
      tranche_code: "2086",
      nature_analytique: "GE",
      ligne_budget: "458722",
      descriptif: "Remplacement ascenseur",
      numero_commande: "654321",
      fournisseur: "OTIS",
    },
    apres: {
      tranche_code: "2086",
      nature_analytique: "GE",
      ligne_budget: "458722",
      descriptif: "Remplacement ascenseur",
      numero_commande: "654322",
      fournisseur: "OTIS",
    },
    resolu: true, // déjà confirmée : ne pas redemander
    created_at: "2026-04-02T14:00:00Z",
  },
];

// ── V8.9.1 — REVUE DES ANCIENNES PROGRAMMATIONS (lecture seule, pur) ────────

/**
 * Ligne brute de psp_lignes suffisante pour la revue des anciennes
 * programmations. Aucune dépendance Supabase : la server function mappe les
 * colonnes réelles vers ce type (lecture seule).
 */
export type LigneRevueBrute = {
  id: string;
  tranche: string;
  categorie: string;
  corps_etat: string | null;
  nature_travaux: string | null;
  programme: Record<string, number>;
  origine: string;
  remarques?: string | null;
  ligne_budget?: string | null;
  adresse?: string | null;
  commande_liee?: {
    numero_commande: string;
    etat_commande: string | null;
    etat_travaux: string | null;
  } | null;
  devis?: Array<{
    statut: string;
    montant: number | null;
    entreprise: string | null;
  }>;
};

/** État réel d'une ancienne programmation (dérivé — jamais inventé). */
export type EtatRevueAncienne = "sans_commande" | "en_cours" | "terminee" | "a_verifier";

export const ETAT_REVUE_ANCIENNE_LABEL: Record<EtatRevueAncienne, string> = {
  sans_commande: "Sans commande",
  en_cours: "En cours",
  terminee: "Terminée",
  a_verifier: "À vérifier",
};

/** Entrée de la revue : UN couple (opération, année programmée) historique réel. */
export type RevueAncienneProgrammation = {
  pspLigneId: string;
  tranche: string;
  categorie: string;
  adresse: string | null;
  nature: string | null;
  corps_etat: string | null;
  annee: number;
  montant: number;
  origine: string;
  ligne_budget: string | null;
  etat: EtatRevueAncienne;
  commande: { numero_commande: string; etat_commande: string | null } | null;
  devis: Array<{ statut: string; montant: number | null; entreprise: string | null }>;
};

/**
 * V8.9.1 — CONSTRUIT LA REVUE DES ANCIENNES PROGRAMMATIONS depuis
 * `psp_lignes.programme` (source de vérité réelle) :
 *  · une entrée par couple (opération, année < référence, montant > 0) ;
 *  · aucun doublon psp_lignes (une ligne → autant d'entrées que d'années
 *    réellement programmées antérieures) ;
 *  · aucun devis / aucune commande seule ne créent d'entrée ;
 *  · l'état réel est DÉRIVÉ de la commande liée (ou « Sans commande ») ;
 *  · aucune donnée historique absente n'est reconstituée.
 */
export const construireRevueAnciennesProgrammations = (
  lignes: LigneRevueBrute[],
  anneeReference: number,
): RevueAncienneProgrammation[] => {
  const sorties: RevueAncienneProgrammation[] = [];
  for (const ligne of lignes) {
    const historiques = extraireProgrammationsHistoriques(ligne.programme ?? {}, anneeReference);
    for (const h of historiques) {
      const commande = ligne.commande_liee ?? null;
      let etat: EtatRevueAncienne = "sans_commande";
      if (commande) {
        const etatT = (commande.etat_travaux ?? "").trim().toLowerCase();
        if (etatT.includes("termin") || etatT.includes("clos")) etat = "terminee";
        else if (etatT.includes("verif") || etatT.includes("controle")) etat = "a_verifier";
        else etat = "en_cours";
      }
      sorties.push({
        pspLigneId: ligne.id,
        tranche: ligne.tranche,
        categorie: ligne.categorie,
        adresse: ligne.adresse ?? null,
        nature: ligne.nature_travaux ?? null,
        corps_etat: ligne.corps_etat ?? null,
        annee: h.annee,
        montant: h.montant,
        origine: ligne.origine,
        ligne_budget: ligne.ligne_budget ?? null,
        etat,
        commande: commande
          ? {
              numero_commande: commande.numero_commande,
              etat_commande: commande.etat_commande,
            }
          : null,
        devis: ligne.devis ?? [],
      });
    }
  }
  return sorties.sort(
    (a, b) => a.annee - b.annee || a.tranche.localeCompare(b.tranche, "fr"),
  );
};

