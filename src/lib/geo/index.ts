/**
 * Géocodage pur (sans dépendance serveur) — Base Adresse Nationale (data.gouv.fr)
 * en priorité, repli Photon / Komoot (OpenStreetMap).
 * Séparé de `geo.functions.ts` pour être importable dans les scripts et les tests.
 */

/** Normalisation d'un nom de ville : accents, casse et séparateurs ignorés. */
export const normaliserVille = (s: string): string =>
  (s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\s'’.-]+/g, "");

/**
 * Une ville retournée par le géocodeur « correspond-elle » à la ville demandée ?
 * Comparaison par inclusion réciproque des noms normalisés (ex. « Chessy » ⊂
 * « Chessy-en-France », « Sucy-en-Brie » ~ « sucyenbrie »). Retourne false si l'un
 * des deux noms est vide — on ne géocode jamais « à l'aveugle ».
 */
export const villeCorrespond = (demandee: string, retournee: string): boolean => {
  const d = normaliserVille(demandee);
  const r = normaliserVille(retournee);
  return d.length > 0 && r.length > 0 && (r.includes(d) || d.includes(r));
};

export type GeoPoint = { lat: number | null; lng: number | null; statut: string };

/**
 * Requête de géocodage "adresse, ville, France" assainie : data.gouv exige que `q` commence
 * par une lettre ou un chiffre (sinon HTTP 400 « Failed parsing query »). Certaines adresses
 * du patrimoine débutent par un point parasite (`. AV. GENERAL DE GAULLE…`) → on retire tout
 * caractère non alphanumérique initial.
 */
const queryAdresse = (adresse: string, ville: string): string =>
  `${adresse}, ${ville}, France`.replace(/^[^A-Za-z0-9À-ÿ]+/, "");

/**
 * Géocodage via Photon (Komoot, données OpenStreetMap) — aucune clé API requise.
 * Google Geocoding renvoyait `REQUEST_DENIED` sur ce projet (coordonnées nulles écrites en
 * cache) et Nominatim public est limité (HTTP 429). Photon est fiable, JSON, sans quota.
 *
 * V8.16h — VALIDATION PAR COMMUNE : Photon peut IGNORER la ville et renvoyer un homonyme
 * d'une autre région (ex. « 13 RUE DES PETITS CHAMPS, CHESSY » → Charny, Yonne ; « PSG DES
 * ECOLES, CHESSY » → Villiers-au-Bouin, Centre). Tout résultat dont la commune retournée
 * ne correspond PAS à la ville demandée est REFUSÉ (coordonnées nulles, statut
 * « VILLE_DIFFERENTE ») — pour ne JAMAIS stocker de fausses coordonnées (cercles de carte
 * placés sur de mauvaises villes).
 */
export async function geocodePhoton(item: { adresse: string; ville: string }): Promise<GeoPoint> {
  const query = queryAdresse(item.adresse, item.ville);
  const res = await fetch(
    `https://photon.komoot.io/api/?limit=1&lang=fr&q=${encodeURIComponent(query)}`,
  );
  if (!res.ok) throw new Error(`Photon rejected [${res.status}]`);
  const json = (await res.json()) as {
    features?: Array<{
      geometry?: { coordinates?: [number, number] };
      properties?: { city?: string; name?: string };
    }>;
  };
  const f = json.features?.[0];
  const coords = f?.geometry?.coordinates;
  if (!coords) return { lat: null, lng: null, statut: "ZERO_RESULTS" };
  const communeRetournee = f.properties?.city ?? f.properties?.name ?? "";
  if (!villeCorrespond(item.ville, communeRetournee)) {
    return { lat: null, lng: null, statut: "VILLE_DIFFERENTE" };
  }
  return { lat: coords[1], lng: coords[0], statut: "ok" };
}

/**
 * Géocodage via la Base Adresse Nationale (api-adresse.data.gouv.fr) — référentiel OFFICIEL
 * français (adresses du patrimoine toutes en Île-de-France), gratuit, sans clé, quota très
 * généreux. Même validation par commune que Photon (voir `villeCorrespond`).
 *
 * V8.16h — SCAN limit=5 : le 1er résultat d'data.gouv est souvent un HOMONYME d'une autre
 * région (ex. « 18 PLACE DE L'EGLISE, MESSY » → Lessy/Moselle ; « 13 RUE D'ENGEN, TRILPORT »
 * → Fublaines) alors qu'un résultat correct existe plus bas. On parcourt les 5 premiers et on
 * prend le PREMIER dont la commune correspond à la ville demandée. Si aucun ne correspond,
 * on refuse (coordonnées nulles, statut « VILLE_DIFFERENTE ») — jamais de fausse coordonnée.
 */
export async function geocodeDataGouv(item: { adresse: string; ville: string }): Promise<GeoPoint> {
  const query = queryAdresse(item.adresse, item.ville);
  const res = await fetch(
    `https://api-adresse.data.gouv.fr/search/?limit=5&q=${encodeURIComponent(query)}`,
  );
  if (!res.ok) throw new Error(`data.gouv rejected [${res.status}]`);
  const json = (await res.json()) as {
    features?: Array<{
      geometry?: { coordinates?: [number, number] };
      properties?: { city?: string; name?: string };
    }>;
  };
  const features = json.features ?? [];
  for (const f of features) {
    const coords = f?.geometry?.coordinates;
    if (!coords) continue;
    const communeRetournee = f.properties?.city ?? f.properties?.name ?? "";
    if (!villeCorrespond(item.ville, communeRetournee)) continue;
    // data.gouv renvoie [lng, lat].
    return { lat: coords[1], lng: coords[0], statut: "ok" };
  }
  return features.length
    ? { lat: null, lng: null, statut: "VILLE_DIFFERENTE" }
    : { lat: null, lng: null, statut: "ZERO_RESULTS" };
}

/**
 * Géocodage combiné : Base Adresse Nationale en priorité (fiable pour la France), repli
 * Photon en cas d'échec réseau d'data.gouv. Un résultat hors commune (VILLE_DIFFERENTE)
 * d'data.gouv est définitif (référentiel officiel) — pas de repli Photon.
 * Lève une erreur réseau si les DEUX services sont injoignables (l'appelant garde alors
 * l'ancienne coordonnée en cache).
 */
export async function geocode(item: { adresse: string; ville: string }): Promise<GeoPoint> {
  try {
    const p = await geocodeDataGouv(item);
    if (p.statut !== "ZERO_RESULTS") return p;
    // data.gouv sans résultat → repli Photon (OSM couvre parfois plus large).
  } catch {
    // data.gouv injoignable → repli Photon.
  }
  return geocodePhoton(item);
}

/**
 * Géocodage du CENTRE d'une commune (référentiel `villes_geo` du Dashboard Travaux) via la
 * Base Adresse Nationale (`type=municipality` → centroïde INSEE de la commune). Même
 * validation par commune que les adresses : un résultat hors commune est refusé.
 */
export async function geocodeVilleDataGouv(item: { ville: string }): Promise<GeoPoint> {
  const res = await fetch(
    `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(
      item.ville,
    )}&type=municipality&limit=1`,
  );
  if (!res.ok) throw new Error(`data.gouv rejected [${res.status}]`);
  const json = (await res.json()) as {
    features?: Array<{
      geometry?: { coordinates?: [number, number] };
      properties?: { city?: string; name?: string };
    }>;
  };
  const f = json.features?.[0];
  const coords = f?.geometry?.coordinates;
  if (!coords) return { lat: null, lng: null, statut: "ZERO_RESULTS" };
  const communeRetournee = f.properties?.city ?? f.properties?.name ?? "";
  if (!villeCorrespond(item.ville, communeRetournee)) {
    return { lat: null, lng: null, statut: "VILLE_DIFFERENTE" };
  }
  // data.gouv renvoie [lng, lat].
  return { lat: coords[1], lng: coords[0], statut: "ok" };
}
