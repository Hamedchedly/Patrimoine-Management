export type LotItem = {
  code_patrimoine: string;
  tranche_code: string;
  type_lot: string | null;
  batiment: string | null;
  etage: string | null;
  porte: string | null;
  surface_utile: number | null;
  dpe: string | null;
  ville: string | null;
  code_postal: string | null;
  adresse: string | null;
  locataire_nom: string | null;
  locataire_telephone?: string | null;
  locataire_email?: string | null;
  date_entree?: string | null;
};

/** Garages, boxes et parkings : code lot en ER.G… ou type PAR/GAR/BOX/MOT. */
export function estGarage(lot: Pick<LotItem, "code_patrimoine" | "type_lot">) {
  if (/^ER\.G/i.test(lot.code_patrimoine)) return true;
  return ["PAR", "GAR", "BOX", "MOT"].includes((lot.type_lot ?? "").toUpperCase());
}

export const collator = new Intl.Collator("fr", { numeric: true, sensitivity: "base" });

/** « 25-27  RUE DE RUZE » → « RUE DE RUZE » : on retire le numéro pour regrouper la rue. */
export function rueDe(adresse: string | null) {
  const a = (adresse ?? "").replace(/\s+/g, " ").trim();
  if (!a) return "Adresse inconnue";
  const m = a.match(/^[\d.\-/]+\s*(BIS|TER|QUATER)?\s+(.*)$/i);
  return (m?.[2] ?? a).trim();
}

export function entreeDe(adresse: string | null) {
  return (adresse ?? "").replace(/\s+/g, " ").trim() || "Entrée inconnue";
}

export const cleAdresse = (adresse: string, ville: string) =>
  `${adresse.replace(/\s+/g, " ").trim()}|${ville.trim()}`.toUpperCase();

export type AdresseParTranche = {
  code: string;
  adresses: { adresse: string; lots: number }[];
  nbAdresses: number;
  nbLots: number;
};

/**
 * Regroupement des adresses par tranche (page /adresses, niveau ville).
 * `tranches` = hiérarchie { codeTranche: { adresse: LotItem[] } } déjà filtrée des garages
 * masqués : une tranche sans adresse visible n'apparaît pas.
 */
export function adressesParTranche(
  tranches: Record<string, Record<string, LotItem[]>>,
): AdresseParTranche[] {
  return Object.entries(tranches)
    .map(([code, rues]) => {
      const adresses = Object.entries(rues).map(([adresse, lots]) => ({
        adresse,
        lots: lots.length,
      }));
      return {
        code,
        adresses,
        nbAdresses: adresses.length,
        nbLots: adresses.reduce((s, a) => s + a.lots, 0),
      };
    })
    .filter((g) => g.nbAdresses > 0);
}

/**
 * Normalisation unique de recherche : majuscules, accents retirés, tirets/ponctuation → espace,
 * espaces superflus supprimés. Permet de comparer « othis »=« OTHIS », « é »=« e »,
 * « Plessis-Trévise »=« PLESSIS TREVISE ».
 */
export function normaliserRecherche(value: string | null | undefined): string {
  return (value ?? "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

/**
 * Motif de recherche avec joker « * » = n'importe quelle suite de caractères.
 * - Sans « * » : correspondance « contient » (comportement historique, « PARIS »).
 * - Avec « * » : le joker généralise la recherche, ex. « PLESS* » → « PLESSIS TREVISE »,
 *   « RUE DE * » → « RUE DE PARIS », « *CARRE* » → n'importe où dans le libellé.
 * Retourne null quand le terme est vide (aucun résultat).
 */
export function motifRechercheRegex(terme: string | null | undefined): RegExp | null {
  const norm = (terme ?? "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9*]+/g, " ")
    .trim();
  if (!norm) return null;
  const echapper = (part: string) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!norm.includes("*")) {
    return new RegExp(echapper(norm));
  }
  // Mode joker : « * » devient « .* » (toute suite de caractères, y compris vide).
  return new RegExp(norm.split("*").map(echapper).join(".*"));
}

export type ResultatVille = { ville: string; tranches: number; lots: number };
export type ResultatAdresse = {
  adresse: string;
  ville: string;
  tranche: string;
  lots: number;
};
export type ResultatLocataire = {
  nom: string;
  adresse: string;
  ville: string;
  tranche: string;
};
export type ResultatEr = {
  code: string;
  adresse: string;
  ville: string;
  tranche: string;
};
/** V8.16q — tranche dont le numéro correspond à la recherche (regroupée par ville). */
export type ResultatTranche = {
  tranche: string;
  ville: string;
  lots: number;
};
export type ResultatsRecherche = {
  villes: ResultatVille[];
  adresses: ResultatAdresse[];
  locataires: ResultatLocataire[];
  ers: ResultatEr[];
  /** V8.16q — tranches dont le numéro correspond (regroupées par tranche). */
  tranches: ResultatTranche[];
};

/**
 * Libellé de la date d'un travail (modal « Travaux » historique).
 * Règle stricte : date_demarrage → sinon date_fin_travaux (« Fin : … ») → sinon
 * date_communication (« Comm. : … ») → sinon « Date non précisée ».
 * `annee_exercice` n'est JAMAIS une date : elle ne sert qu'au regroupement annuel.
 */
export function libelleDateTravail(
  dateDemarrage: string | null | undefined,
  dateFinTravaux: string | null | undefined,
  dateCommunication: string | null | undefined,
): string {
  const fmt = (v: string) => {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString("fr-FR");
  };
  if (dateDemarrage) return fmt(dateDemarrage);
  if (dateFinTravaux) return `Fin : ${fmt(dateFinTravaux)}`;
  if (dateCommunication) return `Comm. : ${fmt(dateCommunication)}`;
  return "Date non précisée";
}

/** Montant fr-FR (négatifs conservés — jamais Math.abs). */
export function formatMontantTravaux(v: number | null | undefined): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v || 0);
}

