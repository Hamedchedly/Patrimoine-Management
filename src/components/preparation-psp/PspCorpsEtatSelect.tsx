/**
 * V7.4 — Sélecteur de corps d'état STRUCTURÉ (GE / GT / CP), sélection UNIQUE.
 *  · recherche libre possible dans la liste ;
 *  · réutilise `getCorpsEtats` (référentiel réel) et `categorieDepuisCorpsEtat`
 *    (mapping unique — jamais de second mapping corps d'état → catégorie) ;
 *  · le badge C est dérivé automatiquement.
 */
import { useMemo, useState } from "react";
import { Check, ChevronDown, Plus, Search } from "lucide-react";

import PspSecteurBadge from "@/components/preparation-psp/PspSecteurBadge";
import { useReferentielCorpsEtats } from "@/components/preparation-psp/useReferentielCorpsEtats";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { corpsEtatsGroupesReferentiel } from "@/lib/psp.prep.v7";
import { cn } from "@/lib/utils";

export default function PspCorpsEtatSelect({
  value,
  onValueChange,
}: {
  value: string;
  onValueChange: (v: string) => void;
}) {
  const { referentiel, categorieDe } = useReferentielCorpsEtats();
  const [ouvert, setOuvert] = useState(false);
  const [q, setQ] = useState("");

  const groupes = useMemo(() => corpsEtatsGroupesReferentiel(referentiel, q), [referentiel, q]);

  const categorie = categorieDe(value);

  return (
    <Popover open={ouvert} onOpenChange={setOuvert}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-8 w-full items-center justify-between gap-2 rounded-md border bg-transparent px-3 text-left text-xs",
            value
              ? "border-primary/40 bg-primary/5 font-medium text-foreground"
              : "border-input text-muted-foreground",
          )}
        >
          <span className="truncate">{value || "Corps d'état…"}</span>
          <span className="flex shrink-0 items-center gap-1.5">
            {value ? <PspSecteurBadge categorie={categorie} /> : null}
            <ChevronDown className="size-3.5 text-muted-foreground" />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <div className="border-b p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-2 size-3.5 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Rechercher (elec, plom…)…"
              className="h-8 pl-7 text-xs"
            />
          </div>
        </div>
        <div className="max-h-52 overflow-auto p-1">
          {groupes.length === 0 && !q.trim() ? (
            <p className="px-2 py-2 text-[10px] text-muted-foreground">Aucun corps d'état.</p>
          ) : null}
          {q.trim() ? (
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 rounded bg-primary/5 px-2 py-1 text-left text-xs font-bold text-primary hover:bg-accent"
              onClick={() => {
                onValueChange(q.trim());
                setOuvert(false);
              }}
            >
              <span className="truncate">Utiliser « {q.trim()} »</span>
              <Plus className="size-3.5 shrink-0" />
            </button>
          ) : null}
          {groupes.map((g) => (
            <div key={g.categorie}>
              <p className="px-2 pb-0.5 pt-2 text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                {g.categorie}
              </p>
              {g.items.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-xs hover:bg-accent",
                    value === c && "bg-primary/10 font-bold",
                  )}
                  onClick={() => {
                    onValueChange(c);
                    setOuvert(false);
                  }}
                >
                  <span className="truncate">{c}</span>
                  {value === c ? <Check className="size-3.5 shrink-0 text-primary" /> : null}
                </button>
              ))}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
