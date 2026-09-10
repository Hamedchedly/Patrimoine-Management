import { useMemo, useState, useEffect, useCallback, lazy, Suspense } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link, createFileRoute } from "@tanstack/react-router";
import * as SliderPrimitive from "@radix-ui/react-slider";
import {
  ETATS_METIER,
  buildDataVilles,
  etatMetier,
  exerciceCourant,
  formatDateImportFr,
  getAlertesCommande,
  getDernierImportExercice,
  matchesAnnee,
  resyncImportErrors,
  secteurDe,
  sliderYearDomain,
  villeDeCommande,
  visibleParPerimetre,
  yearRangeInitial,
} from "@/lib/travaux";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip, Legend } from "recharts";
import {
  AlertTriangle,
  ArrowDownUp,
  FilterX,
  LayoutDashboard,
  ListFilter,
  RotateCcw,
  Search,
  Upload,
  Wrench,
  MapPin,
  History,
  ChevronRight,
  Info,
  Building2,
  Calendar,
  FileText,
  User,
  Euro,
  CheckCircle2,
  Edit3,
  Save,
  X,
  AlertCircle,
  Map as MapIcon,
  Filter,
  ArrowUp,
  ArrowDown,
  Layers,
  SlidersHorizontal,
  BarChart3,
  Loader2,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import {
  getTravauxDashboard,
  getCommandeHistorique,
  updateCommandeTravaux,
  resolveHistoriqueTravaux,
  checkTravauxLatestImport,
  type CommandeTravaux,
  type CommandeTravauxEnrichie,
  type HistoriqueTravaux,
  type TravauxDashboardData,
  type ImportTravaux,
} from "@/lib/travaux.dashboard.functions";
import { getVillesGeo, type VilleGeo } from "@/lib/geo.functions";
import { calculerStatsSuiviAnnuel, detecterLBIncoherentes } from "@/lib/travaux.suivi.stats";
import { normaliserVille } from "@/lib/geo";
import {
  construireCleMetierCommande,
  extraireChargePsp,
  type TypeDecisionPsp,
} from "@/lib/psp.validation";
import { getPspDecision, savePspDecision } from "@/lib/psp.validation.functions";
import { getFournisseursPourCommandes } from "@/lib/fournisseurs.functions";
import { money0 } from "@/lib/formats";
import { construireSearchAdresses } from "@/lib/adresses";
import CommandeFicheDialog, {
  type DecideState,
  type FicheFournisseurInfo,
} from "@/components/CommandeFicheDialog";
import { EtiquetteTranche } from "@/components/tranches/EtiquetteTranche";
import { useEtiquettesTranches } from "@/lib/tranches.etiquettes.hooks";

export const Route = createFileRoute("/dashboard-travaux")({
  // `?commande=` porte un NUMÉRO de commande (TanStack JSON-parse → number) ;
  // `?de=`/`?a=` persistent la plage d'années (exercice) du slider (Phase 6B).
  validateSearch: (s: Record<string, unknown>) => {
    const nombre = (v: unknown): number | undefined =>
      typeof v === "number" || typeof v === "string" ? Number(v) : undefined;
    return {
      commande:
        typeof s["commande"] === "string" || typeof s["commande"] === "number"
          ? String(s["commande"])
          : undefined,
      de: nombre(s["de"]),
      a: nombre(s["a"]),
    };
  },
  head: () => ({
    meta: [
      { title: "Dashboard suivi travaux" },
      {
        name: "description",
        content: "Pilotage des commandes de travaux par programmation, secteur et tranche.",
      },
    ],
  }),
  component: DashboardTravauxPage,
});

type Commande = CommandeTravauxEnrichie;

type ClassementRow = {
  label: string;
  value: number;
  ville?: string;
  adresse?: string;
  tranche?: string;
};
const SECTEURS = ["GT", "GE", "CP"] as const;
const SECTOR_COLORS = { GT: "#2563eb", GE: "#0f766e", CP: "#c2410c" };
const PAGE_SIZE = 20;

const text = (value: unknown) => (value == null ? "" : String(value));

/** Slider d'années (double curseur Radix) : remplace les <input type="range"> natifs. */
function YearRangeSlider({
  min,
  max,
  value,
  onChange,
}: {
  min: number;
  max: number;
  value: [number, number];
  onChange: (value: [number, number]) => void;
}) {
  return (
    <SliderPrimitive.Root
      min={min}
      max={max}
      step={1}
      value={value}
      onValueChange={(v) => onChange([v[0] as number, v[1] as number])}
      className="relative flex w-full touch-none select-none items-center"
    >
      <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-slate-200">
        <SliderPrimitive.Range className="absolute h-full bg-blue-600" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb className="block h-4 w-4 rounded-full border-2 border-blue-600 bg-white shadow transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:pointer-events-none disabled:opacity-50" />
      <SliderPrimitive.Thumb className="block h-4 w-4 rounded-full border-2 border-blue-600 bg-white shadow transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:pointer-events-none disabled:opacity-50" />
    </SliderPrimitive.Root>
  );
}

/** Normalisation et matching de villes + secteur dérivé : helpers importés de "@/lib/travaux"
 * (secteurDe, villeDeCommande, buildDataVilles). */

const yearOf = (row: Commande) => {
  if (row.annee_exercice) return String(row.annee_exercice);
  const date = row.date_demarrage || row.date_fin_travaux || row.date_communication;
  return date ? date.slice(0, 4) : "Sans année";
};

function MultiSelect({
  label,
  options,
  selected,
  onChange,
  icon: Icon,
}: {
  label: string;
  options: { label: string; value: string; sub?: string }[];
  selected: string[];
  onChange: (vals: string[]) => void;
  icon?: LucideIcon;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-9 w-full justify-between text-[10px] font-black uppercase border-slate-200 rounded-xl px-3"
        >
          <div className="flex items-center gap-2 overflow-hidden">
            {Icon && <Icon className="size-3.5 text-slate-400 shrink-0" />}
            <span className="truncate">
              {selected.length === 0 ? `Tous ${label}` : `${selected.length} ${label}`}
            </span>
          </div>
          <ChevronRight className="size-3 text-slate-400 rotate-90 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0 rounded-2xl border-slate-200 shadow-2xl" align="start">
        <div className="p-3 border-b bg-slate-50/50 flex items-center justify-between">
          <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest">
            {label}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChange([])}
            className="text-[9px] font-black text-blue-600 h-6 px-2"
          >
            TOUT DÉCOCHER
          </Button>
        </div>
        <div className="max-h-64 overflow-y-auto p-2 custom-scrollbar space-y-1">
          {options.map((opt) => (
            <label
              key={opt.value}
              className="flex items-start gap-3 p-2 rounded-xl hover:bg-slate-50 cursor-pointer transition-colors group"
            >
              <Checkbox
                checked={selected.includes(opt.value)}
                onCheckedChange={(v) =>
                  onChange(v ? [...selected, opt.value] : selected.filter((x) => x !== opt.value))
                }
                className="mt-0.5"
              />
              <div className="flex flex-col">
                <span
                  className={`text-[11px] font-black uppercase tracking-tight ${selected.includes(opt.value) ? "text-blue-600" : "text-slate-700"}`}
                >
                  {opt.label}
                </span>
                {opt.sub && (
                  <span className="text-[9px] font-bold text-slate-400 uppercase leading-none mt-0.5">
                    {opt.sub}
                  </span>
                )}
              </div>
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

const DashboardMap = lazy(() => import("@/components/DashboardMap"));

function ClientOnlyMap({
  dataVilles,
  missing,
}: {
  dataVilles: {
    ville: string;
    lat: number;
    lng: number;
    value: number;
    count: number;
    paye: number;
  }[];
  missing: number;
}) {
  const [isClient, setIsClient] = useState(false);
  useEffect(() => {
    setIsClient(true);
  }, []);
  if (!isClient)
    return (
      <div className="h-full w-full bg-slate-50 flex items-center justify-center text-[10px] font-black uppercase text-slate-300">
        Chargement carte...
      </div>
    );

  return (
    <Suspense
      fallback={
        <div className="h-full w-full bg-slate-50 flex items-center justify-center text-[10px] font-black uppercase text-slate-300">
          Chargement carte...
        </div>
      }
    >
      <DashboardMap dataVilles={dataVilles} missing={missing} />
    </Suspense>
  );
}

function DashboardTravauxPage() {
  const queryClient = useQueryClient();
  const fetchDashboard = useServerFn(getTravauxDashboard);
  const updateCommande = useServerFn(updateCommandeTravaux);
  const resolveHistory = useServerFn(resolveHistoriqueTravaux);
  const fetchCheckImport = useServerFn(checkTravauxLatestImport);
  const fetchGetDecision = useServerFn(getPspDecision);
  const saveDecision = useServerFn(savePspDecision);

  const { data, isLoading, isError, error } = useQuery<TravauxDashboardData>({
    queryKey: ["travaux-dashboard"],
    queryFn: () => fetchDashboard(),
  });

  const fetchVillesGeo = useServerFn(getVillesGeo);
  const { data: villesGeo } = useQuery<VilleGeo[]>({
    queryKey: ["villes-geo"],
    queryFn: () => fetchVillesGeo(),
    staleTime: 1000 * 60 * 30,
  });

  const allCommandes = data?.commandes ?? [];
  const routeSearch = Route.useSearch();
  const navigate = Route.useNavigate();
  const commandeParam = routeSearch.commande;
  const historique = data?.historique ?? [];
  const recentImports = data?.imports ?? [];
  const tranchesDetails = data?.tranchesDetails ?? [];
  // V8.18 — étiquettes des tranches (VEFA, RACHAT…) affichées sous le TR du journal.
  const etiquettes = useEtiquettesTranches();
  const etiquettesParTranche = etiquettes.etiquettesParTranche;
  // V8.16x — rue réelle par tranche (mode des lots) pour un journal lisible.
  const adresseRuesParTranche = data?.adresseRuesParTranche ?? {};

  // V8.12 — LIGNES ANNUELLES SANS COMMANDE (matérialisées origine='suivi') : exposées dans
  // le tableau du Dashboard + KPI/barres. Forme « commande-like » (sans n° de commande).
  const lignesSuiviRows = useMemo<CommandeTravauxEnrichie[]>(() => {
    const lignesSuivi = data?.lignesSuivi ?? [];
    return lignesSuivi.map((l: Record<string, unknown>): CommandeTravauxEnrichie => {
      const trancheCode = l["tranche_code"] ? String(l["tranche_code"]) : null;
      const detail = tranchesDetails.find((td) => td.code === trancheCode);
      const programme = (l["programme"] as Record<string, number> | undefined) ?? {};
      // V8.16 — année d'exercice : colonne dédiée si présente (migration V8.16), sinon
      // dérivée des clés de `programme` (une ligne suivi matérialisée = une seule année).
      const anneeExercice =
        typeof l["annee_exercice"] === "number" && Number.isFinite(Number(l["annee_exercice"]))
          ? Number(l["annee_exercice"])
          : (() => {
              const annees = Object.keys(programme)
                .map(Number)
                .filter((a) => Number.isFinite(a) && (programme[String(a)] ?? 0) > 0);
              return annees.length ? Math.max(...annees) : null;
            })();
      return {
        id: String(l["id"]),
        sans_commande: true,
        numero_commande: "",
        secteur: null,
        tranche_code: trancheCode,
        lot_code: null,
        batiment: null,
        charge_clientele: null,
        adresse:
          adresseRuesParTranche[trancheCode ?? ""] ??
          (detail ? [detail.libelle, detail.localite].filter(Boolean).join(" – ") : null),
        nature_analytique: l["categorie"] ? String(l["categorie"]) : null,
        corps_etat: l["corps_etat"] ? String(l["corps_etat"]) : null,
        charge_operation: null,
        ligne_budget: l["ligne_budget"] ? String(l["ligne_budget"]) : null,
        descriptif: l["nature_travaux"] ? String(l["nature_travaux"]) : null,
        budget:
          anneeExercice != null ? Number(programme[String(anneeExercice)] ?? 0) || null : null,
        numero_fournisseur: null,
        fournisseur: null,
        etat_commande: null,
        // V8.16 — engagé/payé réels des lignes sans commande (colonnes migration V8.16).
        engage: Number(l["montant_engage"]) || 0,
        ecart: null,
        paye: Number(l["montant_paye"]) || 0,
        solde: null,
        etat_travaux: null,
        date_demarrage: null,
        date_fin_travaux: null,
        observations: null,
        support_communication: null,
        date_communication: null,
        annee_exercice: anneeExercice,
        classification_programmation: null,
        classification_secteur: null,
        actif: true,
        created_at: "",
        updated_at: "",
      };
    });
  }, [data?.lignesSuivi, tranchesDetails, adresseRuesParTranche]);

  // Conflits/doublons non résolus par commande (indicateur « ACT. ») — défini avant le
  // filtre `filteredJournal` afin qu'il puisse les prendre en compte.
  const historyMap = useMemo(() => {
    const map = new Map<string, HistoriqueTravaux>();
    historique.forEach((h) => {
      if (!h.resolu && !map.has(h.commande_id)) map.set(h.commande_id, h);
    });
    return map;
  }, [historique]);

  // Exercice courant (jamais codé en dur) — utilisé pour l'état dérivé « Pas réalisé ».
  const exercice = exerciceCourant();

  // Dernier import de l'EXERCICE COURANT (en-tête) — indépendant du slider d'années.
  // Un import 2025 effectué après un import 2026 ne modifie pas cette date.
  const dernierImportExercice = useMemo(
    () => getDernierImportExercice(recentImports, exercice),
    [recentImports, exercice],
  );

  // Vérification manuelle d'un éventuel nouvel import (bouton « ACTUALISER ») : voir la
  // définition de `handleCheckImport` plus bas, après les états de modales (il réévalue
  // aussi l'alerte « Analyse des Erreurs d'Import » à partir des données réellement rechargées).

  // États Filtres
  // Sélection initiale : exercice courant uniquement ([exercice, exercice]), SAUF si
  // l'URL porte une plage persistée (`?de=&a=`, Phase 6B). Le domaine accessible
  // (sliderYearDomain) reste toutes les années — les deux sont distincts.
  const [yearRange, setYearRange] = useState<[number, number]>([
    routeSearch.de ?? exercice,
    routeSearch.a ?? exercice,
  ]);

  // Phase 6B : persiste la plage d'années (exercice) dans l'URL → partageable et
  // conservée lors du retour navigateur (ex. depuis /adresses) et de l'ouverture de fiche.
  useEffect(() => {
    navigate({
      replace: true,
      search: (prev) => ({ ...prev, de: yearRange[0], a: yearRange[1] }),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yearRange[0], yearRange[1]]);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [progFilter, setProgFilter] = useState({ prog: true, hors: true });
  const [selectedSectors, setSelectedSectors] = useState<string[]>([...SECTEURS]);
  const [selectedTranches, setSelectedTranches] = useState<string[]>([]);
  const [selectedVilles, setSelectedVilles] = useState<string[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [selectedEtats, setSelectedEtats] = useState<string[]>([]);
  const [selectedCharges, setSelectedCharges] = useState<string[]>([]);
  const [actFilter, setActFilter] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [mapMode, setMapMode] = useState<"map" | "classement">("map");
  const [rankingMode, setRankingMode] = useState<"ville" | "tranche" | "adresse">("ville");

  // États Filtres En-tête Tableau
  const [tableFilters, setTableFilters] = useState<
    Record<string, { min?: number; max?: number; selected?: string[]; search?: string }>
  >({});
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: "asc" | "desc" } | null>({
    key: "engage",
    direction: "desc",
  });

  // États Modales
  const [drilldownSector, setDrilldownSector] = useState<string | null>(null);
  const [selectedModif, setSelectedModif] = useState<HistoriqueTravaux | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<Commande | null>(null);
  const [historyFor, setHistoryFor] = useState<Commande | null>(null);
  const [selectedImportErrors, setSelectedImportErrors] = useState<ImportTravaux | null>(null);
  // Fournisseur référencé pour la fiche affichée (nom enrichi — source jamais modifiée).
  const [fournisseurFiche, setFournisseurFiche] = useState<FicheFournisseurInfo | null>(null);
  const [versionChoice, setVersionChoice] = useState<"A" | "B">("B");

  // Décision humaine Historique CMD (nature / corps d'état) — couche psp_decisions.
  const [decide, setDecide] = useState<DecideState | null>(null);
  const [appliedNature, setAppliedNature] = useState<string | null>(null);
  const [appliedCorps, setAppliedCorps] = useState<string | null>(null);

  // Bouton « ACTUALISER » : rechargement réel depuis Supabase PUIS réévaluation de l'alerte.
  // L'identité d'un import repose sur son `id` ; la détection d'un nouvel import se fait par
  // comparaison d'id ET d'horodatage (jamais par comparaison de fichiers Excel).
  const [checkingImport, setCheckingImport] = useState(false);
  const handleCheckImport = async () => {
    if (checkingImport) return;
    setCheckingImport(true);
    try {
      // 1. Lecture serveur directe : import le plus récent réellement présent dans Supabase.
      const res = await fetchCheckImport();
      const latest = res.latestImport ?? null;
      const prevLast = recentImports[0] ?? null;

      // 2. Recharger les données du dashboard et ATTENDRE la fin du refetch.
      await queryClient.invalidateQueries({ queryKey: ["travaux-dashboard"] });

      // 3. Réévaluer l'alerte « Analyse des Erreurs d'Import » avec les données réellement
      //    rechargées, pour l'EXERCICE consulté : import de l'exercice supprimé / erreurs
      //    corrigées → l'alerte disparaît ; erreurs > 0 → elle reste avec le nombre réel ;
      //    nouvel import de l'exercice → elle reflète uniquement le nouvel import. Un import
      //    d'un autre exercice ne peut jamais déclencher l'alerte. Aucun `setState(false)`
      //    artificiel : seul `resyncImportErrors` décide.
      const fresh = queryClient.getQueryData<TravauxDashboardData>(["travaux-dashboard"]);
      setSelectedImportErrors((prev) => resyncImportErrors(prev, fresh?.imports ?? [], exercice));

      // 4. Message de retour.
      if (prevLast && latest && latest.id === prevLast.id) {
        toast("Aucune nouvelle importation détectée.");
      } else if (!prevLast && !latest) {
        toast("Aucune importation disponible.");
      } else if (
        latest &&
        (!prevLast ||
          new Date(latest.demarre_at).getTime() > new Date(prevLast.demarre_at).getTime())
      ) {
        toast.success("Nouvelle importation détectée.", {
          description: "Le dashboard a été actualisé.",
        });
      } else {
        // L'import affiché n'existe plus dans Supabase (supprimé) — l'alerte a été réévaluée.
        toast("L'import affiché a été supprimé de Supabase.");
      }
    } catch {
      toast.error("Échec de la vérification de l'import.");
    } finally {
      setCheckingImport(false);
    }
  };

  // Réévaluation de l'alerte d'erreurs à CHAQUE changement des imports (données réelles),
  // pour l'exercice consulté. Garantit que le composant ne conserve jamais en mémoire un
  // import supprimé ou corrigé : l'alerte ne dépend que de l'import le plus récent de
  // l'exercice présent dans Supabase.
  useEffect(() => {
    setSelectedImportErrors((prev) => resyncImportErrors(prev, recentImports, exercice));
  }, [recentImports, exercice]);

  // État Édition
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Commande>>({});

  const mutation = useMutation({
    mutationFn: (variables: { id: string; data: Partial<Commande> }) =>
      updateCommande({ data: variables }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["travaux-dashboard"] });
      setIsEditing(false);
      setSelectedDetail((prev) => (prev ? ({ ...prev, ...editForm } as Commande) : null));
    },
  });

  const saveDecisionMutation = useMutation({
    mutationFn: (variables: {
      cleMetier: string;
      typeDecision: TypeDecisionPsp;
      decisionUtilisateur: string;
      statut: "valide" | "proposition" | "rejete";
    }) => saveDecision({ data: variables }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["travaux-dashboard"] });
    },
  });

  // Décisions existantes (réutilisées automatiquement aux prochains imports) pour la
  // commande affichée : nature + corps d'état. Une décision « valide » évite une nouvelle
  // demande ; « proposition » et « rejete » ne sont jamais appliquées comme valeur retenue.
  useEffect(() => {
    const num = selectedDetail?.numero_commande;
    if (!num) return;
    let cancelled = false;
    (async () => {
      try {
        const [rn, rc] = await Promise.all([
          fetchGetDecision({
            data: { cleMetier: construireCleMetierCommande(num, "nature"), typeDecision: "nature" },
          }),
          fetchGetDecision({
            data: {
              cleMetier: construireCleMetierCommande(num, "corps_etat"),
              typeDecision: "corps_etat",
            },
          }),
        ]);
        if (cancelled) return;
        setAppliedNature(
          (rn as { decision_utilisateur?: string } | null)?.decision_utilisateur ?? null,
        );
        setAppliedCorps(
          (rc as { decision_utilisateur?: string } | null)?.decision_utilisateur ?? null,
        );
      } catch {
        if (!cancelled) {
          setAppliedNature(null);
          setAppliedCorps(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDetail?.numero_commande]);

  const handleSaveDecision = async (value: string) => {
    if (!decide) return;
    try {
      await saveDecisionMutation.mutateAsync({
        cleMetier: decide.cleMetier,
        typeDecision: decide.type,
        decisionUtilisateur: value,
        statut: "valide",
      });
      if (decide.type === "nature") setAppliedNature(value);
      else setAppliedCorps(value);
      setDecide(null);
      toast.success("Décision enregistrée — réutilisée aux prochains imports.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Enregistrement de la décision impossible.");
    }
  };
  // Navigation depuis un numéro de commande (param ?commande=) — ouvre la fiche.
  // La fiche est pilotée par l'URL : retirer le param (bouton retour navigateur)
  // ferme l'overlay → le retour navigateur est « back-aware ».
  useEffect(() => {
    if (!commandeParam) {
      setSelectedDetail(null);
      return;
    }
    if (allCommandes.length === 0) return;
    const found = allCommandes.find((c) => c.numero_commande === commandeParam);
    if (found) setSelectedDetail(found);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commandeParam, allCommandes]);

  // Fournisseur référencé pour la commande affichée (référentiel, lecture seule).
  useEffect(() => {
    if (!selectedDetail?.id) {
      setFournisseurFiche(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await getFournisseursPourCommandes({
          data: { commandeIds: [selectedDetail.id] },
        });
        if (cancelled) return;
        const map = res as Record<string, { id: string; nom: string; identifiants: string[] }>;
        setFournisseurFiche(map[selectedDetail.id] ?? null);
      } catch {
        if (!cancelled) setFournisseurFiche(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDetail?.id]);

  const closeFiche = () => {
    setSelectedDetail(null);
    setIsEditing(false);
    // Retire ?commande= en conservant les autres paramètres (de/a).
    if (commandeParam) navigate({ search: (prev) => ({ ...prev, commande: undefined }) });
  };

  const resolveMutation = useMutation({
    mutationFn: (variables: {
      id: string;
      keepVersion: "A" | "B";
      commandeId: string;
      data: Record<string, unknown> | null;
    }) => resolveHistory({ data: variables }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["travaux-dashboard"] });
      setSelectedModif(null);
    },
  });

  const options = useMemo(() => {
    const years = [...new Set(allCommandes.map(yearOf))]
      .filter((y) => y !== "Sans année")
      .map(Number)
      .sort((a, b) => a - b);
    const villes = [
      ...new Set(
        allCommandes
          .map((c) => villeDeCommande(c, tranchesDetails, villesGeo ?? []))
          .filter((v): v is string => !!v),
      ),
    ]
      .sort()
      .map((v) => ({ label: v, value: v }));
    const tranchesMap = new Map<string, { label: string; value: string; sub: string }>();
    allCommandes.forEach((c) => {
      if (!c.tranche_code) return;
      if (!tranchesMap.has(c.tranche_code)) {
        const detail = tranchesDetails.find((td) => td.code === c.tranche_code);
        tranchesMap.set(c.tranche_code, {
          label: c.tranche_code,
          value: c.tranche_code,
          sub: `${detail?.localite || villeDeCommande(c, tranchesDetails, villesGeo ?? []) || ""}`,
        });
      }
    });
    const tranches = [...tranchesMap.values()].sort((a, b) => a.value.localeCompare(b.value));
    return { years, tranches, villes };
  }, [allCommandes, tranchesDetails, villesGeo]);

  // Options pour les filtres du Journal des Commandes (Paramètres)
  const typeOptions = useMemo(() => {
    const map = new Map<string, { label: string; value: string }>();
    allCommandes.forEach((c) => {
      if (!c.corps_etat) return;
      if (!map.has(c.corps_etat))
        map.set(c.corps_etat, { label: c.corps_etat, value: c.corps_etat });
    });
    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [allCommandes]);

  const etatOptions = useMemo(() => {
    // États métier réels (whitelist ETATS_METIER) présents dans les données, y compris
    // l'état dérivé « Pas réalisé ». Les valeurs parasites (dates, montants) sont exclues.
    const found = new Set<string>();
    allCommandes.forEach((c) => {
      found.add(etatMetier(c, exercice));
    });
    return ETATS_METIER.filter((s) => found.has(s)).map((s) => ({ label: s, value: s }));
  }, [allCommandes, exercice]);

  // Chargés d'opération Historique CMD (UTIC_CODE normalisé) — Règle N°10 : filtrables,
  // les commandes restent dans l'historique source, jamais supprimées.
  const chargeOptions = useMemo(() => {
    const map = new Map<string, { label: string; value: string }>();
    allCommandes.forEach((c) => {
      const charge = extraireChargePsp(c.psp_donnees_brutes) ?? c.psp_charge_operation ?? "";
      if (!charge) return;
      if (!map.has(charge)) map.set(charge, { label: charge, value: charge });
    });
    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [allCommandes]);

  // Périmètre visible : règles d'archivage existantes (visibleArchivage) + année du slider.
  // Le filtre d'année prime sur l'exclusion d'archivage : les commandes archivées d'une année
  // sélectionnée entrent dans le dataset (ex. [2025,2026] → 28 archivées 2025 + 49 actives 2026),
  // tandis que les commandes hors intervalle restent exclues. « Inclure archivées » reste actif.
  const visibleCommandes = useMemo(
    () =>
      allCommandes.filter((row) =>
        visibleParPerimetre(row, { includeArchived, selectedEtats, yearRange, exercice }),
      ),
    [allCommandes, includeArchived, selectedEtats, yearRange, exercice],
  );

  // Domaine du slider : années d'exercice disponibles (y compris archivées), élargies,
  // jamais réduites à une seule année — le slider reste utilisable avec une seule année.
  const yearDomain = useMemo<[number, number]>(
    () => sliderYearDomain(options.years),
    [options.years],
  );

  useEffect(() => {
    if (options.years.length > 0) {
      const lo = options.years[0] as number;
      const hi = options.years[options.years.length - 1] as number;
      // On conserve la sélection utilisateur tant qu'elle reste dans le domaine.
      setYearRange(([a, b]) => (a < lo || b > hi || a > b ? [lo, hi] : [a, b]));
    }
  }, [options.years]);

  /** V8.16x — PRÉDICAT COMMUN des filtres d'en-tête du journal (commandes ET
   * lignes suivi). Appliqué aux deux → les lignes suivi sont filtrées comme les
   * commandes (elles n'apparaissent plus « en trop » après une sélection). */
  const filtreJournalBase = useCallback(
    (row: CommandeTravauxEnrichie): boolean => {
      const isProg = !!row.ligne_budget;
      const sect = secteurDe(row);
      const ville = villeDeCommande(row, tranchesDetails, villesGeo ?? []) ?? "";
      const matchesYear = matchesAnnee(row, yearRange);
      const matchesProg = (isProg && progFilter.prog) || (!isProg && progFilter.hors);
      const matchesSect = selectedSectors.includes(sect);
      const matchesTranche =
        selectedTranches.length === 0 ||
        (!!row.tranche_code && selectedTranches.includes(row.tranche_code));
      const matchesVille = selectedVilles.length === 0 || selectedVilles.includes(ville);
      const matchesType =
        selectedTypes.length === 0 || (!!row.corps_etat && selectedTypes.includes(row.corps_etat));
      const matchesEtat =
        selectedEtats.length === 0 || selectedEtats.includes(etatMetier(row, exercice));
      const matchesSearch =
        !search ||
        [
          row.numero_commande,
          row.adresse,
          row.descriptif,
          row.fournisseur,
          row.numero_fournisseur,
        ].some((v) => text(v).toLowerCase().includes(search.toLowerCase()));
      const chargeRow = extraireChargePsp(row.psp_donnees_brutes) ?? row.psp_charge_operation ?? "";
      const matchesCharge =
        selectedCharges.length === 0 || (chargeRow !== "" && selectedCharges.includes(chargeRow));
      return (
        matchesYear &&
        matchesProg &&
        matchesSect &&
        matchesTranche &&
        matchesVille &&
        matchesType &&
        matchesEtat &&
        matchesCharge &&
        matchesSearch
      );
    },
    [
      yearRange,
      progFilter,
      selectedSectors,
      selectedTranches,
      selectedVilles,
      selectedTypes,
      selectedEtats,
      selectedCharges,
      search,
      tranchesDetails,
      villesGeo,
      exercice,
    ],
  );

  const filtered = useMemo(() => {
    let result = visibleCommandes.filter(filtreJournalBase);

    Object.entries(tableFilters).forEach(([key, filter]) => {
      if (filter?.min !== undefined)
        result = result.filter(
          (r) => (Number((r as unknown as Record<string, unknown>)[key]) || 0) >= (filter.min ?? 0),
        );
      if (filter?.max !== undefined)
        result = result.filter(
          (r) => (Number((r as unknown as Record<string, unknown>)[key]) || 0) <= (filter.max ?? 0),
        );
      if (filter?.selected && filter.selected.length > 0)
        result = result.filter((r) =>
          filter.selected!.includes(String((r as unknown as Record<string, unknown>)[key])),
        );
      if (filter?.search !== undefined && filter.search !== "")
        result = result.filter((r) =>
          text((r as unknown as Record<string, unknown>)[key])
            .toLowerCase()
            .includes(filter.search!.toLowerCase()),
        );
    });

    if (sortConfig) {
      result.sort((a, b) => {
        if (sortConfig.key === "city") {
          const va = villeDeCommande(a, tranchesDetails, villesGeo ?? []) ?? "";
          const vb = villeDeCommande(b, tranchesDetails, villesGeo ?? []) ?? "";
          return sortConfig.direction === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
        }
        const va = (a as unknown as Record<string, unknown>)[sortConfig.key];
        const vb = (b as unknown as Record<string, unknown>)[sortConfig.key];
        if (typeof va === "number" && typeof vb === "number")
          return sortConfig.direction === "asc" ? va - vb : vb - va;
        return sortConfig.direction === "asc"
          ? text(va).localeCompare(text(vb))
          : text(vb).localeCompare(text(va));
      });
    }
    return result;
  }, [visibleCommandes, filtreJournalBase, tableFilters, sortConfig]);

  // Journal : filtre « ACT. » (anomalies de données OU conflit/doublon) — en surcouche des
  // filtres existants (année, état, secteur, ville, archivage…). Les statistiques globales
  // (KPI, donut, carte) restent sur `filtered`, seules les lignes du journal sont filtrées.
  const filteredJournal = useMemo(() => {
    const base = actFilter
      ? filtered.filter((row) => getAlertesCommande(row).length > 0 || historyMap.has(row.id))
      : filtered;
    // V8.12/V8.16 — lignes annuelles SANS commande ajoutées au tableau. V8.16x :
    // elles sont soumises aux MÊMES filtres d'en-tête que les commandes.
    const suivi = lignesSuiviRows.filter(
      (l) => l.annee_exercice != null && matchesAnnee(l, yearRange) && filtreJournalBase(l),
    );
    return [...base, ...suivi];
  }, [filtered, actFilter, historyMap, lignesSuiviRows, yearRange, filtreJournalBase]);

  // V8.16 — lignes suivi de l'exercice (les lignes sans année sont exclues des vues
  // annuelles), passées à la fonction pure de stats (testable).
  const suiviAnnee = useMemo(
    () => lignesSuiviRows.filter((l) => l.annee_exercice != null && matchesAnnee(l, yearRange)),
    [lignesSuiviRows, yearRange],
  );

  // V8.16 — alerte lignes budgétaires incohérentes (même LB, budgets différents) sur
  // l'EXERCICE (commandes de l'année + lignes suivi de l'année ; indépendant des filtres
  // secteur/état/archivage). Une LB peut légitimement changer de montant entre exercices :
  // la détection est donc limitée à l'année affichée. Correction au prochain import.
  const alertesLB = useMemo(
    () =>
      detecterLBIncoherentes([
        ...allCommandes.filter((c) => matchesAnnee(c, yearRange)),
        ...suiviAnnee,
      ]),
    [allCommandes, suiviAnnee, yearRange],
  );

  // V8.12/V8.16 — KPI du suivi annuel ANM (engagé, payé, % engagé/budget, % payé/engagé,
  // % hors budget) + barres d'avancement par catégorie (GT/GE/CP). Calcul PUR dans
  // `calculerStatsSuiviAnnuel` : lignes suivi incluses dans compteurs et totaux.
  const statsAnm = useMemo(
    () => calculerStatsSuiviAnnuel(filtered, suiviAnnee),
    [filtered, suiviAnnee],
  );

  // V8.16 — répartition de l'ENGAGÉ par catégorie GT/GE/CP (montants, lignes suivi
  // comprises), en complément du comptage par secteur.
  const dataCategorieEngage = useMemo(
    () =>
      statsAnm.cat.map((c) => ({
        name: c.code,
        value: c.engage,
        count: c.nbProg + c.nbHors,
        prog: c.prog,
        hors: c.hors,
        paye: c.paye,
      })),
    [statsAnm.cat],
  );

  // V8.16e — donut « % programmé / % hors budget » de la carte « % Engagé vs Budget »
  // (100 % = enveloppe budgétaire : programmé + hors prog + reste).
  const dataDonutBudget = useMemo(
    () => [
      { name: "Programmées", value: statsAnm.engProg, color: "#2563eb" },
      { name: "Hors budget", value: statsAnm.engHors, color: "#f59e0b" },
      {
        name: "Reste",
        value: Math.max(0, statsAnm.budgetTotal - statsAnm.engage),
        color: "#e2e8f0",
      },
    ],
    [statsAnm],
  );

  // V8.16e — barre empilée « payé / engagé non payé / reste » de la carte Total engagé
  // (100 % = enveloppe budgétaire, ou engagé total si dépassement).
  const barreFlux = useMemo(() => {
    const scale = Math.max(statsAnm.budgetTotal, statsAnm.engage, 1);
    const engRestant = Math.max(0, statsAnm.engage - statsAnm.paye);
    const resteBudget = Math.max(0, statsAnm.budgetTotal - statsAnm.engage);
    return {
      pPaye: (statsAnm.paye / scale) * 100,
      pEngRestant: (engRestant / scale) * 100,
      pResteBudget: (resteBudget / scale) * 100,
      engRestant,
      resteBudget,
    };
  }, [statsAnm]);

  /** Ville canonique d'une commande (source de vérité : villeDeCommande). */
  const villeDe = (r: Commande) =>
    villeDeCommande(r, tranchesDetails, villesGeo ?? []) ?? "Inconnue";

  /**
   * Adresse sans la ville en suffixe (format d'import « ADRESSE, VILLE »). Le dernier
   * segment (après la dernière virgule) est retiré s'il correspond à la ville donnée
   * (comparaison normalisée) — évite « 10 RUE BONAPARTE, OZOIR-LA-FERRIÈRE · OZOIR-LA-FERRIÈRE ».
   */
  const adresseSansVille = (adresse: string, ville: string): string => {
    const parts = adresse
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length > 1) {
      const dernier = parts.at(-1) ?? "";
      const v = normaliserVille(ville);
      const d = normaliserVille(dernier);
      if (v && d && (d.includes(v) || v.includes(d))) return parts.slice(0, -1).join(", ");
    }
    return adresse;
  };

  const dataClassement = useMemo<ClassementRow[]>(() => {
    if (rankingMode === "ville") {
      const map = filtered.reduce(
        (acc, r) => {
          const city = villeDe(r);
          acc[city] = (acc[city] || 0) + (r.engage || 0);
          return acc;
        },
        {} as Record<string, number>,
      );
      return Object.entries(map)
        .filter(([_, v]) => v > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([label, value]) => ({ label, value }));
    }

    if (rankingMode === "tranche") {
      // Classement par tranche : la ville et l'adresse affichées sont celles de la commande
      // au plus gros montant engagé de la tranche.
      const map = filtered.reduce((acc, r) => {
        const tranche = r.tranche_code || "Sans tranche";
        const ville = villeDe(r);
        const adresse = r.adresse || "Adresse inconnue";
        const engage = r.engage || 0;
        const g = acc.get(tranche) ?? {
          tranche,
          ville,
          adresse,
          value: 0,
          villeValue: -1,
          adresseValue: -1,
        };
        g.value += engage;
        if (engage > g.villeValue) {
          g.villeValue = engage;
          g.ville = ville;
        }
        if (engage > g.adresseValue) {
          g.adresseValue = engage;
          g.adresse = adresse;
        }
        acc.set(tranche, g);
        return acc;
      }, new Map<string, { tranche: string; ville: string; adresse: string; value: number; villeValue: number; adresseValue: number }>());
      return [...map.values()]
        .filter((g) => g.value > 0)
        .sort((a, b) => b.value - a.value)
        .map((g) => ({
          label: g.tranche,
          adresse: adresseSansVille(g.adresse, g.ville),
          ville: g.ville,
          value: g.value,
        }));
    }

    // Classement par adresse : la ville et la/les tranche(s) sont affichées à côté.
    const map = filtered.reduce((acc, r) => {
      const adresse = r.adresse || "Adresse inconnue";
      const g = acc.get(adresse) ?? {
        adresse,
        ville: villeDe(r),
        tranches: new Set<string>(),
        value: 0,
      };
      g.value += r.engage || 0;
      if (r.tranche_code) g.tranches.add(r.tranche_code);
      acc.set(adresse, g);
      return acc;
    }, new Map<string, { adresse: string; ville: string; tranches: Set<string>; value: number }>());
    return [...map.values()]
      .filter((g) => g.value > 0)
      .sort((a, b) => b.value - a.value)
      .map((g) => ({
        label: g.adresse,
        ville: g.ville,
        tranche: [...g.tranches].sort().join(" / "),
        value: g.value,
      }));
  }, [filtered, rankingMode, villesGeo]);

  // Villes géocodées avec le montant investi agrégé (pour la cartographie couleur).
  const { dataVilles, nonLocalisees: villesNonLocalisees } = useMemo(
    () => buildDataVilles(filtered, tranchesDetails, villesGeo ?? []),
    [filtered, tranchesDetails, villesGeo],
  );

  const dataDrilldown = useMemo(() => {
    if (!drilldownSector) return [];
    const map = filtered
      .filter((r) => secteurDe(r) === drilldownSector)
      .reduce(
        (acc, r) => {
          const c = r.corps_etat || "Non renseigné";
          acc[c] = (acc[c] || 0) + (r.engage || 0);
          return acc;
        },
        {} as Record<string, number>,
      );
    return Object.entries(map)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [filtered, drilldownSector]);

  const reset = () => {
    // Réinitialisation = retour à la sélection initiale (exercice courant uniquement).
    setYearRange(yearRangeInitial(exercice));
    setProgFilter({ prog: true, hors: true });
    setSelectedSectors([...SECTEURS]);
    setSelectedTranches([]);
    setSelectedVilles([]);
    setSelectedTypes([]);
    setSelectedEtats([]);
    setActFilter(false);
    setSearch("");
    setTableFilters({});
    setPage(1);
  };

  const handleLastYear = () => {
    const last = options.years[options.years.length - 1];
    if (last) setYearRange([last, last]);
  };

  const handleEditStart = () => {
    if (!selectedDetail) return;
    setEditForm({ ...selectedDetail });
    setIsEditing(true);
  };
  const handleSave = () => {
    if (!selectedDetail?.id) return;
    mutation.mutate({ id: selectedDetail.id, data: editForm });
  };

  const handleResolve = () => {
    if (!selectedModif) return;
    const dataToKeep = versionChoice === "A" ? selectedModif.avant : selectedModif.apres;
    resolveMutation.mutate({
      id: selectedModif.id,
      keepVersion: versionChoice,
      commandeId: selectedModif.commande_id,
      data: dataToKeep,
    });
  };

  const toggleSort = (key: string) => {
    setSortConfig((prev) =>
      prev?.key === key
        ? { key, direction: prev.direction === "asc" ? "desc" : "asc" }
        : { key, direction: "desc" },
    );
  };

  if (isLoading)
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50 font-black text-slate-300 uppercase tracking-widest">
        Initialisation du Dashboard Pro...
      </div>
    );

  if (isError) {
    const message = error instanceof Error ? error.message : "Erreur inconnue";
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-slate-50 px-6 text-center">
        <AlertTriangle className="size-10 text-red-500" />
        <div className="max-w-lg">
          <h2 className="text-lg font-black text-slate-900 uppercase tracking-wide">
            Impossible de charger le dashboard
          </h2>
          <p className="mt-2 text-sm font-medium text-slate-500">
            La connexion à la base de données a échoué. Vérifiez que les variables{" "}
            <code>EXT_SUPABASE_URL</code> et <code>EXT_SUPABASE_SERVICE_ROLE_KEY</code> sont
            configurées, puis rechargez la page.
          </p>
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 font-mono text-xs text-red-600">
            {message}
          </p>
          <Button className="mt-5" size="sm" onClick={() => window.location.reload()}>
            Recharger la page
          </Button>
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50/50 pb-12 text-slate-900 font-sans">
      <header className="sticky top-0 z-20 border-b bg-white/90 backdrop-blur-lg shadow-sm">
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 p-2 rounded-lg text-white shadow-blue-200 shadow-lg">
              <Wrench className="size-5" />
            </div>
            <div>
              <h1 className="text-lg font-black tracking-tight uppercase">TRAVAUX ANALYTICS</h1>
              <p className="text-[9px] text-muted-foreground font-black uppercase tracking-widest">
                Pilotage Patrimonial
              </p>
            </div>
          </div>
          <div className="flex items-center gap-6">
            {recentImports.length > 0 && (
              <div className="hidden md:flex items-center gap-3 border-r pr-6">
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">
                  Dernier Import :
                </span>
                <button
                  onClick={() => setSelectedImportErrors(dernierImportExercice ?? null)}
                  title={
                    alertesLB.length > 0
                      ? "Lignes budgétaires incohérentes — voir le détail"
                      : "Voir l'analyse des erreurs d'import"
                  }
                  className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-[9px] font-black uppercase transition-all ${alertesLB.length > 0 ? "bg-amber-50 text-amber-700 hover:bg-amber-100" : (dernierImportExercice?.erreurs || 0) > 0 ? "bg-red-50 text-red-600 hover:bg-red-100" : "bg-green-50 text-green-600"}`}
                >
                  {alertesLB.length > 0 ? (
                    <AlertTriangle className="size-3" />
                  ) : (dernierImportExercice?.erreurs || 0) > 0 ? (
                    <AlertCircle className="size-3" />
                  ) : (
                    <CheckCircle2 className="size-3" />
                  )}
                  {alertesLB.length > 0
                    ? `${alertesLB.length} LB incohérente${alertesLB.length > 1 ? "s" : ""}`
                    : `${dernierImportExercice?.erreurs || 0} ERREURS`}
                </button>
                {dernierImportExercice ? (
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">
                    · {formatDateImportFr(dernierImportExercice.demarre_at)}
                  </span>
                ) : (
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">
                    · Aucun import {exercice}
                  </span>
                )}
              </div>
            )}
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleCheckImport}
                disabled={checkingImport}
                title="Vérifier manuellement si une nouvelle importation est arrivée dans Supabase"
                className="font-black text-[10px] tracking-widest"
              >
                {checkingImport ? (
                  <Loader2 className="size-3.5 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="size-3.5 mr-2" />
                )}
                {checkingImport ? "VÉRIFICATION..." : "ACTUALISER"}
              </Button>
              <Button
                asChild
                variant="ghost"
                size="sm"
                className="font-black text-[10px] tracking-widest"
              >
                <Link to="/">ACCUEIL</Link>
              </Button>
              <Button
                asChild
                size="sm"
                className="bg-slate-900 hover:bg-slate-800 text-[10px] font-black tracking-widest px-4"
              >
                <Link to="/import-travaux">
                  <Upload className="size-3.5 mr-2" /> IMPORT SUIVI BUDGÉTAIRE
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="px-4 py-6 space-y-6 max-w-full">
        {/* SECTION FILTRES */}
        <section className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[10px] font-black text-slate-400 uppercase tracking-widest">
              <ListFilter className="size-4" /> Filtres de Pilotage
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={reset}
              className="text-[9px] font-black text-slate-400 hover:text-red-500 uppercase tracking-widest"
            >
              <RotateCcw className="size-3 mr-1" /> RÉINITIALISER
            </Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
            <div className="space-y-4">
              <Label className="text-[9px] font-black uppercase text-slate-400 tracking-wider">
                Période (Slider)
              </Label>
              <div className="px-2 pt-2">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-[10px] font-black text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
                    {yearRange[0]}
                  </span>
                  <span className="text-[10px] font-black text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
                    {yearRange[1]}
                  </span>
                </div>
                <YearRangeSlider
                  min={yearDomain[0]}
                  max={yearDomain[1]}
                  value={yearRange}
                  onChange={setYearRange}
                />
              </div>
            </div>
            <div className="space-y-3">
              <Label className="text-[9px] font-black uppercase text-slate-400 tracking-wider">
                Multi-Sélection Tranches
              </Label>
              <MultiSelect
                label="Tranches"
                options={options.tranches}
                selected={selectedTranches}
                onChange={setSelectedTranches}
                icon={Layers}
              />
            </div>
            <div className="space-y-3">
              <Label className="text-[9px] font-black uppercase text-slate-400 tracking-wider">
                Multi-Sélection Villes
              </Label>
              <MultiSelect
                label="Villes"
                options={options.villes}
                selected={selectedVilles}
                onChange={setSelectedVilles}
                icon={MapPin}
              />
            </div>
            <div className="space-y-3">
              <Label className="text-[9px] font-black uppercase text-slate-400 tracking-wider">
                Secteur & Programmation
              </Label>
              <div className="flex flex-wrap gap-2">
                {SECTEURS.map((s) => (
                  <button
                    key={s}
                    onClick={() =>
                      setSelectedSectors((prev) =>
                        prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
                      )
                    }
                    className={`px-2 py-1 rounded-lg text-[9px] font-black transition-all border ${selectedSectors.includes(s) ? "bg-blue-600 text-white border-blue-600 shadow-md" : "bg-slate-50 text-slate-500 border-slate-200"}`}
                  >
                    {s}
                  </button>
                ))}
                <div className="w-full h-px bg-slate-100 my-1" />
                <button
                  onClick={() => setProgFilter((p) => ({ ...p, prog: !p.prog }))}
                  className={`px-2 py-1 rounded-lg text-[9px] font-black transition-all border ${progFilter.prog ? "bg-green-600 text-white border-green-600 shadow-md" : "bg-slate-50 text-slate-500 border-slate-200"}`}
                >
                  PROG.
                </button>
                <button
                  onClick={() => setProgFilter((p) => ({ ...p, hors: !p.hors }))}
                  className={`px-2 py-1 rounded-lg text-[9px] font-black transition-all border ${progFilter.hors ? "bg-orange-600 text-white border-orange-600 shadow-md" : "bg-slate-50 text-slate-500 border-slate-200"}`}
                >
                  HORS
                </button>
              </div>
            </div>
            <div className="space-y-3">
              <Label className="text-[9px] font-black uppercase text-slate-400 tracking-wider">
                Recherche Rapide
              </Label>
              <div className="relative">
                <Search className="absolute left-3 top-2.5 size-3.5 text-slate-400" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="CMD, ADRESSE..."
                  className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-4 text-[10px] font-black uppercase focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
            </div>
          </div>
        </section>

        {/* V8.16j — alerte lignes budgétaires incohérentes déplacée dans la boîte de dialogue
            « Analyse des Erreurs d'Import » (voir plus bas). */}

        {/* V8.12/V8.16e — KPIs réorganisés : Total engagé (payé + barre flux), % Engagé vs
            Budget (donut programmé/hors), % payé vs engagé, Lignes suivies (LB avec/sans n°) */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* V8.16g — Total engagé seul sur sa ligne (pleine largeur) ; en dessous
              % Engagé vs Budget (2/4) · % payé vs engagé (1/4) · Lignes suivies (1/4) */}
          <div className="grid grid-cols-1 gap-4">
            {/* Carte 1 — Total engagé (pleine largeur) : grand nombre + payé + barre flux */}
            <div className="rounded-xl border bg-card p-4 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                    Total engagé
                  </p>
                  <div className="mt-1 flex items-baseline gap-2">
                    <p className="text-2xl font-black text-slate-900">{money0(statsAnm.engage)}</p>
                    <span className="text-[9px] font-black text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded uppercase tracking-tighter">
                      ACTUEL
                    </span>
                  </div>
                </div>
                <p className="text-[9px] font-bold text-slate-400 text-right">
                  Enveloppe :{" "}
                  <span className="font-black text-slate-700">{money0(statsAnm.budgetTotal)}</span>
                </p>
              </div>
              {/* Barre empilée : payé / engagé non payé / reste budget (100 % = enveloppe ou engagé) */}
              <div className="relative mt-3 h-3">
                <div className="absolute inset-0 rounded-full bg-slate-100" />
                <div className="relative flex h-3 overflow-hidden rounded-full">
                  <div
                    className="h-full"
                    style={{ width: `${barreFlux.pPaye}%`, background: "#2563eb" }}
                    title={`Payé ${money0(statsAnm.paye)}`}
                  />
                  <div
                    className="h-full"
                    style={{ width: `${barreFlux.pEngRestant}%`, background: "#0f766e" }}
                    title={`Engagé non payé ${money0(barreFlux.engRestant)}`}
                  />
                  <div
                    className="h-full bg-[repeating-linear-gradient(45deg,#cbd5e1,#cbd5e1_4px,#e2e8f0_4px,#e2e8f0_8px)]"
                    style={{ width: `${barreFlux.pResteBudget}%` }}
                    title={`Reste (enveloppe − engagé) ${money0(barreFlux.resteBudget)}`}
                  />
                </div>
              </div>
              <div className="mt-1 flex flex-wrap gap-3 text-[9px] font-bold text-slate-500">
                <span className="inline-flex items-center gap-1">
                  <span className="size-2 rounded-sm bg-blue-600" />
                  Payé {money0(statsAnm.paye)} ({statsAnm.pctPaye} %)
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="size-2 rounded-sm bg-teal-700" />
                  Engagé {money0(statsAnm.engage)} ({statsAnm.pctTotal} % du budget)
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="size-2 rounded-sm bg-[repeating-linear-gradient(45deg,#cbd5e1,#cbd5e1_2px,#e2e8f0_2px,#e2e8f0_4px)]" />
                  Reste {money0(barreFlux.resteBudget)}
                </span>
              </div>
            </div>

            {/* Ligne 2 — % Engagé vs Budget (2/4) · % payé vs engagé (1/4) · Lignes suivies (1/4) */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
              {/* Carte 2 — % Engagé vs Budget (2/4) + donut programmé/hors/reste */}
              <div className="rounded-xl border bg-card p-4 shadow-sm hover:shadow-md transition-shadow sm:col-span-2">
                <div className="flex items-center gap-3">
                  <div className="min-w-[90px]">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                      % Engagé vs Budget
                    </p>
                    <div className="mt-1 flex items-baseline gap-2">
                      <p className="text-2xl font-black text-slate-900">{statsAnm.pctTotal}%</p>
                      <span className="text-[9px] font-black text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded uppercase tracking-tighter">
                        BUDGET
                      </span>
                    </div>
                  </div>
                  <div className="h-24 w-24 shrink-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={dataDonutBudget}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={30}
                          outerRadius={46}
                          paddingAngle={2}
                          strokeWidth={0}
                        >
                          {dataDonutBudget.map((d) => (
                            <Cell key={d.name} fill={d.color} />
                          ))}
                        </Pie>
                        <Tooltip
                          content={({ active, payload }) => {
                            if (active && payload && payload.length) {
                              const d = payload[0]?.payload as { name: string; value: number };
                              return (
                                <div className="bg-slate-900 text-white p-3 rounded-2xl shadow-2xl border-none">
                                  <p className="text-[10px] font-black uppercase">{d.name}</p>
                                  <p className="text-xs font-black text-blue-400">
                                    {money0(d.value)}
                                  </p>
                                </div>
                              );
                            }
                            return null;
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex-1 space-y-1 text-[9px] font-bold text-slate-500">
                    <p className="flex items-center gap-1.5">
                      <span className="size-2 rounded-sm" style={{ background: "#2563eb" }} />
                      Programmées {statsAnm.pct}%
                    </p>
                    <p className="flex items-center gap-1.5">
                      <span className="size-2 rounded-sm" style={{ background: "#f59e0b" }} />
                      Hors budget {statsAnm.pctHorsBudget}%
                    </p>
                    <p className="flex items-center gap-1.5">
                      <span className="size-2 rounded-sm bg-slate-200" />
                      Reste {Math.max(0, 100 - statsAnm.pctTotal)}%
                    </p>
                  </div>
                </div>
              </div>

              {/* Carte 3 — % payé vs engagé (1/4) */}
              <div className="rounded-xl border bg-card p-4 shadow-sm hover:shadow-md transition-shadow sm:col-span-1">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  % payé vs engagé
                </p>
                <div className="mt-1 flex items-baseline gap-2">
                  <p className="text-2xl font-black text-slate-900">{statsAnm.pctPaye}%</p>
                  <span className="text-[9px] font-black text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded uppercase tracking-tighter">
                    FLUX
                  </span>
                </div>
                <p className="mt-1 text-[10px] font-bold text-slate-400">
                  programmé {statsAnm.pctPayeProg} % · hors {statsAnm.pctPayeHors} %
                </p>
              </div>

              {/* Carte 4 — Lignes suivies (1/4) + LB avec/sans n° de commande */}
              <div className="rounded-xl border bg-card p-4 shadow-sm hover:shadow-md transition-shadow sm:col-span-1">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  Lignes suivies
                </p>
                <div className="mt-1 flex items-baseline gap-2">
                  <p className="text-2xl font-black text-slate-900">
                    {statsAnm.nProg + statsAnm.nHors}
                  </p>
                  <span className="text-[9px] font-black text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded uppercase tracking-tighter">
                    FLUX
                  </span>
                </div>
                <p className="mt-1 text-[10px] font-bold text-slate-400">
                  {statsAnm.nProg} prog · {statsAnm.nHors} hors
                </p>
                <p className="mt-0.5 text-[9px] font-bold text-slate-500">
                  LB n° de commande :{" "}
                  <span className="font-black text-slate-900">{statsAnm.nProgCmd}</span>
                  <span className="mx-1 text-slate-300">·</span>
                  LB sans commande :{" "}
                  <span className="font-black text-slate-900">{statsAnm.nProgSuivi}</span>
                </p>
              </div>
            </div>
          </div>

          {/* Barres d'avancement budgétaire par catégorie (GT · GE · CP) — à côté des KPI */}
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="mb-1 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
              <BarChart3 className="size-4 text-blue-600" /> Avancement budgétaire par catégorie
            </h3>
            <p className="mb-3 text-[9px] text-slate-400">
              Barre 100 % = enveloppe budgétaire (ou engagé si dépassement) : programmé + hors
              programmation + reste — toujours à l&apos;intérieur, aucun débordement.
            </p>
            <div className="space-y-5">
              {statsAnm.cat.map((c) => {
                // 100 % = MAX(enveloppe, engagé total) : prog + hors + reste tiennent dans la
                // barre. En cas de dépassement (engagé > budget), un marqueur indique l'enveloppe.
                const scale = Math.max(c.budget, c.prog + c.hors, 1);
                const pProg = (c.prog / scale) * 100;
                const pHors = (c.hors / scale) * 100;
                const pReste = (c.reste / scale) * 100;
                const pBudgetMark = (c.budget / scale) * 100;
                const pPayeCat = c.engage > 0 ? Math.round((c.paye / c.engage) * 100) : 0;
                return (
                  <div key={c.code}>
                    <div className="flex items-baseline justify-between text-[10px] font-black uppercase tracking-widest">
                      <span className="text-slate-700">{c.code}</span>
                      <span className="text-slate-400">
                        {money0(c.budget)} · engagé {money0(c.engage)} · payé {money0(c.paye)} (
                        {pPayeCat} %)
                      </span>
                    </div>
                    {/* Barre 100 % = enveloppe : programmé (plein) + hors prog (translucide) +
                        reste (rayé) — tout est à l'intérieur. Marqueur vertical = enveloppe. */}
                    <div className="relative mt-1.5 h-4">
                      <div className="absolute inset-0 rounded-full bg-slate-100" />
                      <div className="relative flex h-4 overflow-hidden rounded-full">
                        <div
                          className="h-full"
                          style={{ width: `${pProg}%`, background: SECTOR_COLORS[c.code] }}
                          title={`Programmées (engagé) ${money0(c.prog)} (${c.nbProg})`}
                        />
                        {pHors > 0 && (
                          <div
                            className="h-full"
                            style={{
                              width: `${pHors}%`,
                              background: SECTOR_COLORS[c.code],
                              opacity: 0.35,
                            }}
                            title={`Hors programmation (engagé) ${money0(c.hors)} (${c.nbHors})`}
                          />
                        )}
                        {pReste > 0 && (
                          <div
                            className="h-full bg-[repeating-linear-gradient(45deg,#cbd5e1,#cbd5e1_4px,#e2e8f0_4px,#e2e8f0_8px)]"
                            style={{ width: `${pReste}%` }}
                            title={`Reste (budget − engagé) ${money0(c.reste)}`}
                          />
                        )}
                      </div>
                      {c.overrun > 0 && (
                        <div
                          className="absolute inset-y-0 w-0.5 bg-slate-700"
                          style={{ left: `${pBudgetMark}%` }}
                          title={`Enveloppe budgétaire (100 % = ${money0(c.budget)}) — dépassement ${money0(c.overrun)}`}
                        />
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-3 text-[9px] text-slate-400">
                      <span className="inline-flex items-center gap-1">
                        <span
                          className="size-2 rounded-sm"
                          style={{ background: SECTOR_COLORS[c.code] }}
                        />
                        Programmées (engagé) {money0(c.prog)} ({c.nbProg})
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span className="size-2 rounded-sm bg-[repeating-linear-gradient(45deg,#cbd5e1,#cbd5e1_2px,#e2e8f0_2px,#e2e8f0_4px)]" />
                        Reste {money0(c.reste)}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span
                          className="size-2 rounded-sm"
                          style={{ background: SECTOR_COLORS[c.code], opacity: 0.4 }}
                        />
                        Hors prog (engagé) {money0(c.hors)} ({c.nbHors})
                      </span>
                      {c.overrun > 0 && (
                        <span className="inline-flex items-center gap-1 font-black text-red-600">
                          +{money0(c.overrun)} au-delà de l&apos;enveloppe
                        </span>
                      )}
                      {c.nbSuivi > 0 && <span>· dont {c.nbSuivi} sans commande</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        {/* CARTE & GRAPHIQUES */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <article className="lg:col-span-2 bg-white rounded-3xl border border-slate-200 p-6 shadow-sm overflow-hidden relative min-h-[450px]">
            <div className="flex items-center justify-between mb-6 relative z-10">
              <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
                <MapIcon className="size-4 text-blue-600" /> Cartographie vs Classement
              </h3>
              <div className="flex bg-slate-100 p-1 rounded-xl">
                <button
                  onClick={() => setMapMode("map")}
                  className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase transition-all ${mapMode === "map" ? "bg-white text-blue-600 shadow-sm" : "text-slate-400 hover:text-slate-600"}`}
                >
                  <MapIcon className="size-3 mr-1.5 inline" /> Carte
                </button>
                <button
                  onClick={() => setMapMode("classement")}
                  className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase transition-all ${mapMode === "classement" ? "bg-white text-blue-600 shadow-sm" : "text-slate-400 hover:text-slate-600"}`}
                >
                  <BarChart3 className="size-3 mr-1.5 inline" /> Classement
                </button>
              </div>
            </div>
            {mapMode === "map" ? (
              <div className="absolute inset-0 z-0">
                <ClientOnlyMap dataVilles={dataVilles} missing={villesNonLocalisees} />
              </div>
            ) : (
              <>
                <div className="flex bg-slate-100 p-1 rounded-xl w-max mb-4">
                  {(["ville", "tranche", "adresse"] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setRankingMode(mode)}
                      className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase transition-all ${rankingMode === mode ? "bg-white text-blue-600 shadow-sm" : "text-slate-400 hover:text-slate-600"}`}
                    >
                      {mode === "ville" ? "Ville" : mode === "tranche" ? "Tranche" : "Adresse"}
                    </button>
                  ))}
                </div>
                <div className="space-y-4 h-[350px] overflow-y-auto pr-2 custom-scrollbar">
                  {dataClassement.map((row, idx) => {
                    const max = dataClassement[0]?.value || 1;
                    const pct = (row.value / max) * 100;
                    const color =
                      pct > 70 ? "bg-red-500" : pct > 40 ? "bg-orange-400" : "bg-yellow-400";
                    return (
                      <div key={`${rankingMode}-${idx}-${row.label}`} className="group relative">
                        <div className="flex items-center justify-between mb-1 gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-[10px] font-black text-slate-700 uppercase truncate">
                              {row.label}
                            </span>
                            {row.ville && (
                              <span className="text-[9px] font-bold text-slate-400 truncate">
                                {rankingMode === "tranche"
                                  ? `· ${row.adresse ?? ""} · ${row.ville}`
                                  : row.tranche
                                    ? `· ${row.ville} · Tr. ${row.tranche}`
                                    : `· ${row.ville}`}
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] font-black text-slate-900 shrink-0">
                            {money0(row.value)}
                          </span>
                        </div>
                        <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-1000 ${color}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </article>
          <article className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                Engagé par catégorie
              </h3>
              <Filter className="size-3.5 text-slate-300" />
            </div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={dataCategorieEngage}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={10}
                    onClick={(e) => setDrilldownSector(e.name)}
                    className="cursor-pointer"
                  >
                    {dataCategorieEngage.map((entry) => (
                      <Cell
                        key={entry.name}
                        fill={SECTOR_COLORS[entry.name as keyof typeof SECTOR_COLORS]}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const d = payload[0]?.payload as {
                          name: string;
                          value: number;
                          count: number;
                          paye: number;
                        };
                        return (
                          <div className="bg-slate-900 text-white p-3 rounded-2xl shadow-2xl border-none">
                            <p className="text-[10px] font-black uppercase mb-1">{d.name}</p>
                            <p className="text-[9px] font-bold text-slate-400 uppercase mb-2">
                              {d.count} lignes
                            </p>
                            <p className="text-xs font-black text-blue-400">
                              Engagé : {money0(d.value)}
                            </p>
                            <p className="text-[9px] font-bold text-slate-400 uppercase">
                              Payé : {money0(d.paye)}
                            </p>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Legend
                    verticalAlign="bottom"
                    height={36}
                    iconType="circle"
                    wrapperStyle={{
                      fontSize: "9px",
                      fontWeight: "black",
                      textTransform: "uppercase",
                      letterSpacing: "0.1em",
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-4 text-[9px] text-center text-slate-400 font-black uppercase tracking-widest">
              Cliquez pour voir les corps d'état
            </p>
          </article>
        </div>

        {/* V8.16k — section « Classement des Tranches » supprimée du dashboard : le classement
            (villes / tranches / adresses) vit désormais dans l'onglet « Classement » de la
            carte « Cartographie vs Classement ». */}

        {/* JOURNAL DES COMMANDES */}
        <section className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-5 border-b bg-slate-50/50 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-900">
                Journal des Commandes
              </h3>
              <Badge className="bg-slate-200 text-slate-700 text-[9px] font-black uppercase tracking-tighter rounded-lg">
                {filteredJournal.length} LIGNES
              </Badge>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <Label className="text-[9px] font-black uppercase text-slate-400 tracking-wider">
                  Années
                </Label>
                <span className="text-[10px] font-black text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
                  {yearRange[0]}
                </span>
                <div className="relative w-36 h-6 flex items-center">
                  <YearRangeSlider
                    min={yearDomain[0]}
                    max={yearDomain[1]}
                    value={yearRange}
                    onChange={setYearRange}
                  />
                </div>
                <span className="text-[10px] font-black text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
                  {yearRange[1]}
                </span>
              </div>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <Checkbox
                  checked={includeArchived}
                  onCheckedChange={(checked) => setIncludeArchived(checked === true)}
                  className="size-4"
                />
                <span className="text-[9px] font-black uppercase text-slate-500 tracking-wider">
                  Inclure archivées
                </span>
              </label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-[9px] font-black uppercase tracking-widest border-slate-200 rounded-lg h-8"
                  >
                    <SlidersHorizontal className="size-3 mr-1.5" /> PARAMÈTRES
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-96 p-4 rounded-2xl space-y-5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase text-slate-900 tracking-widest">
                      Filtres du Journal
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setSelectedTranches([]);
                        setSelectedTypes([]);
                        setSelectedEtats([]);
                        setSelectedCharges([]);
                        setProgFilter({ prog: true, hors: true });
                      }}
                      className="text-[9px] font-black text-red-500 h-6 px-2"
                    >
                      EFFACER
                    </Button>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[9px] font-black uppercase text-slate-400 tracking-wider">
                      Tranche
                    </Label>
                    <MultiSelect
                      label="Tranches"
                      options={options.tranches}
                      selected={selectedTranches}
                      onChange={setSelectedTranches}
                      icon={Layers}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[9px] font-black uppercase text-slate-400 tracking-wider">
                      Type
                    </Label>
                    <MultiSelect
                      label="Types"
                      options={typeOptions}
                      selected={selectedTypes}
                      onChange={setSelectedTypes}
                      icon={Wrench}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[9px] font-black uppercase text-slate-400 tracking-wider">
                      État
                    </Label>
                    <MultiSelect
                      label="États"
                      options={etatOptions}
                      selected={selectedEtats}
                      onChange={setSelectedEtats}
                      icon={CheckCircle2}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[9px] font-black uppercase text-slate-400 tracking-wider">
                      Chargé d'opération (Hist. CMD)
                    </Label>
                    <MultiSelect
                      label="Chargés d'opération"
                      options={chargeOptions}
                      selected={selectedCharges}
                      onChange={setSelectedCharges}
                      icon={User}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[9px] font-black uppercase text-slate-400 tracking-wider">
                      Programmation
                    </Label>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setProgFilter((p) => ({ ...p, prog: !p.prog }))}
                        className={`px-3 py-1.5 rounded-lg text-[9px] font-black transition-all border ${progFilter.prog ? "bg-green-600 text-white border-green-600 shadow-md" : "bg-slate-50 text-slate-500 border-slate-200"}`}
                      >
                        PROG.
                      </button>
                      <button
                        onClick={() => setProgFilter((p) => ({ ...p, hors: !p.hors }))}
                        className={`px-3 py-1.5 rounded-lg text-[9px] font-black transition-all border ${progFilter.hors ? "bg-orange-600 text-white border-orange-600 shadow-md" : "bg-slate-50 text-slate-500 border-slate-200"}`}
                      >
                        HORS
                      </button>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
              <Button
                variant="outline"
                size="sm"
                onClick={handleLastYear}
                className="text-[9px] font-black uppercase tracking-widest border-slate-200 rounded-lg h-8"
              >
                DERNIÈRE ANNÉE
              </Button>
            </div>
          </div>
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-left text-[10px] border-collapse">
              <thead className="bg-slate-50 border-b text-slate-400 font-black uppercase tracking-widest">
                <tr>
                  <th className="p-4 w-20">Année</th>
                  <th className="p-4 w-32">
                    <button
                      onClick={() => toggleSort("numero_commande")}
                      className="flex items-center gap-1 hover:text-blue-600 transition-colors"
                    >
                      N° Commande{" "}
                      {sortConfig?.key === "numero_commande" &&
                        (sortConfig.direction === "asc" ? (
                          <ArrowUp className="size-3" />
                        ) : (
                          <ArrowDown className="size-3" />
                        ))}
                    </button>
                  </th>
                  <th className="p-4 w-24">
                    <button
                      onClick={() => toggleSort("tranche_code")}
                      className="flex items-center gap-1 hover:text-blue-600 transition-colors"
                    >
                      Tranche{" "}
                      {sortConfig?.key === "tranche_code" &&
                        (sortConfig.direction === "asc" ? (
                          <ArrowUp className="size-3" />
                        ) : (
                          <ArrowDown className="size-3" />
                        ))}
                    </button>
                  </th>
                  <th className="p-4 w-48">Adresse</th>
                  <th className="p-4 w-28">
                    <button
                      onClick={() => toggleSort("city")}
                      className="flex items-center gap-1 hover:text-blue-600 transition-colors"
                    >
                      Ville{" "}
                      {sortConfig?.key === "city" &&
                        (sortConfig.direction === "asc" ? (
                          <ArrowUp className="size-3" />
                        ) : (
                          <ArrowDown className="size-3" />
                        ))}
                    </button>
                  </th>
                  <th className="p-4 w-56">
                    <Popover>
                      <PopoverTrigger asChild>
                        <button className="flex items-center gap-1 hover:text-blue-600">
                          Descriptif <Search className="size-3" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-80 p-4 rounded-2xl">
                        <Label className="text-[9px] font-black uppercase mb-4 block">
                          Recherche Descriptif
                        </Label>
                        <div className="relative">
                          <Search className="absolute left-3 top-2.5 size-3.5 text-slate-400" />
                          <Input
                            type="text"
                            value={tableFilters["descriptif"]?.search ?? ""}
                            onChange={(e) =>
                              setTableFilters((p) => ({
                                ...p,
                                descriptif: {
                                  ...(p["descriptif"] ?? {}),
                                  search: e.target.value,
                                },
                              }))
                            }
                            placeholder="Rechercher dans le descriptif..."
                            autoFocus
                            className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-4 text-[10px] font-black uppercase focus:ring-2 focus:ring-blue-500 outline-none"
                          />
                        </div>
                        {tableFilters["descriptif"]?.search ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setTableFilters((p) => {
                                const next = { ...(p["descriptif"] ?? {}) };
                                delete next.search;
                                return { ...p, descriptif: next };
                              })
                            }
                            className="mt-2 text-[9px] font-black text-red-500 h-6 px-2"
                          >
                            EFFACER LA RECHERCHE
                          </Button>
                        ) : null}
                      </PopoverContent>
                    </Popover>
                  </th>
                  <th className="p-4 w-24">Type</th>
                  <th className="p-4 w-28">Entreprise</th>
                  <th className="p-4 w-32 text-right">
                    <Popover>
                      <PopoverTrigger asChild>
                        <button className="flex items-center gap-1 ml-auto hover:text-blue-600">
                          Engagé <Filter className="size-3" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-64 p-4 rounded-2xl">
                        <Label className="text-[9px] font-black uppercase mb-4 block">
                          Plage Engagé (€)
                        </Label>
                        <div className="space-y-4">
                          <Input
                            type="number"
                            placeholder="Min"
                            onChange={(e) => {
                              const value = Number(e.target.value);
                              setTableFilters((p) => ({
                                ...p,
                                engage: {
                                  ...(p["engage"] ?? {}),
                                  ...(value ? { min: value } : {}),
                                },
                              }));
                            }}
                            className="h-8 text-[10px] font-black"
                          />
                          <Input
                            type="number"
                            placeholder="Max"
                            onChange={(e) => {
                              const value = Number(e.target.value);
                              setTableFilters((p) => ({
                                ...p,
                                engage: {
                                  ...(p["engage"] ?? {}),
                                  ...(value ? { max: value } : {}),
                                },
                              }));
                            }}
                            className="h-8 text-[10px] font-black"
                          />
                        </div>
                      </PopoverContent>
                    </Popover>
                  </th>
                  <th className="p-4 w-32 text-right">Payé</th>
                  <th className="p-4 w-16 text-center">Prog.</th>
                  <th className="p-4 w-24">État</th>
                  <th className="p-4 w-12 text-center">
                    <button
                      onClick={() => setActFilter((v) => !v)}
                      title={
                        actFilter
                          ? "Désactiver le filtre anomalies"
                          : "Filtrer les commandes avec anomalie"
                      }
                      className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase transition-all ${
                        actFilter
                          ? "bg-blue-600 text-white shadow-sm"
                          : "text-slate-400 hover:text-blue-600"
                      }`}
                    >
                      ACT.
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredJournal.length === 0 && (
                  <tr>
                    <td
                      colSpan={13}
                      className="p-8 text-center text-[10px] font-bold uppercase tracking-widest text-slate-400"
                    >
                      {actFilter ? "Aucune anomalie détectée" : "Aucune commande"}
                    </td>
                  </tr>
                )}
                {filteredJournal.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((row) => {
                  const modif = historyMap.get(row.id);
                  const alertes = getAlertesCommande(row);
                  const sect = secteurDe(row);
                  const isProg = !!row.ligne_budget;
                  return (
                    <tr key={row.id} className="hover:bg-blue-50/30 transition-colors group">
                      <td className="p-4 font-bold text-slate-400">{yearOf(row)}</td>
                      <td className="p-4 font-black truncate">
                        {row.sans_commande ? (
                          <span className="inline-block rounded bg-slate-200 px-2 py-0.5 text-[8px] font-black uppercase tracking-wider text-slate-600">
                            Sans commande
                          </span>
                        ) : (
                          <button
                            onClick={() => {
                              // V8.12 — la ligne est garantie « commande » ici (hors badge
                              // « Sans commande ») : cast sûr vers le type enrichi.
                              setSelectedDetail(row as CommandeTravauxEnrichie);
                              // Ouvre la fiche VIA l'URL (param ?commande=) en FUSIONNANT avec
                              // les autres paramètres (de/a) : le bouton retour navigateur
                              // retirera le param et fermera l'overlay.
                              if (row.numero_commande) {
                                navigate({
                                  search: (prev) => ({ ...prev, commande: row.numero_commande }),
                                });
                              }
                            }}
                            className="hover:underline flex items-center gap-1 text-blue-600"
                          >
                            {row.numero_commande}
                            <Info className="size-3 opacity-0 group-hover:opacity-100" />
                          </button>
                        )}
                      </td>
                      <td className="p-4 font-black text-slate-700 truncate">
                        <Link
                          to="/adresses"
                          search={construireSearchAdresses({ tranche: row.tranche_code })}
                          className="hover:underline"
                        >
                          {row.tranche_code || "—"}
                        </Link>
                        {etiquettesParTranche[row.tranche_code ?? ""] ? (
                          <span className="mt-0.5 block">
                            <EtiquetteTranche
                              etiquette={etiquettesParTranche[row.tranche_code ?? ""]}
                            />
                          </span>
                        ) : null}
                      </td>
                      <td className="p-4 font-bold text-slate-600 truncate uppercase">
                        {adresseRuesParTranche[row.tranche_code ?? ""] || row.adresse || "—"}
                      </td>
                      <td className="p-4 font-bold text-slate-500 truncate uppercase">
                        {villeDeCommande(row, tranchesDetails, villesGeo ?? []) || "—"}
                      </td>
                      <td className="p-4 text-slate-500 truncate">{row.descriptif || "—"}</td>
                      <td className="p-4">
                        <span
                          className={`px-2 py-0.5 rounded text-[8px] font-black ${sect === "GT" ? "bg-blue-100 text-blue-700" : sect === "GE" ? "bg-teal-100 text-teal-700" : "bg-orange-100 text-orange-700"}`}
                        >
                          {sect}
                        </span>
                      </td>
                      <td className="p-4 font-bold text-slate-500 truncate">
                        {row.numero_fournisseur || "—"}
                      </td>
                      <td className="p-4 text-right font-black text-slate-900">
                        {money0(row.engage)}
                      </td>
                      <td className="p-4 text-right text-slate-600">{money0(row.paye)}</td>
                      <td className="p-4 text-center">
                        <div
                          className={`mx-auto size-2 rounded-full ${isProg ? "bg-green-500 shadow-green-200" : "bg-slate-300"} shadow-sm`}
                        />
                      </td>
                      <td className="p-4 truncate">
                        <span className="text-slate-400 font-black uppercase text-[8px]">
                          {row.etat_travaux || row.etat_commande || "—"}
                        </span>
                      </td>
                      <td className="p-4 text-center">
                        {alertes.length > 0 || modif ? (
                          <div className="flex items-center justify-center gap-1">
                            {alertes.length > 0 && (
                              <Popover>
                                <PopoverTrigger asChild>
                                  <button
                                    className="text-red-500 hover:scale-110"
                                    title={alertes.join("\n")}
                                    aria-label="Anomalies de données"
                                  >
                                    <AlertCircle className="size-4" />
                                  </button>
                                </PopoverTrigger>
                                <PopoverContent
                                  className="w-80 rounded-2xl border-red-200 shadow-2xl p-3"
                                  align="start"
                                >
                                  <p className="text-[9px] font-black uppercase tracking-widest text-red-500 mb-2">
                                    Anomalies données
                                  </p>
                                  <div className="space-y-1">
                                    {alertes.map((alerte, i) => (
                                      <p
                                        key={i}
                                        className="text-[10px] font-bold text-slate-700 leading-snug"
                                      >
                                        {alerte}
                                      </p>
                                    ))}
                                  </div>
                                </PopoverContent>
                              </Popover>
                            )}
                            {modif && (
                              <button
                                onClick={() => {
                                  setSelectedModif(modif);
                                  setVersionChoice("B");
                                }}
                                className="text-amber-500 hover:scale-110"
                              >
                                <AlertTriangle className="size-4 fill-amber-50" />
                              </button>
                            )}
                          </div>
                        ) : (
                          <div className="size-4 mx-auto rounded-full border-2 border-slate-100 group-hover:border-slate-200" />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filteredJournal.length > PAGE_SIZE ? (
            <div className="p-4 bg-slate-50/50 border-t flex items-center justify-between">
              <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">
                PAGE {page} SUR {Math.ceil(filteredJournal.length / PAGE_SIZE) || 1}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 font-black text-[9px] rounded-xl uppercase tracking-widest"
                  disabled={page === 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  PRÉCÉDENT
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 font-black text-[9px] rounded-xl uppercase tracking-widest"
                  disabled={page * PAGE_SIZE >= filteredJournal.length}
                  onClick={() => setPage((p) => p + 1)}
                >
                  SUIVANT
                </Button>
              </div>
            </div>
          ) : null}
        </section>
      </div>

      {/* MODALE FICHE DÉTAILLÉE ÉDITABLE — composant PARTAGÉ (Dashboard + Fournisseur) */}
      <CommandeFicheDialog
        open={!!selectedDetail}
        commande={selectedDetail}
        onClose={closeFiche}
        isEditing={isEditing}
        editForm={editForm}
        onEditField={(patch) => setEditForm((p) => ({ ...p, ...patch }) as CommandeTravauxEnrichie)}
        onStartEdit={handleEditStart}
        onSave={handleSave}
        onCancelEdit={() => setIsEditing(false)}
        onOpenHistorique={() => setHistoryFor(selectedDetail)}
        appliedNature={appliedNature}
        appliedCorps={appliedCorps}
        onDecider={setDecide}
        fournisseur={fournisseurFiche}
      />

      <DecideDialog state={decide} onClose={() => setDecide(null)} onSave={handleSaveDecision} />

      {/* DRILL-DOWN SECTEUR */}
      <Dialog open={!!drilldownSector} onOpenChange={(o) => !o && setDrilldownSector(null)}>
        <DialogContent className="max-w-xl rounded-3xl border-none shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-black uppercase tracking-tight">
              Détail : {drilldownSector}
            </DialogTitle>
            <DialogDescription className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
              Répartition Engagé par Corps d'état
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-2 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
            {dataDrilldown.map((d, i) => (
              <div
                key={d.name}
                className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100 hover:border-blue-200 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="text-[9px] font-black text-slate-300">#0{i + 1}</span>
                  <span className="text-[10px] font-black text-slate-700 uppercase">{d.name}</span>
                </div>
                <span className="text-[10px] font-black text-blue-600">{money0(d.value)}</span>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button
              onClick={() => setDrilldownSector(null)}
              className="w-full bg-slate-900 font-black text-[10px] rounded-xl uppercase tracking-widest h-12"
            >
              FERMER
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ALERTE MODIFICATIONS (⚠️) */}
      <Dialog open={!!selectedModif} onOpenChange={(o) => !o && setSelectedModif(null)}>
        <DialogContent className="max-w-4xl rounded-3xl overflow-hidden p-0 border-none shadow-2xl">
          <div className="bg-amber-500 p-6 text-white">
            <div className="flex items-center gap-3">
              <AlertTriangle className="size-8" />
              <div>
                <h2 className="text-xl font-black uppercase tracking-tight">
                  Conflit de version détecté
                </h2>
                <p className="text-[10px] font-black opacity-80 uppercase tracking-widest">
                  Commande N°{" "}
                  {(
                    selectedModif as unknown as { travaux_commandes?: { numero_commande?: string } }
                  )?.travaux_commandes?.numero_commande || "—"}
                </p>
              </div>
            </div>
          </div>
          <div className="p-8 space-y-8 bg-white">
            <div className="grid grid-cols-2 gap-8">
              <div
                className={`rounded-2xl border-2 p-6 transition-all ${versionChoice === "A" ? "border-blue-600 bg-blue-50/30 ring-4 ring-blue-50" : "border-slate-100 bg-slate-50"}`}
              >
                <div className="flex items-center justify-between mb-4">
                  <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                    VERSION ACTUELLE (A)
                  </span>
                  <RadioGroup
                    value={versionChoice}
                    onValueChange={(v) => setVersionChoice(v as "A" | "B")}
                  >
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="A" id="vA" />
                      <Label
                        htmlFor="vA"
                        className="text-[10px] font-black cursor-pointer uppercase"
                      >
                        GARDER L'ANCIENNE
                      </Label>
                    </div>
                  </RadioGroup>
                </div>
                <div className="space-y-3">
                  {selectedModif?.avant &&
                    Object.entries(selectedModif.avant).map(([k, v]) => (
                      <div
                        key={k}
                        className="flex justify-between text-[10px] border-b border-slate-100 pb-1"
                      >
                        <span className="text-slate-400 font-black uppercase tracking-tighter">
                          {k.replace(/_/g, " ")}
                        </span>
                        <span className="text-slate-900 font-bold">{text(v)}</span>
                      </div>
                    ))}
                </div>
              </div>
              <div
                className={`rounded-2xl border-2 p-6 transition-all ${versionChoice === "B" ? "border-blue-600 bg-blue-50/30 ring-4 ring-blue-50" : "border-slate-100 bg-slate-50"}`}
              >
                <div className="flex items-center justify-between mb-4">
                  <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                    VERSION IMPORTÉE (B)
                  </span>
                  <RadioGroup
                    value={versionChoice}
                    onValueChange={(v) => setVersionChoice(v as "A" | "B")}
                  >
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="B" id="vB" />
                      <Label
                        htmlFor="vB"
                        className="text-[10px] font-black cursor-pointer uppercase"
                      >
                        GARDER LA NOUVELLE
                      </Label>
                    </div>
                  </RadioGroup>
                </div>
                <div className="space-y-3">
                  {selectedModif?.apres &&
                    Object.entries(selectedModif.apres).map(([k, v]) => {
                      const changed =
                        JSON.stringify(selectedModif.avant?.[k]) !== JSON.stringify(v);
                      return (
                        <div
                          key={k}
                          className={`flex justify-between text-[10px] border-b border-slate-100 pb-1 ${changed ? "text-blue-600 font-black bg-blue-50 -mx-2 px-2 rounded" : ""}`}
                        >
                          <span className="text-slate-400 font-black uppercase tracking-tighter">
                            {k.replace(/_/g, " ")}
                          </span>
                          <span>{text(v)}</span>
                        </div>
                      );
                    })}
                </div>
              </div>
            </div>
            <div className="flex gap-4">
              <Button
                className="flex-1 h-12 bg-slate-900 hover:bg-slate-800 text-white font-black text-[11px] uppercase tracking-[0.2em] rounded-2xl shadow-xl"
                onClick={handleResolve}
                disabled={resolveMutation.isPending}
              >
                VALIDER LA DÉCISION
              </Button>
              <Button
                variant="ghost"
                className="h-12 px-8 font-black text-[11px] uppercase tracking-widest rounded-2xl"
                onClick={() => setSelectedModif(null)}
              >
                ANNULER
              </Button>
            </div>
            {resolveMutation.isError ? (
              <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                La résolution a échoué :{" "}
                {resolveMutation.error instanceof Error
                  ? resolveMutation.error.message
                  : "erreur inconnue"}
                . L'alerte reste active.
              </p>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      {/* ERREURS IMPORT */}
      <Dialog
        open={!!selectedImportErrors}
        onOpenChange={(o) => !o && setSelectedImportErrors(null)}
      >
        <DialogContent className="max-w-2xl rounded-3xl border-none shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-black uppercase tracking-tight flex items-center gap-2 text-red-600">
              <AlertCircle className="size-5" /> Analyse des Erreurs d'Import
            </DialogTitle>
            <DialogDescription className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
              Fichier : {selectedImportErrors?.fichier}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
            <div className="bg-red-50 p-5 rounded-2xl border border-red-100 text-xs text-red-800 font-bold uppercase tracking-tight leading-relaxed">
              {selectedImportErrors?.erreurs} lignes ont été rejetées car le numéro de commande
              était manquant ou les données financières étaient corrompues.
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
                <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Total Scanné</p>
                <p className="text-xl font-black text-slate-900">{selectedImportErrors?.lignes}</p>
              </div>
              <div className="p-4 rounded-2xl bg-green-50 border border-green-100">
                <p className="text-[9px] font-black text-green-400 uppercase mb-1">Réussites</p>
                <p className="text-xl font-black text-green-700">{selectedImportErrors?.creees}</p>
              </div>
            </div>
            {/* V8.16j — lignes budgétaires incohérentes (même LB, budgets différents) */}
            {alertesLB.length > 0 && (
              <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-800">
                <p className="flex items-center gap-2 font-black uppercase tracking-widest">
                  <AlertTriangle className="size-4 text-amber-600 shrink-0" />
                  {alertesLB.length} ligne{alertesLB.length > 1 ? "s" : ""} budgétaire
                  {alertesLB.length > 1 ? "s" : ""} incohérente{alertesLB.length > 1 ? "s" : ""}
                </p>
                <div className="mt-2 space-y-2">
                  {alertesLB.map((a) => (
                    <div
                      key={a.ligne_budget}
                      className="rounded-xl border border-amber-200 bg-white/60 p-3"
                    >
                      <p className="font-black uppercase">LB {a.ligne_budget}</p>
                      <p className="mt-0.5 font-bold">
                        {a.budgets.map((b) => money0(b)).join(" vs ")} ({a.nbLignes} lignes)
                      </p>
                    </div>
                  ))}
                </div>
                <p className="mt-2 font-bold text-amber-600">
                  La même ligne budgétaire porte des montants différents — l&apos;enveloppe sera
                  re-calculée au prochain import.
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              onClick={() => setSelectedImportErrors(null)}
              className="w-full bg-slate-900 font-black text-[10px] rounded-2xl uppercase tracking-widest h-12"
            >
              COMPRIS
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {historyFor ? (
        <CommandeHistoriqueDialog commande={historyFor} onClose={() => setHistoryFor(null)} />
      ) : null}
    </main>
  );
}
function CommandeHistoriqueDialog({
  commande,
  onClose,
}: {
  commande: Commande;
  onClose: () => void;
}) {
  const fetchHistory = useServerFn(getCommandeHistorique);
  const { data, isLoading } = useQuery({
    queryKey: ["commande-historique", commande.id],
    queryFn: () => fetchHistory({ data: { commandeId: commande.id } }),
  });
  const rows = (data ?? []) as HistoriqueTravaux[];

  const operationLabel: Record<string, string> = {
    creation: "Création",
    modification: "Modification",
    archivage: "Archivage",
    conflit: "Conflit de réimport",
    resolution: "Résolution",
    report: "Report d'exercice",
  };
  const keyLabel: Record<string, string> = {
    numero_commande: "N° commande",
    annee_exercice: "Année",
    budget: "Budget",
    engage: "Engagé",
    paye: "Payé",
    ecart: "Écart",
    solde: "Solde",
    fournisseur: "Fournisseur",
    lot_code: "Lot",
    descriptif: "Description",
    adresse: "Adresse",
    etat_travaux: "État",
  };
  const displayedKeys = [
    "numero_commande",
    "annee_exercice",
    "budget",
    "engage",
    "paye",
    "ecart",
    "fournisseur",
    "lot_code",
    "descriptif",
    "adresse",
    "etat_travaux",
  ];
  const moneyKeys = new Set(["budget", "engage", "paye", "ecart", "solde"]);
  const fmt = (k: string, v: string | number | boolean | null | undefined) =>
    v === null || v === undefined
      ? "—"
      : typeof v === "number" && moneyKeys.has(k)
        ? money0(v)
        : String(v);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto rounded-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="size-4 text-blue-600" />
            Historique — Commande N° {commande.numero_commande}
          </DialogTitle>
          <DialogDescription>
            Année d'exercice : {commande.annee_exercice ?? "—"} · {rows.length} événement(s)
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Chargement de l'historique…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun événement enregistré.</p>
        ) : (
          <div className="space-y-3">
            {rows.map((h) => {
              const avant = h.avant ?? {};
              const apres = h.apres ?? {};
              const isConflit = h.operation === "conflit";
              const isResolution = h.operation === "resolution";
              return (
                <div
                  key={h.id}
                  className="rounded-2xl border border-slate-100 bg-slate-50/50 p-4 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-black uppercase tracking-widest text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
                      {operationLabel[h.operation] ?? h.operation}
                    </span>
                    <span className="text-[10px] text-slate-400 font-bold">
                      {new Date(h.created_at).toLocaleString("fr-FR")}
                    </span>
                  </div>

                  {isResolution ? (
                    <p className="text-xs font-bold text-slate-700">
                      Version conservée : {String(apres["version_conservee"] ?? "—")}
                    </p>
                  ) : null}

                  {isConflit ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                      <div className="rounded-xl bg-white border border-slate-100 p-3 space-y-1">
                        <p className="text-[9px] font-black uppercase text-slate-400">
                          Ancienne version
                        </p>
                        {displayedKeys.map((k) => (
                          <p key={k} className="flex justify-between gap-2">
                            <span className="text-slate-400">{keyLabel[k] ?? k}</span>
                            <span
                              className={
                                String(avant[k]) !== String(apres[k])
                                  ? "text-red-500 font-bold"
                                  : "text-slate-700"
                              }
                            >
                              {fmt(k, avant[k])}
                            </span>
                          </p>
                        ))}
                      </div>
                      <div className="rounded-xl bg-white border border-slate-100 p-3 space-y-1">
                        <p className="text-[9px] font-black uppercase text-slate-400">
                          Nouvelle version
                        </p>
                        {displayedKeys.map((k) => (
                          <p key={k} className="flex justify-between gap-2">
                            <span className="text-slate-400">{keyLabel[k] ?? k}</span>
                            <span
                              className={
                                String(avant[k]) !== String(apres[k])
                                  ? "text-green-600 font-bold"
                                  : "text-slate-700"
                              }
                            >
                              {fmt(k, apres[k])}
                            </span>
                          </p>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl bg-white border border-slate-100 p-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs">
                        {displayedKeys
                          .filter((k) => apres[k] !== null && apres[k] !== undefined)
                          .map((k) => (
                            <p key={k} className="flex justify-between gap-2">
                              <span className="text-slate-400">{keyLabel[k] ?? k}</span>
                              <span className="text-slate-700 font-bold truncate">
                                {fmt(k, apres[k])}
                              </span>
                            </p>
                          ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <DialogFooter>
          <Button
            onClick={onClose}
            className="w-full bg-slate-900 font-black text-[10px] rounded-2xl uppercase tracking-widest h-12"
          >
            FERMER
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Enrichissement Historique CMD — sections de la Fiche Commande ──────────────
// Sources immuables : nature/corps d'état affichés en 2 variantes sans écrasement,
// corps d'état avec code en préfixe, PMR hors PSP, WPATRIMOINE à valider si ambigu,
// WNOTES lue telle quelle, rapprochement via la vue.

function DecideDialog({
  state,
  onClose,
  onSave,
}: {
  state: DecideState | null;
  onClose: () => void;
  onSave: (value: string) => void;
}) {
  const [choice, setChoice] = useState<string | null>(null);
  useEffect(() => {
    setChoice(null);
  }, [state]);

  return (
    <Dialog open={!!state} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md rounded-3xl border-none shadow-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-black uppercase tracking-tight">
            <AlertTriangle className="size-4 text-amber-600" /> {state?.titre ?? "Décision"}
          </DialogTitle>
          <DialogDescription>
            Choisissez la valeur à retenir pour cette commande. Les données sources (Excel, suivi
            annuel, Historique CMD) ne sont jamais modifiées.
          </DialogDescription>
        </DialogHeader>
        <RadioGroup value={choice ?? ""} onValueChange={(v) => setChoice(v)} className="space-y-2">
          {state?.options.map((o, i) => (
            <label
              key={i}
              className="flex cursor-pointer items-start gap-2 rounded-xl border border-slate-200 p-3"
            >
              <RadioGroupItem value={o.value} id={`dec-${i}`} />
              <span className="text-xs font-semibold text-slate-700">{o.label}</span>
            </label>
          ))}
        </RadioGroup>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button
            className="bg-amber-600 text-white hover:bg-amber-700"
            disabled={!choice}
            onClick={() => choice && onSave(choice)}
          >
            Valider la décision
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