/** Libellé du nombre de commandes de travaux : « 1 commande de travaux », « 3 commandes de travaux »… */
export function libelleNbCommandesTravaux(n: number): string {
  return `${n} commande${n > 1 ? "s" : ""} de travaux`;
}

/**
 * Recherche hiérarchique du patrimoine, multi-catégories (jamais exclusive) :
 *  1. VILLES    — dans le référentiel des villes (getVilles, hors lots filtrés) ;
 *  2. ADRESSES  — lots dont l'adresse contient le terme (regroupées par adresse) ;
 *  3. LOCATAIRES— lots dont le locataire contient le terme (avec contexte d'adresse) ;
 *  4. ER        — lots dont l'identifiant patrimoine (code_patrimoine, ex. ER.123456)
 *                contient le terme (ouvre la fiche logement).
 * Matching « contient », insensible casse/accents/tirets/espaces. Le symbole « * » signifie
 * « n'importe quelle suite de caractères » (glob, ex. « PLESS* », « RUE DE * », « *PARIS »).
 * Terme vide → aucun résultat. `lots` doivent déjà respecter le filtre `showGarages`.
 */
export function rechercherPatrimoine(
  terme: string,
  lots: LotItem[],
  villes: { ville: string; tranches: number; lots: number }[],
): ResultatsRecherche {
  const regex = motifRechercheRegex(terme);
  if (!regex) return { villes: [], adresses: [], locataires: [], ers: [], tranches: [] };

  const villesTrouvees: ResultatVille[] = villes
    .filter((v) => regex.test(normaliserRecherche(v.ville)))
    .map((v) => ({ ville: v.ville, tranches: v.tranches, lots: v.lots }));

  const adresses = new Map<string, ResultatAdresse>();
  const locataires = new Map<string, ResultatLocataire>();
  const ers: ResultatEr[] = [];
  const tranches = new Map<string, ResultatTranche>();

  for (const lot of lots) {
    const erNorm = normaliserRecherche(lot.code_patrimoine);
    if (erNorm && regex.test(erNorm)) {
      ers.push({
        code: lot.code_patrimoine,
        adresse: lot.adresse ?? "Adresse inconnue",
        ville: lot.ville ?? "",
        tranche: lot.tranche_code ?? "",
      });
    }
    // V8.16q — recherche par numéro de tranche (ex. « 2293 », « 14* »).
    const trNorm = normaliserRecherche(lot.tranche_code);
    if (trNorm && regex.test(trNorm)) {
      const cleT = `${lot.tranche_code}|${lot.ville ?? ""}`;
      const g = tranches.get(cleT) ?? {
        tranche: lot.tranche_code ?? "",
        ville: lot.ville ?? "",
        lots: 0,
      };
      g.lots += 1;
      tranches.set(cleT, g);
    }
    const adrNorm = normaliserRecherche(lot.adresse);
    if (adrNorm && regex.test(adrNorm)) {
      const cle = `${lot.ville}|${lot.tranche_code}|${adrNorm}`;
      const g = adresses.get(cle) ?? {
        adresse: lot.adresse ?? "Adresse inconnue",
        ville: lot.ville ?? "",
        tranche: lot.tranche_code ?? "",
        lots: 0,
      };
      g.lots += 1;
      adresses.set(cle, g);
    }
    const nomNorm = normaliserRecherche(lot.locataire_nom);
    if (nomNorm && regex.test(nomNorm)) {
      const cleLoc = `${nomNorm}|${lot.ville}|${lot.tranche_code}|${adrNorm}`;
      if (!locataires.has(cleLoc)) {
        locataires.set(cleLoc, {
          nom: lot.locataire_nom ?? "",
          adresse: lot.adresse ?? "Adresse inconnue",
          ville: lot.ville ?? "",
          tranche: lot.tranche_code ?? "",
        });
      }
    }
  }

  ers.sort((a, b) => a.code.localeCompare(b.code, "fr", { numeric: true }));

  return {
    villes: villesTrouvees,
    adresses: [...adresses.values()],
    locataires: [...locataires.values()],
    ers,
    tranches: [...tranches.values()].sort((a, b) =>
      a.tranche.localeCompare(b.tranche, "fr", { numeric: true }),
    ),
  };
}

