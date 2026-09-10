/**
 * V8.16z — Fiche « Informations des lots » pour les DEMANDES DE DEVIS.
 *
 * Module PUR (testable sans navigateur ni base) : types + préremplissage depuis
 * le référentiel patrimoine + composition du bloc texte injecté dans le mail.
 *
 * Règles impératives :
 *  · JAMAIS inventer une information (champ absent du référentiel → null/vide) ;
 *  · les données du référentiel (lots/tranches) ne sont JAMAIS modifiées ici ;
 *  · la fiche sert uniquement à composer le mail destiné à l'entreprise.
 */

export type StatutOccupation = "occupe" | "vacant" | "autre";

export const STATUT_OCCUPATION_LABELS: Record<StatutOccupation, string> = {
  occupe: "Occupé",
  vacant: "Vacant",
  autre: "Autre",
};

/** Données référentiel renvoyées par `getLotsPourDevis` (colonnes `lots` + tranche). */
export type LotDevisInfos = {
  id: string;
  code_patrimoine: string;
  tranche_code: string;
  type_lot: string | null;
  batiment: string | null;
  etage: string | null;
  porte: string | null;
  surface_utile: number | null;
  dpe: string | null;
  adresse: string | null;
  code_postal: string | null;
  ville: string | null;
  locataire_nom: string | null;
  locataire_telephone: string | null;
  locataire_email: string | null;
  date_entree: string | null;
  /** Ville (localité) de la tranche, via `tranches.localite`. */
  localite_tranche: string | null;
};

/**
 * Fiche « informations pour l'entreprise » : valeurs préremplies depuis le
 * référentiel + champs libres saisis SPÉCIFIQUEMENT pour la demande (jamais
 * réinjectés dans le référentiel). Champs manquants → null / chaîne vide.
 */
export type FicheLotDevis = {
  lot_id: string;
  code: string;
  adresse: string | null;
  batiment: string | null;
  entree: string | null;
  appartement: string | null;
  etage: string | null;
  ville: string | null;
  tranche: string;
  localite_tranche: string | null;
  surface: number | null;
  dpe: string | null;
  // Occupation
  statut_occupation: StatutOccupation;
  locataire_nom: string | null;
  locataire_telephone: string | null;
  // Champs saisis pour la demande (mail uniquement)
  contact_complement: string;
  nb_pieces: string;
  localisation_intervention: string;
  conditions_acces: string;
  contraintes: string;
  creneaux: string;
  observations: string;
};

/** Statut d'occupation DÉFAUT depuis le référentiel : occupé si un locataire
 *  courant existe (`lots.locataire_nom`), sinon VACANT (jamais inventé). */
export function statutOccupationDefaut(
  lot: Pick<LotDevisInfos, "locataire_nom">,
): StatutOccupation {
  return (lot.locataire_nom ?? "").trim() ? "occupe" : "vacant";
}

/** Construit la fiche préremplie depuis le référentiel (manquant → null/vide). */
export function construireFicheLot(lot: LotDevisInfos): FicheLotDevis {
  return {
    lot_id: lot.id,
    code: lot.code_patrimoine,
    adresse: lot.adresse,
    batiment: lot.batiment,
    // aucune colonne « entrée » dans `lots` → jamais inventé
    entree: null,
    appartement: lot.porte,
    etage: lot.etage,
    ville: lot.ville,
    tranche: lot.tranche_code,
    localite_tranche: lot.localite_tranche,
    surface: lot.surface_utile,
    dpe: lot.dpe,
    statut_occupation: statutOccupationDefaut(lot),
    locataire_nom: lot.locataire_nom,
    locataire_telephone: lot.locataire_telephone,
    contact_complement: "",
    nb_pieces: "",
    localisation_intervention: "",
    conditions_acces: "",
    contraintes: "",
    creneaux: "",
    observations: "",
  };
}

