/**
 * V8.21 — KANBAN devis → commande → travaux : DÉRIVATION des cartes (PUR).
 *
 * Consomme `SuiviOperationVue` (socle V8.1) : chaque opération porte déjà sa
 * consultation (devis), ses commandes liées (`psp_command_links`) et son statut
 * d'exécution (dérivé de `travaux_commandes`). Le Kanban classe ces opérations
 * dans 8 colonnes ; seule la « commande passée » saisie à la main (sans commande
 * importée) est portée par la table `kanban_commandes_passees` et est confrontée
 * au prochain import. Aucune écriture ici.
 */
import type {
  ConsultationEntreprise,
  DevisSuivi,
  SuiviOperationVue,
} from "../psp/suivi.foundation.ts";
import { operationSurAnnee } from "../psp/suivi.view.ts";

export type ColonneKanban =
  | "sans_devis"
  | "demande_devis"
  | "devis_recus"
  | "commande_a_passer"
  | "commande_passee"
  | "travaux_en_cours"
  | "fin_des_travaux";

export const COLONNES_KANBAN: Array<{ code: ColonneKanban; label: string; dot: string }> = [
  { code: "sans_devis", label: "Sans devis", dot: "bg-slate-400" },
  { code: "demande_devis", label: "Demande de devis", dot: "bg-sky-500" },
  { code: "devis_recus", label: "Devis reçus", dot: "bg-emerald-500" },
  { code: "commande_a_passer", label: "Commande à passer", dot: "bg-indigo-500" },
  { code: "commande_passee", label: "Commande passée", dot: "bg-violet-500" },
  { code: "travaux_en_cours", label: "Travaux en cours", dot: "bg-orange-500" },
  { code: "fin_des_travaux", label: "Travaux terminés", dot: "bg-teal-500" },
];

export const LABEL_COLONNE: Record<ColonneKanban, string> = Object.fromEntries(
  COLONNES_KANBAN.map((c) => [c.code, c.label]),
) as Record<ColonneKanban, string>;

/** Groupes d'AFFICHAGE du board (colonnes réduites) — la dérivation fine reste
 *  `ColonneKanban` (nécessaire à l'assistant).
 *  V8.24 — « Commande à passer » n'est plus un groupe d'affichage (inutile) :
 *  une carte avec devis retenu reste dans « Devis » (badge « retenu ») jusqu'à
 *  ce qu'une commande réelle/manuelle la fasse passer en « Commande / travaux ». */
export type GroupeKanban =
  | "sans_devis"
  | "devis" // demande en attente + devis reçus + retenu (pastilles jaune/verte)
  | "commande_travaux" // commande passée + travaux en cours
  | "termines";

export const GROUPES_KANBAN: Array<{ code: GroupeKanban; label: string; dot: string }> = [
  { code: "sans_devis", label: "Sans devis", dot: "bg-slate-400" },
  { code: "devis", label: "Devis", dot: "bg-sky-500" },
  { code: "commande_travaux", label: "Commande / travaux", dot: "bg-violet-500" },
  { code: "termines", label: "Travaux terminés", dot: "bg-teal-500" },
];

/** Regroupe une colonne fine dans son groupe d'affichage. */
export const groupeDeColonne = (c: ColonneKanban): GroupeKanban => {
  switch (c) {
    case "demande_devis":
    case "devis_recus":
    case "commande_a_passer": // devis retenu : toujours en « Devis » (badge retenu)
      return "devis";
    case "commande_passee":
    case "travaux_en_cours":
      return "commande_travaux";
    case "fin_des_travaux":
      return "termines";
    default:
      return "sans_devis";
  }
};

/** Rang d'une colonne fine (tri « état interne » : sans devis < demande < reçu…). */
export const RANG_COLONNE_KANBAN: Record<ColonneKanban, number> = {
  sans_devis: 0,
  demande_devis: 1,
  devis_recus: 2,
  commande_a_passer: 3,
  commande_passee: 4,
  travaux_en_cours: 5,
  fin_des_travaux: 6,
};

/** Mode de tri des cartes dans chaque colonne. */
export type TriCartesKanban = "etat" | "recent" | "tranche";

