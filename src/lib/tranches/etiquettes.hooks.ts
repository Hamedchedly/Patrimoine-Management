/**
 * V8.18 — Hook client « étiquettes de tranches » (VEFA, RACHAT, USUFRUIT, BAIL À CONSTRUIRE…).
 * Lit `getTranchesEtiquettes` (lecture seule) et expose un accès par code + index.
 * Fichier en `.hooks.ts` (jamais `.client.ts`) pour rester hors du graphe serveur.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getTranchesEtiquettes } from "@/lib/isis/functions";
import type { TrancheEtiquette } from "@/lib/isis/functions";

export const TRANCHES_ETIQUETTES_KEY = ["tranches-etiquettes"] as const;

export function useEtiquettesTranches(enabled = true) {
  const fetchEtiquettes = useServerFn(getTranchesEtiquettes);
  const query = useQuery({
    queryKey: [...TRANCHES_ETIQUETTES_KEY],
    queryFn: () => fetchEtiquettes(),
    enabled,
    staleTime: 5 * 60 * 1000,
  });
  const etiquettes = useMemo(
    () => (Array.isArray(query.data) ? (query.data as TrancheEtiquette[]) : []),
    [query.data],
  );
  const parCode = useMemo(() => new Map(etiquettes.map((t) => [t.code, t])), [etiquettes]);
  /** Record code → etiquette (null si non renseignée). */
  const etiquettesParTranche = useMemo(() => {
    const out: Record<string, string | null> = {};
    for (const t of etiquettes) out[t.code] = t.etiquette;
    return out;
  }, [etiquettes]);
  /** Étiquette d'une tranche (null si inconnue/non renseignée). */
  const etiquette = (code: string | null | undefined): string | null =>
    code ? (parCode.get(code)?.etiquette ?? null) : null;

  return { ...query, etiquettes, etiquettesParTranche, etiquette };
}
