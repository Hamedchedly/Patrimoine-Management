import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";

import {
  rechercherLotsAdresse,
  rechercherLotsV7,
  rechercherNumerosRue,
  rechercherPatrimoineGlobal,
  rechercherRuesTranche,
} from "@/lib/psp.prep.supabase.functions";
import {
  construirePerimetres,
  estLotGarage,
  libelleCcManquant,
  resumeSelectionAdresse,
  sansGarages,
  suggestionsLotsDepuisPerimetres,
  type LotInfo,
  type PerimetreLigne,
} from "@/lib/psp.prep.v7";
import { entreeDe, rueDe } from "@/lib/adresses";
import type { ReferencePatrimoine } from "@/lib/psp.prep.data";

export type SuggestionTranche = { code: string; libelle: string | null; localite: string | null };
export type SuggestionLot = {
  id: string;
  code_patrimoine: string;
  tranche_code: string;
  adresse: string | null;
  ville: string | null;
  locataire_nom?: string | null;
  /** Type du lot (PAR, GAR, BOX, …) — permet le filtre garages (V7.5). */
  type_lot?: string | null;
};

/** V7.5 §5 — filtre garages partagé (défini dans psp.prep.v7, testé). */
export { estLotGarage, sansGarages };

/**
 * V7.3 — Recherche patrimoine partagée (saisie directe + formulaire).
 * Corrections apportées :
 *  · `searchQuery` (texte temporaire) séparé de `selectedTranche` : la TR
 *    sélectionnée reste visible (chip) et ne dépend pas du texte de recherche ;
 *  · recherche globale détectée proprement (numéro/TR/ville/libellé → tranches ;
 *    ER → lots ; texte libre → les deux, regroupés) via `rechercherPatrimoineGlobal` ;
 *  · les panneaux de suggestions sont FERMABLES sans annuler la sélection ;
 *  · recherche de lot (ER / locataire) dans la tranche courante ;
 *  · contrainte UNE seule tranche par ligne ;
 *  · périmètre construit via `construirePerimetres` (règle unique).
 */