/**
 * Dernière modification d'une carte (timestamp ISO comparable lexicographiquement,
 * null si aucun). Meilleure source disponible : ligne (created/updated) + chaque
 * devis (demande créée / devis reçu / relance) + dates de la commande.
 */
export const derniereModificationCarte = (carte: CarteKanban): string | null => {
  const candidats: Array<string | null | undefined> = [];
  const ligne = carte.op.programmation.ligne;
  candidats.push(ligne.updated_at, ligne.created_at);
  for (const e of carte.op.consultation.entreprises) {
    for (const d of e.devis) {
      candidats.push(d.created_at, d.date_devis, d.derniere_relance_at);
    }
  }
  candidats.push(
    carte.op.execution.date_demarrage,
    carte.op.execution.date_fin,
    carte.commandePassee?.date_commande ?? null,
  );
  let max: string | null = null;
  for (const c of candidats) {
    if (!c) continue;
    if (!max || c > max) max = c;
  }
  return max;
};

const comparerTranche = (a: CarteKanban, b: CarteKanban): number =>
  a.tranche.localeCompare(b.tranche, "fr", { numeric: true });

/** Trie une liste de cartes (destinée à UNE colonne/groupe d'affichage). */
export const trierCartesKanban = (cartas: CarteKanban[], mode: TriCartesKanban): CarteKanban[] => {
  const arr = [...cartas];
  if (mode === "recent") {
    return arr.sort((a, b) => {
      const da = derniereModificationCarte(a) ?? "";
      const db = derniereModificationCarte(b) ?? "";
      if (da !== db) return db.localeCompare(da); // plus récent d'abord
      return comparerTranche(a, b);
    });
  }
  if (mode === "etat") {
    return arr.sort((a, b) => {
      const ra = RANG_COLONNE_KANBAN[a.colonne] ?? 0;
      const rb = RANG_COLONNE_KANBAN[b.colonne] ?? 0;
      if (ra !== rb) return ra - rb;
      return comparerTranche(a, b);
    });
  }
  // mode === "tranche" : numéro de tranche (puis état interne).
  return arr.sort((a, b) => {
    const t = comparerTranche(a, b);
    if (t !== 0) return t;
    const ra = RANG_COLONNE_KANBAN[a.colonne] ?? 0;
    const rb = RANG_COLONNE_KANBAN[b.colonne] ?? 0;
    return ra - rb;
  });
};

/** Ligne `kanban_commandes_passees` (commande passée à confronter à l'import). */
export interface CommandePasseeKanban {
  id: string;
  exercice: number;
  psp_ligne_id: string | null;
  tranche_code: string | null;
  adresse: string | null;
  libelle: string | null;
  montant_prevu: number | null;
  entreprise: string;
  numero_commande: string | null;
  date_commande: string | null;
  statut: "a_confirmer" | "confirme" | "ecart";
  commande_id: string | null;
}

/** État de consultation d'une entreprise (pastille). */
export type EtatEntrepriseDevis = "attente" | "relance" | "recu";

/** Devis affiché sur une carte (entreprise + montant + statut + pastille). */
export interface DevisAffiche {
  entreprise: string;
  montant: number | null;
  statut: string;
  etat: EtatEntrepriseDevis;
}

/** Commande liée affichée sur une carte. */
export interface CommandeAffichee {
  numero: string;
  entreprise: string;
  etat_travaux: string | null;
}

/** Carte du Kanban — vue agrégée prête à afficher. */
export interface CarteKanban {
  key: string;
  /** Opération source (SuiviOperationVue) — pour ouvrir la fiche complète. */
  op: SuiviOperationVue;
  psp_ligne_id: string;
  tranche: string;
  categorie: string;
  origine: "psp" | "hors_psp";
  adresse: string | null;
  nature: string | null;
  corps_etat: string | null;
  ligne_budget: string | null;
  cc: string | null;
  /** Montant programmé sur l'exercice choisi. */
  montant: number | null;
  colonne: ColonneKanban;
  /** V8.26 — état forcé (etat_pilotage) incohérent avec la colonne réelle (import). */
  conflit_pilotage: boolean;
  nb_demandes: number;
  nb_devis_recus: number;
  relance_necessaire: boolean;
  entreprisesConsultees: DevisAffiche[];
  devisRetenu: DevisAffiche | null;
  commandesLiees: CommandeAffichee[];
  commandePassee: CommandePasseeKanban | null;
  etat_commande: string | null;
  etat_travaux: string | null;
  date_debut: string | null;
  date_fin: string | null;
}

