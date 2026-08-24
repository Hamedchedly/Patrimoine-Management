import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { ArrowDown, ArrowUp, Building2, Plus, Search, Star, X } from "lucide-react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { toast } from "sonner";

import NiveauBadge from "@/components/NiveauBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  creerFournisseurDepuisRef,
  createFournisseur,
  getFournisseursList,
  type LigneFournisseurListe,
} from "@/lib/fournisseurs.functions";
import { useFavorisLocal } from "@/lib/fournisseurs.favoris.hooks";
import { libelleEntreprise, premierePropositionCorpsEtat } from "@/lib/fournisseurs";
import { ORDRE_NIVEAU, PROFIL_BADGE, trierLignes } from "@/lib/fournisseurs.analyse";
import { money2, pct } from "@/lib/formats";
import { formatDateCommandeFr } from "@/lib/psp.validation";
import EvoCell from "@/components/EvoCell";
import Labeled from "@/components/Labeled";

/** Search de la liste Fournisseurs (filtres + tri persistés dans l'URL, P0-2). */
export type ListeFournisseursSearch = {
  q?: string | undefined;
  corps?: string[] | undefined;
  famille?: string | undefined;
  anneeDe?: number | undefined;
  anneeFin?: number | undefined;
  profil?: string | undefined;
  favoris?: boolean | undefined;
  sansCmd?: boolean | undefined;
  activite?: string | undefined;
  triC?: string | undefined;
  triD?: "asc" | "desc" | undefined;
  marcheM?: "tous" | "principaux" | undefined;
  marcheD?: "asc" | "desc" | undefined;
};

/** Search « vide » réutilisable par les liens vers /fournisseurs. */
export const LISTE_FOURNISSEURS_SEARCH_VIDE: ListeFournisseursSearch = {
  q: undefined,
  corps: undefined,
  famille: undefined,
  anneeDe: undefined,
  anneeFin: undefined,
  profil: undefined,
  favoris: undefined,
  sansCmd: undefined,
  activite: undefined,
  triC: undefined,
  triD: undefined,
  marcheM: undefined,
  marcheD: undefined,
};

/** Hydrate un search brut TanStack (valeurs JSON-encodées) vers le type de la liste. */
function validerListeSearch(s: Record<string, unknown>): ListeFournisseursSearch {
  const str = (v: unknown): string | undefined =>
    typeof v === "string" || typeof v === "number" ? String(v) : undefined;
  const dir = (v: unknown): "asc" | "desc" | undefined =>
    v === "asc" || v === "desc" ? v : undefined;
  return {
    q: str(s["q"]),
    corps: Array.isArray(s["corps"])
      ? s["corps"].map(String)
      : str(s["corps"])
        ? [str(s["corps"]) as string]
        : undefined,
    famille: str(s["famille"]),
    anneeDe:
      typeof s["anneeDe"] === "number" || typeof s["anneeDe"] === "string"
        ? Number(s["anneeDe"])
        : undefined,
    anneeFin:
      typeof s["anneeFin"] === "number" || typeof s["anneeFin"] === "string"
        ? Number(s["anneeFin"])
        : undefined,
    profil: str(s["profil"]),
    favoris: s["favoris"] === true || s["favoris"] === "true" ? true : undefined,
    sansCmd: s["sansCmd"] === true || s["sansCmd"] === "true" ? true : undefined,
    activite: str(s["activite"]),
    triC: str(s["triC"]),
    triD: dir(s["triD"]),
    marcheM: s["marcheM"] === "principaux" || s["marcheM"] === "tous" ? s["marcheM"] : undefined,
    marcheD: dir(s["marcheD"]),
  };
}

export const Route = createFileRoute("/fournisseurs/")({
  validateSearch: validerListeSearch,
  head: () => ({
    meta: [
      { title: "Fournisseurs" },
      {
        name: "description",
        content:
          "Référentiel des entreprises — couche d'enrichissement manuel. Les données sources restent immuables.",
      },
    ],
  }),
  component: FournisseursPage,
});

/** Colonne « Activités principales » : corps d'état à niveau EFFECTIF principal (codes conservés).
 *  V8.16p — repli : si aucune activité « principale », affiche l'activité la plus forte avec son
 *  niveau (règle utilisateur : un petit fournisseur doit montrer son activité réelle). */