/* ---------- Recherches récentes (local) ---------- */

export type RecentAdresse = { rue: string; ville: string; lots: number; at: number };

const RECENTS_KEY = "patrimoine-recents-v1";

export function loadRecents(): RecentAdresse[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    const parsed = raw ? (JSON.parse(raw) as RecentAdresse[]) : [];
    return Array.isArray(parsed) ? parsed.slice(0, 5) : [];
  } catch {
    return [];
  }
}

export function pushRecent(entry: Omit<RecentAdresse, "at">) {
  if (typeof window === "undefined") return;
  const others = loadRecents().filter((r) => !(r.rue === entry.rue && r.ville === entry.ville));
  const next = [{ ...entry, at: Date.now() }, ...others].slice(0, 5);
  window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
}

/* ---------- Locataire actuel (source de vérité : table `occupants`) ---------- */

/**
 * Occupant tel que renvoyé par `getOccupants` (table `occupants`).
 * `date_sortie` est RÉSERVÉE à une future colonne — elle n'existe pas dans le
 * modèle actuel (vérifié en base). Le helper la traite dès qu'elle apparaîtra,
 * sans migration ni changement aujourd'hui.
 */
export type OccupantActuel = {
  id: string;
  lot_code: string;
  nom: string | null;
  prenom: string | null;
  date_naissance: string | null;
  date_entree: string | null;
  created_at: string | null;
  date_sortie?: string | null;
};

/** Nom d'affichage « PRENOM NOM » (même format partout). null → « — ». */
export function nomCompletOccupant(
  o: Pick<OccupantActuel, "nom" | "prenom"> | null | undefined,
): string {
  return [o?.prenom, o?.nom].filter(Boolean).join(" ") || "—";
}

/**
 * Règle « locataire actuel » — UNIQUE fonction de référence (fiche logement,
 * fiche locataire, liste des occupants).
 *
 *  1. occupants avec une `date_entree` renseignée ;
 *  2. si `date_sortie` est présente : elle doit être >= aujourd'hui
 *     (une sortie passée exclut l'occupant) ;
 *  3. parmi les candidats : `date_entree` la plus récente ;
 *  4. tie-break : `nom` ASC ;
 *  5. `[]` → null.
 *
 * Aucune dépendance à l'ordre SQL : le tri est explicite en mémoire.
 * `options.aujourdHui` permet un test déterministe (défaut : date du jour).
 */
export function determinerLocataireActuel(
  occupants: OccupantActuel[],
  options?: { aujourdHui?: string },
): OccupantActuel | null {
  const aujourdHui = options?.aujourdHui ?? new Date().toISOString().slice(0, 10);
  const candidats = occupants
    .filter((o) => typeof o.date_entree === "string" && o.date_entree.trim() !== "")
    .filter((o) => {
      const sortie = typeof o.date_sortie === "string" ? o.date_sortie.trim() : "";
      if (!sortie) return true;
      return sortie >= aujourdHui;
    });
  if (candidats.length === 0) return null;
  return (
    [...candidats].sort((a, b) => {
      const da = String(a.date_entree);
      const db = String(b.date_entree);
      if (da !== db) return da < db ? 1 : -1; // date_entree DESC
      return collator.compare(String(a.nom ?? ""), String(b.nom ?? ""));
    })[0] ?? null
  );
}

/** Search d'/adresses (route à validateSearch) — helper partagé (Phase 6B).
 *  Normalise la construction des liens vers /adresses (q / ville / tranche / rue / adresse
 *  / retour). `retour` porte la provenance (ex. fournisseurId) pour un retour contextuel. */
export function construireSearchAdresses(p: {
  q?: string | null | undefined;
  ville?: string | null | undefined;
  tranche?: string | null | undefined;
  rue?: string | null | undefined;
  adresse?: string | null | undefined;
  retour?: string | null | undefined;
}): {
  q: string | undefined;
  ville: string | undefined;
  tranche: string | undefined;
  rue: string | undefined;
  adresse: string | undefined;
  retour: string | undefined;
} {
  return {
    q: p.q ?? undefined,
    ville: p.ville ?? undefined,
    tranche: p.tranche ?? undefined,
    rue: p.rue ?? undefined,
    adresse: p.adresse ?? undefined,
    retour: p.retour ?? undefined,
  };
}