const STATUT_DEVIS_LABEL: Record<string, string> = {
  a_demander: "À demander",
  demande_envoyee: "Demande envoyée",
  recu: "Reçu",
  a_analyser: "Reçu (à analyser)",
  retenu: "Retenu",
  non_retenu: "Non retenu",
  expire: "Expiré",
  annule: "Annulé",
};

const libelleStatutDevis = (s: string | null | undefined): string =>
  (s && STATUT_DEVIS_LABEL[s]) || s || "—";

const estDevisRecu = (s: string | null | undefined): boolean =>
  s === "recu" || s === "a_analyser" || s === "retenu" || s === "non_retenu";

const etatEntrepriseDepuisConsultation = (s: string | null | undefined): EtatEntrepriseDevis => {
  if (s === "devis_recu" || s === "devis_retenu") return "recu";
  if (s === "relance_necessaire") return "relance";
  return "attente";
};

const entrepriseVersDevis = (e: ConsultationEntreprise): DevisAffiche => ({
  entreprise: e.entreprise,
  montant: e.montant,
  statut: libelleStatutDevis(e.statut_devis),
  etat: etatEntrepriseDepuisConsultation(e.statut_consultation),
});

const devisVersAffiche = (d: DevisSuivi): DevisAffiche => ({
  entreprise: d.entreprise,
  montant: d.montant,
  statut: libelleStatutDevis(d.statut),
  etat: estDevisRecu(d.statut) ? "recu" : "attente",
});

/** Montant programmé de l'opération sur l'exercice (null si 0/absent). */
export const montantOperationExercice = (
  op: SuiviOperationVue,
  exercice: number,
): number | null => {
  const a = op.programmation.annees.find((y) => y.annee === exercice);
  return a && a.montant > 0 ? a.montant : null;
};

/** L'opération appartient-elle au Kanban de l'exercice ? */
export const operationDansExercice = (op: SuiviOperationVue, exercice: number): boolean =>
  operationSurAnnee(op, exercice) || op.commandes.nb_commandes > 0;

/** Forçage manuel (`etat_pilotage`) → colonne Kanban (pas de colonne = pas de forçage). */
export const COLONNE_DEPUIS_PILOTAGE: Partial<Record<string, ColonneKanban>> = {
  devis_a_demander: "sans_devis",
  devis_demande: "demande_devis",
  devis_recu: "devis_recus",
  commande_a_passer: "commande_a_passer",
  en_cours: "travaux_en_cours",
  a_cloturer: "fin_des_travaux",
};

/**
 * Colonne « naturelle » dérivée des données RÉELLES (sans forçage manuel).
 * Ordre : exécution (commandes réelles) → commande passée manuelle → consultation.
 */
export const colonneKanbanSansForcage = (
  op: SuiviOperationVue,
  commandePassee: CommandePasseeKanban | null,
): ColonneKanban => {
  const exec = op.execution.statut;
  if (op.commandes.nb_commandes > 0) {
    if (exec === "travaux_termines") return "fin_des_travaux";
    if (exec === "travaux_en_cours" || exec === "travaux_a_demarrer") return "travaux_en_cours";
    return "commande_passee"; // commande_passee ou pas_realisee (commande émise)
  }
  if (commandePassee) return "commande_passee"; // saisie manuelle, à confirmer à l'import
  const consult = op.consultation;
  if (consult.devis_retenu) return "commande_a_passer";
  if (consult.nb_devis_recus > 0) return "devis_recus";
  if (consult.nb_demandes > 0) return "demande_devis"; // attente/relance → même colonne, pastille dédiée
  return "sans_devis";
};

/**
 * Colonne du Kanban pour une opération (+ éventuelle « commande passée » manuelle).
 * Ordre : forçage manuel (etat_pilotage) → sinon colonne naturelle (voir
 * `colonneKanbanSansForcage`).
 */
