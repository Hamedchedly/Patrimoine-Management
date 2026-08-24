/**
 * PSP — V8.1 SOCLE MODULE SUIVI (module PUR, testable en Node).
 *
 * Identité d'une opération : `psp_lignes.id` UNIQUEMENT (jamais TR+C — depuis
 * V7.3 plusieurs opérations peuvent partager le même TR + catégorie).
 *
 * Ce module AGRÈGE à la lecture, sans rien copier :
 *   PROGRAMMATION  → psp_lignes / psp_ligne_patrimoine / psp_enveloppes
 *   CONSULTATION   → psp_devis (demande = created_at, devis = date_devis,
 *                    montant nullable, statut)
 *   COMMANDE       → psp_command_links → travaux_commandes
 *   EXÉCUTION      → travaux_commandes (données réelles des imports Excel)
 *
 * Règles absolues :
 *  · aucune valeur de commande recopiée dans psp_lignes ;
 *  · aucun MOCK — si une donnée est absente → « Aucune donnée disponible » ;
 *  · le CC est dérivé de tranches.sous_secteur → psp_charges_clientele,
 *    JAMAIS depuis travaux_commandes ;
 *  · les statuts sont DÉRIVÉS (jamais stockés, aucun système parallèle) ;
 *  · la recommandation d'entreprises n'utilise que des données réelles
 *    (historique des commandes + fournisseur_activites validées manuellement) ;
 *  · aucun texte « Meilleure entreprise » : « Correspondance forte » /
 *    « Entreprise compatible » uniquement.
 */
import { etatMetier } from "./travaux.ts";
import {
  classerCorpsEtatDansFamille,
  type ProfilActivite,
  type ProfilNiveau,
  calculerProfilActivite,
  extraireCorpsEtatCode,
  meilleurNiveauCorps,
} from "./fournisseurs.analyse.ts";
import type { PspCategorie } from "./psp.prep.ts";

// ── Types d'entrée (formes réelles des tables Supabase) ─────────────────────

