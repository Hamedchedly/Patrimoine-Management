import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { getCorpsEtats } from "@/lib/psp.prep.supabase.functions";
import { categorieCorpsEtatReferentiel, type CorpsEtatReferentiel } from "@/lib/psp.prep.v7";
import type { PspCategorie } from "@/lib/psp.prep";

/**
 * V7.6 §13 — Référentiel corps d'état PARTAGÉ (une seule source, mise en cache) :
 *  · la liste structurée GE / GT / CP (PspCorpsEtatSelect) ;
 *  · la catégorie C d'un corps sélectionné (saisie directe + formulaire) —
 *    autorité `psp_corps_etats`, repli mapping historique si valeur libre.
 */
export function useReferentielCorpsEtats() {
  const corpsEtatsFn = useServerFn(getCorpsEtats);
  const { data } = useQuery({
    queryKey: ["psp-referentiel-corps-etats"],
    queryFn: () => corpsEtatsFn({ data: { q: "", tout: false } }),
    staleTime: 1000 * 60 * 10,
    retry: 1,
  });
  const referentiel: CorpsEtatReferentiel[] = useMemo(() => data ?? [], [data]);
  const categorieDe = useCallback(
    (corps: string | null | undefined): PspCategorie =>
      categorieCorpsEtatReferentiel(corps, referentiel),
    [referentiel],
  );
  return { referentiel, categorieDe };
}