export const colonneKanban = (
  op: SuiviOperationVue,
  commandePassee: CommandePasseeKanban | null,
): ColonneKanban => {
  // Forçage manuel : l'utilisateur a choisi une étape (etat_pilotage) → elle prime.
  const pilotage = op.identite.etat_pilotage;
  const colonneForcee = pilotage ? COLONNE_DEPUIS_PILOTAGE[pilotage] : undefined;
  if (colonneForcee) return colonneForcee;
  return colonneKanbanSansForcage(op, commandePassee);
};

/** Construit la carte d'une opération pour l'exercice (+ commande passée associée). */
export const construireCarteKanban = (
  op: SuiviOperationVue,
  exercice: number,
  commandePassee: CommandePasseeKanban | null,
): CarteKanban => {
  const consultes = op.consultation.entreprises.map(entrepriseVersDevis);
  const devisRetenu = op.consultation.devis_retenu
    ? devisVersAffiche(op.consultation.devis_retenu)
    : null;
  const liee = op.commandes.liees[0];
  const colonne = colonneKanban(op, commandePassee);
  const colonneNaturelle = colonneKanbanSansForcage(op, commandePassee);
  return {
    key: op.identite.id,
    op,
    psp_ligne_id: op.identite.id,
    tranche: op.identite.tranche,
    categorie: op.identite.categorie,
    origine: op.identite.origine,
    adresse: op.programmation.adresse_rue ?? op.programmation.adresse,
    nature: op.programmation.nature,
    corps_etat: op.programmation.corps_etat,
    ligne_budget: op.programmation.ligne.ligne_budget ?? null,
    cc: op.programmation.cc,
    montant: montantOperationExercice(op, exercice),
    colonne,
    conflit_pilotage: Boolean(op.identite.etat_pilotage) && colonneNaturelle !== colonne,
    nb_demandes: op.consultation.nb_demandes,
    nb_devis_recus: op.consultation.nb_devis_recus,
    relance_necessaire: op.consultation.relance_necessaire,
    entreprisesConsultees: consultes,
    devisRetenu,
    commandesLiees: op.commandes.liees.map((c) => ({
      numero: c.numero_commande ?? "—",
      entreprise: c.entreprise ?? c.numero_fournisseur ?? "—",
      etat_travaux: c.etat_travaux,
    })),
    commandePassee,
    etat_commande: liee?.etat_commande ?? null,
    etat_travaux: op.execution.etat_travaux ?? liee?.etat_travaux ?? null,
    date_debut: liee?.date_demarrage ?? null,
    date_fin: liee?.date_fin_travaux ?? null,
  };
};

/** Détail des devis REÇUS d'une carte (à afficher). */
export const devisRecusCarte = (carte: CarteKanban): DevisAffiche[] =>
  carte.entreprisesConsultees.filter((d) => d.etat === "recu");

/** Normalise un texte pour comparaison (repli import : nom d'entreprise…). */
export const normaliserTexteKanban = (s: string | null | undefined): string =>
  (s ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?/()]/g, "");

/**
 * Filtre + construit toutes les cartes d'un exercice.
 * `commandesPassees` = lignes `kanban_commandes_passees` de l'exercice.
 */
export const construireCartesKanban = (
  operations: SuiviOperationVue[],
  exercice: number,
  commandesPassees: CommandePasseeKanban[],
): CarteKanban[] => {
  const cpParLigne = new Map<string, CommandePasseeKanban>();
  for (const cp of commandesPassees) {
    if (cp.psp_ligne_id && !cpParLigne.has(cp.psp_ligne_id)) cpParLigne.set(cp.psp_ligne_id, cp);
  }
  return operations
    .filter((op) => operationDansExercice(op, exercice))
    .map((op) => construireCarteKanban(op, exercice, cpParLigne.get(op.identite.id) ?? null))
    .sort((a, b) => a.tranche.localeCompare(b.tranche, "fr", { numeric: true }));
};

/** Années disponibles pour le sélecteur d'exercice (programmées + actuelles). */
export const anneesKanban = (operations: SuiviOperationVue[]): number[] => {
  const set = new Set<number>();
  const now = new Date().getFullYear();
  set.add(now);
  set.add(now + 1);
  for (const op of operations) {
    for (const a of op.programmation.annees) {
      if (a.montant > 0) set.add(a.annee);
    }
  }
  return [...set].sort((a, b) => b - a);
};
