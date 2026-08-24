import { useEffect, type ReactNode } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

/** Zoom automatique sur l'étendue des points (même mécanique sur toutes les cartes Leaflet). */
export function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (!points.length) return;
    if (points.length === 1) {
      map.setView(points[0]!, 12);
      return;
    }
    map.fitBounds(L.latLngBounds(points), { padding: [42, 42] });
  }, [map, points]);
  return null;
}

/**
 * Coque Leaflet commune (DashboardMap, FournisseurVillesMap) :
 *  - wrapper `relative isolate` → stacking context isolé : les panes/popups/légende de
 *    la carte (z-index internes jusqu'à 700/1000) ne peuvent JAMAIS passer au-dessus d'un
 *    Dialog (z-50) ouvert sur la page. La carte reste entièrement interactive sans dialog.
 *  - MapContainer + tuiles OSM + FitBounds partagés.
 *  - `overlay` : légende / message superposé (rendu dans le wrapper, au-dessus de la carte).
 */
export default function LeafletMapShell({
  points,
  overlay,
  children,
}: {
  points: [number, number][];
  overlay?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="relative isolate h-full w-full">
      <MapContainer
        center={[48.8566, 2.3522]}
        zoom={9}
        style={{ height: "100%", width: "100%" }}
        zoomControl={false}
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <FitBounds points={points} />
        {children}
      </MapContainer>
      {overlay}
    </div>
  );
}
