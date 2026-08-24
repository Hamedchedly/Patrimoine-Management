/**
 * V8.5.1 Ã¢â‚¬â€ MOTEUR DE DÃƒâ€°TECTION DE CORRESPONDANCES (pur, rÃƒÂ©versible).
 *
 * RÃƒÂ©pond Ãƒ  : Ã‚Â« Cette commande importÃƒÂ©e correspond-elle probablement Ãƒ  cette
 * opÃƒÂ©ration existante ? Ã‚Â» Ã¢â‚¬â€ SANS crÃƒÂ©er de lien, SANS modifier de donnÃƒÂ©es.
 *
 * RÃƒÂ¨gles absolues :
 *  Ã‚Â· aucune ÃƒÂ©criture (ni psp_command_links, ni psp_lignes, ni travaux_commandes) ;
 *  Ã‚Â· identitÃƒÂ© opÃƒÂ©ration = psp_lignes.id, identitÃƒÂ© commande = travaux_commandes.id ;
 *  Ã‚Â· JAMAIS TR+C comme identitÃƒÂ© (deux opÃƒÂ©rations peuvent partager TR+C) ;
 *  Ã‚Â· un champ absent n'est pas une diffÃƒÂ©rence ;
 *  Ã‚Â· une diffÃƒÂ©rence de montant > 30 % interdit AUTO ;
 *  Ã‚Â· ambiguÃƒÂ¯tÃƒÂ© (ÃƒÂ©cart < SEUIL_ECART_AMBIGUITE) Ã¢â€ â€™ A_CONFIRMER.
 *
 * Sources de vÃƒÂ©ritÃƒÂ© : patrimoine (tranches/lots/CC) Ã‚Â· programmation (psp_lignes,
 * psp_ligne_patrimoine) Ã‚Â· consultation (psp_devis) Ã‚Â· commandes/exÃƒÂ©cution
 * (travaux_commandes + imports) Ã‚Â· rapprochement (psp_command_links).
 */
import { normaliserTexte } from "./psp.suivi.foundation.ts";
import { rueDe } from "./adresses.ts";

// Ã¢â€â‚¬Ã¢â€â‚¬ Types d'entrÃƒÂ©e (structures STRUCTURELLES Ã¢â‚¬â€ alignÃƒÂ©es sur le schÃƒÂ©ma rÃƒÂ©el) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

/** Ligne PSP (`psp_lignes`) Ã¢â‚¬â€ champs utilisÃƒÂ©s par le moteur. */
export interface OperationRapprochement {
  id: string;
  tranche_code: string;
  categorie: string | null;
  corps_etat: string | null;
  nature_travaux: string | null;
  ligne_budget: string | null;
  origine: string;
  /** Montant total programmÃƒÂ© (somme des annÃƒÂ©es) Ã¢â‚¬â€ peut ÃƒÂªtre 0/absent. */
  montant_total: number | null;
  /** PÃƒÂ©rimÃƒÂ¨tres patrimoine (`psp_ligne_patrimoine`). */
  perimetres: PerimetreRapprochement[];
  /** Entreprises consultÃƒÂ©es via devis (fournisseur_id, nom). */
  entreprises_consultees: { fournisseur_id: string | null; entreprise: string | null }[];
}

export interface PerimetreRapprochement {
  id?: string;
  niveau: string;
  rue: string | null;
  numero: string | null;
  lot_id: string | null;
}

/** Commande importÃƒÂ©e (`travaux_commandes`) Ã¢â‚¬â€ lecture seule. */
export interface CommandeRapprochement {
  id: string;
  numero_commande: string | null;
  tranche_code: string | null;
  adresse: string | null;
  corps_etat: string | null;
  descriptif: string | null;
  fournisseur: string | null;
  numero_fournisseur: string | null;
  budget: number | null;
  annee_exercice: number | null;
  nature_analytique?: string | null;
}

/** Lien existant (`psp_command_links`) Ã¢â‚¬â€ lecture seule. */
export interface LienRapprochement {
  id: string;
  commande_id: string;
  psp_ligne_id: string | null;
  methode: string | null;
  confiance: number | null;
  statut: string | null;
}

