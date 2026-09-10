/**
 * PATRIMOINE — RECHERCHE AVEC LISTE DÉROULANTE (en-tête /adresses).
 *
 * - Suggestions en direct (ER / villes / adresses / locataires) dès 2 caractères,
 *   navigables au clavier (↑ / ↓ / Entrée / Échap) et cliquables.
 * - Le symbole « * » signifie « n'importe quelle suite de caractères » pour
 *   généraliser la recherche (ex. « PLESS* », « RUE DE * », « *PARIS »).
 * - Entrée → recherche globale (comportement historique conservé).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Building2, KeyRound, MapPin, Search, User } from "lucide-react";

import { Input } from "@/components/ui/input";
import { estGarage, rechercherPatrimoine } from "@/lib/adresses";
import { getAdresses, type LotItem } from "@/lib/isis/functions";

const SEUIL = 2; // minimum de caractères pour afficher les suggestions
const LIMITE = 5; // résultats par catégorie dans la liste déroulante

type SuggestionItem =
  | { type: "ville"; ville: string; tranches: number; lots: number }
  | { type: "adresse"; adresse: string; ville: string; tranche: string; lots: number }
  | { type: "locataire"; nom: string; adresse: string; ville: string; tranche: string }
  | { type: "er"; code: string; adresse: string; ville: string; tranche: string }
  | { type: "tranche"; tranche: string; ville: string; lots: number };

type RecherchePatrimoineNavigation = {
  ville?: string | undefined;
  tranche?: string | undefined;
  rue?: string | undefined;
  lot?: string | undefined;
  q?: string | undefined;
};

const cleItem = (item: SuggestionItem): string => {
  switch (item.type) {
    case "ville":
      return `ville:${item.ville}`;
    case "adresse":
      return `adresse:${item.ville}|${item.tranche}|${item.adresse}`;
    case "locataire":
      return `locataire:${item.nom}|${item.ville}|${item.tranche}|${item.adresse}`;
    case "er":
      return `er:${item.code}`;
    case "tranche":
      return `tranche:${item.ville}|${item.tranche}`;
  }
};

const libelleItem = (item: SuggestionItem): string => {
  switch (item.type) {
    case "ville":
      return item.ville;
    case "adresse":
      return item.adresse;
    case "locataire":
      return item.nom;
    case "er":
      return item.code;
    case "tranche":
      return `Tranche ${item.tranche}`;
  }
};

const detailItem = (item: SuggestionItem): string => {
  switch (item.type) {
    case "ville":
      return `${item.lots} lot(s)`;
    case "adresse":
      return `${item.tranche} · ${item.ville}`;
    case "locataire":
      return item.adresse;
    case "er":
      return item.adresse;
    case "tranche":
      return item.ville ? `${item.ville} · ${item.lots} lot(s)` : `${item.lots} lot(s)`;
  }
};

export default function PatrimoineSearch({
  q,
  villes,
  showGarages,
  onSearch,
  onNavigate,
}: {
  q: string | undefined;
  villes: { ville: string; tranches: number; lots: number }[];
  showGarages: boolean;
  onSearch: (q: string) => void;
  onNavigate: (search: RecherchePatrimoineNavigation) => void;
}) {
  const [draft, setDraft] = useState(q ?? "");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const racineRef = useRef<HTMLDivElement>(null);

  // Synchronise le champ quand la recherche (URL) change.
  useEffect(() => {
    setDraft(q ?? "");
    setActive(-1);
  }, [q]);

  // Tous les lots sont chargés une seule fois pour la recherche client
  // (aucune requête par résultat) dès que l'utilisateur tape.
  const fetchAdresses = useServerFn(getAdresses);
  const { data: allLots, isLoading } = useQuery({
    queryKey: ["adresses", "suggestions", "toutes"],
    queryFn: () => fetchAdresses({ data: {} }),
    enabled: draft.trim().length >= SEUIL,
    staleTime: 1000 * 60 * 10,
  });

  const lots = useMemo(
    () => ((allLots as LotItem[]) ?? []).filter((lot) => showGarages || !estGarage(lot)),
    [allLots, showGarages],
  );

  const suggestions = useMemo(() => {
    if (draft.trim().length < SEUIL) return null;
    return rechercherPatrimoine(draft, lots, villes);
  }, [draft, lots, villes]);

  const groupes = useMemo(() => {
    if (!suggestions) return [];
    const g: Array<{
      titre: string;
      icone: typeof Building2;
      items: SuggestionItem[];
    }> = [];
    if (suggestions.ers.length > 0)
      g.push({
        titre: "ER",
        icone: KeyRound,
        items: suggestions.ers.slice(0, LIMITE).map((e) => ({ type: "er", ...e })),
      });
    if (suggestions.villes.length > 0)
      g.push({
        titre: "Villes",
        icone: Building2,
        items: suggestions.villes.slice(0, LIMITE).map((v) => ({ type: "ville", ...v })),
      });
    if (suggestions.adresses.length > 0)
      g.push({
        titre: "Adresses",
        icone: MapPin,
        items: suggestions.adresses.slice(0, LIMITE).map((a) => ({ type: "adresse", ...a })),
      });
    if (suggestions.tranches.length > 0)
      g.push({
        titre: "Tranches",
        icone: Building2,
        items: suggestions.tranches.slice(0, LIMITE).map((t) => ({ type: "tranche", ...t })),
      });
    if (suggestions.locataires.length > 0)
      g.push({
        titre: "Locataires",
        icone: User,
        items: suggestions.locataires.slice(0, LIMITE).map((l) => ({ type: "locataire", ...l })),
      });
    return g;
  }, [suggestions]);

  // Liste aplatie (mêmes références) pour la navigation clavier.
  const items = useMemo(() => groupes.flatMap((g) => g.items), [groupes]);
  const itemIndexByKey = useMemo(
    () => new Map(items.map((item, index) => [cleItem(item), index] as const)),
    [items],
  );
  const total = items.length;
  const jokerActif = (draft ?? "").includes("*");

  // Fermeture au clic extérieur.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (racineRef.current && !racineRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const choisir = (item: SuggestionItem) => {
    setOpen(false);
    setActive(-1);
    if (item.type === "ville") {
      onNavigate({ ville: item.ville, q: undefined });
    } else if (item.type === "er") {
      onNavigate({ lot: item.code, q: undefined });
    } else if (item.type === "tranche") {
      onNavigate({ ville: item.ville || undefined, tranche: item.tranche, q: undefined });
    } else {
      onNavigate({ ville: item.ville, tranche: item.tranche, rue: item.adresse, q: undefined });
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setOpen(false);
      setActive(-1);
      return;
    }
    if (e.key === "ArrowDown" && open && total > 0) {
      e.preventDefault();
      setActive((i) => (i + 1) % total);
      return;
    }
    if (e.key === "ArrowUp" && open && total > 0) {
      e.preventDefault();
      setActive((i) => (i <= 0 ? total - 1 : i - 1));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (open && active >= 0 && items[active]) {
        choisir(items[active]);
      } else {
        setOpen(false);
        onSearch(draft);
      }
    }
  };

  return (
    <div ref={racineRef} className="relative w-full sm:w-64">
      <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
      <Input
        type="search"
        placeholder="Rechercher… ( * = tout )"
        className="pl-9"
        value={draft}
        onFocus={() => draft.trim().length >= SEUIL && setOpen(true)}
        onChange={(e) => {
          setDraft(e.target.value);
          setActive(-1);
          setOpen(e.target.value.trim().length >= SEUIL);
        }}
        onKeyDown={onKeyDown}
      />

      {open && total > 0 ? (
        <div className="absolute right-0 z-40 mt-1 max-h-80 w-72 overflow-auto rounded-lg border bg-popover p-1 shadow-lg">
          {jokerActif ? (
            <p className="px-2 py-1 text-[9px] font-medium text-muted-foreground">
              « * » = n&apos;importe quelle suite de caractères
            </p>
          ) : null}
          {groupes.map((g) => (
            <div key={g.titre} className="mb-0.5">
              <p className="flex items-center gap-1 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                <g.icone className="size-3" /> {g.titre}
              </p>
              {g.items.map((item) => {
                const idx = itemIndexByKey.get(cleItem(item)) ?? -1;
                const actif = idx === active;
                return (
                  <button
                    key={cleItem(item)}
                    type="button"
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => choisir(item)}
                    className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-xs hover:bg-accent ${
                      actif ? "bg-primary/10 font-bold" : ""
                    }`}
                  >
                    <span className="truncate">{libelleItem(item)}</span>
                    <span className="shrink-0 text-muted-foreground">{detailItem(item)}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      ) : null}

      {open && total === 0 && draft.trim().length >= SEUIL && isLoading ? (
        <div className="absolute right-0 z-40 mt-1 w-72 rounded-lg border bg-popover p-2 text-[11px] text-muted-foreground shadow-lg">
          Chargement du patrimoine…
        </div>
      ) : null}

      {open && total === 0 && draft.trim().length >= SEUIL && !isLoading && allLots ? (
        <div className="absolute right-0 z-40 mt-1 w-72 rounded-lg border bg-popover p-2 text-[11px] text-muted-foreground shadow-lg">
          Aucune correspondance pour « {draft} » — utilisez « * » pour généraliser.
        </div>
      ) : null}
    </div>
  );
}