function ActivitesPrincipalesCell({ ligne }: { ligne: LigneFournisseurListe }) {
  const corps = ligne.corps_principaux_effectifs;
  if (corps.length) {
    return (
      <span className="block max-w-[320px] text-xs leading-tight text-slate-600">
        {corps.slice(0, 5).join(" · ")}
      </span>
    );
  }
  if (ligne.corps_etat_principal) {
    return (
      <span className="flex max-w-[320px] flex-wrap items-center gap-1.5 text-xs leading-tight text-slate-600">
        <span>{ligne.corps_etat_principal}</span>
        {ligne.niveau_corps_principal && ligne.niveau_corps_principal !== "principal" && (
          <NiveauBadge niveau={ligne.niveau_corps_principal} />
        )}
      </span>
    );
  }
  return <span className="block max-w-[320px] text-xs leading-tight text-slate-600">—</span>;
}

/** Colonne « Famille » : classification métier CEA / CVC-P / TCE / AUTRE (jamais un corps). */
function FamilleCell({ famille }: { famille: string }) {
  return (
    <Badge variant="outline" className={PROFIL_BADGE[famille] ?? ""}>
      {famille}
    </Badge>
  );
}

/** Tri local de la table : valeurs réelles (jamais le texte formaté), nulles en fin.
 *  Mécanique de tri mutualisée (trierLignes) — seules les clés de colonne restent locales. */
function trierListe(list: LigneFournisseurListe[], key: string, dir: "asc" | "desc") {
  const get = (l: LigneFournisseurListe): number | string | null => {
    if (key === "ref_isis") {
      const s = l.ref_isis;
      if (s && /^\d+$/.test(s)) return Number(s);
      return s ?? null;
    }
    if (key === "nom") {
      const n = libelleEntreprise(l.nom);
      const base =
        n === "Entreprise non renseignée" && l.ref_isis
          ? `Entreprise non renseignée ${l.ref_isis}`
          : n;
      return base.toLowerCase();
    }
    if (key === "activites") {
      return (l.corps_principaux_effectifs ?? []).join(" · ").toLowerCase();
    }
    if (key === "famille") {
      return l.famille;
    }
    const v = (l as unknown as Record<string, unknown>)[key];
    return typeof v === "number" ? v : v == null ? null : String(v);
  };
  return trierLignes(list, get, dir);
}

