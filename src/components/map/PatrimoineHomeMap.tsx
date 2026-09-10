import { lazy, Suspense, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import type { LotItem } from "@/lib/adresses";

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
 * Le calcul d'agrégation vit dans @/lib/patrimoine.home (testé dans tests/patrimoine-home.test.ts).
 */
const PatrimoineHomeMapLeaflet = lazy(() => import("@/components/map/PatrimoineHomeMapLeaflet"));

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
