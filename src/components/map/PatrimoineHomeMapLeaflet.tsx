import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Loader2, MapPinOff, RefreshCw } from "lucide-react";
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import { getAdressesGeo, geocodeAdresses } from "@/lib/geo.functions";
import { getPatrimoine } from "@/lib/isis.functions";
import { cleAdresse, entreeDe, type LotItem } from "@/lib/adresses";
import {
  agregerPatrimoineHome,
  adressesDeVille,
  type AdressesGeoApercu,
} from "@/lib/patrimoine.home";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Teinte HSL : 60 = jaune (peu de lots), 0 = rouge (beaucoup de lots). */
function colorFor(t: number) {
  const hue = Math.round((1 - Math.min(1, Math.max(0, t))) * 60);
  return `hsl(${hue}, 90%, 50%)`;
}

const pluriel = (n: number, s: string) => `${n} ${s}${n > 1 ? "s" : ""}`;

/** Zoom automatique sur l'étendue des points (même mécanique que la carte du Dashboard). */
function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (!points.length) return;
    if (points.length === 1) {
      map.setView(points[0]!, 14);
      return;
    }
    map.fitBounds(L.latLngBounds(points), { padding: [42, 42] });
  }, [map, points]);
  return null;
}

/**
 * Carte Leaflet du patrimoine de la PAGE D'ACCUEIL — même style que la carte du Dashboard
 * (Leaflet + OpenStreetMap, cercles colorés par ville). Deux niveaux :
 * - Niveau 1 : UN cercle par VILLE (barycentre des adresses localisées), rayon et couleur
 *   proportionnels au nombre de lots ; clic → zoom sur la ville (niveau 2).
 * - Niveau 2 : UN petit cercle par ADRESSE localisée ; clic → fiche de la ville dans /adresses.
 *   Bouton « ← Toutes les villes » pour revenir.
 * Les garages (estGarage) sont comptés séparément, jamais dans `lots`.
 * Les villes/adresses sans coordonnées sont comptées, jamais déplacées ni inventées.
 * Ce module est chargé uniquement côté client (react-leaflet est incompatible avec le SSR).
 */
