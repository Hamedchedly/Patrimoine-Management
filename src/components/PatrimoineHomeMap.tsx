import { lazy, Suspense, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { cleAdresse, entreeDe, estGarage, type LotItem } from "@/lib/adresses";

/* ------------------------------------------------------------------ *
 * Agrégation pure du patrimoine pour la carte d'accueil (niveau 1 :
 * une entrée par VILLE ; niveau 2 : une entrée par ADRESSE).
 * Les garages (estGarage) sont comptés séparément et JAMAIS dans `lots`.
 * ------------------------------------------------------------------ */
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

/* ------------------------------------------------------------------ *
 * AUTO-TESTS (développement uniquement) — agregerPatrimoineHome / adressesDeVille.
 * Exécutés au chargement du module quand Vite tourne en mode dev ; éliminés du build.
 * ------------------------------------------------------------------ */
if (import.meta.env.DEV) {
  const lt = (
    code: string,
    type: string | null,
    adresse: string | null,
    ville: string | null,
    tranche = "1400",
  ) =>
    ({
      code_patrimoine: code,
      tranche_code: tranche,
      type_lot: type,
      batiment: null,
      etage: null,
      porte: null,
      surface_utile: null,
      dpe: null,
      ville,
      code_postal: "77700",
      adresse,
      locataire_nom: null,
    }) as LotItem;

  const lotsTest = [
    // CHESSY — A1 (localisée) : 3 lots + 2 garages (tranche 1001) ; A2 (NON localisée) :
    //           2 lots + 1 garage (tranche 1002) ; A3 (localisée) : 1 lot + 1 garage (tranche 1003).
    lt("ER.0001", "1", "6/8/10 PLACE DES CORNILLES", "CHESSY", "1001"),
    lt("ER.0002", "2", "6/8/10 PLACE DES CORNILLES", "CHESSY", "1001"),
    lt("ER.0003", "2", "6/8/10 PLACE DES CORNILLES", "CHESSY", "1005"),
    lt("ER.G0001", "PAR", "6/8/10 PLACE DES CORNILLES", "CHESSY", "1001"),
    lt("ER.G0002", "GAR", "6/8/10 PLACE DES CORNILLES", "CHESSY", "1001"),
    lt("ER.0004", "1", "15 RUE DE PARIS", "CHESSY", "1002"),
    lt("ER.0005", "1", "15 RUE DE PARIS", "CHESSY", "1002"),
    lt("ER.G0003", "BOX", "15 RUE DE PARIS", "CHESSY", "1002"),
    lt("ER.0006", "1", "2 AVENUE DU GENERAL", "CHESSY", "1003"),
    lt("ER.G0004", "MOT", "2 AVENUE DU GENERAL", "CHESSY", "1003"),
    // SERRIS — 1 adresse localisée : 2 lots, 0 garage.
    lt("ER.0101", "1", "12 RUE DE LA GARE", "SERRIS", "1400"),
    lt("ER.0102", "1", "12 RUE DE LA GARE", "SERRIS", "1400"),
    // NANGIS — ville absente du cache d'adresses → ville non localisée.
    lt("ER.0201", "1", "1 RUE DE NANGIS", "NANGIS", "2001"),
    // Lots non rattachables → ignorés proprement.
    lt("ER.0301", "1", null, "CHESSY"),
    lt("ER.0302", "1", "10 RUE X", null),
  ];

  const geoTest = [
    { cle: "6/8/10 PLACE DES CORNILLES|CHESSY", lat: 48.876, lng: 2.769 },
    { cle: "2 AVENUE DU GENERAL|CHESSY", lat: 48.877, lng: 2.77 },
    { cle: "12 RUE DE LA GARE|SERRIS", lat: 48.851, lng: 2.775 },
  ];

  const t = agregerPatrimoineHome(lotsTest, geoTest);
  const assertHome = (name: string, cond: boolean) => {
    if (!cond) throw new Error(`PatrimoineHomeMap self-test FAIL — ${name}`);
    // eslint-disable-next-line no-console
    console.log(`PASS  ${name}`);
  };

  assertHome(
    "P1 plusieurs adresses d'une même ville → UN seul marker ville (CHESSY)",
    t.villes.filter((v) => v.ville === "CHESSY").length === 1,
  );
  const chessy = t.villes.find((v) => v.ville === "CHESSY");
  assertHome("P2 nombre d'adresses distinctes = 3 (CHESSY)", chessy?.adresses === 3);
  assertHome("P3 lots hors garages = 6 (CHESSY : 3 + 2 + 1)", chessy?.lots === 6);
  assertHome("P4 garages comptés séparément = 4 (CHESSY : 2 + 1 + 1)", chessy?.garages === 4);
  assertHome(
    "P5 clic ville → adressesDeVille(CHESSY) = ses 2 adresses localisées",
    adressesDeVille(t.adresses, "CHESSY").length === 2,
  );
  const a1 = t.adresses.find((a) => a.adresse === "6/8/10 PLACE DES CORNILLES");
  assertHome("P6 adresse A1 → 3 lots / 2 garages", a1?.lots === 3 && a1?.garages === 2);
  assertHome("P7 retour villes → niveau 1 restauré (2 villes localisées)", t.villes.length === 2);
  assertHome(
    "P8 adresse sans coordonnées → comptée sans erreur (2 adresses, 1 ville)",
    t.nonGeolocaliseesAdresses === 2 && t.villesNonLocalisees === 1,
  );
  assertHome(
    "P8b SERRIS → 1 adresse / 2 lots / 0 garage",
    t.villes.find((v) => v.ville === "SERRIS")?.lots === 2,
  );
  assertHome("P9 CHESSY → 4 tranches distinctes (1001/1002/1003/1005)", chessy?.tranches === 4);
  assertHome(
    "P9b adresse A1 → tranche la plus représentée (1001) / rue brute conservée",
    a1?.tranche === "1001" && a1?.rue === "6/8/10 PLACE DES CORNILLES",
  );
  assertHome(
    "P9d adresse multi-tranches → répartition 1001 (2 lots/2 garages) + 1005 (1 lot)",
    a1?.tranches.length === 2 &&
      a1?.tranches.find((t) => t.code === "1001")?.lots === 2 &&
      a1?.tranches.find((t) => t.code === "1001")?.garages === 2 &&
      a1?.tranches.find((t) => t.code === "1005")?.lots === 1,
  );
  assertHome("P9c SERRIS → 1 tranche", t.villes.find((v) => v.ville === "SERRIS")?.tranches === 1);
}

/** Chargement de la carte (placeholder rendu serveur / pendant le chargement du module Leaflet). */
function MapLoading() {
  return (
    <div className="flex h-[420px] items-center justify-center gap-2 rounded-xl border bg-card text-sm text-muted-foreground shadow-panel">
      <Loader2 className="size-4 animate-spin" /> Chargement de la carte…
    </div>
  );
}

/**
 * Carte du patrimoine de la PAGE D'ACCUEIL — même style que la carte du Dashboard
 * (Leaflet + OpenStreetMap, cercles colorés par ville). Deux niveaux :
 * - Niveau 1 : UN cercle par VILLE (barycentre des adresses localisées), rayon et couleur
 *   proportionnels au nombre de lots ; clic → zoom sur la ville (niveau 2).
 * - Niveau 2 : UN petit cercle par ADRESSE localisée ; clic → fiche de la ville dans /adresses.
 *   Bouton « ← Toutes les villes » pour revenir.
 * Les garages (estGarage) sont comptés séparément, jamais dans `lots`.
 * Les villes/adresses sans coordonnées sont comptées, jamais déplacées ni inventées.
 * Le rendu Leaflet est chargé paresseusement côté client (react-leaflet est incompatible SSR).
 */
const PatrimoineHomeMapLeaflet = lazy(() => import("@/components/PatrimoineHomeMapLeaflet"));

export function PatrimoineHomeMap({ lots }: { lots?: LotItem[] }) {
  const [isClient, setIsClient] = useState(false);
  useEffect(() => setIsClient(true), []);
  if (!isClient) return <MapLoading />;
  return (
    <Suspense fallback={<MapLoading />}>
      <PatrimoineHomeMapLeaflet lots={lots} />
    </Suspense>
  );
}