/** « 64 m² » — uniquement si la valeur existe (jamais inventé). */
export function formaterSurface(surface: number | null | undefined): string | null {
  if (surface == null || Number.isNaN(surface)) return null;
  return `${surface} m²`;
}

/** Options de sélection des catégories à inclure dans le bloc mail (V8.16z). */
export type BlocLotsMailOptions = {
  identification?: boolean;
  occupation?: boolean;
  caracteristiques?: boolean;
  acces?: boolean;
  observations?: boolean;
};

/**
 * Bloc texte multi-lignes injecté dans le MAIL (compact : seules les lignes
 * renseignées sont incluses ; un lot par bloc). Retourne "" si aucune fiche.
 * `options` permet de choisir quelles catégories d'informations apparaissent
 * (par défaut toutes).
 */
export function composerBlocLotsMail(
  fiches: FicheLotDevis[],
  options?: BlocLotsMailOptions,
): string {
  const opt: Required<BlocLotsMailOptions> = {
    identification: options?.identification ?? true,
    occupation: options?.occupation ?? true,
    caracteristiques: options?.caracteristiques ?? true,
    acces: options?.acces ?? true,
    observations: options?.observations ?? true,
  };
  const valides = (fiches ?? []).filter(Boolean);
  if (valides.length === 0) return "";
  const blocs = valides.map((f) => {
    const lignes: string[] = [];
    lignes.push(`INFORMATIONS DU LOT — ${f.code}`);
    if (opt.identification) {
      // Normalise les espaces multiples de l'adresse source (jamais inventé).
      const adresse = (f.adresse ?? "").replace(/\s+/g, " ").trim();
      if (adresse) lignes.push(`Adresse : ${adresse}${f.ville ? `, ${f.ville}` : ""}`);
      if (f.batiment) lignes.push(`Bâtiment : ${f.batiment}`);
      if (f.entree) lignes.push(`Entrée : ${f.entree}`);
      if (f.appartement) lignes.push(`Appartement / local : ${f.appartement}`);
      if (f.etage) lignes.push(`Étage : ${f.etage}`);
      if (f.ville && !adresse) lignes.push(`Ville : ${f.ville}`);
      if (f.tranche) {
        lignes.push(
          `Tranche : ${f.tranche}${f.localite_tranche ? ` — ${f.localite_tranche}` : ""}`,
        );
      }
    }
    if (opt.caracteristiques) {
      const surface = formaterSurface(f.surface);
      if (surface) lignes.push(`Surface : ${surface}`);
      if (f.dpe) lignes.push(`DPE : ${f.dpe}`);
      if (f.nb_pieces.trim()) lignes.push(`Nombre de pièces : ${f.nb_pieces.trim()}`);
    }
    if (opt.occupation) {
      if (f.statut_occupation) {
        lignes.push(
          `Occupation : ${STATUT_OCCUPATION_LABELS[f.statut_occupation] ?? f.statut_occupation}`,
        );
      }
      if (f.locataire_nom) lignes.push(`Locataire : ${f.locataire_nom}`);
      if (f.locataire_telephone) lignes.push(`Téléphone locataire : ${f.locataire_telephone}`);
      if (f.contact_complement.trim())
        lignes.push(`Contact complémentaire : ${f.contact_complement.trim()}`);
    }
    if (opt.acces) {
      if (f.localisation_intervention.trim())
        lignes.push(`Localisation de l'intervention : ${f.localisation_intervention.trim()}`);
      if (f.conditions_acces.trim())
        lignes.push(`Conditions d'accès : ${f.conditions_acces.trim()}`);
      if (f.contraintes.trim()) lignes.push(`Contraintes : ${f.contraintes.trim()}`);
      if (f.creneaux.trim()) lignes.push(`Créneaux / disponibilités : ${f.creneaux.trim()}`);
    }
    if (opt.observations && f.observations.trim()) {
      lignes.push(`Observations : ${f.observations.trim()}`);
    }
    return lignes.join("\n");
  });
  return blocs.join("\n\n");
}