export function useRecherchePatrimoine(options: {
  reference: ReferencePatrimoine | null;
  initial?: { tranche: string | null; perimetres?: PerimetreLigne[] };
  /** V8.2.1 — restauration des lots sélectionnés en modification (lot_id → chips). */
  lotsParId?: Map<string, LotInfo> | null | undefined;
}) {
  const { reference } = options;
  const initialPerimetres = useMemo(
    () => options.initial?.perimetres ?? [],
    [options.initial?.perimetres],
  );
  /** V8.2.1 — lots sélectionnés restaurés depuis le périmètre initial (modification). */
  const initialLots = useMemo(
    () =>
      suggestionsLotsDepuisPerimetres(
        initialPerimetres,
        options.lotsParId ?? null,
        options.initial?.tranche ?? null,
      ),
    [initialPerimetres, options.lotsParId, options.initial?.tranche],
  );

  const rechercheGlobaleFn = useServerFn(rechercherPatrimoineGlobal);
  const rechercheLotsFn = useServerFn(rechercherLotsV7);
  const rechercheRuesFn = useServerFn(rechercherRuesTranche);
  const rechercheNumerosFn = useServerFn(rechercherNumerosRue);
  const rechercheLotsAdresseFn = useServerFn(rechercherLotsAdresse);

  // ── TR : searchQuery (temporaire) vs selectedTranche (persistant) ──
  // V8.2.1 — le champ de recherche affiche la TR sélectionnée (modification).
  const [searchQuery, setSearchQuery] = useState(options.initial?.tranche ?? "");
  const [sugTranches, setSugTranches] = useState<SuggestionTranche[]>([]);
  const [sugLots, setSugLots] = useState<SuggestionLot[]>([]);
  const [trPanelOuvert, setTrPanelOuvert] = useState(false);
  const [tranche, setTranche] = useState<string | null>(options.initial?.tranche ?? null);
  const [cc, setCc] = useState(
    (options.initial?.tranche
      ? reference?.tranches.get(options.initial.tranche)?.charge_clientele
      : "") ?? "",
  );
  const [alerteTranche, setAlerteTranche] = useState<string | null>(null);
  const [conflit, setConflit] = useState<string | null>(null);

  // ── Hiérarchie adresse ──
  const [adressePanelOuvert, setAdressePanelOuvert] = useState(false);
  // V8.6.1 §3 — rue du périmètre existant (modification) : la recherche existante
  // est visible (qRue initialisé) et la sélection est directement modifiable.
  const rueInitiale = useMemo(
    () => initialPerimetres.find((p) => p.rue)?.rue ?? null,
    [initialPerimetres],
  );
  // V8.6.1 §3 — en modification, une rue existante amène directement au niveau
  // « numéros » : la sélection existante est visible et modifiable.
  const [niveauAdresse, setNiveauAdresse] = useState<"rues" | "numeros">(
    rueInitiale ? "numeros" : "rues",
  );
  /** V7.5 §5 — garages masqués par défaut (filtre d'affichage uniquement). */
  const [afficherGarages, setAfficherGarages] = useState(false);
  // V8.6.1 §3 — le champ de recherche des rues est initialisé avec la rue du
  // périmètre existant (modification) : la recherche existante est visible.
  const [qRue, setQRue] = useState(rueInitiale ?? "");
  const [rues, setRues] = useState<Array<{ rue: string; ville: string | null; nb_lots: number }>>(
    [],
  );
  const [rue, setRue] = useState<string | null>(initialPerimetres.find((p) => p.rue)?.rue ?? null);
  const [numeros, setNumeros] = useState<string[]>([]);
  const [adressesChoisies, setAdressesChoisies] = useState<string[]>(
    initialPerimetres
      .filter((p) => p.niveau === "adresse" && p.rue && p.numero)
      .map((p) => `${p.numero} ${p.rue}`.trim()),
  );
  const [lotsDeAdresse, setLotsDeAdresse] = useState<Map<string, SuggestionLot[]>>(new Map());
  /** V8.2.1 — lots sélectionnés restaurés en modification (périmètre initial). */
  const [lotsChoisis, setLotsChoisis] = useState<SuggestionLot[]>(initialLots);

  // ── Recherche de lot dans la tranche (ER / locataire) ──
  const [qLot, setQLot] = useState("");
  const [sugLotsTranche, setSugLotsTranche] = useState<SuggestionLot[]>([]);

  const [modifie, setModifie] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // V8.6.1 §3 — restauration de la hiérarchie adresse en modification : les
  // numéros de la rue du périmètre initial sont rechargés pour que la sélection
  // existante soit visible et modifiable (aucune donnée écrite).
  useEffect(() => {
    const rueInit = rueInitiale;
    const trInit = options.initial?.tranche;
    if (rueInit && trInit) {
      void rechercheNumerosFn({ data: { tranche: trInit, rue: rueInit } }).then((n) =>
        setNumeros((n ?? []) as string[]),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * SYNCHRONISATION RUE ⇄ CHAMP DE RECHERCHE (correction) : dès qu'une rue est
   * sélectionnée, le champ de recherche des rues (qRue) reflète cette rue.
   * Ajouter un numéro / ER ne doit JAMAIS effacer la rue sélectionnée : la
   * sélection de la rue est conservée et le champ reste réellement synchronisé
   * avec l'état de sélection (jamais un texte statique). Le correctif V8.6.1
   * (qRue initialisé depuis la rue du périmètre existant) est conservé.
   */
  useEffect(() => {
    if (rue) setQRue(rue);
  }, [rue]);

  const referenceTranche = tranche ? reference?.tranches.get(tranche) : undefined;

  /**
   * V7.7 §6 — filtrage GARAGES cohérent sur TOUTES les recherches : les listes
   * exposées aux composants sont TOUJOURS filtrées par `sansGarages` selon
   * `afficherGarages` (défaut : masqués). Une seule mécanique, réutilisée.
   */
  const sugLotsVisibles = useMemo(
    () => sansGarages(sugLots, afficherGarages),
    [sugLots, afficherGarages],
  );
  const sugLotsTrancheVisibles = useMemo(
    () => sansGarages(sugLotsTranche, afficherGarages),
    [sugLotsTranche, afficherGarages],
  );
  const lotsDeAdresseVisibles = useMemo(
    () =>
      new Map(
        [...lotsDeAdresse.entries()].map(([entree, lots]) => [
          entree,
          sansGarages(lots, afficherGarages),
        ]),
      ),
    [lotsDeAdresse, afficherGarages],
  );

  /**
   * V7.7 §6 — décoché après avoir coché : les garages déjà retenus sont retirés
   * de la sélection (aucun garage/box tant que « Afficher les garages » est vide).
   */
  useEffect(() => {
    if (afficherGarages) return;
    setLotsChoisis((prev) => sansGarages(prev, false));
    setLotsDeAdresse((prev) => {
      const suivant = new Map<string, SuggestionLot[]>();
      for (const [entree, lots] of prev) suivant.set(entree, sansGarages(lots, false));
      return suivant;
    });
  }, [afficherGarages]);

  /**
   * V7.6 §3-4 — Résumé de la sélection d'adresse (toujours visible dans la
   * cellule « Adresse / périmètre », y compris panneau fermé) : la rue reste
   * affichée tant qu'une sélection existe.
   */
  const resumeSelection = useMemo(
    () => ({
      rue,
      detail: resumeSelectionAdresse({ rue, adresses: adressesChoisies, lots: lotsChoisis }),
    }),
    [rue, adressesChoisies, lotsChoisis],
  );

  /** V7.6 §9 — alerte quand le sous-secteur n'a pas de CC dans le référentiel. */
  const alerteCc = useMemo(() => libelleCcManquant(referenceTranche), [referenceTranche]);

  /** Périmètre effectif : initial tant que l'utilisateur n'a rien modifié. */
  const perimetres = useMemo<PerimetreLigne[]>(() => {
    if (!modifie) return initialPerimetres;
    return construirePerimetres({
      lots: lotsChoisis,
      adresses: adressesChoisies,
      rue,
      mode: "auto",
    });
  }, [modifie, lotsChoisis, adressesChoisies, rue, initialPerimetres]);

  // ── Recherche GLOBALE (active tant qu'aucune TR n'est sélectionnée) ──
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const valeur = searchQuery.trim();
    if (valeur.length < 2 || tranche) {
      setSugTranches([]);
      setSugLots([]);
      setAlerteTranche(null);
      return;
    }
    timer.current = setTimeout(async () => {
      try {
        const r = ((await rechercheGlobaleFn({ data: { q: valeur } })) ?? {
          tranches: [],
          lots: [],
        }) as { tranches: SuggestionTranche[]; lots: SuggestionLot[] };
        setSugTranches((r.tranches ?? []) as SuggestionTranche[]);
        setSugLots((r.lots ?? []) as SuggestionLot[]);
        setAlerteTranche(
          r.tranches.length === 0 && r.lots.length === 0
            ? `Aucune tranche ni lot pour « ${valeur} »`
            : null,
        );
      } catch {
        // la recherche ne bloque jamais la saisie
      }
    }, 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, tranche]);

  // ── Rues de la tranche sélectionnée (progressive) ──
  useEffect(() => {
    if (!tranche) {
      setRues([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const r = (await rechercheRuesFn({ data: { tranche, q: qRue } })) ?? [];
        setRues(r as Array<{ rue: string; ville: string | null; nb_lots: number }>);
      } catch {
        setRues([]);
      }
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tranche, qRue]);

  // ── Recherche de lot dans la tranche (ER / locataire) — progressive ──
  useEffect(() => {
    if (!tranche || qLot.trim().length < 2) {
      setSugLotsTranche([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const r = (await rechercheLotsFn({ data: { q: qLot, tranche } })) ?? [];
        setSugLotsTranche(r as SuggestionLot[]);
      } catch {
        setSugLotsTranche([]);
      }
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qLot, tranche]);

  /** Sélection d'une tranche → la valeur reste visible (chip), texte de recherche vidé. */
  const choisirTranche = (code: string) => {
    setTranche(code);
    setCc(reference?.tranches.get(code)?.charge_clientele ?? "");
    setSearchQuery("");
    setSugTranches([]);
    setSugLots([]);
    setTrPanelOuvert(false);
    setAlerteTranche(null);
    setConflit(null);
    setRue(null);
    setNumeros([]);
    setAdressesChoisies([]);
    setLotsDeAdresse(new Map());
    setLotsChoisis([]);
    setAdressePanelOuvert(false);
    setNiveauAdresse("rues");
    setModifie(true);
  };

  /** Efface la TR sélectionnée (bouton X) — le texte de recherche réapparaît. */
  const effacerTranche = () => {
    setTranche(null);
    setCc("");
    setRue(null);
    setNumeros([]);
    setAdressesChoisies([]);
    setLotsDeAdresse(new Map());
    setLotsChoisis([]);
    setNiveauAdresse("rues");
    setModifie(true);
  };

  /** V7.5 §6 — reset TOTAL après un enregistrement réussi (saisie directe). */
  const resetTout = () => {
    setTranche(null);
    setCc("");
    setConflit(null);
    setSearchQuery("");
    setSugTranches([]);
    setSugLots([]);
    setTrPanelOuvert(false);
    setRue(null);
    setQRue("");
    setRues([]);
    setNumeros([]);
    setAdressesChoisies([]);
    setLotsDeAdresse(new Map());
    setLotsChoisis([]);
    setQLot("");
    setSugLotsTranche([]);
    setNiveauAdresse("rues");
    setAdressePanelOuvert(false);
    setModifie(false);
  };

  /** Sélection d'un lot via la recherche globale (ER / locataire, sans TR encore choisie). */
  const choisirLotGlobal = (l: SuggestionLot) => {
    if (tranche && l.tranche_code !== tranche) {
      setConflit(
        `Ce lot (${l.code_patrimoine}) appartient à la tranche ${l.tranche_code} — une ligne ne peut couvrir qu'une seule tranche.`,
      );
      return;
    }
    setTranche(l.tranche_code);
    setCc(reference?.tranches.get(l.tranche_code)?.charge_clientele ?? "");
    setConflit(null);
    if (!lotsChoisis.some((x) => x.id === l.id)) setLotsChoisis((prev) => [...prev, l]);
    // V7.5 §3 — la rue / le numéro / l'adresse du lot sont remplis immédiatement.
    const r = rueDe(l.adresse);
    const entree = entreeDe(l.adresse);
    setRue(r);
    setQRue(r);
    setAdressesChoisies(entree ? [entree] : []);
    setLotsDeAdresse((prev) => (entree ? new Map(prev).set(entree, [l]) : new Map(prev)));
    setNiveauAdresse("numeros");
    setAdressePanelOuvert(false);
    setSearchQuery("");
    setSugLots([]);
    setTrPanelOuvert(false);
    if (r) {
      void rechercheNumerosFn({ data: { tranche: l.tranche_code, rue: r } }).then((n) =>
        setNumeros((n ?? []) as string[]),
      );
    }
    setModifie(true);
  };

  /** Sélection d'un lot trouvé dans la tranche (recherche ER / locataire intra-tranche). */
  const choisirLotTranche = (l: SuggestionLot) => {
    if (l.tranche_code !== tranche) {
      setConflit(
        `Ce lot (${l.code_patrimoine}) appartient à la tranche ${l.tranche_code} — une ligne ne peut couvrir qu'une seule tranche.`,
      );
      return;
    }
    setModifie(true);
    setConflit(null);
    if (!lotsChoisis.some((x) => x.id === l.id)) setLotsChoisis((prev) => [...prev, l]);
    // V7.5 §3 — remplissage immédiat de la rue / du numéro / de l'adresse du lot.
    const r = rueDe(l.adresse);
    const entree = entreeDe(l.adresse);
    if (r) setRue(r);
    if (r) setQRue(r);
    if (entree) {
      setAdressesChoisies((prev) => (prev.includes(entree) ? prev : [...prev, entree]));
      setLotsDeAdresse((prev) => (prev.has(entree) ? prev : new Map(prev).set(entree, [l])));
    }
    setQLot("");
    setSugLotsTranche([]);
  };

  /** Sélection d'une rue → passage au niveau NUMÉROS (le panneau ne reste pas sur les rues). */
  const choisirRue = (r: string) => {
    setRue(r);
    setQRue(r);
    setAdressesChoisies([]);
    setLotsDeAdresse(new Map());
    setLotsChoisis([]);
    setModifie(true);
    setNiveauAdresse("numeros");
    setAdressePanelOuvert(true);
    void rechercheNumerosFn({ data: { tranche: tranche ?? "", rue: r } }).then((n) =>
      setNumeros((n ?? []) as string[]),
    );
  };

  /** Retour au niveau « rues » (la sélection de rue reste conservée). */
  const retourRues = () => {
    setNiveauAdresse("rues");
    setAdressePanelOuvert(true);
  };

  /** V7.6 §3-4 — rouvre le panneau au niveau « numéros » pour modifier la sélection. */
  const reouvrirNumeros = () => {
    setNiveauAdresse("numeros");
    setAdressePanelOuvert(true);
  };

  /**
   * V7.6 §4 — supprime UNIQUEMENT la sélection d'adresse (rue/numéros/lots).
   * La TR et le CC sont CONSERVÉS ; le périmètre repasse au niveau « tranche ».
   * La fermeture du panneau ne reset JAMAIS la sélection — c'est ce bouton ✕
   * qui est la seule façon de l'effacer.
   */
  const effacerAdresse = () => {
    setRue(null);
    setNumeros([]);
    setAdressesChoisies([]);
    setLotsDeAdresse(new Map());
    setLotsChoisis([]);
    setQLot("");
    setSugLotsTranche([]);
    setNiveauAdresse("rues");
    setModifie(true);
  };

  /** « Toute la rue » proposée EN PREMIÈRE position des rues → périmètre tranche entière. */
  const choisirTouteLaRue = () => {
    setRue(null);
    setNumeros([]);
    setAdressesChoisies([]);
    setLotsDeAdresse(new Map());
    setLotsChoisis([]);
    setModifie(true);
    setNiveauAdresse("rues");
    setAdressePanelOuvert(false);
    setQRue("");
    setRues([]);
  };

  /** « Toute la rue » du niveau NUMÉROS : rue entière (aucun numéro, aucun lot). */
  const touteLaRue = () => {
    setAdressesChoisies([]);
    setLotsDeAdresse(new Map());
    setLotsChoisis([]);
    setModifie(true);
  };

  /** Multi-adresses : coche/décoche une adresse (même tranche uniquement). */
  const basculerAdresse = async (entree: string) => {
    setModifie(true);
    const present = adressesChoisies.includes(entree);
    setAdressesChoisies((prev) => (present ? prev.filter((a) => a !== entree) : [...prev, entree]));
    if (present) {
      setLotsChoisis((prev) =>
        prev.filter((l) => entreeDe(l.adresse).toUpperCase() !== entree.toUpperCase()),
      );
      return;
    }
    try {
      const l =
        (await rechercheLotsAdresseFn({
          data: { tranche: tranche ?? "", adresse: entree },
        })) ?? [];
      setLotsDeAdresse((prev) => new Map(prev).set(entree, l as SuggestionLot[]));
    } catch {
      setLotsDeAdresse((prev) => new Map(prev).set(entree, []));
    }
  };

  /** Multi-lots (tous de la même tranche). */
  const basculerLot = (l: SuggestionLot) => {
    if (tranche && l.tranche_code !== tranche) {
      setConflit(
        `Ce lot (${l.code_patrimoine}) appartient à la tranche ${l.tranche_code} — une ligne ne peut couvrir qu'une seule tranche.`,
      );
      return;
    }
    setModifie(true);
    setLotsChoisis((prev) =>
      prev.some((x) => x.id === l.id) ? prev.filter((x) => x.id !== l.id) : [...prev, l],
    );
  };

  const retirerLot = (id: string) => setLotsChoisis((prev) => prev.filter((x) => x.id !== id));

  return {
    // recherche TR globale (searchQuery ≠ selectedTranche)
    searchQuery,
    setSearchQuery,
    trPanelOuvert,
    setTrPanelOuvert,
    sugTranches,
    sugLots,
    alerteTranche,
    conflit,
    setConflit,
    // tranche + CC (persistants)
    tranche,
    cc,
    referenceTranche,
    alerteCc,
    choisirTranche,
    effacerTranche,
    choisirLotGlobal,
    resetTout,
    // hiérarchie adresse
    adressePanelOuvert,
    setAdressePanelOuvert,
    niveauAdresse,
    setNiveauAdresse,
    afficherGarages,
    setAfficherGarages,
    qRue,
    setQRue,
    rues,
    rue,
    numeros,
    adressesChoisies,
    lotsDeAdresse,
    lotsDeAdresseVisibles,
    lotsChoisis,
    choisirRue,
    retourRues,
    reouvrirNumeros,
    effacerAdresse,
    choisirTouteLaRue,
    touteLaRue,
    basculerAdresse,
    basculerLot,
    retirerLot,
    // recherche lot intra-tranche (ER / locataire)
    qLot,
    setQLot,
    sugLotsTranche,
    sugLotsTrancheVisibles,
    choisirLotTranche,
    // recherche globale
    sugLotsVisibles,
    // périmètre
    perimetres,
    modifie,
    resumeSelection,
  };
}