/** Ligne PSP persistée (`psp_lignes`) — identité = id. */
export interface LignePspSuivi {
  id: string;
  /** NULL pour une opération HORS PSP (V8.3 — aucune programmation de rattachement). */
  programmation_id: string | null;
  tranche_code: string;
  categorie: PspCategorie;
  corps_etat_code: string | null;
  corps_etat: string | null;
  nature_travaux: string | null;
  programme: Record<string, number>;
  ligne_budget: string | null;
  remarques: string | null;
  origine: string;
  statut: string | null;
  priorite: string | null;
  /** V8.8 §9 — état de pilotage manuel (colonne additive, migration à valider). */
  etat_pilotage?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

/** Périmètre patrimonial (`psp_ligne_patrimoine`). */
export interface PerimetreSuivi {
  id: string;
  psp_ligne_id: string;
  tranche_code: string;
  niveau: "tranche" | "rue" | "adresse" | "lot";
  rue: string | null;
  numero: string | null;
  lot_id: string | null;
}

/** Devis (`psp_devis`) — montant nullable, created_at = date de demande. */
export interface DevisSuivi {
  id: string;
  psp_ligne_id: string;
  fournisseur_id: string | null;
  entreprise: string;
  date_devis: string | null;
  montant: number | null;
  statut: string;
  commentaire: string | null;
  document_reference: string | null;
  created_at: string | null;
  /** Date limite de réponse (optionnelle — à défaut : created_at + joursReponse). */
  date_limite_reponse?: string | null;
  /** V8.4 — date de la dernière relance envoyée (distincte de created_at). */
  derniere_relance_at?: string | null;
}

/** Lien ligne PSP ↔ commande (`psp_command_links`). */
export interface LienCommandeSuivi {
  id: string;
  commande_id: string;
  psp_ligne_id: string | null;
  type_relation: string;
  methode: string | null;
  confiance: number | null;
  statut: string | null;
  justification: string | null;
}

/** Commande (`travaux_commandes`) — données d'exécution lues telles quelles. */
export interface CommandeTravauxSuivi {
  id: string;
  numero_commande: string | null;
  tranche_code: string | null;
  fournisseur: string | null;
  /** V8.8.2 §1 — numéro fournisseur (affiché si le nom manque). */
  numero_fournisseur: string | null;
  descriptif: string | null;
  corps_etat: string | null;
  etat_commande: string | null;
  etat_travaux: string | null;
  budget: number | null;
  engage: number | null;
  paye: number | null;
  solde: number | null;
  date_import: string | null;
  date_demarrage: string | null;
  date_fin_travaux: string | null;
  annee_exercice: number | null;
}

/** Décision d'annulation éventuelle (`psp_decisions`, type_decision='annulation'). */
export interface DecisionSuivi {
  type_decision: string;
  statut?: string | null;
  valeur_retenue?: string | null;
} // ── Statuts dérivés (séparés, jamais fusionnés) ──────────────────────────────

/** Statut PSP — dérivé de psp_lignes.statut (+ programmation, décisions). */
export type StatutPspCode = "a_programmer" | "a_arbitrer" | "programme" | "reporte" | "annule";

/** Statut CONSULTATION — dérivé de psp_devis (+ date limite). */
export type StatutConsultationCode =
  | "pas_consulte"
  | "demande_a_envoyer"
  | "demande_envoyee"
  | "en_attente"
  | "relance_necessaire"
  | "devis_recu"
  | "devis_retenu"
  | "consultation_abandonnee";

/** Statut de RAPPROCHEMENT — dérivé de psp_command_links. */
export type StatutRapprochementCode = "non_rapproche" | "a_confirmer" | "auto" | "manuel";

/** Statut EXÉCUTION — dérivé des commandes liées (etatMetier, existant). */
export type StatutExecutionCode =
  | "sans_commande"
  | "commande_passee"
  | "travaux_a_demarrer"
  | "travaux_en_cours"
  | "travaux_termines"
  | "pas_realisee";

export const STATUT_PSP_LABELS: Record<StatutPspCode, string> = {
  a_programmer: "À programmer",
  a_arbitrer: "À arbitrer",
  programme: "Programmé",
  reporte: "Reporté",
  annule: "Annulé",
};

export const STATUT_CONSULTATION_LABELS: Record<StatutConsultationCode, string> = {
  pas_consulte: "Pas encore consulté",
  demande_a_envoyer: "Demande à envoyer",
  demande_envoyee: "Demande envoyée",
  en_attente: "En attente de réponse",
  relance_necessaire: "Relance nécessaire",
  devis_recu: "Devis reçu",
  devis_retenu: "Devis retenu",
  consultation_abandonnee: "Consultation abandonnée",
};

export const STATUT_RAPPROCHEMENT_LABELS: Record<StatutRapprochementCode, string> = {
  non_rapproche: "Non rapproché",
  a_confirmer: "À confirmer",
  auto: "Rapprochement automatique",
  manuel: "Rapprochement manuel",
};

export const STATUT_EXECUTION_LABELS: Record<StatutExecutionCode, string> = {
  sans_commande: "Sans commande",
  commande_passee: "Commande passée",
  travaux_a_demarrer: "Travaux à démarrer",
  travaux_en_cours: "Travaux en cours",
  travaux_termines: "Travaux terminés",
  pas_realisee: "Pas réalisé",
};

/** Déduit le statut PSP depuis la ligne (+ programmation / décisions éventuelles). */
export const statutPspDepuisLigne = (
  ligne: Pick<LignePspSuivi, "statut" | "origine">,
  options?: { programmationStatut?: string | null; decisions?: DecisionSuivi[] },
): StatutPspCode => {
  const decisions = options?.decisions ?? [];
  if (decisions.some((d) => d.type_decision === "annulation" && d.statut !== "rejete")) {
    return "annule";
  }
  if (ligne.origine === "report" || options?.programmationStatut === "reportee") {
    return "reporte";
  }
  if (ligne.statut === "attente_agence" || ligne.statut === "attente_confirmation") {
    return "a_arbitrer";
  }
  if (options?.programmationStatut === "validee" || options?.programmationStatut === "figee") {
    return "programme";
  }
  return "a_programmer";
};

// ── Consultation : relance, dates ───────────────────────────────────────────

/** Jours de réponse par défaut si aucune date limite renseignée. */
export const JOURS_REPONSE_DEFAUT = 21;

const isoDate = (v: string | null | undefined): Date | null => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Date de demande d'un devis = created_at (V7.10). */
export const dateDemandeDevis = (d: DevisSuivi): Date | null => isoDate(d.created_at);

/** Date limite de réponse (renseignée sinon created_at + joursReponse). */
export const dateLimiteReponse = (
  d: DevisSuivi,
  joursReponse = JOURS_REPONSE_DEFAUT,
): Date | null => {
  const explicite = isoDate(d.date_limite_reponse);
  if (explicite) return explicite;
  const demande = dateDemandeDevis(d);
  if (!demande) return null;
  const limite = new Date(demande);
  limite.setDate(limite.getDate() + joursReponse);
  return limite;
};

/** Devis sans montant n'est PAS une anomalie (V7.10 §6). */
export const devisSansMontant = (d: DevisSuivi): boolean =>
  d.montant === null || d.montant === undefined;

const demandeOuverte = (d: DevisSuivi): boolean =>
  d.statut === "a_demander" || d.statut === "demande_envoyee";

const devisRecuPour = (d: DevisSuivi): boolean =>
  d.statut === "recu" ||
  d.statut === "a_analyser" ||
  d.statut === "retenu" ||
  d.statut === "non_retenu";

/**
 * Relance nécessaire : date actuelle > date limite ET aucun devis reçu
 * pour cette demande.
 */
export const relanceNecessairePourDevis = (
  d: DevisSuivi,
  dateRef: Date,
  joursReponse = JOURS_REPONSE_DEFAUT,
): boolean => {
  if (!demandeOuverte(d)) return false;
  if (devisRecuPour(d)) return false;
  const limite = dateLimiteReponse(d, joursReponse);
  return limite !== null && dateRef.getTime() > limite.getTime();
};
// ── Consultation multi-entreprises ──────────────────────────────────────────

/** Entreprise consultée : regroupement des devis d'une même entreprise. */
export interface ConsultationEntreprise {
  fournisseur_id: string | null;
  entreprise: string;
  devis: DevisSuivi[];
  date_demande: string | null;
  date_devis: string | null;
  montant: number | null;
  statut_devis: string;
  statut_consultation: StatutConsultationCode;
  relance_necessaire: boolean;
}

/** Statut de consultation d'une entreprise (à partir de SES devis). */
export const statutConsultationEntreprise = (
  devis: DevisSuivi[],
  dateRef: Date,
  joursReponse = JOURS_REPONSE_DEFAUT,
): { statut: StatutConsultationCode; relance_necessaire: boolean } => {
  if (devis.length === 0) return { statut: "pas_consulte", relance_necessaire: false };
  if (devis.some((d) => d.statut === "retenu"))
    return { statut: "devis_retenu", relance_necessaire: false };
  if (devis.some((d) => d.statut === "recu" || d.statut === "a_analyser"))
    return { statut: "devis_recu", relance_necessaire: false };
  if (devis.every((d) => d.statut === "annule" || d.statut === "expire"))
    return { statut: "consultation_abandonnee", relance_necessaire: false };
  const relance = devis.some((d) => relanceNecessairePourDevis(d, dateRef, joursReponse));
  if (relance) return { statut: "relance_necessaire", relance_necessaire: true };
  if (devis.some((d) => d.statut === "demande_envoyee"))
    return { statut: "en_attente", relance_necessaire: false };
  if (devis.some((d) => d.statut === "a_demander"))
    return { statut: "demande_a_envoyer", relance_necessaire: false };
  return { statut: "demande_envoyee", relance_necessaire: false };
};

/** Regroupe les devis par entreprise (plusieurs entreprises consultées). */
export const grouperConsultationParEntreprise = (
  devis: DevisSuivi[],
  dateRef: Date,
  joursReponse = JOURS_REPONSE_DEFAUT,
): ConsultationEntreprise[] => {
  const parEntreprise = new Map<string, DevisSuivi[]>();
  for (const d of devis) {
    const cle = d.fournisseur_id ?? `nofournisseur:${d.entreprise}`;
    const liste = parEntreprise.get(cle) ?? [];
    liste.push(d);
    parEntreprise.set(cle, liste);
  }
  const result: ConsultationEntreprise[] = [];
  for (const [cle, liste] of parEntreprise) {
    const plusRecente = [...liste].sort((a, b) =>
      (b.created_at ?? "").localeCompare(a.created_at ?? ""),
    )[0];
    const recu = liste.find((d) => d.statut === "recu" || d.statut === "a_analyser");
    const retenu = liste.find((d) => d.statut === "retenu");
    const s = statutConsultationEntreprise(liste, dateRef, joursReponse);
    result.push({
      fournisseur_id: cle.startsWith("nofournisseur:") ? null : cle,
      entreprise: liste[0]?.entreprise ?? "",
      devis: liste,
      date_demande: plusRecente?.created_at ?? null,
      date_devis: recu?.date_devis ?? retenu?.date_devis ?? null,
      montant: recu?.montant ?? retenu?.montant ?? null,
      statut_devis: retenu?.statut ?? recu?.statut ?? plusRecente?.statut ?? "",
      statut_consultation: s.statut,
      relance_necessaire: s.relance_necessaire,
    });
  }
  return result.sort((a, b) =>
    a.entreprise.localeCompare(b.entreprise, "fr", { sensitivity: "base" }),
  );
};

/** Statut de consultation GLOBAL de l'opération. */
export const statutConsultationGlobal = (
  devis: DevisSuivi[],
  dateRef: Date,
  joursReponse = JOURS_REPONSE_DEFAUT,
): StatutConsultationCode => {
  if (devis.length === 0) return "pas_consulte";
  if (devis.some((d) => d.statut === "retenu")) return "devis_retenu";
  if (devis.some((d) => d.statut === "recu" || d.statut === "a_analyser")) return "devis_recu";
  if (devis.every((d) => d.statut === "annule" || d.statut === "expire"))
    return "consultation_abandonnee";
  if (devis.some((d) => relanceNecessairePourDevis(d, dateRef, joursReponse)))
    return "relance_necessaire";
  if (devis.some((d) => d.statut === "demande_envoyee")) return "en_attente";
  if (devis.some((d) => d.statut === "a_demander")) return "demande_a_envoyer";
  return "demande_envoyee";
};

/** Devis retenu d'une opération (statut 'retenu') — null si aucun. */
export const devisRetenuDe = (devis: DevisSuivi[]): DevisSuivi | null =>
  devis.find((d) => d.statut === "retenu") ?? null;

/**
 * V8.4 §11 — CHRONOLOGIE DE CONSULTATION d'un devis (événements ordonnés).
 * Dérivée à la lecture depuis psp_devis (aucune table d'historique parallèle) :
 *   1. demande (création)          → created_at
 *   2. relance (dernière envoyée)  → derniere_relance_at (si présente)
 *   3. devis reçu                  → date_devis (statut reçu/a_analyser/retenu/non_retenu)
 *   4. devis retenu                → statut = retenu (événement dérivé, même date)
 */
export type EvenementConsultation = {
  type: "demande" | "relance" | "devis_recu" | "devis_retenu";
  libelle: string;
  date: string | null;
};

export const chronologieConsultationDevis = (devis: DevisSuivi): EvenementConsultation[] => {
  const evenements: EvenementConsultation[] = [];
  const demande = dateDemandeDevis(devis);
  if (demande)
    evenements.push({ type: "demande", libelle: "Demande de devis", date: demande.toISOString() });
  const relance = isoDate(devis.derniere_relance_at);
  if (relance)
    evenements.push({ type: "relance", libelle: "Relance envoyée", date: relance.toISOString() });
  const recu = isoDate(devis.date_devis);
  if (recu && devisRecuPour(devis)) {
    evenements.push({ type: "devis_recu", libelle: "Devis reçu", date: recu.toISOString() });
  }
  if (devis.statut === "retenu") {
    evenements.push({
      type: "devis_retenu",
      libelle: "Devis retenu",
      date: recu ? recu.toISOString() : null,
    });
  }
  return evenements.sort((a, b) => String(a.date ?? "").localeCompare(String(b.date ?? "")));
};

export const chronologieConsultationEntreprise = (devis: DevisSuivi[]): EvenementConsultation[] => {
  const tout = devis.flatMap((d) => chronologieConsultationDevis(d));
  return tout.sort((a, b) => String(a.date ?? "").localeCompare(String(b.date ?? "")));
};

/**
 * Un devis est « reçu » dès qu'une réponse de l'entreprise est disponible,
 * quel que soit son traitement ultérieur : recu, a_analyser, retenu ou
 * non_retenu. Un devis retenu (ou écarté) est nécessairement un devis reçu.
 * (V8.3 — correction E5 : le marquage « retenu » ne doit pas faire sortir le
 * devis du compteur de devis reçus.)
 */
const STATUTS_DEVIS_RECUS = new Set(["recu", "a_analyser", "retenu", "non_retenu"]);
export const estDevisRecu = (devis: Pick<DevisSuivi, "statut">): boolean =>
  STATUTS_DEVIS_RECUS.has(devis.statut);
// ── Commandes liées + rapprochement + exécution ─────────────────────────────

/** Commande rattachée à l'opération (lien + commande + statut de rapprochement). */
export interface CommandeLieeSuivi {
  lien_id: string;
  commande_id: string;
  numero_commande: string | null;
  entreprise: string | null;
  /** V8.8.2 §1 — numéro fournisseur (affiché si le nom manque). */
  numero_fournisseur: string | null;
  date_import: string | null;
  descriptif: string | null;
  budget: number | null;
  engage: number | null;
  paye: number | null;
  solde: number | null;
  etat_commande: string | null;
  etat_travaux: string | null;
  date_demarrage: string | null;
  date_fin_travaux: string | null;
  statut_rapprochement: StatutRapprochementCode;
  statut_rapprochement_label: string;
  confiance: number | null;
}

/** Statut de rapprochement d'un lien (`psp_command_links`). */
export const statutRapprochementDepuisLien = (
  lien: Pick<LienCommandeSuivi, "methode" | "statut" | "confiance">,
): StatutRapprochementCode => {
  if (lien.statut === "rejete") return "non_rapproche";
  if (lien.methode === "manuel") return "manuel";
  if (lien.statut === "a_confirmer") return "a_confirmer";
  if (lien.methode === "auto" && lien.confiance != null && lien.confiance >= 1) return "auto";
  if (lien.statut === "valide") return "auto";
  return "a_confirmer";
};

/** Rattache les commandes aux liens (1 opération ↔ 0..N commandes). */
export const rattacherCommandes = (
  liens: LienCommandeSuivi[],
  commandes: CommandeTravauxSuivi[],
): CommandeLieeSuivi[] => {
  const parId = new Map(commandes.map((c) => [c.id, c]));
  const result: CommandeLieeSuivi[] = [];
  // V8.2.1 — une commande liée par plusieurs liens est comptée UNE seule fois
  // (les montants ne doivent jamais être double-comptés).
  const vues = new Set<string>();
  for (const lien of liens) {
    const cmd = parId.get(lien.commande_id);
    if (!cmd) continue; // commande absente (ne rien inventer)
    if (vues.has(cmd.id)) continue; // dédoublonnage V8.2.1
    vues.add(cmd.id);
    const rapprochement = statutRapprochementDepuisLien(lien);
    result.push({
      lien_id: lien.id,
      commande_id: cmd.id,
      numero_commande: cmd.numero_commande,
      entreprise: cmd.fournisseur,
      numero_fournisseur: cmd.numero_fournisseur,
      date_import: cmd.date_import,
      descriptif: cmd.descriptif,
      budget: cmd.budget,
      engage: cmd.engage,
      paye: cmd.paye,
      solde: cmd.solde,
      etat_commande: cmd.etat_commande,
      etat_travaux: cmd.etat_travaux,
      date_demarrage: cmd.date_demarrage,
      date_fin_travaux: cmd.date_fin_travaux,
      statut_rapprochement: rapprochement,
      statut_rapprochement_label: STATUT_RAPPROCHEMENT_LABELS[rapprochement],
      confiance: lien.confiance,
    });
  }
  return result.sort((a, b) => (a.numero_commande ?? "").localeCompare(b.numero_commande ?? ""));
};

/** Statut d'exécution dérivé des commandes liées (réutilise etatMetier). */
export const statutExecutionDepuisCommandes = (
  commandes: CommandeLieeSuivi[],
  exercice: number,
): StatutExecutionCode => {
  if (commandes.length === 0) return "sans_commande";
  const etats = commandes.map((c) =>
    etatMetier(
      {
        etat_travaux: c.etat_travaux,
        etat_commande: c.etat_commande,
        engage: c.engage,
      },
      exercice,
    ),
  );
  if (etats.includes("Terminés")) return "travaux_termines";
  if (etats.includes("Pas réalisé")) return "pas_realisee";
  if (etats.includes("En cours")) return "travaux_en_cours";
  if (etats.includes("Attente validation")) return "travaux_a_demarrer";
  return "commande_passee";
};

const somme = (vs: Array<number | null | undefined>): number =>
  vs.reduce<number>((s, v) => s + (typeof v === "number" ? v : 0), 0);
// ── Vue métier agrégée (getPspSuiviOperation) ───────────────────────────────

export interface SuiviOperationVue {
  identite: {
    id: string;
    tranche: string;
    categorie: PspCategorie;
    origine: "psp" | "hors_psp";
    /** V8.8 §9 — état de pilotage manuel (optionnel, migration à valider). */
    etat_pilotage?: string | null;
  };
  programmation: {
    ligne: LignePspSuivi;
    perimetre: PerimetreSuivi[];
    adresse: string | null;
    cc: string | null;
    sous_secteur: string | null;
    corps_etat: string | null;
    nature: string | null;
    priorite: string | null;
    statut_psp: StatutPspCode;
    statut_psp_label: string;
    annees: Array<{ annee: number; montant: number }>;
    montant_total: number;
    annee_premiere: number | null;
  };
  consultation: {
    statut: StatutConsultationCode;
    statut_label: string;
    entreprises: ConsultationEntreprise[];
    nb_entreprises_consultees: number;
    nb_demandes: number;
    nb_devis_recus: number;
    devis_retenu: DevisSuivi | null;
    relance_necessaire: boolean;
  };
  commandes: {
    liees: CommandeLieeSuivi[];
    nb_commandes: number;
    statut_rapprochement_global: StatutRapprochementCode;
    statut_rapprochement_label: string;
    budget_commande: number;
    engage: number;
    paye: number;
  };
  execution: {
    statut: StatutExecutionCode;
    statut_label: string;
    etat_travaux: string | null;
    date_demarrage: string | null;
    date_fin: string | null;
  };
  synthese: Array<{ code: string; label: string; atteint: boolean }>;
  source: { mock: false; donnees_reelles: true };
}

/** Étape de la synthèse du rapport de suivi (§13). */
const ETAPES_SYNTHESE = [
  { code: "programme", label: "Programmé" },
  { code: "devis_demandes", label: "Devis demandés" },
  { code: "devis_recus", label: "Devis reçus" },
  { code: "devis_retenu", label: "Devis retenu" },
  { code: "commande", label: "Commandé" },
  { code: "en_cours", label: "En cours" },
  { code: "termine", label: "Terminé" },
] as const;

/** Construit la vue métier agrégée — aucune écriture, aucun MOCK. */
export const construireSuiviOperation = (input: {
  ligne: LignePspSuivi;
  perimetres?: PerimetreSuivi[];
  devis?: DevisSuivi[];
  liens?: LienCommandeSuivi[];
  commandes?: CommandeTravauxSuivi[];
  decisions?: DecisionSuivi[];
  patrimoine?: { adresse: string | null; cc: string | null; sous_secteur?: string | null };
  programmationStatut?: string | null;
  exercice?: number;
  dateRef?: Date;
  joursReponse?: number;
}): SuiviOperationVue => {
  const {
    ligne,
    perimetres = [],
    devis = [],
    liens = [],
    commandes = [],
    decisions = [],
    patrimoine = { adresse: null, cc: null, sous_secteur: null },
    programmationStatut = null,
    exercice = new Date().getFullYear(),
    dateRef = new Date(),
    joursReponse = JOURS_REPONSE_DEFAUT,
  } = input;

  const statutPsp = statutPspDepuisLigne(ligne, { programmationStatut, decisions });
  const entreprises = grouperConsultationParEntreprise(devis, dateRef, joursReponse);
  const statutConsult = statutConsultationGlobal(devis, dateRef, joursReponse);
  const devisRetenu = devisRetenuDe(devis);
  const commandesLiees = rattacherCommandes(liens, commandes);
  const statutExec = statutExecutionDepuisCommandes(commandesLiees, exercice);
  const rapprochements = commandesLiees.map((c) => c.statut_rapprochement);
  const statutRapp: StatutRapprochementCode =
    rapprochements.length === 0
      ? "non_rapproche"
      : rapprochements.includes("a_confirmer")
        ? "a_confirmer"
        : rapprochements.includes("manuel")
          ? "manuel"
          : "auto";

  const annees = Object.entries(ligne.programme ?? {})
    .map(([annee, montant]) => ({ annee: Number(annee), montant: montant ?? 0 }))
    .filter((a) => Number.isFinite(a.annee))
    .sort((a, b) => a.annee - b.annee);
  const montantTotal = annees.reduce((s, a) => s + a.montant, 0);
  const anneePremiere = annees.find((a) => a.montant > 0)?.annee ?? null;
  const nbDevisRecus = devis.filter((d) => estDevisRecu(d)).length;

  const synthese = ETAPES_SYNTHESE.map((etape) => {
    let atteint = false;
    switch (etape.code) {
      case "programme":
        atteint = montantTotal > 0;
        break;
      case "devis_demandes":
        atteint = devis.length > 0;
        break;
      case "devis_recus":
        atteint = nbDevisRecus > 0;
        break;
      case "devis_retenu":
        atteint = devisRetenu !== null;
        break;
      case "commande":
        atteint = commandesLiees.length > 0;
        break;
      case "en_cours":
        atteint = statutExec === "travaux_en_cours" || statutExec === "travaux_a_demarrer";
        break;
      case "termine":
        atteint = statutExec === "travaux_termines";
        break;
    }
    return { code: etape.code, label: etape.label, atteint };
  });

  return {
    identite: {
      id: ligne.id,
      tranche: ligne.tranche_code,
      categorie: ligne.categorie,
      // V8.6.2 — une ligne annuelle matérialisée ('suivi') SANS ligne budgétaire
      // est une opération hors PSP annuel ; avec ligne budgétaire = PSP annuel.
      origine:
        ligne.origine === "hors_psp" ||
        (ligne.origine === "suivi" && !(ligne.ligne_budget ?? "").trim())
          ? "hors_psp"
          : "psp",
      etat_pilotage: ligne.etat_pilotage ?? null,
    },
    programmation: {
      ligne,
      perimetre: perimetres,
      adresse: patrimoine.adresse,
      cc: patrimoine.cc,
      sous_secteur: patrimoine.sous_secteur ?? null,
      corps_etat: ligne.corps_etat,
      nature: ligne.nature_travaux,
      priorite: ligne.priorite,
      statut_psp: statutPsp,
      statut_psp_label: STATUT_PSP_LABELS[statutPsp],
      annees,
      montant_total: montantTotal,
      annee_premiere: anneePremiere,
    },
    consultation: {
      statut: statutConsult,
      statut_label: STATUT_CONSULTATION_LABELS[statutConsult],
      entreprises,
      nb_entreprises_consultees: entreprises.length,
      nb_demandes: devis.length,
      nb_devis_recus: nbDevisRecus,
      devis_retenu: devisRetenu,
      relance_necessaire: entreprises.some((e) => e.relance_necessaire),
    },
    commandes: {
      liees: commandesLiees,
      nb_commandes: commandesLiees.length,
      statut_rapprochement_global: statutRapp,
      statut_rapprochement_label: STATUT_RAPPROCHEMENT_LABELS[statutRapp],
      budget_commande: somme(commandesLiees.map((c) => c.budget)),
      engage: somme(commandesLiees.map((c) => c.engage)),
      paye: somme(commandesLiees.map((c) => c.paye)),
    },
    execution: {
      statut: statutExec,
      statut_label: STATUT_EXECUTION_LABELS[statutExec],
      etat_travaux: commandesLiees.find((c) => c.etat_travaux)?.etat_travaux ?? null,
      date_demarrage: commandesLiees.find((c) => c.date_demarrage)?.date_demarrage ?? null,
      date_fin: commandesLiees.find((c) => c.date_fin_travaux)?.date_fin_travaux ?? null,
    },
    synthese,
    source: { mock: false, donnees_reelles: true },
  };
};
// ── Moteur de modèles de mail (mailto:, aucune connexion messagerie) ─────────

export interface VariableMail {
  cle: string;
  libelle: string;
}

/** Variables dynamiques disponibles dans les modèles. */
export const VARIABLES_MAIL: VariableMail[] = [
  { cle: "TR", libelle: "Référence patrimoine (TR)" },
  { cle: "NATURE_TRAVAUX", libelle: "Nature des travaux" },
  { cle: "CORPS_ETAT", libelle: "Corps d'état" },
  { cle: "ADRESSE", libelle: "Adresse du patrimoine" },
  { cle: "DATE_RETOUR", libelle: "Date souhaitée de retour" },
  { cle: "DATE_DEMANDE", libelle: "Date de la demande initiale (relance)" },
];

export interface ModeleMail {
  id: string;
  libelle: string;
  sujet: string;
  corps: string;
}

/**
 * Modèles centraux (un seul endroit) : les textes ne sont PAS figés dans les
 * composants. Ils restent personnalisables avant mailto:.
 */
export const MAIL_MODELES: ModeleMail[] = [
  {
    id: "demande_devis",
    libelle: "Demande de devis",
    sujet: "Demande de devis – {TR} – {NATURE_TRAVAUX}",
    corps: `Bonjour,

Dans le cadre de travaux à réaliser sur notre patrimoine situé {ADRESSE},

nous souhaiterions recevoir votre proposition pour :

Nature des travaux :
{NATURE_TRAVAUX}

Corps d'état :
{CORPS_ETAT}

Référence patrimoine :
{TR}

Adresse :
{ADRESSE}

Date souhaitée de retour :
{DATE_RETOUR}

Cordialement,`,
  },
  {
    id: "relance",
    libelle: "Relance de demande de devis",
    sujet: "Relance – Demande de devis – {TR} – {NATURE_TRAVAUX}",
    corps: `Bonjour,

Nous vous avons adressé le {DATE_DEMANDE} une demande de devis pour des travaux sur notre patrimoine situé {ADRESSE}.

Dans l'attente de votre proposition pour :

Nature des travaux :
{NATURE_TRAVAUX}

Corps d'état :
{CORPS_ETAT}

Référence patrimoine :
{TR}

Adresse :
{ADRESSE}

Date souhaitée de retour :
{DATE_RETOUR}

Cordialement,`,
  },
];

/** Remplace les variables {CLE} d'un texte (moteur central, insensible à la casse). */
export const remplacerVariablesMail = (
  texte: string,
  variables: Record<string, string | null | undefined>,
): string =>
  texte.replace(/\{([A-Z_]+)\}/g, (_, cle: string) => {
    const valeur = variables[cle];
    return valeur == null || String(valeur).trim() === "" ? `{${cle}}` : String(valeur);
  });

/** Compose sujet + corps d'un modèle avec les variables. */
export const composerMail = (
  modele: ModeleMail,
  variables: Record<string, string | null | undefined>,
): { sujet: string; corps: string } => ({
  sujet: remplacerVariablesMail(modele.sujet, variables),
  corps: remplacerVariablesMail(modele.corps, variables),
});

/** Construit une URL mailto: (ouverture client local — PAT S11 ne prétend pas que le mail est parti). */
export const construireMailto = (input: {
  email?: string | null;
  sujet: string;
  corps: string;
}): string => {
  const base = input.email && input.email.trim() !== "" ? input.email : "";
  const params: string[] = [];
  if (input.sujet.trim() !== "") params.push(`subject=${encodeURIComponent(input.sujet)}`);
  if (input.corps.trim() !== "") params.push(`body=${encodeURIComponent(input.corps)}`);
  return `mailto:${base}${params.length > 0 ? `?${params.join("&")}` : ""}`;
};

/** Date de retour par défaut (created_at de la demande + jours). */
export const dateRetourParDefaut = (dateRef: Date, jours = JOURS_REPONSE_DEFAUT): string => {
  const d = new Date(dateRef);
  d.setDate(d.getDate() + jours);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
// ── Recommandation d'entreprises (données RÉELLES uniquement) ───────────────

/** Activité structurée validée manuellement (`fournisseur_activites`). */
export interface ActiviteEntreprise {
  fournisseur_id: string;
  corps_etat_code: string;
  corps_etat_libelle: string;
  niveau: "principal" | "secondaire" | "occasionnel";
}

export interface SuggestionEntreprise {
  fournisseur_id: string;
  nom: string;
  /** Numéro fournisseur réel (alias travaux_commandes) — pour le libellé robuste. */
  numero?: string | null;
  correspondance: "forte" | "compatible" | "aucune";
  etiquettes: string[];
  commandes_corps_etat: number;
  commandes_total: number;
  niveau: ProfilNiveau | null;
  /** Score technique INTERNE, expliquable (jamais affiché comme « meilleure entreprise »). */
  score: number;
}

/** Normalise un texte pour les comparaisons (règle — pas d'invention). */
export const normaliserTexte = (v: string | null | undefined): string =>
  (v ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

/**
 * Recommande des entreprises pour une opération.
 * Sources réellement disponibles :
 *  · historique réel des commandes (travaux_commandes → profil via fournisseurs.analyse) ;
 *  · activités validées manuellement (fournisseur_activites — vide actuellement).
 * Aucune activité inventée : sans données, l'entreprise n'est pas suggérée.
 */
export const recommanderEntreprises = (input: {
  fournisseurs: Array<{ id: string; nom: string; numero?: string | null }>;
  historique: Array<{
    fournisseur_id: string;
    corps_etat: string | null;
    montant: number | null;
    annee: number | null;
  }>;
  activites?: ActiviteEntreprise[];
  corps_etat_operation: string | null;
  limite?: number;
}): SuggestionEntreprise[] => {
  const { fournisseurs, historique, activites = [], corps_etat_operation, limite = 20 } = input;
  const corpsOpNormalise = normaliserTexte(corps_etat_operation);
  const familleOp = classerCorpsEtatDansFamille(corps_etat_operation);

  const parFournisseur = new Map<
    string,
    Array<{ corps_etat: string | null; montant: number | null; annee: number | null }>
  >();
  for (const h of historique) {
    const liste = parFournisseur.get(h.fournisseur_id) ?? [];
    liste.push(h);
    parFournisseur.set(h.fournisseur_id, liste);
  }

  const suggestions: SuggestionEntreprise[] = [];
  for (const f of fournisseurs) {
    const commandesF = parFournisseur.get(f.id) ?? [];
    const profil: ProfilActivite | null =
      commandesF.length > 0 ? calculerProfilActivite(commandesF) : null;

    const commandesCorps = corpsOpNormalise
      ? commandesF.filter((c) => {
          const { code } = extraireCorpsEtatCode(c.corps_etat);
          return (
            normaliserTexte(code) === corpsOpNormalise ||
            normaliserTexte(c.corps_etat).includes(corpsOpNormalise)
          );
        }).length
      : commandesF.length;

    const activiteManuelle = activites.find(
      (a) =>
        a.fournisseur_id === f.id &&
        (corpsOpNormalise === ""
          ? true
          : normaliserTexte(a.corps_etat_code) === corpsOpNormalise ||
            normaliserTexte(a.corps_etat_libelle).includes(corpsOpNormalise)),
    );

    let niveau: ProfilNiveau | null = null;
    if (activiteManuelle) niveau = activiteManuelle.niveau;
    else if (profil && corps_etat_operation)
      niveau = meilleurNiveauCorps(profil, [corps_etat_operation]);
    else if (profil) niveau = profil.corps[0]?.niveau ?? null;

    const familleCompatible =
      profil != null && familleOp !== "AUTRE" && profil.famille_principale === familleOp;
    const corpsCompatible = niveau !== null && niveau !== "occasionnel";

    let correspondance: SuggestionEntreprise["correspondance"] = "aucune";
    const etiquettes: string[] = [];
    if (corpsCompatible) {
      correspondance = "forte";
      etiquettes.push("Corps d'état compatible");
    } else if (familleCompatible) {
      correspondance = "compatible";
      etiquettes.push("Activité compatible");
    } else if (profil && corpsOpNormalise) {
      const corpsPresent = profil.corps.some((c) =>
        normaliserTexte(c.corps_etat).includes(corpsOpNormalise),
      );
      if (corpsPresent) {
        correspondance = "compatible";
        etiquettes.push("Activité compatible");
      }
    }
    if (commandesCorps > 0) {
      etiquettes.push(
        `${commandesCorps} commande${commandesCorps > 1 ? "s" : ""} historique${commandesCorps > 1 ? "s" : ""} sur ce corps d'état`,
      );
    } else if (commandesF.length === 0) {
      etiquettes.push("Aucune commande historique connue");
    }
    if (etiquettes.length === 0) etiquettes.push("Pas d'historique connu sur ce corps d'état");

    const ordreNiveau = { principal: 3, secondaire: 2, occasionnel: 1 } as const;
    const score =
      commandesCorps * 10 +
      (ordreNiveau[niveau ?? "occasionnel"] ?? 1) +
      (corpsCompatible ? 20 : 0) +
      (familleCompatible ? 5 : 0);

    suggestions.push({
      fournisseur_id: f.id,
      nom: f.nom,
      numero: f.numero ?? null,
      correspondance,
      etiquettes,
      commandes_corps_etat: commandesCorps,
      commandes_total: commandesF.length,
      niveau,
      score,
    });
  }

  return suggestions
    .filter((s) => s.correspondance !== "aucune")
    .sort((a, b) => b.score - a.score || a.nom.localeCompare(b.nom, "fr"))
    .slice(0, limite);
};
