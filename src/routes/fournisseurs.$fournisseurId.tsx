import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import {
  Building2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  FilterX,
  Info,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  RotateCcw,
  Save,
  Search,
  Star,
  Trash2,
  User,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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
import { Textarea } from "@/components/ui/textarea";
import {
  getFournisseurDetail,
  saveActivitesManuelles,
  toggleFournisseurFavori,
  updateFournisseur,
} from "@/lib/fournisseurs.functions";
import {
  ORDRE_NIVEAU,
  PROFIL_BADGE,
  extraireAdressePhysique,
  timestampDateCommande,
  trancheDeCommande,
  trierHistoriqueAnnuelDesc,
  trierLignes,
  type ActiviteEffective,
  type ActiviteManuelle,
  type ProfilActivite,
  type ProfilNiveau,
  type VilleFournisseur,
} from "@/lib/fournisseurs.analyse";
import { evo, money2, pct } from "@/lib/formats";
import EvoCell from "@/components/EvoCell";
import Labeled from "@/components/Labeled";
import NiveauBadge from "@/components/NiveauBadge";
import {
  estValeurEtatPlausible,
  libelleEntreprise,
  refIsisDepuisAliases,
  type CommandeFournisseur,
  type Fournisseur,
  type FournisseurAlias,
  type FournisseurContact,
} from "@/lib/fournisseurs";
import CommandeFicheDialog from "@/components/CommandeFicheDialog";
import { construireSearchAdresses } from "@/lib/adresses";
import {
  LISTE_FOURNISSEURS_SEARCH_VIDE,
  type ListeFournisseursSearch,
} from "@/routes/fournisseurs.index";
import type { CommandeTravauxEnrichie } from "@/lib/travaux.dashboard.functions";
import { formatDateCommandeFr } from "@/lib/psp.validation";

export const Route = createFileRoute("/fournisseurs/$fournisseurId")({
  // Param `?cmd=<commandeId>` (fiche commande en overlay) et `?annee=` (KPI).
  validateSearch: (s: Record<string, unknown>) => ({
    cmd: typeof s["cmd"] === "string" ? s["cmd"] : undefined,
    annee:
      typeof s["annee"] === "number" || typeof s["annee"] === "string"
        ? Number(s["annee"])
        : undefined,
  }),
  head: () => ({
    meta: [{ title: "Fiche fournisseur" }],
  }),
  component: FournisseurFiche,
});

const FournisseurVillesMap = lazy(() => import("@/components/FournisseurVillesMap"));

/** Carte des villes — chargée uniquement côté client (react-leaflet), comme le Dashboard. */
function CarteVillesClient({ villes }: { villes: VilleFournisseur[] }) {
  const [isClient, setIsClient] = useState(false);
  useEffect(() => {
    setIsClient(true);
  }, []);
  if (!isClient)
    return (
      <div className="flex h-full w-full items-center justify-center bg-slate-50 text-[10px] font-black uppercase tracking-widest text-slate-300">
        Chargement carte...
      </div>
    );
  return (
    <Suspense
      fallback={
        <div className="flex h-full w-full items-center justify-center bg-slate-50 text-[10px] font-black uppercase tracking-widest text-slate-300">
          Chargement carte...
        </div>
      }
    >
      <FournisseurVillesMap villes={villes} />
    </Suspense>
  );
}

function FournisseurFiche() {
  const { fournisseurId } = Route.useParams();
  const routeSearch = Route.useSearch();
  const navigate = Route.useNavigate();
  const cmdParam = routeSearch.cmd;
  // P0-2 : filtres/tri de la liste persistés par /fournisseurs (retour contextuel).
  const retourListeSearch = useMemo<ListeFournisseursSearch>(() => {
    try {
      const raw = sessionStorage.getItem("pat-s11:fournisseurs:liste");
      if (raw) return { ...LISTE_FOURNISSEURS_SEARCH_VIDE, ...(JSON.parse(raw) as object) };
    } catch {
      // stockage indisponible / corrompu : liste vierge.
    }
    return LISTE_FOURNISSEURS_SEARCH_VIDE;
  }, []);
  const [editOpen, setEditOpen] = useState(false);
  // Année KPI persistée dans l'URL (`?annee=`) : partageable, conservée par le retour
  // navigateur et les overlays (Phase 6B).
  const annee = routeSearch.annee ?? null;
  const changerAnnee = (a: number | null) =>
    navigate({ search: (prev) => ({ ...prev, annee: a ?? undefined }) });
  const fetchDetail = useServerFn(getFournisseurDetail);
  const toggleFavori = useServerFn(toggleFournisseurFavori);
  const update = useServerFn(updateFournisseur);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["fournisseur", fournisseurId, annee],
    queryFn: () => fetchDetail({ data: { id: fournisseurId, annee: annee ?? undefined } }),
  });

  const onToggleFavori = async () => {
    if (!data?.fournisseur?.id) return;
    const res = (await toggleFavori({
      data: { fournisseurId: data.fournisseur.id, favori: !data.favori },
    })) as { ok: boolean; error?: string };
    if (res.ok) {
      queryClient.invalidateQueries({ queryKey: ["fournisseur", fournisseurId] });
    } else {
      toast.error(res.error ?? "Favori indisponible.");
    }
  };

  const updateMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => update({ data: payload }),
    onSuccess: (res) => {
      const r = res as { ok: boolean; error?: string };
      if (r.ok) {
        toast.success("Fiche fournisseur enregistrée.");
        setEditOpen(false);
        queryClient.invalidateQueries({ queryKey: ["fournisseur", fournisseurId] });
      } else {
        toast.error(r.error ?? "Enregistrement impossible.");
      }
    },
  });

  // ———— Activités manuelles / validées ——————————————————————————————————————————————————————————————————————————————————
  const [editActivites, setEditActivites] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [addSearch, setAddSearch] = useState("");
  const [addNiveau, setAddNiveau] = useState<ProfilNiveau>("principal");
  // Tri des tables (1er clic desc, 2e asc, 3e retour défaut).
  const [triAct, setTriAct] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);
  const [triCmd, setTriCmd] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);
  // Fiche commande en superposition (aucune navigation) + détails patrimoine + filtre État.
  const [commandeOuverte, setCommandeOuverte] = useState<CommandeFournisseur | null>(null);
  const [detailsPatrimoine, setDetailsPatrimoine] = useState(false);
  const [filtresEtat, setFiltresEtat] = useState<string[]>([]);
  const saveAct = useServerFn(saveActivitesManuelles);

  const saveActMutation = useMutation({
    mutationFn: (payload: { fournisseurId: string; activites: unknown[] }) =>
      saveAct({ data: payload }),
    onSuccess: (res) => {
      const r = res as { ok: boolean; error?: string };
      if (r.ok) {
        toast.success("Activités enregistrées.");
        setResetOpen(false);
        queryClient.invalidateQueries({ queryKey: ["fournisseur", fournisseurId] });
      } else {
        toast.error(r.error ?? "Enregistrement impossible.");
      }
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Enregistrement impossible.");
    },
  });

  /** Construit la liste souhaitée des décisions manuelles (aucune écriture directe). */
  const buildListeManuelle = (
    modifs: Array<{
      corps_etat_code: string;
      corps_etat_libelle: string;
      niveau: ProfilNiveau;
    } | null>,
  ) => {
    const carte = new Map<
      string,
      { corps_etat_code: string; corps_etat_libelle: string; niveau: ProfilNiveau }
    >();
    for (const a of activitesManuel) {
      carte.set(a.corps_etat_code, {
        corps_etat_code: a.corps_etat_code,
        corps_etat_libelle: a.corps_etat_libelle,
        niveau: a.niveau,
      });
    }
    for (const m of modifs) {
      if (!m) continue;
      carte.set(m.corps_etat_code, m);
    }
    return [...carte.values()];
  };

  /**
   * Choix EXPLICITE du niveau via sélecteur (Principal / Secondaire / Occasionnel).
   * Enregistre uniquement dans fournisseur_activites (source 'manuel').
   * Pas d'override inutile : sélection égale au niveau automatique et sans décision
   * manuelle existante → aucune écriture.
   */
  const changerNiveauSelect = (row: ActiviteEffective, niveau: ProfilNiveau) => {
    if (row.niveau_manuel === niveau) return;
    if (row.niveau_manuel == null && row.niveau_auto === niveau) return;
    saveActMutation.mutate({
      fournisseurId,
      activites: buildListeManuelle([
        { corps_etat_code: row.code, corps_etat_libelle: row.corps_etat, niveau },
      ]),
    });
  };

  const ajouterActivite = (code: string, libelle: string, niveau: ProfilNiveau) => {
    saveActMutation.mutate({
      fournisseurId,
      activites: buildListeManuelle([
        { corps_etat_code: code, corps_etat_libelle: libelle, niveau },
      ]),
    });
    setAddSearch("");
  };

  const reinitialiserActivites = () => {
    saveActMutation.mutate({ fournisseurId, activites: [] });
  };

  const triClickAct = (key: string) =>
    setTriAct((p) => {
      if (!p || p.key !== key) return { key, dir: "desc" };
      if (p.dir === "desc") return { key, dir: "asc" };
      return null;
    });
  const triClickCmd = (key: string) =>
    setTriCmd((p) => {
      if (!p || p.key !== key) return { key, dir: "desc" };
      if (p.dir === "desc") return { key, dir: "asc" };
      return null;
    });
  const indAct = (key: string) =>
    triAct?.key === key ? (triAct.dir === "desc" ? " ↓" : " ↑") : "";
  const indCmd = (key: string) =>
    triCmd?.key === key ? (triCmd.dir === "desc" ? " ↓" : " ↑") : "";

  const fournisseur = data?.fournisseur ?? null;
  const contacts = (data?.contacts ?? []) as FournisseurContact[];
  const aliases = (data?.aliases ?? []) as FournisseurAlias[];
  const refIsis = refIsisDepuisAliases(aliases);
  const franNum = aliases.find((a) => a.source === "psp_import_rows")?.identifiant_source ?? null;
  const autresAlias = aliases.filter(
    (a) => a.source !== "travaux_commandes" && a.source !== "psp_import_rows",
  );
  const commandes = (data?.commandes ?? []) as CommandeFournisseur[];

  // Fiche commande pilotée par l'URL (`?cmd=<commandeId>`, back-aware) :
  //  - le param présent ouvre l'overlay dès que les commandes du fournisseur sont chargées ;
  //  - retirer le param (bouton retour navigateur) ferme l'overlay.
  useEffect(() => {
    if (!cmdParam) {
      setCommandeOuverte(null);
      return;
    }
    if (commandes.length === 0) return;
    const found = commandes.find((c) => c.id === cmdParam);
    if (found) setCommandeOuverte(found);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cmdParam, commandes]);
  const profil = (data?.profil ?? null) as ProfilActivite | null;
  const historique = (data?.historique_annuel ?? []) as {
    annee: number;
    commandes: number;
    montant: number;
    part_marche: number | null;
  }[];
  const activitesEffectives = (data?.activites_effectives ?? []) as ActiviteEffective[];
  const activitesManuel = (data?.activites_manuel ?? []) as ActiviteManuelle[];
  const activitesDisponibles = data?.activites_disponibles === true;
  const corpsDisponibles = (data?.corps_disponibles ?? []) as {
    corps_etat: string;
    code: string;
    libelle: string;
  }[];

  // ———— Données dérivées pour l'affichage / le tri ——————————————————————————————————————————————————————————
  const principales = activitesEffectives.filter((a) => a.niveau === "principal");
  const autres = activitesEffectives.filter((a) => a.niveau !== "principal");
  const dejaCodes = new Set(activitesEffectives.map((a) => a.code));
  const corpsDisponiblesFiltres = corpsDisponibles.filter(
    (c) => !dejaCodes.has(c.code) && c.corps_etat.toLowerCase().includes(addSearch.toLowerCase()),
  );
  const effectivesTriees = useMemo(() => {
    if (!triAct) return activitesEffectives;
    const get = (a: ActiviteEffective): number | string | null => {
      switch (triAct.key) {
        case "corps_etat":
          return a.corps_etat.toLowerCase();
        case "commandes":
          return a.commandes;
        case "partCommandes":
          return a.partCommandes;
        case "montant":
          return a.montant;
        case "niveau":
          return ORDRE_NIVEAU[a.niveau ?? "occasionnel"] ?? 3;
        default:
          return null;
      }
    };
    return trierLignes(activitesEffectives, get, triAct.dir);
  }, [activitesEffectives, triAct]);
  // États réellement présents dans les commandes de ce fournisseur (bruit numérique exclu).
  const etatsDisponibles = useMemo(() => {
    const set = new Set<string>();
    for (const c of commandes) {
      const e = (c.etat ?? "").trim();
      if (e && estValeurEtatPlausible(e)) set.add(e);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [commandes]);

  const commandesTriees = useMemo(() => {
    let base = commandes;
    if (filtresEtat.length > 0) {
      base = base.filter((c) => !!c.etat && filtresEtat.includes(c.etat));
    }
    if (!triCmd) return base;
    const get = (c: CommandeFournisseur): number | string | null => {
      switch (triCmd.key) {
        case "date":
          // Vraie valeur temporelle (jamais la chaîne affichée), null → fin de tri.
          return timestampDateCommande(c.date_commande, c.date_demarrage);
        case "commande":
          return c.numero_commande;
        case "description":
          return c.descriptif;
        case "categorie":
          return c.categorie;
        case "corps_etat":
          return c.corps_etat;
        case "montant":
          return c.montant;
        case "tranche":
          return trancheDeCommande(c);
        case "patrimoine":
          return c.patrimoine;
        case "adresse":
          return extraireAdressePhysique(c.adresse);
        case "etat":
          return c.etat;
        default:
          return null;
      }
    };
    return trierLignes(base, get, triCmd.dir);
  }, [commandes, triCmd, filtresEtat]);
  const patrimoine = (data?.patrimoine ?? null) as {
    tranches: string[];
    batiments: string[];
    entrees: string[];
    lots: string[];
    villes: string[];
  } | null;
  const kpisAnnee = (data?.kpis_annee ?? null) as {
    annee: number | null;
    commandes: number;
    montant: number;
    evolution_commandes: number | null;
    evolution_montant: number | null;
    part_marche: number | null;
    part_marche_moyenne: number | null;
  } | null;
  const favori = data?.favori === true;
  const anneeMax = (data?.annee_max as number | null) ?? null;
  const anneeSelect = annee ?? anneeMax;
  // Années disponibles pour le stepper KPI (historique déjà trié décroissant côté serveur).
  const anneesListe = historique.map((h) => h.annee);
  const idxAnnees = anneeSelect != null ? anneesListe.indexOf(anneeSelect) : -1;
  const anneePrecedente = idxAnnees >= 0 ? (anneesListe[idxAnnees + 1] ?? null) : null;
  const anneeSuivante = idxAnnees > 0 ? (anneesListe[idxAnnees - 1] ?? null) : null;
  const villesCarte = (data?.villes_carte ?? []) as VilleFournisseur[];
  const villesNonLocalisees = (data?.villes_non_localisees ?? []) as string[];
  const commandesSansVille = (data?.commandes_sans_ville as number | undefined) ?? 0;

  /**
   * Paramètres de recherche /adresses pour ouvrir LE patrimoine précis d'une commande
   * (même mécanisme que la navigation interne d'/adresses) :
   *  - ville + tranche + rue : le terme « rue » est le segment de l'adresse AVANT la
   *    première virgule / « - » (formats réels de la table lots : « 2  RUE DU PRESSOIR »),
   *    dérivé des données, jamais inventé ;
   *  - sinon recherche par identifiant patrimoine (code ER).
   */
  const recherchePatrimoineCommande = (c: CommandeFournisseur) => {
    const adressePhysique = extraireAdressePhysique(c.adresse);
    if (adressePhysique) {
      const segment = adressePhysique.split(",")[0]?.split(" - ")[0]?.trim();
      const rue = segment && segment.length >= 4 ? segment : adressePhysique;
      return construireSearchAdresses({
        ville: c.ville,
        tranche: c.tranche_code,
        rue,
        retour: fournisseurId,
      });
    }
    if (c.patrimoine)
      return construireSearchAdresses({ q: c.patrimoine, retour: fournisseurId });
    return construireSearchAdresses({ ville: c.ville, tranche: c.tranche_code, retour: fournisseurId });
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-[2200px] flex-wrap items-center gap-3 px-4 py-4 sm:px-6">
          <div className="mr-auto">
            <h1 className="flex items-center gap-2 text-lg font-semibold leading-tight">
              <Building2 className="size-5 text-primary" />{" "}
              {fournisseur ? libelleEntreprise(fournisseur.nom) : "Fournisseur"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {(data?.aliases as { identifiant_source?: string }[] | undefined)
                ?.map((a) => a.identifiant_source)
                .join(", ") ?? "aucun identifiant source"}
            </p>
          </div>
          {fournisseur ? (
            <Button onClick={() => setEditOpen(true)}>
              <Pencil className="size-4" /> Modifier
            </Button>
          ) : null}
          {fournisseur ? (
            <Button variant={favori ? "default" : "outline"} onClick={onToggleFavori}>
              <Star className={`size-4 ${favori ? "fill-current" : ""}`} />{" "}
              {favori ? "Favori" : "Favoris"}
            </Button>
          ) : null}
          <Button asChild variant="outline">
            {/* Retour contextuel (P0-2) : restaure les filtres/tri de la liste s'ils ont
                été persistés (sessionStorage) par /fournisseurs — sinon liste vierge. */}
            <Link to="/fournisseurs" search={retourListeSearch}>
              Retour
            </Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-[2200px] space-y-5 px-4 py-6 sm:px-6">
        {isLoading ? (
          <p className="px-4 py-8 text-sm text-muted-foreground">Chargement&</p>
        ) : !fournisseur ? (
          <Card>
            <CardContent className="p-4 text-sm text-muted-foreground">
              Fournisseur introuvable ou référentiel non disponible.
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <h2 className="text-base font-bold">Analyse</h2>
              <div className="flex items-center gap-1">
                <Button
                  size="icon"
                  variant="outline"
                  className="size-8"
                  disabled={anneePrecedente == null}
                  onClick={() => anneePrecedente != null && changerAnnee(anneePrecedente)}
                  title={
                    anneePrecedente != null
                      ? `Année précédente (${anneePrecedente})`
                      : "Aucune année précédente"
                  }
                  aria-label="Année précédente"
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <div className="w-40">
                  <Select
                    value={anneeSelect != null ? String(anneeSelect) : "all"}
                    onValueChange={(v) => changerAnnee(v === "all" ? null : Number(v))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Année" />
                    </SelectTrigger>
                    <SelectContent>
                      {historique.length > 0 ? (
                        historique.map((h) => (
                          <SelectItem key={h.annee} value={String(h.annee)}>
                            {h.annee}
                          </SelectItem>
                        ))
                      ) : (
                        <SelectItem value="all">Aucune année</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  size="icon"
                  variant="outline"
                  className="size-8"
                  disabled={anneeSuivante == null}
                  onClick={() => anneeSuivante != null && changerAnnee(anneeSuivante)}
                  title={
                    anneeSuivante != null ? `Année suivante (${anneeSuivante})` : "Dernière année"
                  }
                  aria-label="Année suivante"
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>

            <div className="grid gap-5 lg:grid-cols-3">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">ACTIVITÉS</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Famille :</span>
                    <Badge
                      variant="outline"
                      className={
                        PROFIL_BADGE[
                          profil?.est_tce ? "TCE" : (profil?.famille_principale ?? "AUTRE")
                        ] ?? ""
                      }
                    >
                      {profil?.est_tce ? "TCE" : (profil?.famille_principale ?? "AUTRE")}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      Activités principales
                    </p>
                    <div className="flex flex-wrap gap-1 pt-1">
                      {principales.length ? (
                        principales.map((a) => (
                          <Badge key={a.code} variant="outline">
                            {a.corps_etat}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      Autres activités
                    </p>
                    <div className="flex flex-wrap gap-1 pt-1">
                      {autres.length ? (
                        autres.map((a) => (
                          <Badge key={a.code} variant="secondary">
                            {a.corps_etat}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">KPIs — année {anneeSelect ?? "—"}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 text-sm">
                  <Ligne label="Commandes" value={String(kpisAnnee?.commandes ?? 0)} />
                  <Ligne label="Montant engagé" value={money2(kpisAnnee?.montant ?? 0)} />
                  <Ligne
                    label="Évol. commandes"
                    value={<EvoCell v={kpisAnnee?.evolution_commandes} />}
                  />
                  <Ligne
                    label="Évol. montant"
                    value={<EvoCell v={kpisAnnee?.evolution_montant} />}
                  />
                  <Ligne label="Part de marché" value={pct(kpisAnnee?.part_marche)} />
                  <Ligne label="Part marché moyenne" value={pct(kpisAnnee?.part_marche_moyenne)} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">CONTACTS</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  {contacts.length === 0 ? (
                    <p className="text-muted-foreground">Aucun contact renseigné.</p>
                  ) : (
                    contacts.map((c) => (
                      <div key={c.id} className="space-y-0.5 rounded-lg border p-2">
                        <p className="font-semibold">
                          <User className="mr-1 inline size-3.5" />
                          {c.nom}
                        </p>
                        {c.fonction ? <p className="text-muted-foreground">{c.fonction}</p> : null}
                        {c.email ? (
                          <p className="flex items-center gap-1 text-muted-foreground">
                            <Mail className="size-3.5" />
                            {c.email}
                          </p>
                        ) : null}
                        {c.telephone ? (
                          <p className="flex items-center gap-1 text-muted-foreground">
                            <Phone className="size-3.5" />
                            {c.telephone}
                          </p>
                        ) : null}
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">HISTORIQUE ANNUEL</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                {historique.length === 0 ? (
                  <p className="text-muted-foreground">Aucune donnée.</p>
                ) : (
                  // Ordre PAR DÉFAUT : année décroissante (2026 → 2023), tri idempotent.
                  trierHistoriqueAnnuelDesc(historique).map((h) => (
                    <Ligne
                      key={h.annee}
                      label={`${h.annee} · ${h.commandes} commande(s)`}
                      value={`${money2(h.montant)} · part ${pct(h.part_marche)}`}
                    />
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-base">DÉTAIL DES ACTIVITÉS</CardTitle>
                  {activitesDisponibles ? (
                    editActivites ? (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-destructive"
                          onClick={() => setResetOpen(true)}
                          disabled={activitesManuel.length === 0}
                        >
                          <RotateCcw className="size-3.5" /> Réinitialiser les niveaux
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditActivites(false)}>
                          Terminer
                        </Button>
                      </div>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => setEditActivites(true)}>
                        <Pencil className="size-3.5" /> Modifier les activités
                      </Button>
                    )
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      Couche « fournisseur_activites » non disponible (migration à valider).
                    </span>
                  )}
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead
                        className="cursor-pointer select-none"
                        onClick={() => triClickAct("corps_etat")}
                      >
                        Corps d'état{indAct("corps_etat")}
                      </TableHead>
                      <TableHead
                        className="cursor-pointer select-none text-right"
                        onClick={() => triClickAct("commandes")}
                      >
                        Commandes{indAct("commandes")}
                      </TableHead>
                      <TableHead
                        className="cursor-pointer select-none text-right"
                        onClick={() => triClickAct("partCommandes")}
                      >
                        Part d'activité{indAct("partCommandes")}
                      </TableHead>
                      <TableHead
                        className="cursor-pointer select-none text-right"
                        onClick={() => triClickAct("montant")}
                      >
                        Montant{indAct("montant")}
                      </TableHead>
                      <TableHead
                        className="cursor-pointer select-none"
                        onClick={() => triClickAct("niveau")}
                      >
                        Niveau{indAct("niveau")}
                      </TableHead>
                      <TableHead>Ajustement</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {effectivesTriees.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={6}
                          className="py-6 text-center text-sm text-muted-foreground"
                        >
                          Aucune activité. {activitesDisponibles ? "Ajoutez un corps d'état." : ""}
                        </TableCell>
                      </TableRow>
                    ) : (
                      effectivesTriees.map((a) => (
                        <TableRow key={a.code}>
                          <TableCell className="whitespace-nowrap">{a.corps_etat}</TableCell>
                          <TableCell className="text-right">{a.commandes}</TableCell>
                          <TableCell className="text-right">
                            {a.commandes > 0 ? pct(a.partCommandes) : "—"}
                          </TableCell>
                          <TableCell className="text-right font-semibold">
                            {money2(a.montant)}
                          </TableCell>
                          <TableCell>
                            {editActivites && activitesDisponibles ? (
                              <Select
                                value={a.niveau_manuel ?? a.niveau_auto ?? "occasionnel"}
                                onValueChange={(v) => changerNiveauSelect(a, v as ProfilNiveau)}
                              >
                                <SelectTrigger className="h-7 w-44 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="principal">Principal</SelectItem>
                                  <SelectItem value="secondaire">Secondaire</SelectItem>
                                  <SelectItem value="occasionnel">Occasionnel</SelectItem>
                                </SelectContent>
                              </Select>
                            ) : (
                              <NiveauBadge niveau={a.niveau} />
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {a.niveau_manuel ? (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="inline-flex cursor-help" tabIndex={0}>
                                      <Info className="size-3.5 text-amber-500" />
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    {a.niveau_auto == null || a.commandes === 0
                                      ? "Ajout manuel — corps d'état ajouté par l'utilisateur"
                                      : "Modification manuelle — niveau défini par l'utilisateur"}
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>

                {editActivites && activitesDisponibles ? (
                  <div className="border-t p-3">
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      Ajouter un corps d'état
                    </p>
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="relative min-w-[240px] flex-1">
                        <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                        <Input
                          value={addSearch}
                          onChange={(e) => setAddSearch(e.target.value)}
                          placeholder="Rechercher un corps d'état réel&"
                          className="pl-8"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Niveau initial</Label>
                        <Select
                          value={addNiveau}
                          onValueChange={(v) => setAddNiveau(v as ProfilNiveau)}
                        >
                          <SelectTrigger className="h-8 w-44 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="principal">Principal</SelectItem>
                            <SelectItem value="secondaire">Secondaire</SelectItem>
                            <SelectItem value="occasionnel">Occasionnel</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => {
                          const c = corpsDisponiblesFiltres[0];
                          if (c) ajouterActivite(c.code, c.corps_etat, addNiveau);
                        }}
                        disabled={corpsDisponiblesFiltres.length === 0 || saveActMutation.isPending}
                      >
                        Ajouter
                      </Button>
                    </div>
                    <div className="mt-2 max-h-44 space-y-0.5 overflow-y-auto">
                      {corpsDisponiblesFiltres.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          Aucun corps d'état disponible (les corps réels du suivi sont déjà présents
                          ou la recherche ne correspond à rien).
                        </p>
                      ) : (
                        corpsDisponiblesFiltres.map((c) => (
                          <button
                            key={c.code}
                            type="button"
                            onClick={() => ajouterActivite(c.code, c.corps_etat, addNiveau)}
                            className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs hover:bg-muted"
                          >
                            <span className="font-mono">{c.corps_etat}</span>
                            <Plus className="size-3.5 text-emerald-600" />
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <div className="grid gap-5 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">PATRIMOINE — CARTE DES VILLES</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="h-72 overflow-hidden rounded-lg border bg-slate-50">
                    {villesCarte.length > 0 ? (
                      <CarteVillesClient villes={villesCarte} />
                    ) : (
                      <div className="flex h-full items-center justify-center px-4 text-center text-xs text-muted-foreground">
                        Aucune ville géolocalisable pour ce fournisseur.
                      </div>
                    )}
                  </div>
                  {villesNonLocalisees.length > 0 || commandesSansVille > 0 ? (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                      <p className="text-xs font-semibold text-amber-700">
                        Villes non géolocalisables (listées — jamais positionnées sur la carte)
                      </p>
                      <p className="mt-0.5 text-xs text-amber-700">
                        {villesNonLocalisees.length > 0 ? villesNonLocalisees.join(", ") : ""}
                        {commandesSansVille > 0
                          ? `${villesNonLocalisees.length > 0 ? " · " : ""}${commandesSansVille} commande(s) sans ville déterminée`
                          : ""}
                      </p>
                    </div>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setDetailsPatrimoine((p) => !p)}
                    className="flex w-full items-center justify-between rounded-lg border bg-muted/30 px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted/50"
                    aria-expanded={detailsPatrimoine}
                  >
                    <span>
                      {detailsPatrimoine
                        ? "Masquer les détails du patrimoine"
                        : "Afficher les détails du patrimoine"}
                    </span>
                    {detailsPatrimoine ? (
                      <ChevronUp className="size-4" />
                    ) : (
                      <ChevronDown className="size-4" />
                    )}
                  </button>
                  {detailsPatrimoine ? (
                    <div className="space-y-3">
                      {villesCarte.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {villesCarte.map((v) => (
                            <span
                              key={v.ville}
                              title={`${v.commandes} commande(s) · ${money2(v.montant)} engagés`}
                              className="inline-flex items-center gap-1.5 rounded-full border bg-muted/40 px-2.5 py-0.5 text-xs font-semibold"
                            >
                              <MapPin className="size-3 text-primary" /> {v.ville}
                              <span className="font-normal text-muted-foreground">
                                · {v.commandes} cmd · {money2(v.montant)}
                              </span>
                            </span>
                          ))}
                        </div>
                      ) : null}
                      <Ligne label="Tranches" value={patrimoine?.tranches.join(", ") || "—"} />
                      <Ligne label="Bâtiments" value={patrimoine?.batiments.join(", ") || "—"} />
                      <Ligne label="Entrées" value={patrimoine?.entrees.join(", ") || "—"} />
                      <Ligne label="Lots" value={patrimoine?.lots.join(", ") || "—"} />
                      <Ligne label="Villes" value={patrimoine?.villes.join(", ") || "—"} />
                    </div>
                  ) : null}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">IDENTITÉ</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 text-sm">
                  <Ligne label="Nom" value={libelleEntreprise(fournisseur?.nom) ?? "—"} />
                  <div className="border-b border-slate-50 pb-1">
                    <p className="text-muted-foreground">Identifiants sources</p>
                    <div className="mt-1 space-y-0.5">
                      <p className="flex items-center justify-between gap-3">
                        <span className="text-muted-foreground">Ref ISIS</span>
                        <span className="font-mono font-semibold">
                          {refIsis ?? "Non renseigné"}
                        </span>
                      </p>
                      <p className="flex items-center justify-between gap-3">
                        <span className="text-muted-foreground">FRAN_NUM</span>
                        <span className="font-mono font-semibold">
                          {franNum ?? "Non renseigné"}
                        </span>
                      </p>
                      {autresAlias.map((a) => (
                        <p key={a.id} className="flex items-center justify-between gap-3">
                          <span className="text-muted-foreground">{a.source}</span>
                          <span className="font-mono font-semibold">{a.identifiant_source}</span>
                        </p>
                      ))}
                    </div>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      Rattachement FRAN_NUM soumis à validation humaine (aucun rapprochement
                      automatique).
                    </p>
                  </div>
                  <Ligne label="Adresse" value={fournisseur?.adresse ?? "—"} />
                  <Ligne
                    label="CP / Ville"
                    value={
                      `${fournisseur?.code_postal ?? ""} ${fournisseur?.ville ?? ""}`.trim() || "—"
                    }
                  />
                  <Ligne label="Pays" value={fournisseur?.pays ?? "—"} />
                  <Ligne label="Site web" value={fournisseur?.site_web ?? "—"} />
                  <Ligne label="Notes" value={fournisseur?.notes ?? "—"} />
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">COMMANDES ({commandes.length})</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead
                          className="cursor-pointer select-none"
                          onClick={() => triClickCmd("date")}
                        >
                          Date{indCmd("date")}
                        </TableHead>
                        <TableHead
                          className="cursor-pointer select-none"
                          onClick={() => triClickCmd("commande")}
                        >
                          Commande{indCmd("commande")}
                        </TableHead>
                        <TableHead
                          className="cursor-pointer select-none"
                          onClick={() => triClickCmd("description")}
                        >
                          Description{indCmd("description")}
                        </TableHead>
                        <TableHead
                          className="cursor-pointer select-none"
                          onClick={() => triClickCmd("categorie")}
                        >
                          Catégorie{indCmd("categorie")}
                        </TableHead>
                        <TableHead
                          className="cursor-pointer select-none"
                          onClick={() => triClickCmd("corps_etat")}
                        >
                          Corps d'état{indCmd("corps_etat")}
                        </TableHead>
                        <TableHead
                          className="cursor-pointer select-none"
                          onClick={() => triClickCmd("tranche")}
                        >
                          Tranche{indCmd("tranche")}
                        </TableHead>
                        <TableHead
                          className="cursor-pointer select-none"
                          onClick={() => triClickCmd("patrimoine")}
                        >
                          Patrimoine{indCmd("patrimoine")}
                        </TableHead>
                        <TableHead
                          className="cursor-pointer select-none"
                          onClick={() => triClickCmd("adresse")}
                        >
                          Adresse{indCmd("adresse")}
                        </TableHead>
                        <TableHead
                          className="cursor-pointer select-none text-right"
                          onClick={() => triClickCmd("montant")}
                        >
                          Montant engagé{indCmd("montant")}
                        </TableHead>
                        <TableHead className="select-none">
                          <Popover>
                            <PopoverTrigger asChild>
                              <button
                                type="button"
                                className="flex items-center gap-1 font-semibold hover:text-primary"
                                title="Filtrer par état"
                              >
                                État
                                {filtresEtat.length > 0 ? (
                                  <span className="rounded-full bg-primary px-1.5 text-[9px] font-black text-primary-foreground">
                                    {filtresEtat.length}
                                  </span>
                                ) : (
                                  <FilterX className="size-3" />
                                )}
                              </button>
                            </PopoverTrigger>
                            <PopoverContent className="w-64 p-3" align="start">
                              <div className="space-y-2">
                                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                  Filtrer par état ({filtresEtat.length})
                                </p>
                                {etatsDisponibles.length === 0 ? (
                                  <p className="text-xs text-muted-foreground">
                                    Aucun état disponible.
                                  </p>
                                ) : (
                                  <div className="max-h-48 space-y-0.5 overflow-y-auto">
                                    {etatsDisponibles.map((e) => (
                                      <label
                                        key={e}
                                        className="flex cursor-pointer items-center gap-2 rounded p-1 hover:bg-muted/50"
                                      >
                                        <Checkbox
                                          checked={filtresEtat.includes(e)}
                                          onCheckedChange={() =>
                                            setFiltresEtat((p) =>
                                              p.includes(e) ? p.filter((x) => x !== e) : [...p, e],
                                            )
                                          }
                                        />
                                        <span className="text-xs font-medium">{e}</span>
                                      </label>
                                    ))}
                                  </div>
                                )}
                                <div className="flex items-center justify-between gap-2 border-t pt-2">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => setFiltresEtat([])}
                                    disabled={filtresEtat.length === 0}
                                  >
                                    Effacer le filtre
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => triClickCmd("etat")}
                                    title="Trier par état (croissant/décroissant)"
                                  >
                                    Tri{" "}
                                    {triCmd?.key === "etat" && triCmd.dir === "desc" ? "↓" : "↑"}
                                  </Button>
                                </div>
                              </div>
                            </PopoverContent>
                          </Popover>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {commandesTriees.length === 0 ? (
                        <TableRow>
                          <TableCell
                            colSpan={10}
                            className="py-6 text-center text-sm text-muted-foreground"
                          >
                            Aucune commande rattachée.
                          </TableCell>
                        </TableRow>
                      ) : (
                        commandesTriees.map((c) => (
                          <TableRow key={c.numero_commande}>
                            <TableCell className="whitespace-nowrap">
                              {formatDateCommandeFr(c.date_commande) ?? c.date_demarrage ?? "—"}
                            </TableCell>
                            <TableCell>
                              <button
                                type="button"
                                onClick={() => {
                                  setCommandeOuverte(c);
                                  // Ouvre via l'URL (`?cmd=`) en FUSIONNANT avec les autres
                                  // paramètres (annee) — back-aware, la fermeture retire cmd.
                                  if (c.id)
                                    navigate({ search: (prev) => ({ ...prev, cmd: c.id ?? undefined }) });
                                }}
                                className="font-semibold text-primary hover:underline"
                                title="Ouvrir la fiche commande (sans quitter cette page)"
                              >
                                #{c.numero_commande}
                              </button>
                            </TableCell>
                            <TableCell className="max-w-[280px]">
                              {c.descriptif ? (
                                <span className="block truncate" title={c.descriptif}>
                                  {c.descriptif}
                                </span>
                              ) : (
                                "—"
                              )}
                            </TableCell>
                            <TableCell className="whitespace-nowrap">
                              {c.categorie ?? "—"}
                            </TableCell>
                            <TableCell className="whitespace-nowrap">
                              {c.corps_etat ?? "—"}
                            </TableCell>
                            <TableCell className="whitespace-nowrap">
                              {trancheDeCommande(c) ?? "—"}
                            </TableCell>
                            <TableCell className="whitespace-nowrap">
                              {c.patrimoine ? (
                                <Link
                                  to="/adresses"
                                  search={recherchePatrimoineCommande(c)}
                                  className="font-semibold text-primary hover:underline"
                                  title="Ouvrir ce patrimoine dans /adresses"
                                >
                                  {c.patrimoine}
                                  {c.patrimoine_ambigu ? (
                                    <span
                                      className="ml-1 text-amber-500"
                                      title="Rattachement patrimoine ambigu"
                                    >
                                      ⚠
                                    </span>
                                  ) : null}
                                </Link>
                              ) : (
                                "—"
                              )}
                            </TableCell>
                            <TableCell className="whitespace-nowrap">
                              {extraireAdressePhysique(c.adresse) ?? "—"}
                            </TableCell>
                            <TableCell className="text-right font-semibold">
                              {money2(c.montant)}
                            </TableCell>
                            <TableCell>{c.etat ?? "—"}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </main>

      <ModifierFournisseurDialog
        key={fournisseurId}
        open={editOpen}
        onClose={() => setEditOpen(false)}
        fournisseur={fournisseur}
        contacts={contacts}
        onSave={(payload) => updateMutation.mutate(payload)}
        pending={updateMutation.isPending}
      />

      <ReinitialiserActivitesDialog
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        activites={activitesEffectives}
        onConfirmer={reinitialiserActivites}
        pending={saveActMutation.isPending}
      />

      <CommandeFicheDialog
        commande={
          commandeOuverte
            ? ({
                // Fallback d'affichage pour les lignes Historique CMD sans commande suivi
                // (id null → aucun enrichissement possible) : toutes les données disponibles
                // de la CommandeFournisseur sont transmises. Dès qu'un `commandeId` existe,
                // le composant charge la fiche COMPLÈTE (même modèle que le Dashboard) et
                // ce fallback n'est jamais utilisé pour le rendu.
                id: commandeOuverte.id ?? undefined,
                numero_commande: commandeOuverte.numero_commande,
                descriptif: commandeOuverte.descriptif ?? undefined,
                corps_etat: commandeOuverte.corps_etat ?? undefined,
                tranche_code: commandeOuverte.tranche_code ?? undefined,
                lot_code: commandeOuverte.lot_code ?? undefined,
                batiment: commandeOuverte.batiment ?? undefined,
                adresse: commandeOuverte.adresse ?? undefined,
                annee_exercice: commandeOuverte.annee ?? undefined,
                etat_commande: commandeOuverte.etat ?? undefined,
                etat_travaux: commandeOuverte.etat ?? undefined,
                engage: commandeOuverte.montant,
                date_demarrage: commandeOuverte.date_demarrage ?? undefined,
                psp_date_commande: commandeOuverte.date_commande ?? undefined,
                psp_corps_etat_libelle: commandeOuverte.nature_travaux ?? undefined,
                psp_patrimoine: commandeOuverte.patrimoine ?? undefined,
                psp_fournisseur: commandeOuverte.fournisseur_source_code ?? undefined,
                psp_numero_commande_interne: commandeOuverte.numero_commande,
              } as unknown as CommandeTravauxEnrichie)
            : null
        }
        commandeId={commandeOuverte?.id ?? null}
        open={!!commandeOuverte}
        onClose={() => {
          setCommandeOuverte(null);
          // Fermeture back-aware : retire `?cmd=` en conservant les autres paramètres (annee).
          if (cmdParam) navigate({ search: (prev) => ({ ...prev, cmd: undefined }) });
        }}
        readOnly
      />
    </div>
  );
}

function Ligne({ label, value }: { label: string; value: ReactNode }) {
  return (
    <p className="flex justify-between gap-3 border-b border-slate-50 pb-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold">{value}</span>
    </p>
  );
}

function ModifierFournisseurDialog({
  open,
  onClose,
  fournisseur,
  contacts,
  onSave,
  pending,
}: {
  open: boolean;
  onClose: () => void;
  fournisseur: Fournisseur | null;
  contacts: FournisseurContact[];
  onSave: (payload: Record<string, unknown>) => void;
  pending: boolean;
}) {
  const [form, setForm] = useState(() => ({
    nom: fournisseur?.nom ?? "",
    adresse: fournisseur?.adresse ?? "",
    complementAdresse: fournisseur?.complement_adresse ?? "",
    codePostal: fournisseur?.code_postal ?? "",
    ville: fournisseur?.ville ?? "",
    pays: fournisseur?.pays ?? "",
    siteWeb: fournisseur?.site_web ?? "",
    notes: fournisseur?.notes ?? "",
    contacts: (contacts ?? []).map((c) => ({
      id: c.id as string | null,
      nom: c.nom,
      fonction: c.fonction ?? "",
      email: c.email ?? "",
      telephone: c.telephone ?? "",
    })),
  }));

  // Réinitialise le formulaire à chaque ouverture (données rechargées depuis la base).
  useEffect(() => {
    if (!open) return;
    setForm({
      nom: fournisseur?.nom ?? "",
      adresse: fournisseur?.adresse ?? "",
      complementAdresse: fournisseur?.complement_adresse ?? "",
      codePostal: fournisseur?.code_postal ?? "",
      ville: fournisseur?.ville ?? "",
      pays: fournisseur?.pays ?? "",
      siteWeb: fournisseur?.site_web ?? "",
      notes: fournisseur?.notes ?? "",
      contacts: (contacts ?? []).map((c) => ({
        id: c.id as string | null,
        nom: c.nom,
        fonction: c.fonction ?? "",
        email: c.email ?? "",
        telephone: c.telephone ?? "",
      })),
    });
  }, [open, fournisseur, contacts]);

  const setField =
    (k: keyof typeof form) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((p) => ({ ...p, [k]: e.target.value }));

  const setContact =
    (i: number, k: "nom" | "fonction" | "email" | "telephone") =>
    (e: ChangeEvent<HTMLInputElement>) =>
      setForm((p) => ({
        ...p,
        contacts: p.contacts.map((c, idx) => (idx === i ? { ...c, [k]: e.target.value } : c)),
      }));

  const addContact = () =>
    setForm((p) => ({
      ...p,
      contacts: [...p.contacts, { id: null, nom: "", fonction: "", email: "", telephone: "" }],
    }));

  const removeContact = (i: number) =>
    setForm((p) => ({ ...p, contacts: p.contacts.filter((_, idx) => idx !== i) }));

  const submit = () => {
    if (!fournisseur) return;
    if (!form.nom.trim()) {
      toast.error("Le nom est obligatoire.");
      return;
    }
    onSave({
      id: fournisseur.id,
      nom: form.nom.trim(),
      adresse: form.adresse.trim() || null,
      complementAdresse: form.complementAdresse.trim() || null,
      codePostal: form.codePostal.trim() || null,
      ville: form.ville.trim() || null,
      pays: form.pays.trim() || null,
      siteWeb: form.siteWeb.trim() || null,
      notes: form.notes.trim() || null,
      contacts: form.contacts
        .filter((c) => c.nom.trim() !== "")
        .map((c) => ({
          id: c.id || undefined,
          nom: c.nom.trim(),
          fonction: c.fonction.trim() || null,
          email: c.email.trim() || null,
          telephone: c.telephone.trim() || null,
        })),
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="size-4" /> Modifier les informations
          </DialogTitle>
          <DialogDescription>
            Données enregistrées dans le référentiel fournisseur (fournisseurs,
            fournisseurs_contacts). Les tables sources restent immuables.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Identité
            </p>
            <Labeled label="Nom entreprise *">
              <Input value={form.nom} onChange={setField("nom")} placeholder="Entreprise Dupont" />
            </Labeled>
          </div>

          <div className="sm:col-span-2">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Coordonnées
            </p>
          </div>
          <Labeled label="Adresse">
            <Input value={form.adresse} onChange={setField("adresse")} />
          </Labeled>
          <Labeled label="Complément d'adresse">
            <Input value={form.complementAdresse} onChange={setField("complementAdresse")} />
          </Labeled>
          <Labeled label="Code postal">
            <Input value={form.codePostal} onChange={setField("codePostal")} />
          </Labeled>
          <Labeled label="Ville">
            <Input value={form.ville} onChange={setField("ville")} />
          </Labeled>
          <Labeled label="Pays">
            <Input value={form.pays} onChange={setField("pays")} />
          </Labeled>
          <Labeled label="Site web">
            <Input value={form.siteWeb} onChange={setField("siteWeb")} />
          </Labeled>

          <div className="space-y-3 sm:col-span-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Contacts
            </p>
            {form.contacts.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Aucun contact. Cliquez sur « Ajouter un contact ».
              </p>
            ) : (
              form.contacts.map((c, i) => (
                <div key={c.id ?? `nouveau-${i}`} className="space-y-2 rounded-lg border p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      Contact {i + 1}
                    </p>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-1.5 text-destructive"
                      onClick={() => removeContact(i)}
                    >
                      <Trash2 className="size-3.5" /> Supprimer
                    </Button>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <Labeled label="Nom *">
                      <Input
                        value={c.nom}
                        onChange={setContact(i, "nom")}
                        placeholder="Jean DUPONT"
                      />
                    </Labeled>
                    <Labeled label="Fonction">
                      <Input
                        value={c.fonction}
                        onChange={setContact(i, "fonction")}
                        placeholder="Directeur"
                      />
                    </Labeled>
                    <Labeled label="Email">
                      <Input
                        value={c.email}
                        onChange={setContact(i, "email")}
                        placeholder="contact@entreprise.fr"
                      />
                    </Labeled>
                    <Labeled label="Téléphone">
                      <Input
                        value={c.telephone}
                        onChange={setContact(i, "telephone")}
                        placeholder="01 23 45 67 89"
                      />
                    </Labeled>
                  </div>
                </div>
              ))
            )}
            <Button size="sm" variant="outline" onClick={addContact}>
              <Plus className="size-3.5" /> Ajouter un contact
            </Button>
          </div>

          <div className="sm:col-span-2">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Notes
            </p>
            <Labeled label="Notes internes">
              <Textarea
                value={form.notes}
                onChange={setField("notes")}
                rows={3}
                placeholder="Notes internes&"
              />
            </Labeled>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={submit} disabled={pending}>
            <Save className="size-4" /> {pending ? "Enregistrement&" : "Enregistrer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReinitialiserActivitesDialog({
  open,
  onClose,
  activites,
  onConfirmer,
  pending,
}: {
  open: boolean;
  onClose: () => void;
  activites: ActiviteEffective[];
  onConfirmer: () => void;
  pending: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RotateCcw className="size-4" /> Réinitialiser les niveaux d'activité ?
          </DialogTitle>
          <DialogDescription>
            Les décisions manuelles seront supprimées et le calcul automatique reprendra le dessus.
            Les coordonnées, contacts et notes ne sont pas concernés.
          </DialogDescription>
        </DialogHeader>
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Corps d'état</TableHead>
                <TableHead>Actuel</TableHead>
                <TableHead>Calcul automatique</TableHead>
                <TableHead>Effet</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activites.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-4 text-center text-sm text-muted-foreground">
                    Aucune activité.
                  </TableCell>
                </TableRow>
              ) : (
                activites.map((a) => {
                  const actuel = a.niveau;
                  const auto = a.niveau_auto;
                  let effet: string;
                  let classe = "text-slate-500";
                  if (auto == null) {
                    effet = "Sera retirée du profil automatique";
                    classe = "text-red-500";
                  } else if (actuel === auto) {
                    effet = "Inchangée";
                    classe = "text-slate-500";
                  } else if (
                    (ORDRE_NIVEAU[actuel ?? "occasionnel"] ?? 3) < (ORDRE_NIVEAU[auto] ?? 3)
                  ) {
                    effet = "Descendra";
                    classe = "text-red-500";
                  } else {
                    effet = "Montera";
                    classe = "text-emerald-600";
                  }
                  return (
                    <TableRow key={a.code}>
                      <TableCell className="whitespace-nowrap font-mono text-xs">
                        {a.corps_etat}
                      </TableCell>
                      <TableCell>
                        <NiveauBadge niveau={actuel} />
                      </TableCell>
                      <TableCell>
                        {auto ? (
                          <NiveauBadge niveau={auto} />
                        ) : (
                          <span className="text-xs text-muted-foreground">Aucun historique</span>
                        )}
                      </TableCell>
                      <TableCell className={`text-xs font-semibold ${classe}`}>{effet}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Annuler
          </Button>
          <Button variant="destructive" onClick={onConfirmer} disabled={pending}>
            <RotateCcw className="size-4" /> Réinitialiser
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
