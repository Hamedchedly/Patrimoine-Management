/**
 * Agrégation pure du patrimoine pour la carte d'accueil (niveau 1 : une entrée
 * par VILLE ; niveau 2 : une entrée par ADRESSE).
 *
 * Les garages (estGarage) sont comptés séparément et JAMAIS dans `lots`.
 * Ce module est sans dépendance React : il est testable directement
 * (voir tests/patrimoine-home.test.ts).
 */
import { cleAdresse, entreeDe, estGarage, type LotItem } from "./adresses.ts";

export type AdresseHome = {
  cle: string;
  ville: string;
  adresse: string;
  /** Adresse brute telle que stockée — valeur du paramètre `rue` de /adresses. */
  rue: string;
  /** Code de tranche (le plus représenté pour cette adresse) — paramètre `tranche` de /adresses. */
  tranche: string;
  /** Répartition des lots/garages par tranche (triée par importance décroissante). */
  tranches: { code: string; lots: number; garages: number }[];
  codePostal: string | null;
  lots: number;
  garages: number;
};

export type VilleHome = {
  ville: string;
  adresses: number;
  lots: number;
  garages: number;
  /** Nombre de tranches distinctes rattachées à la ville. */
  tranches: number;
  /** Somme des lat/lng des adresses localisées (barycentre = position de la ville). */
  lat: number;
  lng: number;
  /** Nombre d'adresses localisées de la ville. */
  n: number;
};

export type AdressesGeoApercu = {
  cle: string;
  lat?: number | null;
  lng?: number | null;
  /** Statut du géocodage en cache (ok | VILLE_DIFFERENTE | ZERO_RESULTS). */
  statut?: string | null;
};

export type PatrimoineHomeData = {
  villes: VilleHome[];
  adresses: AdresseHome[];
  nonGeolocaliseesAdresses: number;
  villesNonLocalisees: number;
};

export function agregerPatrimoineHome(
  lots: LotItem[],
  adressesGeo: AdressesGeoApercu[],
): PatrimoineHomeData {
  const connues = new Map(adressesGeo.map((g) => [g.cle, g]));

  // Regroupement par adresse (clé identique à adresses_geo : adresse + ville).
  // `rue` = adresse brute (telle que stockée), `tranche` = code de tranche le plus représenté.
  const parAdresse = new Map<string, AdresseHome>();
  const tranchesParAdresse = new Map<string, Map<string, { lots: number; garages: number }>>();
  const tranchesParVille = new Map<string, Set<string>>();
  for (const l of lots) {
    if (!l.adresse || !l.ville) continue;
    const adresse = entreeDe(l.adresse);
    const cle = cleAdresse(adresse, l.ville);
    const g = parAdresse.get(cle) ?? {
      cle,
      ville: l.ville,
      adresse,
      rue: l.adresse,
      tranche: l.tranche_code ?? "",
      tranches: [],
      codePostal: l.code_postal,
      lots: 0,
      garages: 0,
    };
    if (estGarage(l)) g.garages += 1;
    else g.lots += 1;
    if (l.tranche_code) {
      const m = tranchesParAdresse.get(cle) ?? new Map<string, { lots: number; garages: number }>();
      const entry = m.get(l.tranche_code) ?? { lots: 0, garages: 0 };
      if (estGarage(l)) entry.garages += 1;
      else entry.lots += 1;
      m.set(l.tranche_code, entry);
      tranchesParAdresse.set(cle, m);
      const s = tranchesParVille.get(l.ville) ?? new Set<string>();
      s.add(l.tranche_code);
      tranchesParVille.set(l.ville, s);
    }
    parAdresse.set(cle, g);
  }

  // Répartition par tranche (triée par importance) + tranche cible pour la navigation.
  for (const [cle, g] of parAdresse) {
    const m = tranchesParAdresse.get(cle);
    if (m && m.size) {
      const rows = [...m.entries()]
        .map(([code, v]) => ({ code, lots: v.lots, garages: v.garages }))
        .sort((a, b) => b.lots + b.garages - (a.lots + a.garages) || a.code.localeCompare(b.code));
      g.tranches = rows;
      g.tranche = rows[0]!.code;
    }
  }

  // Agrégation par ville + barycentre des adresses localisées.
  const villesMap = new Map<string, VilleHome>();
  let nonGeolocaliseesAdresses = 0;
  for (const a of parAdresse.values()) {
    const point = connues.get(a.cle);
    const v = villesMap.get(a.ville) ?? {
      ville: a.ville,
      adresses: 0,
      lots: 0,
      garages: 0,
      tranches: 0,
      lat: 0,
      lng: 0,
      n: 0,
    };
    v.adresses += 1;
    v.lots += a.lots;
    v.garages += a.garages;
    if (point?.lat && point?.lng) {
      v.lat += point.lat;
      v.lng += point.lng;
      v.n += 1;
    } else {
      nonGeolocaliseesAdresses += 1;
    }
    villesMap.set(a.ville, v);
  }

  for (const v of villesMap.values()) {
    v.tranches = tranchesParVille.get(v.ville)?.size ?? 0;
  }

  const villes = [...villesMap.values()].filter((v) => v.n > 0);
  const villesNonLocalisees = villesMap.size - villes.length;
  const adresses = [...parAdresse.values()].filter((a) => {
    const p = connues.get(a.cle);
    return !!p?.lat && !!p?.lng;
  });

  return { villes, adresses, nonGeolocaliseesAdresses, villesNonLocalisees };
}

/** Adresses d'une ville (niveau 2) — liste localisée, triée par adresse. */
export function adressesDeVille(adresses: AdresseHome[], ville: string): AdresseHome[] {
  return adresses
    .filter((a) => a.ville === ville)
    .sort((a, b) => a.adresse.localeCompare(b.adresse));
}
