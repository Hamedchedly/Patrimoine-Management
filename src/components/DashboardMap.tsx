import { useMemo } from "react";
import { CircleMarker, Popup } from "react-leaflet";

import { moneyCents } from "@/lib/formats";
import LeafletMapShell from "@/components/LeafletMapShell";

export type VilleAmount = {
  ville: string;
  lat: number;
  lng: number;
  value: number;
  count: number;
  paye: number;
};

/** Teinte HSL : 60 = jaune (faible investissement), 0 = rouge (fort investissement). */
function colorFor(t: number) {
  const hue = Math.round((1 - Math.min(1, Math.max(0, t))) * 60);
  return `hsl(${hue}, 90%, 50%)`;
}

export default function DashboardMap({
  dataVilles,
  missing = 0,
}: {
  dataVilles: VilleAmount[];
  missing?: number;
}) {
  const max = useMemo(() => Math.max(0, ...dataVilles.map((d) => d.value)), [dataVilles]);
  const points = useMemo(
    () => dataVilles.map((d) => [d.lat, d.lng] as [number, number]),
    [dataVilles],
  );

  return (
    <LeafletMapShell
      points={points}
      overlay={
        /* Légende : investissement faible (jaune) → élevé (rouge) */
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-[1000] rounded-xl border border-slate-200 bg-white/95 px-4 py-2 shadow-lg backdrop-blur">
          <div className="flex items-center gap-2">
            <span className="text-[8px] font-black uppercase tracking-widest text-slate-400">
              Peu investi
            </span>
            <div
              className="h-2 w-32 rounded-full"
              style={{
                background: "linear-gradient(90deg, #facc15 0%, #f97316 50%, #ef4444 100%)",
              }}
            />
            <span className="text-[8px] font-black uppercase tracking-widest text-slate-400">
              Très investi
            </span>
          </div>
          {missing > 0 && (
            <p className="mt-1 text-center text-[8px] font-bold text-amber-600">
              {missing} ville{missing > 1 ? "s" : ""} non localisée{missing > 1 ? "s" : ""}
            </p>
          )}
        </div>
      }
    >
      {dataVilles.map((d) => {
        const t = max > 0 ? d.value / max : 0;
        const color = colorFor(t);
        const radius = 8 + t * 7;
        return (
          <CircleMarker
            key={d.ville}
            center={[d.lat, d.lng]}
            radius={radius}
            pathOptions={{
              fillColor: color,
              fillOpacity: 0.9,
              color: "rgba(15, 23, 42, 0.55)",
              weight: 1.5,
            }}
          >
            <Popup>
              <div className="p-2 font-sans">
                <p className="text-[10px] font-black uppercase text-slate-400 mb-1">{d.ville}</p>
                <p className="text-xs font-black text-slate-700">
                  {d.count} commande{d.count > 1 ? "s" : ""}
                </p>
                <p className="text-xs font-black text-slate-700">Engagé : {moneyCents(d.value)}</p>
                <p className="text-xs font-black text-slate-700">Payé : {moneyCents(d.paye)}</p>
              </div>
            </Popup>
          </CircleMarker>
        );
      })}
    </LeafletMapShell>
  );
}