function FournisseursPage() {
  const routeSearch = Route.useSearch();
  const navigate = Route.useNavigate();
  // P0-2 : les filtres/tri sont hydratés depuis l'URL (deep-link + retour contextuel).
  const [query, setQuery] = useState(routeSearch.q ?? "");
  const [corpsEtats, setCorpsEtats] = useState<string[]>(routeSearch.corps ?? []);
  const [famille, setFamille] = useState(routeSearch.famille ?? "");
  // V8.16s — plage d'années du slider (null = toutes les années).
  const [anneeDe, setAnneeDe] = useState<number | null>(routeSearch.anneeDe ?? null);
  const [anneeFin, setAnneeFin] = useState<number | null>(routeSearch.anneeFin ?? null);
  const [profil, setProfil] = useState(routeSearch.profil ?? "");
  const [favorisOnly, setFavorisOnly] = useState(routeSearch.favoris === true);
  // V8.16s — entreprises sans commande sur la période : MASQUÉES par défaut.
  // Case cochée = les afficher (persisté dans l'URL via `sansCmd`).
  const [sansCmdVisible, setSansCmdVisible] = useState(routeSearch.sansCmd === true);
  const [activite, setActivite] = useState(routeSearch.activite ?? "");
  const [open, setOpen] = useState(false);
  // Tri : 1er clic = desc, 2e = asc, 3e = retour au tri par défaut (null).
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(
    routeSearch.triC && routeSearch.triD ? { key: routeSearch.triC, dir: routeSearch.triD } : null,
  );
  // Part de marché : clic sur l'en-tête = bascule principaux / tous (+ tri associé).
  const [marche, setMarche] = useState<{
    mode: "tous" | "principaux";
    sort: "desc" | "asc" | null;
  }>({
    mode: routeSearch.marcheM ?? "tous",
    sort: routeSearch.marcheD ?? null,
  });

  // P0-2 : synchronise filtres + tri dans l'URL (replace, sans polluer l'historique) et
  // dans sessionStorage (utilisé par le bouton « Retour » de la fiche fournisseur).
  useEffect(() => {
    const search: ListeFournisseursSearch = {
      q: query || undefined,
      corps: corpsEtats.length ? corpsEtats : undefined,
      famille: famille || undefined,
      anneeDe: anneeDe ?? undefined,
      anneeFin: anneeFin ?? undefined,
      profil: profil || undefined,
      favoris: favorisOnly || undefined,
      sansCmd: sansCmdVisible || undefined,
      activite: activite || undefined,
      triC: sort?.key ?? undefined,
      triD: sort?.dir ?? undefined,
      marcheM: marche.mode === "principaux" ? "principaux" : undefined,
      marcheD: marche.sort ?? undefined,
    };
    navigate({ replace: true, search });
    try {
      sessionStorage.setItem("pat-s11:fournisseurs:liste", JSON.stringify(search));
    } catch {
      // stockage indisponible : le retour contextuel perdra les filtres (non bloquant).
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    query,
    corpsEtats,
    famille,
    anneeDe,
    anneeFin,
    profil,
    favorisOnly,
    sansCmdVisible,
    activite,
    sort,
    marche,
  ]);

  const fetchList = useServerFn(getFournisseursList);
  const create = useServerFn(createFournisseur);
  const creerDepuisRef = useServerFn(creerFournisseurDepuisRef);
  const queryClient = useQueryClient();
  // V8.16s — favoris locaux (localStorage, aucune authentification requise).
  const {
    estFavori,
    basculer: basculerFavori,
    disponibles: favorisDisponibles,
  } = useFavorisLocal();

  const { data } = useQuery({
    queryKey: ["fournisseurs", query, corpsEtats, famille, anneeDe, anneeFin, profil, activite],
    queryFn: () =>
      fetchList({
        data: {
          query,
          corpsEtats,
          famille: (famille || undefined) as "CEA" | "CVC-P" | "TCE" | "AUTRE" | undefined,
          anneeDe: anneeDe ?? undefined,
          anneeFin: anneeFin ?? undefined,
          profil: (profil || undefined) as "principal" | "secondaire" | "occasionnel" | undefined,
          activite: (activite || undefined) as "annee" | "3ans" | "5ans" | undefined,
        },
      }),
  });

  const lignes = useMemo(() => (data?.fournisseurs ?? []) as LigneFournisseurListe[], [data]);
  const corpsDisponibles = (data?.corps_disponibles ?? []) as string[];
  // V8.16s — plage effective du slider (défaut : toutes les années réelles).
  const anneesMin = (data?.annee_min as number | null) ?? 2020;
  const anneesMax = (data?.annee_max as number | null) ?? 2026;
  const plageEffective = {
    de: anneeDe ?? anneesMin,
    fin: anneeFin ?? anneesMax,
  };
  // Filtres CLIENT : favoris (localStorage) + entreprises sans commande masquées.
  const lignesFiltrees = useMemo(() => {
    let out = lignes;
    if (favorisOnly) out = out.filter((l) => estFavori(l.id));
    if (!sansCmdVisible) out = out.filter((l) => !l.sans_commande);
    return out;
  }, [lignes, favorisOnly, sansCmdVisible, estFavori]);

  const triees = useMemo(() => {
    if (sort) return trierListe(lignesFiltrees, sort.key, sort.dir);
    if (marche.sort) {
      // Tri de la colonne « Part de marché » selon le mode sélectionné.
      const cle =
        marche.mode === "principaux" ? "part_marche_annee_principaux" : "part_marche_annee";
      return trierListe(lignesFiltrees, cle, marche.sort);
    }
    if (corpsEtats.length) {
      // Classement recherche corps : principal > secondaire > occasionnel > absent.
      return [...lignesFiltrees].sort(
        (a, b) =>
          (ORDRE_NIVEAU[a.niveau_corps_recherche ?? "occasionnel"] ?? 3) -
          (ORDRE_NIVEAU[b.niveau_corps_recherche ?? "occasionnel"] ?? 3),
      );
    }
    // Tri par défaut : dernière commande DESC (entreprises sans commande en fin).
    return trierListe(lignesFiltrees, "derniere_commande_date", "desc");
  }, [lignesFiltrees, sort, marche, corpsEtats]);

  const mutation = useMutation({
    mutationFn: (variables: Record<string, unknown>) => create({ data: variables }),
    onSuccess: (res) => {
      const r = res as { ok: boolean; error?: string };
      if (r.ok) {
        toast.success("Fournisseur créé.");
        setOpen(false);
        queryClient.invalidateQueries({ queryKey: ["fournisseurs"] });
      } else {
        toast.error(r.error ?? "Création impossible.");
      }
    },
  });

  // V8.16s — favoris LOCAUX (localStorage) : plus d'appel serveur ni d'authentification.
  const onToggleFavori = (l: LigneFournisseurListe) => {
    if (!l.id) return;
    basculerFavori(l.id);
  };

  const sortClick = (key: string) => {
    setMarche((p) => ({ ...p, sort: null }));
    setSort((p) => {
      if (!p || p.key !== key) return { key, dir: "desc" };
      if (p.dir === "desc") return { key, dir: "asc" };
      return null; // retour au tri par défaut
    });
  };

  /** Bascule « Part de marché » : principaux ↓ → tous ↓ → tous ↑ → défaut. */
  const marcheClick = () => {
    setSort(null);
    setMarche((p) => {
      if (!p.sort) return { mode: "principaux", sort: "desc" };
      if (p.mode === "principaux") return { mode: "tous", sort: "desc" };
      if (p.sort === "desc") return { mode: "tous", sort: "asc" };
      return { mode: "tous", sort: null };
    });
  };

  const sortIndicator = (key: string) =>
    sort?.key === key ? (
      sort.dir === "desc" ? (
        <ArrowDown className="ml-1 inline size-3.5" />
      ) : (
        <ArrowUp className="ml-1 inline size-3.5" />
      )
    ) : null;

  // Création d'une fiche depuis une Ref ISIS (nom jamais inventé : « À renseigner »).
  const renseignerRef = async (ref: string) => {
    const res = (await creerDepuisRef({ data: { ref } })) as {
      ok: boolean;
      fournisseur_id?: string;
      error?: string;
    };
    if (res.ok && res.fournisseur_id) {
      queryClient.invalidateQueries({ queryKey: ["fournisseurs"] });
      toast.success("Fiche fournisseur créée — renseignez le nom réel.");
      navigate({
        to: "/fournisseurs/$fournisseurId",
        params: { fournisseurId: res.fournisseur_id },
        search: { cmd: undefined, annee: undefined },
      });
    } else {
      toast.error(res.error ?? "Création impossible.");
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-[2200px] flex-wrap items-center gap-3 px-4 py-4 sm:px-6">
          <div className="mr-auto">
            <h1 className="flex items-center gap-2 text-lg font-semibold leading-tight">
              <Building2 className="size-5 text-primary" /> Fournisseurs
            </h1>
            <p className="text-sm text-muted-foreground">
              Sourcing — profil d'activité, familles (CEA / CVC-P / TCE), KPIs montant engagé.
              Sources immuables.
            </p>
          </div>
          <Button onClick={() => setOpen(true)}>
            <Plus className="size-4" /> Ajouter un fournisseur
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-[2200px] space-y-5 px-4 py-6 sm:px-6">
        {lignes.length === 0 && data ? (
          <Card>
            <CardContent className="p-4 text-sm text-muted-foreground">
              Référentiel vide : aucun fournisseur renseigné. Ajoutez une entreprise (les
              identifiants sources et les Excel restent immuables).
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recherche & filtres</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <Label>Nom entreprise ou identifiant</Label>
              <div className="relative">
                <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Dupont, 12562, 218021…"
                  className="pl-9"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Corps d'état (multi-sélection)</Label>
              <CorpsEtatMultiSelect
                options={corpsDisponibles}
                selected={corpsEtats}
                onChange={setCorpsEtats}
              />
            </div>
            <div className="space-y-1">
              <Label>Famille métier</Label>
              <Select value={famille} onValueChange={(v) => setFamille(v === "toutes" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Toutes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="toutes">Toutes</SelectItem>
                  <SelectItem value="CEA">CEA</SelectItem>
                  <SelectItem value="CVC-P">CVC-P</SelectItem>
                  <SelectItem value="TCE">TCE</SelectItem>
                  <SelectItem value="AUTRE">AUTRE</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Années (plage)</Label>
              <div className="flex items-center gap-2 pt-2">
                <span className="w-10 shrink-0 text-right font-mono text-xs text-muted-foreground">
                  {plageEffective.de}
                </span>
                <SliderPrimitive.Root
                  className="relative flex w-full touch-none select-none items-center"
                  min={anneesMin}
                  max={anneesMax}
                  step={1}
                  value={[plageEffective.de, plageEffective.fin]}
                  onValueChange={(v) => {
                    const de = v[0] ?? null;
                    const fin = v[1] ?? null;
                    setAnneeDe(de);
                    setAnneeFin(fin);
                  }}
                >
                  <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-slate-200">
                    <SliderPrimitive.Range className="absolute h-full bg-blue-600" />
                  </SliderPrimitive.Track>
                  <SliderPrimitive.Thumb className="block h-4 w-4 rounded-full border-2 border-blue-600 bg-white shadow transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" />
                  <SliderPrimitive.Thumb className="block h-4 w-4 rounded-full border-2 border-blue-600 bg-white shadow transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" />
                </SliderPrimitive.Root>
                <span className="w-10 shrink-0 font-mono text-xs text-muted-foreground">
                  {plageEffective.fin}
                </span>
              </div>
              <div className="flex items-center justify-between pt-1">
                <p className="text-xs text-muted-foreground">
                  Du {plageEffective.de} au {plageEffective.fin} — commandes & montants agrégés sur
                  la plage.
                </p>
                <button
                  type="button"
                  className="text-xs font-medium text-primary hover:underline"
                  onClick={() => {
                    setAnneeDe(null);
                    setAnneeFin(null);
                  }}
                >
                  Toutes
                </button>
              </div>
            </div>
            <div className="space-y-1">
              <Label>Profil d'activité</Label>
              <Select value={profil} onValueChange={(v) => setProfil(v === "tous" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Tous" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tous">Tous</SelectItem>
                  <SelectItem value="principal">Principal</SelectItem>
                  <SelectItem value="secondaire">Secondaire</SelectItem>
                  <SelectItem value="occasionnel">Occasionnel</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Activité</Label>
              <Select value={activite} onValueChange={(v) => setActivite(v === "toute" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Toutes périodes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="toute">Toutes périodes</SelectItem>
                  <SelectItem value="annee">Actif sur l'année</SelectItem>
                  <SelectItem value="3ans">Actif sur 3 ans</SelectItem>
                  <SelectItem value="5ans">Actif sur 5 ans</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-wrap items-end gap-4">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="sansCmd"
                  checked={sansCmdVisible}
                  onCheckedChange={(v) => setSansCmdVisible(v !== false)}
                />
                <Label htmlFor="sansCmd" className="text-sm font-normal leading-none">
                  Afficher les entreprises sans commande
                </Label>
              </div>
              <Button
                variant={favorisOnly ? "default" : "outline"}
                onClick={() => setFavorisOnly((v) => !v)}
                disabled={!favorisDisponibles}
              >
                <Star className={`size-4 ${favorisOnly ? "fill-current" : ""}`} /> Favoris
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Entreprises ({triees.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">★</TableHead>
                  <TableHead
                    className="cursor-pointer select-none"
                    onClick={() => sortClick("ref_isis")}
                  >
                    Ref ISIS {sortIndicator("ref_isis")}
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none"
                    onClick={() => sortClick("nom")}
                  >
                    Entreprise {sortIndicator("nom")}
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none"
                    onClick={() => sortClick("activites")}
                  >
                    Activités principales {sortIndicator("activites")}
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none"
                    onClick={() => sortClick("famille")}
                  >
                    Famille {sortIndicator("famille")}
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none"
                    onClick={() => sortClick("derniere_commande_date")}
                  >
                    Dernière commande {sortIndicator("derniere_commande_date")}
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none text-right"
                    onClick={() => sortClick("commandes_annee")}
                  >
                    Commandes {sortIndicator("commandes_annee")}
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none text-right"
                    onClick={() => sortClick("montant_annee")}
                  >
                    Montant {sortIndicator("montant_annee")}
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none text-right"
                    onClick={() => sortClick("evolution_montant")}
                  >
                    Évolution {sortIndicator("evolution_montant")}
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none text-right"
                    onClick={marcheClick}
                  >
                    {marche.sort
                      ? marche.mode === "principaux"
                        ? "Part de marché — principaux"
                        : "Part de marché — tous"
                      : "Part de marché"}{" "}
                    {marche.sort ? (
                      marche.sort === "desc" ? (
                        <ArrowDown className="ml-1 inline size-3.5" />
                      ) : (
                        <ArrowUp className="ml-1 inline size-3.5" />
                      )
                    ) : null}
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none text-right"
                    onClick={() => sortClick("nb_corps_etat")}
                  >
                    Nb corps d'état {sortIndicator("nb_corps_etat")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {triees.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={11}
                      className="py-6 text-center text-sm text-muted-foreground"
                    >
                      Aucun fournisseur ne correspond aux critères.
                    </TableCell>
                  </TableRow>
                ) : (
                  triees.map((l) => (
                    <TableRow key={l.id ?? `ref:${l.ref_isis ?? l.identifiants[0] ?? "?"}`}>
                      <TableCell>
                        {favorisDisponibles && l.id ? (
                          <button
                            onClick={() => onToggleFavori(l)}
                            title={estFavori(l.id) ? "Retirer des favoris" : "Ajouter aux favoris"}
                            className="text-amber-500 hover:scale-110"
                          >
                            <Star className={`size-4 ${estFavori(l.id) ? "fill-current" : ""}`} />
                          </button>
                        ) : (
                          <span className="text-slate-300">
                            <Star className="size-4" />
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {l.ref_isis ? (
                          l.id ? (
                            <Link
                              to="/fournisseurs/$fournisseurId"
                              params={{ fournisseurId: l.id }}
                              search={{ cmd: undefined, annee: undefined }}
                              className="font-mono text-sm font-semibold text-primary hover:underline"
                            >
                              {l.ref_isis}
                            </Link>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 gap-1 px-1.5 font-mono text-xs"
                              onClick={() => renseignerRef(l.ref_isis as string)}
                              title="Créer la fiche fournisseur depuis cette Ref ISIS"
                            >
                              {l.ref_isis} <Plus className="size-3" />
                            </Button>
                          )
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>
                        {l.id ? (
                          <Link
                            to="/fournisseurs/$fournisseurId"
                            params={{ fournisseurId: l.id }}
                            search={{ cmd: undefined, annee: undefined }}
                            className="font-medium text-primary hover:underline"
                          >
                            {libelleEntreprise(l.nom)}
                          </Link>
                        ) : (
                          <span className="italic text-muted-foreground">
                            Entreprise non renseignée
                          </span>
                        )}
                        {/* V8.16p — pastille jaune « à compléter » (nom ou email manquant) */}
                        {l.a_completer &&
                          (l.id ? (
                            <Link
                              to="/fournisseurs/$fournisseurId"
                              params={{ fournisseurId: l.id }}
                              search={{ cmd: undefined, annee: undefined }}
                              className="ml-1.5 inline-block size-2.5 rounded-full bg-amber-400 align-middle"
                              title="Fiche à compléter : email fournisseur manquant"
                            />
                          ) : (
                            <button
                              type="button"
                              onClick={() => l.ref_isis && renseignerRef(l.ref_isis)}
                              className="ml-1.5 inline-block size-2.5 rounded-full bg-amber-400 align-middle"
                              title="Créer la fiche fournisseur (nom/email manquants)"
                            />
                          ))}
                        <div className="text-[10px] text-muted-foreground">
                          {(l.identifiants ?? []).join(", ") || "aucun identifiant"}
                        </div>
                      </TableCell>
                      <TableCell>{ActivitesPrincipalesCell({ ligne: l })}</TableCell>
                      <TableCell>
                        <FamilleCell famille={l.famille} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {l.derniere_commande_date ? (
                          <span className="flex items-center gap-1">
                            <span>{formatDateCommandeFr(l.derniere_commande_date)}</span>
                            {l.derniere_commande_numero ? (
                              <Link
                                to="/dashboard-travaux"
                                search={{
                                  commande: l.derniere_commande_numero,
                                  de: undefined,
                                  a: undefined,
                                }}
                                className="font-semibold text-primary hover:underline"
                              >
                                #{l.derniere_commande_numero}
                              </Link>
                            ) : null}
                          </span>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="text-right">{l.commandes_annee}</TableCell>
                      <TableCell className="text-right font-semibold">
                        {money2(l.montant_annee)}
                      </TableCell>
                      <TableCell className="text-right">
                        <EvoCell v={l.evolution_montant} />
                      </TableCell>
                      <TableCell className="text-right">
                        {pct(
                          marche.mode === "principaux"
                            ? l.part_marche_annee_principaux
                            : l.part_marche_annee,
                        )}
                      </TableCell>
                      <TableCell className="text-right">{l.nb_corps_etat}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </main>

      <AjouterFournisseurDialog
        open={open}
        onClose={() => setOpen(false)}
        onSave={(payload) => mutation.mutate(payload)}
        pending={mutation.isPending}
      />
    </div>
  );
}

function AjouterFournisseurDialog({
  open,
  onClose,
  onSave,
  pending,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (payload: Record<string, unknown>) => void;
  pending: boolean;
}) {
  const [form, setForm] = useState({
    nom: "",
    adresse: "",
    complementAdresse: "",
    codePostal: "",
    ville: "",
    pays: "",
    siteWeb: "",
    notes: "",
    contact1Nom: "",
    contact1Fonction: "",
    contact1Email: "",
    contact1Telephone: "",
    contact2Nom: "",
    contact2Fonction: "",
    contact2Email: "",
    contact2Telephone: "",
    aliasSuivi: "",
    aliasPsp: "",
  });
  const set = (k: keyof typeof form) => (e: ChangeEvent<HTMLInputElement>) =>
    setForm((p) => ({ ...p, [k]: e.target.value }));

  const submit = () => {
    if (!form.nom.trim()) {
      toast.error("Le nom est obligatoire.");
      return;
    }
    const contacts = [
      {
        nom: form.contact1Nom,
        fonction: form.contact1Fonction,
        email: form.contact1Email,
        telephone: form.contact1Telephone,
      },
      {
        nom: form.contact2Nom,
        fonction: form.contact2Fonction,
        email: form.contact2Email,
        telephone: form.contact2Telephone,
      },
    ]
      .filter((c) => c.nom.trim() !== "")
      .map((c) => ({
        nom: c.nom.trim(),
        fonction: c.fonction.trim() || null,
        email: c.email.trim() || null,
        telephone: c.telephone.trim() || null,
      }));
    const aliases: {
      source: "travaux_commandes" | "psp_import_rows";
      identifiantSource: string;
    }[] = [];
    if (form.aliasSuivi.trim())
      aliases.push({ source: "travaux_commandes", identifiantSource: form.aliasSuivi.trim() });
    if (form.aliasPsp.trim())
      aliases.push({ source: "psp_import_rows", identifiantSource: form.aliasPsp.trim() });

    onSave({
      nom: form.nom.trim(),
      adresse: form.adresse.trim() || null,
      complementAdresse: form.complementAdresse.trim() || null,
      codePostal: form.codePostal.trim() || null,
      ville: form.ville.trim() || null,
      pays: form.pays.trim() || null,
      siteWeb: form.siteWeb.trim() || null,
      notes: form.notes.trim() || null,
      contacts,
      aliases,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="size-4" /> Ajouter un fournisseur
          </DialogTitle>
          <DialogDescription>
            Le fournisseur est identifié par son UUID interne. Les identifiants issus des Excel
            (suivi annuel, FRAN_NUM Historique CMD) sont saisis comme alias : ils peuvent être
            différents et pointer vers le même fournisseur, sans jamais modifier les sources.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Labeled label="Nom *">
            <Input value={form.nom} onChange={set("nom")} placeholder="Entreprise Dupont" />
          </Labeled>
          <div className="space-y-1">
            <Label className="text-xs">Identifiants sources (alias)</Label>
            <div className="grid grid-cols-1 gap-2">
              <Input
                value={form.aliasSuivi}
                onChange={set("aliasSuivi")}
                placeholder="Suivi annuel — ex. 12562"
              />
              <Input
                value={form.aliasPsp}
                onChange={set("aliasPsp")}
                placeholder="Historique CMD (FRAN_NUM) — ex. 218021"
              />
            </div>
          </div>
          <Labeled label="Adresse">
            <Input value={form.adresse} onChange={set("adresse")} />
          </Labeled>
          <Labeled label="Complément adresse">
            <Input value={form.complementAdresse} onChange={set("complementAdresse")} />
          </Labeled>
          <Labeled label="Code postal">
            <Input value={form.codePostal} onChange={set("codePostal")} />
          </Labeled>
          <Labeled label="Ville">
            <Input value={form.ville} onChange={set("ville")} />
          </Labeled>
          <Labeled label="Pays">
            <Input value={form.pays} onChange={set("pays")} />
          </Labeled>
          <Labeled label="Site web">
            <Input value={form.siteWeb} onChange={set("siteWeb")} />
          </Labeled>
          <div className="sm:col-span-2">
            <Labeled label="Notes">
              <Input value={form.notes} onChange={set("notes")} />
            </Labeled>
          </div>
          <div className="space-y-3 rounded-lg border p-3 sm:col-span-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Responsable 1
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Labeled label="Nom">
                <Input value={form.contact1Nom} onChange={set("contact1Nom")} />
              </Labeled>
              <Labeled label="Fonction">
                <Input value={form.contact1Fonction} onChange={set("contact1Fonction")} />
              </Labeled>
              <Labeled label="Email">
                <Input value={form.contact1Email} onChange={set("contact1Email")} />
              </Labeled>
              <Labeled label="Téléphone">
                <Input value={form.contact1Telephone} onChange={set("contact1Telephone")} />
              </Labeled>
            </div>
            <p className="pt-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Responsable 2
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Labeled label="Nom">
                <Input value={form.contact2Nom} onChange={set("contact2Nom")} />
              </Labeled>
              <Labeled label="Fonction">
                <Input value={form.contact2Fonction} onChange={set("contact2Fonction")} />
              </Labeled>
              <Labeled label="Email">
                <Input value={form.contact2Email} onChange={set("contact2Email")} />
              </Labeled>
              <Labeled label="Téléphone">
                <Input value={form.contact2Telephone} onChange={set("contact2Telephone")} />
              </Labeled>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? "Création…" : "Créer le fournisseur"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CorpsEtatMultiSelect({
  options,
  selected,
  onChange,
}: {
  options: string[];
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Recherche sur le libellé complet (le code est conservé en préfixe : « (j) Couvertures »).
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q ? options.filter((o) => o.toLowerCase().includes(q)) : options;
    return [...list].sort((a, b) => a.localeCompare(b));
  }, [options, search]);

  const toggle = (c: string) =>
    onChange(selected.includes(c) ? selected.filter((x) => x !== c) : [...selected, c]);
  const tout = () => onChange(options.length ? [...options] : []);
  const effacer = () => onChange([]);

  // ENTER → sélectionne la première proposition PERTINENTE non déjà cochée
  // (jamais de doublon, jamais de suppression des sélections existantes).
  const onEnter = () => {
    const ajout = premierePropositionCorpsEtat(search, options, selected);
    if (ajout) onChange([...selected, ajout]);
    setSearch("");
    setOpen(false);
  };

  // Fermeture au clic extérieur.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const premiere = premierePropositionCorpsEtat(search, options, selected);

  return (
    <div ref={containerRef} className="relative">
      <div className="flex min-h-[36px] flex-wrap items-center gap-1 rounded-lg border bg-card px-2 py-1.5 focus-within:ring-1 focus-within:ring-ring">
        {selected.map((c) => (
          <Badge key={c} variant="outline" className="gap-1">
            {c}
            <button
              onClick={() => toggle(c)}
              className="text-muted-foreground hover:text-destructive"
              aria-label={`Retirer ${c}`}
            >
              <X className="size-3" />
            </button>
          </Badge>
        ))}
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onEnter();
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          placeholder={
            selected.length === 0 ? "Rechercher un corps d'état… (ex. plomberie, j)" : "Ajouter…"
          }
          className="min-w-[140px] flex-1 border-none bg-transparent text-xs outline-none placeholder:text-muted-foreground"
          aria-label="Rechercher un corps d'état"
        />
      </div>
      {open ? (
        <div className="absolute z-50 mt-1 w-full rounded-lg border bg-popover p-2 shadow-md">
          <div className="flex justify-between px-1 pb-1 text-[10px] font-bold uppercase tracking-wider">
            <button className="text-primary hover:underline" onClick={tout}>
              Tout sélectionner
            </button>
            <button className="text-destructive hover:underline" onClick={effacer}>
              Effacer
            </button>
          </div>
          <div className="max-h-52 space-y-0.5 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="py-2 text-center text-xs text-muted-foreground">Aucun corps d'état.</p>
            ) : (
              filtered.map((c) => (
                <label
                  key={c}
                  className="flex cursor-pointer items-start gap-2 rounded p-1 hover:bg-muted/50"
                >
                  <Checkbox checked={selected.includes(c)} onCheckedChange={() => toggle(c)} />
                  <span className="text-xs font-medium">{c}</span>
                </label>
              ))
            )}
          </div>
          {search.trim() !== "" ? (
            <p className="mt-1 border-t pt-1 text-[10px] text-muted-foreground">
              {premiere
                ? `Entrée ↵ → sélectionner « ${premiere} »`
                : "Toutes les propositions sont déjà sélectionnées (Entrée sans effet)."}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