export default function PatrimoineHomeMapLeaflet({ lots }: { lots?: LotItem[] | undefined }) {
  const navigate = useNavigate({ from: "/" });
  const [ville, setVille] = useState<string | null>(null);
  // Popup actuellement ouvert (permet « 1er survol/clic → infos, clic suivant → action »).
  const [selectedVille, setSelectedVille] = useState<string | null>(null);
  const [selectedAdresse, setSelectedAdresse] = useState<string | null>(null);

  // Changement de niveau (ville ⇄ adresses) → réinitialise la sélection des popups.
  useEffect(() => {
    setSelectedVille(null);
    setSelectedAdresse(null);
  }, [ville]);

  // Lots : prop fournie par la page (déjà chargés via ["patrimoine"]) sinon fetch partagé.
  const fetchPatrimoine = useServerFn(getPatrimoine);
  const { data: dataPatrimoine } = useQuery({
    queryKey: ["patrimoine"],
    queryFn: () => fetchPatrimoine(),
  });
  const lotsEffectifs = lots ?? ((dataPatrimoine?.lots ?? []) as LotItem[]);

  // Coordonnées des adresses (cache adresses_geo, jamais un appel par adresse).
  const fetchGeo = useServerFn(getAdressesGeo);
  const runGeocode = useServerFn(geocodeAdresses);
  const { data: geo, refetch } = useQuery({
    queryKey: ["adresses-geo"],
    queryFn: () => fetchGeo(),
  });

  const connues = useMemo(
    () => new Map<string, AdressesGeoApercu>((geo ?? []).map((g) => [g.cle, g])),
    [geo],
  );

  // Toutes les adresses du patrimoine (adresse + ville), dédupliquées par clé.
  const toutesLesAdresses = useMemo(() => {
    const map = new Map<string, { cle: string; adresse: string; ville: string }>();
    for (const l of lotsEffectifs) {
      if (!l.adresse || !l.ville) continue;
      const adresse = entreeDe(l.adresse);
      const cle = cleAdresse(adresse, l.ville);
      if (!map.has(cle)) map.set(cle, { cle, adresse, ville: l.ville });
    }
    return [...map.values()];
  }, [lotsEffectifs]);

  // Adresses sans coordonnées valides dans le cache (à géocoder).
  // ⚠️ Échec définitif (VILLE_DIFFERENTE / ZERO_RESULTS) : PAS re-tenté, sinon boucle
  // infinie de géocodage à chaque chargement (Photon appelé pour rien en boucle).
  const manquantes = useMemo(
    () =>
      toutesLesAdresses.filter((a) => {
        const g = connues.get(a.cle);
        if (g?.lat && g?.lng) return false; // déjà localisée
        if (g?.statut === "VILLE_DIFFERENTE" || g?.statut === "ZERO_RESULTS") return false;
        return true;
      }),
    [toutesLesAdresses, connues],
  );

  // Adresses NON localisées (sans coordonnées valides dans le cache), y compris les échecs
  // définitifs (VILLE_DIFFERENTE / ZERO_RESULTS) : c'est cette liste que l'utilisateur peut
  // consulter et re-tenter MANUELLEMENT (pas de re-tentative automatique pour éviter la boucle).
  const nonLocalisees = useMemo(
    () =>
      toutesLesAdresses.filter((a) => {
        const g = connues.get(a.cle);
        return !(g?.lat && g?.lng);
      }),
    [toutesLesAdresses, connues],
  );

  // Boîte de dialogue « adresses non localisées » + re-tentative forcée.
  const [retryOuvert, setRetryOuvert] = useState(false);
  const [retryEnCours, setRetryEnCours] = useState(false);
  const [retryMessage, setRetryMessage] = useState<string | null>(null);

  /** Re-tente le géocodage de TOUTES les adresses non localisées (déclenchement manuel). */
  const forcerRetentative = async () => {
    if (retryEnCours || nonLocalisees.length === 0) return;
    setRetryEnCours(true);
    setRetryMessage(null);
    try {
      for (let i = 0; i < nonLocalisees.length; i += 25) {
        const items = nonLocalisees
          .slice(i, i + 25)
          .map(({ cle, adresse, ville }) => ({ cle, adresse, ville }));
        await runGeocode({ data: { items } });
      }
      await refetch();
      setRetryMessage(
        "Re-géocodage terminé. Les adresses toujours introuvables (voie absente de la base de référence) restent non localisées.",
      );
    } catch {
      setRetryMessage("Échec du re-géocodage. Réessayez dans quelques instants.");
    } finally {
      setRetryEnCours(false);
    }
  };

  const { villes, adresses, nonGeolocaliseesAdresses, villesNonLocalisees } = useMemo(
    () => agregerPatrimoineHome(lotsEffectifs, geo ?? []),
    [lotsEffectifs, geo],
  );

  // Si la ville sélectionnée disparaît des données → retour au niveau 1.
  useEffect(() => {
    if (ville && !villes.some((v) => v.ville === ville)) setVille(null);
  }, [ville, villes]);

  const adressesVille = useMemo(
    () => (ville ? adressesDeVille(adresses, ville) : []),
    [adresses, ville],
  );

  // Plus grand nombre de lots d'une ville (base du dégradé de couleurs).
  const max = useMemo(() => Math.max(0, ...villes.map((v) => v.lots + v.garages)), [villes]);

  // Géocodage progressif (même mécanisme que /adresses) : un lot de 25 adresses à la fois,
  // résultat mis en cache en base, puis rechargement du cache jusqu'à épuisement.
  useEffect(() => {
    if (!geo || manquantes.length === 0) return;
    let cancelled = false;
    (async () => {
      const items = manquantes
        .slice(0, 25)
        .map(({ cle, adresse, ville }) => ({ cle, adresse, ville }));
      try {
        await runGeocode({ data: { items } });
        if (!cancelled) await refetch();
      } catch {
        /* on réessaiera au prochain chargement */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [geo, manquantes, runGeocode, refetch]);

  const pointsVilles = useMemo(
    () => villes.map((v) => [v.lat / v.n, v.lng / v.n] as [number, number]),
    [villes],
  );
  const pointsAdresses = useMemo(
    () =>
      adressesVille
        .map((a) => {
          const p = connues.get(a.cle);
          return p?.lat && p?.lng ? ([p.lat, p.lng] as [number, number]) : null;
        })
        .filter((p): p is [number, number] => p !== null),
    [adressesVille, connues],
  );
  const points = ville ? pointsAdresses : pointsVilles;

  const placees = adresses.length;
  const nonGeolocalisees = ville ? 0 : nonGeolocaliseesAdresses;

  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-panel">
      <div className="relative h-[420px] w-full">
        <MapContainer
          center={[48.8566, 2.3522]}
          zoom={9}
          style={{ height: "100%", width: "100%" }}
          zoomControl={false}
        >
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <FitBounds points={points} />
          {ville
            ? adressesVille.map((a) => {
                const point = connues.get(a.cle);
                if (!point?.lat || !point?.lng) return null;
                return (
                  <CircleMarker
                    key={a.cle}
                    center={[point.lat, point.lng]}
                    radius={7}
                    pathOptions={{
                      fillColor: "#2563eb",
                      fillOpacity: 0.9,
                      color: "rgba(15, 23, 42, 0.55)",
                      weight: 1.5,
                    }}
                    eventHandlers={{
                      mouseover: (e) => (e.target as L.CircleMarker).openPopup(),
                      mouseout: (e) => (e.target as L.CircleMarker).closePopup(),
                      click: () => {
                        // 2e clic (popup déjà ouverte) → fiche de l'adresse dans /adresses.
                        if (selectedAdresse === a.cle) {
                          void navigate({
                            to: "/adresses",
                            search: {
                              ville: a.ville,
                              ...(a.tranche ? { tranche: a.tranche } : {}),
                              rue: a.rue,
                            },
                          });
                        }
                      },
                      popupopen: () => setSelectedAdresse(a.cle),
                      popupclose: () => setSelectedAdresse((cur) => (cur === a.cle ? null : cur)),
                    }}
                  >
                    <Popup>
                      <div className="p-2 font-sans">
                        <p className="mb-1 text-xs font-black text-slate-900">{a.adresse}</p>
                        <p className="text-[10px] font-bold uppercase text-slate-400">
                          {a.codePostal ? `${a.codePostal} ` : ""}
                          {a.ville}
                        </p>
                        <p className="mt-1 text-xs font-black text-slate-700">
                          {pluriel(a.lots, "lot")}
                        </p>
                        {a.garages > 0 && (
                          <p className="text-xs font-black text-slate-500">
                            dont {pluriel(a.garages, "garage")}
                          </p>
                        )}
                        {a.tranches.length > 1 && (
                          <div className="mt-1.5 border-t border-slate-200 pt-1.5">
                            <p className="mb-1 text-[9px] font-bold uppercase tracking-wide text-slate-400">
                              Répartis sur {a.tranches.length} tranches
                            </p>
                            {a.tranches.map((t) => (
                              <button
                                key={t.code}
                                onClick={() =>
                                  void navigate({
                                    to: "/adresses",
                                    search: { ville: a.ville, tranche: t.code, rue: a.rue },
                                  })
                                }
                                className="block w-full text-left text-[11px] font-semibold text-blue-600 hover:underline"
                              >
                                Tranche {t.code} · {pluriel(t.lots, "lot")}
                                {t.garages > 0 ? ` · ${pluriel(t.garages, "garage")}` : ""}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </Popup>
                  </CircleMarker>
                );
              })
            : villes.map((v) => {
                const total = v.lots + v.garages;
                const t = max > 0 ? total / max : 0;
                return (
                  <CircleMarker
                    key={v.ville}
                    center={[v.lat / v.n, v.lng / v.n]}
                    radius={8 + t * 7}
                    pathOptions={{
                      fillColor: colorFor(t),
                      fillOpacity: 0.9,
                      color: "rgba(15, 23, 42, 0.55)",
                      weight: 1.5,
                    }}
                    eventHandlers={{
                      mouseover: (e) => (e.target as L.CircleMarker).openPopup(),
                      mouseout: (e) => (e.target as L.CircleMarker).closePopup(),
                      click: () => {
                        // 2e clic (popup déjà ouverte) → niveau 2 (zoom sur la ville).
                        if (selectedVille === v.ville) setVille(v.ville);
                      },
                      popupopen: () => setSelectedVille(v.ville),
                      popupclose: () => setSelectedVille((cur) => (cur === v.ville ? null : cur)),
                    }}
                  >
                    <Popup>
                      <div className="p-2 font-sans">
                        <p className="mb-1 text-[10px] font-black uppercase text-slate-400">
                          {v.ville}
                        </p>
                        <p className="text-xs font-black text-slate-700">
                          {pluriel(v.tranches, "tranche")}
                        </p>
                        <p className="text-xs font-black text-slate-700">
                          {pluriel(v.lots, "lot")}
                        </p>
                        {v.garages > 0 && (
                          <p className="text-xs font-black text-slate-500">
                            dont {pluriel(v.garages, "garage")}
                          </p>
                        )}
                      </div>
                    </Popup>
                  </CircleMarker>
                );
              })}
        </MapContainer>

        {villes.length === 0 && (
          <div className="absolute inset-0 z-[1000] flex items-center justify-center bg-card/60 text-xs text-muted-foreground">
            {manquantes.length > 0
              ? "Localisation des adresses en cours…"
              : "Aucune adresse localisée pour le moment."}
          </div>
        )}

        {ville && (
          <button
            onClick={() => setVille(null)}
            className="absolute left-3 top-3 z-[1000] flex items-center gap-1 rounded-lg border bg-card px-3 py-2 text-xs font-medium shadow-panel transition-colors hover:bg-accent"
          >
            <ArrowLeft className="size-4" /> Toutes les villes
          </button>
        )}

        {/* Légende : peu de lots (jaune) → beaucoup de lots (rouge) */}
        <div className="absolute bottom-3 left-1/2 z-[1000] -translate-x-1/2 rounded-xl border border-slate-200 bg-white/95 px-4 py-2 shadow-lg backdrop-blur">
          <div className="flex items-center gap-2">
            <span className="text-[8px] font-black uppercase tracking-widest text-slate-400">
              Peu de lots
            </span>
            <div
              className="h-2 w-32 rounded-full"
              style={{
                background: "linear-gradient(90deg, #facc15 0%, #f97316 50%, #ef4444 100%)",
              }}
            />
            <span className="text-[8px] font-black uppercase tracking-widest text-slate-400">
              Beaucoup de lots
            </span>
          </div>
          {!ville && villesNonLocalisees > 0 && (
            <p className="mt-1 text-center text-[8px] font-bold text-amber-600">
              {villesNonLocalisees} ville{villesNonLocalisees > 1 ? "s" : ""} non localisée
              {villesNonLocalisees > 1 ? "s" : ""}
            </p>
          )}
        </div>
      </div>

      <p className="border-t p-3 text-xs text-muted-foreground">
        {ville
          ? `${ville} · ${adressesVille.length} adresse${adressesVille.length > 1 ? "s" : ""} localisée${adressesVille.length > 1 ? "s" : ""}`
          : `${villes.length} ville${villes.length > 1 ? "s" : ""} · ${placees} adresse${placees > 1 ? "s" : ""} localisée${placees > 1 ? "s" : ""}`}
        {!ville && villesNonLocalisees > 0 && (
          <span className="text-amber-600">
            {" "}
            · {villesNonLocalisees} ville{villesNonLocalisees > 1 ? "s" : ""} non localisée
            {villesNonLocalisees > 1 ? "s" : ""}
          </span>
        )}
        {!ville && nonGeolocalisees > 0 && (
          <button
            onClick={() => setRetryOuvert(true)}
            className="inline-flex items-center gap-1 text-amber-600 underline decoration-dotted underline-offset-2 transition-colors hover:text-amber-700"
            title="Afficher la liste des adresses non localisées et relancer le géocodage"
          >
            {" "}
            · {nonGeolocalisees} adresse{nonGeolocalisees > 1 ? "s" : ""} non localisée
            {nonGeolocalisees > 1 ? "s" : ""}
          </button>
        )}
        {manquantes.length > 0 && " · localisation des adresses restantes en cours…"}
      </p>

      <Dialog open={retryOuvert} onOpenChange={setRetryOuvert}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MapPinOff className="size-4 text-amber-600" />
              Adresses non localisées
            </DialogTitle>
            <DialogDescription>
              {nonLocalisees.length} adresse{nonLocalisees.length > 1 ? "s" : ""} sans coordonnées
              valides dans le cache. Voies absentes de la base de référence ou saisies à corriger.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200 custom-scrollbar">
            {nonLocalisees.length === 0 ? (
              <p className="p-4 text-center text-xs font-semibold text-emerald-600">
                Toutes les adresses sont localisées ✓
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {nonLocalisees.map((a) => {
                  const statut = connues.get(a.cle)?.statut;
                  return (
                    <li key={a.cle} className="px-3 py-2">
                      <p className="text-[11px] font-black text-slate-800">{a.adresse}</p>
                      <p className="text-[10px] font-bold uppercase text-slate-400">
                        {a.ville}
                        {statut ? ` · ${statut}` : ""}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          {retryMessage && (
            <p className="text-[11px] font-semibold text-slate-500">{retryMessage}</p>
          )}
          <DialogFooter>
            <button
              onClick={() => void forcerRetentative()}
              disabled={retryEnCours || nonLocalisees.length === 0}
              className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-xs font-black uppercase text-white transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {retryEnCours ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" /> Re-géocodage…
                </>
              ) : (
                <>
                  <RefreshCw className="size-3.5" /> Relancer le géocodage
                </>
              )}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