/** RÃƒÂ©fÃƒÂ©rentiel fournisseurs + alias (lecture seule). */
export interface FournisseurRapprochement {
  id: string;
  nom: string | null;
  aliases: string[];
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Configuration centralisÃƒÂ©e (UNIQUE) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

export const POIDS_RAPPROCHEMENT = {
  tranche: 25,
  adresse: 25,
  corpsEtat: 15,
  nature: 15,
  entreprise: 10,
  montant: 5,
  annee: 5,
} as const;

export const SEUILS_RAPPROCHEMENT = {
  /** Score minimum pour AUTO. */
  auto: 90,
  /** Score minimum pour A_CONFIRMER. */
  aConfirmer: 60,
  /** Ãƒâ€°cart minimal entre 1er et 2e candidat pour ÃƒÂ©viter l'ambiguÃƒÂ¯tÃƒÂ©. */
  ecartAmbiguite: 10,
  /** DiffÃƒÂ©rence relative de montant maximale autorisÃƒÂ©e pour AUTO. */
  montantEcartMax: 0.3,
} as const;

/** Termes gÃƒÂ©nÃƒÂ©riques ignorÃƒÂ©s dans la comparaison des descriptifs. */
export const TERMES_GENERIQUES_DESCRIPTIF = new Set([
  "travaux",
  "prestation",
  "prestations",
  "remplacement",
  "remplacements",
  "renovation",
  "rehabilitation",
  "refection",
  "reparation",
  "reparations",
  "mise",
  "mises",
  "divers",
  "de",
  "du",
  "des",
  "la",
  "le",
  "les",
  "et",
  "au",
  "aux",
]);

// Ã¢â€â‚¬Ã¢â€â‚¬ RÃƒÂ©sultat Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

export type NiveauRapprochement = "AUTO" | "A_CONFIRMER" | "MANUEL" | "NON_RAPPROCHE";

export interface CriteresRapprochement {
  tranche: string;
  adresse: string;
  corpsEtat: string;
  nature: string;
  entreprise: string;
  montant: string;
  annee: string;
  lien?: string;
}

export interface PropositionRapprochement {
  operationId: string;
  commandeId: string;
  score: number;
  niveau: NiveauRapprochement;
  raisons: string[];
  conflits: string[];
  criteres: CriteresRapprochement;
  /** Candidats alternatifs (id + score) si ambiguÃƒÂ¯tÃƒÂ©. */
  candidatsAlternatifs: { operationId: string; score: number }[];
  /** DÃƒÂ©jÃƒ  liÃƒÂ© ? (commande dÃƒÂ©jÃƒ  rattachÃƒÂ©e Ãƒ  une opÃƒÂ©ration). */
  dejaLie: boolean;
  operationLieeId: string | null;
  methodeLien: string | null;
  statutLien: string | null;
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Normalisation (fonctions pures, testables) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

/** Normalise un numÃƒÂ©ro de commande (retire espaces/sÃƒÂ©parateurs). */
export const normaliserNumeroCommande = (v: string | null | undefined): string =>
  normaliserTexte(v).replace(/[^a-z0-9]/g, "");

/** Normalise une tranche (TR1977 Ã¢â€ â€™ 1977, 1977 Ã¢â€ â€™ 1977). */
export const normaliserTranche = (v: string | null | undefined): string =>
  normaliserTexte(v)
    .replace(/^tr/, "")
    .replace(/[^a-z0-9]/g, "");

/** Normalise un code ER (ER.123, ER 123, er-123 Ã¢â€ â€™ er123). */
export const normaliserEr = (v: string | null | undefined): string =>
  normaliserTexte(v)
    .replace(/^er[.\s-]*/, "")
    .replace(/[^a-z0-9]/g, "");

/** Normalise une adresse (espaces multiples, ponctuation lÃƒÂ©gÃƒÂ¨re). */
export const normaliserAdresse = (v: string | null | undefined): string =>
  normaliserTexte(v)
    .replace(/\s+/g, " ")
    .replace(/[.,;:]/g, "")
    .trim();

/** Normalise une entreprise (nom). */
export const normaliserEntreprise = (v: string | null | undefined): string =>
  normaliserTexte(v).replace(/\s+/g, " ").trim();

/** Normalise un corps d'ÃƒÂ©tat (extrait le libellÃƒÂ© et normalise). */
export const normaliserCorpsEtat = (v: string | null | undefined): string => {
  const brut = normaliserTexte(v).replace(/\s+/g, " ").trim();
  // "(c) Isolation" Ã¢â€ â€™ "isolation"
  return brut.replace(/^\([a-z0-9]+\)\s*/, "");
};

/** Tokenise un descriptif en termes significatifs (filtre les gÃƒÂ©nÃƒÂ©riques). */
export const tokensSignificatifs = (v: string | null | undefined): string[] => {
  const texte = normaliserTexte(v).replace(/\s+/g, " ");
  return texte
    .split(/[\s/]+/)
    .map((t) => t.replace(/[^a-z0-9]/g, ""))
    .filter((t) => t.length > 2 && !TERMES_GENERIQUES_DESCRIPTIF.has(t));
};

/** Jaccard sur les termes significatifs (0..1). */
export const similariteDescriptif = (
  a: string | null | undefined,
  b: string | null | undefined,
): number => {
  const ta = tokensSignificatifs(a);
  const tb = tokensSignificatifs(b);
  if (ta.length === 0 || tb.length === 0) return 0;
  const setA = new Set(ta);
  const setB = new Set(tb);
  let commun = 0;
  for (const t of setA) if (setB.has(t)) commun++;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : commun / union;
};

/** Comparaison relative de montants (null si un cÃƒÂ´tÃƒÂ© absent). */
export const ecartRelatifMontant = (a: number | null, b: number | null): number | null => {
  if (a == null || b == null || a === 0) return null;
  return Math.abs(a - b) / Math.abs(a);
};

// Ã¢â€â‚¬Ã¢â€â‚¬ Matching entreprise (rÃƒÂ©utilise le rÃƒÂ©fÃƒÂ©rentiel existant) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

type CorrespondanceEntreprise = "exacte" | "alias" | "similaire" | "absente";

/**
 * Compare les entreprises consultÃƒÂ©es d'une opÃƒÂ©ration Ãƒ  une commande.
 * Sources : psp_devis (opÃƒÂ©ration) + fournisseurs/aliases (rÃƒÂ©fÃƒÂ©rentiel) +
 * travaux_commandes.fournisseur / numero_fournisseur (commande).
 */
export const correspondanceEntreprise = (
  operationEntreprises: { fournisseur_id: string | null; entreprise: string | null }[],
  commande: Pick<CommandeRapprochement, "fournisseur" | "numero_fournisseur">,
  fournisseurs: FournisseurRapprochement[],
): { type: CorrespondanceEntreprise; raison: string } => {
  if (operationEntreprises.length === 0)
    return { type: "absente", raison: "Aucune entreprise consultÃƒÂ©e" };
  const fournisseurCommande = normaliserEntreprise(commande.fournisseur);
  const numeroFournisseur = normaliserEntreprise(commande.numero_fournisseur);

  for (const opE of operationEntreprises) {
    const ref = fournisseurs.find((f) => f.id === opE.fournisseur_id);
    if (ref) {
      const aliases = ref.aliases.map((a) => normaliserEntreprise(a));
      if (numeroFournisseur && aliases.includes(numeroFournisseur)) {
        return { type: "alias", raison: "Entreprise via alias fournisseur" };
      }
      if (
        fournisseurCommande &&
        aliases.some((a) => a.includes(fournisseurCommande) || fournisseurCommande.includes(a))
      ) {
        return { type: "alias", raison: "Entreprise via alias fournisseur" };
      }
    }
    const nomOp = normaliserEntreprise(opE.entreprise);
    if (
      nomOp &&
      fournisseurCommande &&
      (nomOp === fournisseurCommande ||
        nomOp.includes(fournisseurCommande) ||
        fournisseurCommande.includes(nomOp))
    ) {
      return { type: "exacte", raison: "Entreprise identique" };
    }
  }
  return { type: "similaire", raison: "Entreprise absente ou non comparable" };
};

// Ã¢â€â‚¬Ã¢â€â‚¬ Adresse / ER Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

type CorrespondanceAdresse = "er_exact" | "adresse_exacte" | "rue_seule" | "different" | "absente";

export const correspondanceAdresse = (
  perimetres: PerimetreRapprochement[],
  commandeAdresse: string | null,
  lotCodesParTranche: Record<string, string[]>,
): { type: CorrespondanceAdresse; raison: string } => {
  const adr = normaliserAdresse(commandeAdresse);
  if (!adr) return { type: "absente", raison: "Adresse commande absente" };

  // ER exact : un lot du pÃƒÂ©rimÃƒÂ¨tre dont le code ER apparaÃƒÂ®t dans l'adresse.
  for (const p of perimetres) {
    if (p.niveau === "lot" && p.lot_id) {
      const codes = lotCodesParTranche[p.lot_id] ?? [];
      for (const code of codes) {
        const er = normaliserEr(code);
        if (er && er.length >= 3 && adr.includes(er)) {
          return { type: "er_exact", raison: "ER identique" };
        }
      }
    }
  }

  // Adresse exacte (rue + numÃƒÂ©ro) si un pÃƒÂ©rimÃƒÂ¨tre porte une adresse.
  const adresseComplete = perimetres
    .map((p) => normaliserAdresse([p.numero, p.rue].filter(Boolean).join(" ")))
    .filter(Boolean);
  for (const a of adresseComplete) {
    if (a && (adr.includes(a) || a.includes(adr))) {
      return { type: "adresse_exacte", raison: "Adresse identique (rue + numÃƒÂ©ro)" };
    }
  }
  // Rue seule
  const rueCommande = normaliserAdresse(rueDe(commandeAdresse));
  for (const p of perimetres) {
    const r = normaliserAdresse(p.rue);
    if (r && (rueCommande.includes(r) || r.includes(rueCommande))) {
      return { type: "rue_seule", raison: "Rue identique (pÃƒÂ©rimÃƒÂ¨tre rue/adresse)" };
    }
  }
  return { type: "different", raison: "Adresse diffÃƒÂ©rente" };
};

// Ã¢â€â‚¬Ã¢â€â‚¬ Moteur principal Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

export interface AnalyseRapprochementOptions {
  operation: OperationRapprochement;
  commandes: CommandeRapprochement[];
  liens: LienRapprochement[];
  fournisseurs: FournisseurRapprochement[];
  /** lot_id Ã¢â€ â€™ codes ER (pour la correspondance ER). */
  lotCodesParTranche?: Record<string, string[]>;
}

/**
 * Propose les correspondances commande Ã¢â€ â€™ opÃƒÂ©ration (0..N).
 * Pure : aucune ÃƒÂ©criture. Produit des recommandations explicables.
 */
export const proposerRapprochements = (
  options: AnalyseRapprochementOptions,
): PropositionRapprochement[] => {
  const { operation, commandes, liens, fournisseurs, lotCodesParTranche = {} } = options;
  const propositions: PropositionRapprochement[] = [];

  for (const commande of commandes) {
    const proposition = evaluerCorrespondance(
      operation,
      commande,
      liens,
      fournisseurs,
      lotCodesParTranche,
    );
    if (proposition.niveau !== "NON_RAPPROCHE") propositions.push(proposition);
  }

  // Tri par score dÃƒÂ©croissant, puis rÃƒÂ©solution de l'ambiguÃƒÂ¯tÃƒÂ©.
  propositions.sort((a, b) => b.score - a.score);
  return propositions.map((p, i) => {
    const suivant = propositions[i + 1];
    const ecart = suivant ? p.score - suivant.score : Infinity;
    if (p.niveau === "AUTO" && ecart < SEUILS_RAPPROCHEMENT.ecartAmbiguite) {
      return {
        ...p,
        niveau: "A_CONFIRMER",
        conflits: [
          ...p.conflits,
          "Plusieurs candidats proches Ã¢â‚¬â€ confirmation humaine requise",
        ],
        candidatsAlternatifs: [
          ...propositions.slice(i + 1).map((x) => ({ operationId: x.operationId, score: x.score })),
        ].slice(0, 2),
      };
    }
    return p;
  });
};

/** Ãƒâ€°value une seule paire opÃƒÂ©ration Ã¢â€ â€ commande. */
export const evaluerCorrespondance = (
  operation: OperationRapprochement,
  commande: CommandeRapprochement,
  liens: LienRapprochement[],
  fournisseurs: FournisseurRapprochement[],
  lotCodesParTranche: Record<string, string[]> = {},
): PropositionRapprochement => {
  const raisons: string[] = [];
  const conflits: string[] = [];
  let score = 0;
  const criteres: CriteresRapprochement = {
    tranche: "",
    adresse: "",
    corpsEtat: "",
    nature: "",
    entreprise: "",
    montant: "",
    annee: "",
  };
  criteres.tranche = "exact";
  const trOp = normaliserTranche(operation.tranche_code);
  const trCmd = normaliserTranche(commande.tranche_code);
  if (trOp && trCmd && trOp === trCmd) {
    score += POIDS_RAPPROCHEMENT.tranche;
    raisons.push("TR identique");
    criteres.tranche = "exact";
  } else if (trOp && trCmd && trOp !== trCmd) {
    criteres.tranche = "different";
    conflits.push("TR diffÃƒÂ©rente");
  } else {
    criteres.tranche = "inconnu";
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ C. Adresse / ER Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  const adr = correspondanceAdresse(operation.perimetres, commande.adresse, lotCodesParTranche);
  if (adr.type === "er_exact") {
    score += POIDS_RAPPROCHEMENT.adresse;
    raisons.push(adr.raison);
    criteres.adresse = "er_exact";
  } else if (adr.type === "adresse_exacte") {
    score += POIDS_RAPPROCHEMENT.adresse;
    raisons.push(adr.raison);
    criteres.adresse = "adresse_exacte";
  } else if (adr.type === "rue_seule") {
    score += Math.round(POIDS_RAPPROCHEMENT.adresse * 0.6);
    raisons.push(adr.raison);
    criteres.adresse = "rue_seule";
  } else if (adr.type === "different") {
    criteres.adresse = "different";
  } else {
    criteres.adresse = "inconnu";
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ D. Corps d'ÃƒÂ©tat Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  const ceOp = normaliserCorpsEtat(operation.corps_etat);
  const ceCmd = normaliserCorpsEtat(commande.corps_etat);
  if (ceOp && ceCmd && (ceOp === ceCmd || ceOp.includes(ceCmd) || ceCmd.includes(ceOp))) {
    score += POIDS_RAPPROCHEMENT.corpsEtat;
    raisons.push("Corps d'ÃƒÂ©tat identique");
    criteres.corpsEtat = "exact";
  } else if (ceOp && ceCmd && ceOp !== ceCmd) {
    criteres.corpsEtat = "different";
    conflits.push("Corps d'ÃƒÂ©tat diffÃƒÂ©rent");
  } else {
    criteres.corpsEtat = "inconnu";
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ F. Nature / descriptif Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  const sim = similariteDescriptif(operation.nature_travaux, commande.descriptif);
  if (sim >= 0.6) {
    score += Math.round(POIDS_RAPPROCHEMENT.nature * sim);
    raisons.push("Descriptif proche");
    criteres.nature = "proche";
  } else if (sim >= 0.3) {
    score += Math.round(POIDS_RAPPROCHEMENT.nature * 0.4);
    criteres.nature = "partiel";
  } else if (
    tokensSignificatifs(operation.nature_travaux).length > 0 &&
    tokensSignificatifs(commande.descriptif).length > 0
  ) {
    criteres.nature = "different";
    conflits.push("Descriptif diffÃƒÂ©rent");
  } else {
    criteres.nature = "inconnu";
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ G. Entreprise Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  const entreprise = correspondanceEntreprise(
    operation.entreprises_consultees,
    commande,
    fournisseurs,
  );
  if (entreprise.type === "exacte" || entreprise.type === "alias") {
    score += POIDS_RAPPROCHEMENT.entreprise;
    raisons.push(entreprise.raison);
    criteres.entreprise = entreprise.type;
  } else if (entreprise.type === "similaire" && operation.entreprises_consultees.length > 0) {
    criteres.entreprise = "different";
    conflits.push("Entreprise explicitement diffÃƒÂ©rente");
  } else {
    criteres.entreprise = "absente";
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ H. Montant Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  const ecartMontant = ecartRelatifMontant(operation.montant_total, commande.budget);
  if (ecartMontant != null) {
    if (ecartMontant <= 0.15) {
      score += POIDS_RAPPROCHEMENT.montant;
      raisons.push("Montant proche");
      criteres.montant = "proche";
    } else if (ecartMontant <= SEUILS_RAPPROCHEMENT.montantEcartMax) {
      score += Math.round(POIDS_RAPPROCHEMENT.montant * 0.5);
      criteres.montant = "ecart_modere";
    } else {
      criteres.montant = "ecart_important";
      conflits.push(
        `DiffÃƒÂ©rence de montant > 30 % (ÃƒÂ©cart ${Math.round(ecartMontant * 100)} %)`,
      );
    }
  } else {
    criteres.montant = "inconnu";
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ I. AnnÃƒÂ©e / pÃƒÂ©riode Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  if (commande.annee_exercice != null) {
    // V8.5.1 : l'exercice d'import de la commande Ã¢â€°  annÃƒÂ©e de programmation.
    // Aucun point, aucun conflit (pas de donnÃƒÂ©e fiable pour comparer).
    criteres.annee = "inconnu";
  } else {
    criteres.annee = "inconnu";
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ J. Commande dÃƒÂ©jÃƒ  liÃƒÂ©e Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  const lienExistant = liens.find((l) => l.commande_id === commande.id);
  const dejaLie = !!lienExistant;
  const operationLieeId = lienExistant?.psp_ligne_id ?? null;
  if (dejaLie) {
    conflits.push("Commande dÃƒÂ©jÃƒ  liÃƒÂ©e Ãƒ  une opÃƒÂ©ration");
    criteres.lien = "deja_lie";
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ Niveau de confiance Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  let niveau: NiveauRapprochement;
  if (dejaLie) {
    niveau = "A_CONFIRMER";
  } else if (
    score >= SEUILS_RAPPROCHEMENT.auto &&
    conflits.length === 0 &&
    criteres.tranche !== "different" &&
    criteres.montant !== "ecart_important"
  ) {
    niveau = "AUTO";
  } else if (score >= SEUILS_RAPPROCHEMENT.aConfirmer) {
    niveau = "A_CONFIRMER";
  } else if (score >= 30) {
    niveau = "MANUEL";
  } else {
    niveau = "NON_RAPPROCHE";
  }

  // Conflits bloquants Ã¢â€ â€™ jamais AUTO.
  const bloquants = conflits.filter(
    (c) =>
      c.includes("TR diffÃƒÂ©rente") ||
      c.includes("Corps d'ÃƒÂ©tat diffÃƒÂ©rent") ||
      c.includes("Descriptif diffÃƒÂ©rent") ||
      c.includes("Entreprise explicitement") ||
      c.includes("DiffÃƒÂ©rence de montant > 30 %") ||
      c.includes("dÃƒÂ©jÃƒ  liÃƒÂ©e"),
  );
  if (niveau === "AUTO" && bloquants.length > 0) niveau = "A_CONFIRMER";

  // DonnÃƒÂ©es insuffisantes (trop peu de critÃƒÂ¨res exploitables) Ã¢â€ â€™ jamais AUTO.
  const criteresConnus = Object.values(criteres).filter((v) => v !== "inconnu").length;
  if (niveau === "AUTO" && criteresConnus < 3) niveau = "A_CONFIRMER";

  return {
    operationId: operation.id,
    commandeId: commande.id,
    score,
    niveau,
    raisons,
    conflits,
    criteres,
    candidatsAlternatifs: [],
    dejaLie,
    operationLieeId,
    methodeLien: lienExistant?.methode ?? null,
    statutLien: lienExistant?.statut ?? null,
  };
};

// ── Dérivation d'affichage (V8.5.2 — n'affecte PAS le moteur) ─────────────────

export type ExerceCorrespondance = "courant" | "futur" | "historique" | "inconnu";

/**
 * Dérive la relation d'exercice entre une opération programmée et une commande.
 * Règle métier : commande historique (exercice antérieur à la programmation) =
 * « Historique — exercice différent », priorité visuelle réduite.
 * Le moteur V8.5.1 n'est PAS modifié (aucun changement de seuils ni de score).
 */
export const deriverExerciceCorrespondance = (
  anneesProgrammation: number[],
  exerciceCommande: number | null,
): { type: ExerceCorrespondance; libelle: string } => {
  if (exerciceCommande == null) return { type: "inconnu", libelle: "Exercice non renseigné" };
  const annees = anneesProgrammation.filter((a) => Number.isFinite(a));
  if (annees.length === 0) return { type: "inconnu", libelle: "Opération non programmée" };
  const min = Math.min(...annees);
  const max = Math.max(...annees);
  if (exerciceCommande >= min && exerciceCommande <= max) {
    return { type: "courant", libelle: `Exercice ${exerciceCommande} (courant)` };
  }
  if (exerciceCommande < min) {
    return { type: "historique", libelle: `Historique — exercice ${exerciceCommande} différent` };
  }
  return { type: "futur", libelle: `Exercice ${exerciceCommande} (futur)` };
};

// ── V8.5.4 — relation de période (critère d'appui) ─────────────────────────────

export type RelationPeriode = "historique" | "courant" | "futur" | "inconnu";

/**
 * Détermine la relation de période entre une commande et une opération.
 * Réutilise `deriverExerciceCorrespondance` (aucune logique parallèle) et
 * utilise `date_commande` comme appui secondaire lorsque disponible.
 *
 * La période est un CRITÈRE D'APPUI : elle ne permet jamais, à elle seule,
 * un rattachement (jamais de point AUTO sur la seule période).
 */
export const determinerRelationPeriode = (
  anneesProgrammation: number[],
  exerciceCommande: number | null,
  dateCommande: string | null = null,
): { type: RelationPeriode; libelle: string; exercice: number | null } => {
  const base = deriverExerciceCorrespondance(anneesProgrammation, exerciceCommande);
  // Appui : si l'exercice est inconnu mais qu'une date de commande existe,
  // on déduit l'exercice de la date (jamais un rattachement seul).
  if (base.type === "inconnu" && dateCommande) {
    const annee = new Date(dateCommande).getFullYear();
    if (Number.isFinite(annee)) {
      const avecAnnee = deriverExerciceCorrespondance(anneesProgrammation, annee);
      if (avecAnnee.type !== "inconnu") {
        return { type: avecAnnee.type, libelle: avecAnnee.libelle, exercice: annee };
      }
    }
  }
  return { type: base.type, libelle: base.libelle, exercice: exerciceCommande };
};

// ── V8.5.4 — recherche inversée (commande → opérations) ────────────────────────

/**
 * Propose les opérations correspondant à une commande (recherche inversée).
 *
 * Réutilise EXCLUSIVEMENT `proposerRapprochements`/`evaluerCorrespondance`
 * (aucun moteur parallèle) : pour chaque opération candidate, on évalue la
 * commande et on retient les propositions pertinentes (AUTO, A_CONFIRMER,
 * MANUEL), triées par score décroissant.
 *
 * La commande reste identifiée par travaux_commandes.id ; l'opération par
 * psp_lignes.id. Aucune écriture.
 */
export const suggererOperationsPourCommande = (
  commande: CommandeRapprochement,
  operations: OperationRapprochement[],
  liens: LienRapprochement[],
  fournisseurs: FournisseurRapprochement[],
  lotCodesParTranche: Record<string, string[]> = {},
): PropositionRapprochement[] => {
  const propositions: PropositionRapprochement[] = [];
  for (const operation of operations) {
    const p = evaluerCorrespondance(operation, commande, liens, fournisseurs, lotCodesParTranche);
    if (p.niveau !== "NON_RAPPROCHE") {
      propositions.push({ ...p, operationId: operation.id });
    }
  }
  propositions.sort((a, b) => b.score - a.score);
  // Ambiguïté : si deux candidats proches, le premier passe A_CONFIRMER.
  return propositions.map((p, i) => {
    const suivant = propositions[i + 1];
    if (
      p.niveau === "AUTO" &&
      suivant &&
      p.score - suivant.score < SEUILS_RAPPROCHEMENT.ecartAmbiguite
    ) {
      return {
        ...p,
        niveau: "A_CONFIRMER",
        conflits: [...p.conflits, "Plusieurs opérations possibles — confirmation humaine requise"],
        candidatsAlternatifs: propositions
          .slice(i + 1)
          .map((x) => ({ operationId: x.operationId, score: x.score }))
          .slice(0, 2),
      };
    }
    return p;
  });
};
