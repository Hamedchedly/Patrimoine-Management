/**
 * V8.21 — KANBAN devis → commande → travaux (PAGE « Pilotage »).
 * Sélecteur d'exercice ; cartes = opérations (préparation PSP + lignes suivi sans
 * commande) classées en colonnes dérivées (devis → commande → travaux).
 * Cliquer une carte ouvre la fiche opération (workflow complet) ; « Commande
 * passée » persiste entreprise/n°/date (table kanban_commandes_passees) à
 * confronter à l'import.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  FileText,
  Loader2,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import SuiviOperationFiche from "@/components/suivi/SuiviOperationFiche";
import PspDemandeDevisWorkflow from "@/components/preparation-psp/PspDemandeDevisWorkflow";
import {
  ETAT_PILOTAGE_LABELS,
  getPspSuiviAnnuel,
  getPspSuiviOperations,
  updatePspDevis,
  updatePspLigneEtatPilotage,
} from "@/lib/psp/prep.supabase.functions";
import {
  ajouterFichierCloture,
  confronterKanbanCommandesPassees,
  creerCommandePassee,
  declarerTerminee,
  getKanbanClotures,
  getKanbanCommandesPassees,
  getUrlFichierCloture,
  retirerCloture,
  supprimerCommandePassee,
  supprimerFichierCloture,
  type ClotureKanban,
  type FichierCloture,
} from "@/lib/kanban/functions";
import type { SuiviOperationVue } from "@/lib/psp/suivi.foundation";
import {
  kpiRegistreAnnuel,
  villeDepuisAdresse,
  type LigneRegistreAnnuel,
} from "@/lib/psp/suivi.view";
import {
  COLONNES_KANBAN,
  GROUPES_KANBAN,
  anneesKanban,
  colonneKanbanSansForcage,
  construireCartesKanban,
  groupeDeColonne,
  trierCartesKanban,
  type CarteKanban,
  type CommandePasseeKanban,
  type GroupeKanban,
  type TriCartesKanban,
} from "@/lib/kanban/view";

const OPS_KEY = ["kanban-operations"] as const;
const cpKey = (exercice: number) => ["kanban-commandes-passees", exercice] as const;
/** Clé du registre annuel affiché en KPI (même source que /suivi). */
const kpiKey = (exercice: number) => ["kanban-kpi-suivi-annuel", exercice] as const;
/** Clé des clôtures (« déclarer terminée »). */
const clotKey = (exercice: number) => ["kanban-clotures", exercice] as const;

/** Filtres du board — CC « tous », CC précis ou « sans CC ». */
const CC_TOUS = "__tous__";
const CC_SANS = "__sans_cc__";

/** Carte « commande réelle » — ligne du registre annuel (type 'commande', non liée
 *  à une opération de devis) : une commande importée, en cours ou terminée. */
type CarteCommandeReelle = {
  key: string;
  tranche: string;
  corps_etat: string | null;
  nature: string | null;
  adresse: string | null;
  ville: string | null;
  cc: string | null;
  montant: number | null;
  entreprise: string | null;
  numeroCommande: string | null;
  ligne_budget: string | null;
  etatTravaux: string | null;
  etat: LigneRegistreAnnuel["etat_annuel"];
  dateDebut: string | null;
  dateFin: string | null;
  groupe: GroupeKanban;
};

/** Cible d'un signalement « terminée » : une opération (ligne PSP) ou une commande réelle. */
type CibleCloture =
  { kind: "op"; carte: CarteKanban } | { kind: "cmd"; carte: CarteCommandeReelle };

/** Clé d'indexation d'une clôture (par psp_ligne_id ou commande_id). */
const cleCibleCloture = (cible: CibleCloture): string =>
  cible.kind === "op" ? `psp:${cible.carte.psp_ligne_id}` : cible.carte.key;

/** Libellé court de l'état annuel (badge sur les commandes réelles). */
const ETAT_REEL_LABEL: Record<string, string> = {
  sans_commande: "Sans commande",
  en_cours: "En cours",
  terminee: "Terminée",
  a_verifier: "À vérifier",
};

/** Construit la carte d'une commande réelle (ligne du registre de type 'commande'). */
function commandeReelleDepuisLigne(l: LigneRegistreAnnuel): CarteCommandeReelle | null {
  if (l.type !== "commande" || !l.commande) return null;
  const cmd = l.commande;
  return {
    key: `cmd:${l.id}`,
    tranche: l.tranche,
    corps_etat: l.corps_etat,
    nature: l.nature ?? cmd.descriptif ?? cmd.nature_analytique ?? null,
    adresse: l.adresse_rue ?? l.adresse,
    ville: l.ville,
    cc: l.cc,
    montant: cmd.budget ?? l.budget,
    entreprise: cmd.fournisseur ?? null,
    numeroCommande: cmd.numero_commande,
    ligne_budget: l.ligne_budget ?? cmd.ligne_budget ?? null,
    etatTravaux: cmd.etat_travaux ?? null,
    etat: l.etat_annuel,
    dateDebut: cmd.date_demarrage ?? null,
    dateFin: cmd.date_fin_travaux ?? null,
    groupe: l.etat_annuel === "terminee" ? "termines" : "commande_travaux",
  };
}

const RANG_ETAT_REEL: Record<string, number> = { a_verifier: 0, en_cours: 1, terminee: 2 };

/** Dernière modification d'une commande réelle (date de fin sinon de démarrage). */
const derniereModifCommandeReelle = (c: CarteCommandeReelle): string | null =>
  c.dateFin ?? c.dateDebut ?? null;

/** Trie les commandes réelles d'un groupe (mêmes règles que les cartes opérations). */
function trierCommandesReelles(
  list: CarteCommandeReelle[],
  mode: TriCartesKanban,
): CarteCommandeReelle[] {
  const arr = [...list];
  const cmpTranche = (a: CarteCommandeReelle, b: CarteCommandeReelle) =>
    a.tranche.localeCompare(b.tranche, "fr", { numeric: true });
  if (mode === "recent") {
    return arr.sort((a, b) => {
      const da = derniereModifCommandeReelle(a) ?? "";
      const db = derniereModifCommandeReelle(b) ?? "";
      if (da !== db) return db.localeCompare(da);
      return cmpTranche(a, b);
    });
  }
  if (mode === "etat") {
    return arr.sort((a, b) => {
      const ra = RANG_ETAT_REEL[a.etat] ?? 0;
      const rb = RANG_ETAT_REEL[b.etat] ?? 0;
      if (ra !== rb) return ra - rb;
      return cmpTranche(a, b);
    });
  }
  return arr.sort((a, b) => {
    const t = cmpTranche(a, b);
    if (t !== 0) return t;
    return (RANG_ETAT_REEL[a.etat] ?? 0) - (RANG_ETAT_REEL[b.etat] ?? 0);
  });
}

const fmt = (n: number | null | undefined): string =>
  n == null
    ? "—"
    : new Intl.NumberFormat("fr-FR", {
        style: "currency",
        currency: "EUR",
        maximumFractionDigits: 0,
      }).format(n);

const aujourdhui = () => new Date().toISOString().slice(0, 10);

/** Normalise pour la recherche (minuscules, sans accents). */
const normaliserRecherche = (s: string | null | undefined): string =>
  (s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

/** La carte opération correspond-elle au texte de recherche (tous les champs) ? */
function carteCorrespondRecherche(carte: CarteKanban, q: string): boolean {
  const nq = normaliserRecherche(q);
  if (!nq) return true;
  const entreprises = [
    ...carte.entreprisesConsultees.map((d) => d.entreprise),
    carte.commandePassee?.entreprise ?? "",
    ...carte.commandesLiees.map((c) => `${c.entreprise} ${c.numero}`),
  ].join(" ");
  const hay = [
    carte.tranche,
    carte.categorie,
    carte.adresse,
    carte.nature,
    carte.corps_etat,
    carte.cc,
    carte.ligne_budget,
    carte.op.programmation.adresse,
    entreprises,
  ].join(" ");
  return normaliserRecherche(hay).includes(nq);
}

/** La commande réelle correspond-elle au texte de recherche (tous les champs) ? */
function commandeCorrespondRecherche(c: CarteCommandeReelle, q: string): boolean {
  const nq = normaliserRecherche(q);
  if (!nq) return true;
  const hay = [
    c.tranche,
    c.corps_etat,
    c.nature,
    c.adresse,
    c.ville,
    c.cc,
    c.ligne_budget,
    c.entreprise,
    c.numeroCommande,
  ].join(" ");
  return normaliserRecherche(hay).includes(nq);
}

export function KanbanPage() {
  const queryClient = useQueryClient();
  const anneeCourante = useMemo(() => new Date().getFullYear(), []);
  const [exercice, setExercice] = useState<number>(anneeCourante);
  const [commandeOuverte, setCommandeOuverte] = useState<CarteKanban | null>(null);
  const [etapeCarte, setEtapeCarte] = useState<CarteKanban | null>(null);
  const [ficheOp, setFicheOp] = useState<SuiviOperationVue | null>(null);
  const [vueTermines, setVueTermines] = useState(false);
  const [confrontant, setConfrontant] = useState(false);
  // V8.24 — tri des cartes dans chaque colonne + filtre par chargé clientèle.
  // V8.25 — tri par défaut = « dernière modification ».
  const [tri, setTri] = useState<TriCartesKanban>("recent");
  const [cc, setCc] = useState<string>(CC_TOUS);
  // V8.27 — recherche libre sur tous les champs (description, ville, tranche, entreprise…).
  const [q, setQ] = useState("");
  // V8.28 — dialogue « Déclarer terminée » ouvert pour une carte.
  const [clotureOuverte, setClotureOuverte] = useState<CibleCloture | null>(null);

  const opsFn = useServerFn(getPspSuiviOperations);
  const cpFn = useServerFn(getKanbanCommandesPassees);
  const creerCp = useServerFn(creerCommandePassee);
  const supprimerCp = useServerFn(supprimerCommandePassee);
  const confronter = useServerFn(confronterKanbanCommandesPassees);
  const registreFn = useServerFn(getPspSuiviAnnuel);
  const retirerClotureFn = useServerFn(retirerCloture);

  const {
    data: opsData,
    isLoading: opsChargement,
    error: opsErreur,
  } = useQuery({
    queryKey: [...OPS_KEY],
    queryFn: () => opsFn(),
    staleTime: 60_000,
  });
  const operations = useMemo(() => opsData?.operations ?? [], [opsData]);

  const {
    data: cpsData,
    isLoading: cpsChargement,
    error: cpsErreur,
  } = useQuery({
    queryKey: cpKey(exercice),
    queryFn: () => cpFn({ data: { exercice } }),
    staleTime: 15_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const commandesPassees = useMemo(() => (cpsData ?? []) as CommandePasseeKanban[], [cpsData]);

  // V8.28 — clôtures (« déclarer terminée ») de l'exercice.
  const clotFn = useServerFn(getKanbanClotures);
  const { data: cloturesData, error: clotureErreur } = useQuery({
    queryKey: clotKey(exercice),
    queryFn: () => clotFn({ data: { exercice } }),
    staleTime: 15_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const clotures = useMemo(() => (cloturesData ?? []) as ClotureKanban[], [cloturesData]);
  const clotureTableAbsente =
    (clotureErreur as Error | null)?.message?.includes?.("kanban_clotures") ?? false;
  const clotureParCle = useMemo(() => {
    const m = new Map<string, ClotureKanban>();
    for (const c of clotures) {
      const cle = c.psp_ligne_id
        ? `psp:${c.psp_ligne_id}`
        : c.commande_id
          ? `cmd:${c.commande_id}`
          : "";
      if (cle && !m.has(cle)) m.set(cle, c);
    }
    return m;
  }, [clotures]);

  // V8.24 — registre annuel de l'exercice → mêmes KPI (3 barres) que /suivi, ET
  // V8.26 — source des « commandes réelles » importées (type 'commande') à afficher.
  const { data: registreData, isLoading: kpiChargement } = useQuery({
    queryKey: kpiKey(exercice),
    queryFn: () => registreFn({ data: { annee: exercice } }),
    staleTime: 30_000,
    retry: 1,
  });
  const lignesRegistre = useMemo(
    () => (registreData?.lignes ?? []) as LigneRegistreAnnuel[],
    [registreData],
  );
  const kpiVue = useMemo(() => {
    const k = kpiRegistreAnnuel(lignesRegistre);
    const sansCommande = lignesRegistre.filter(
      (l) => l.type === "operation" && l.etat_annuel === "sans_commande",
    );
    const compter = (p: (l: LigneRegistreAnnuel) => boolean) => sansCommande.filter(p).length;
    return {
      totalOperations: k.operations,
      budgetProgramme: k.budgetProgramme,
      engage: k.budgetEngage,
      paye: k.budgetPaye,
      travauxEnCours: k.travauxEnCours,
      terminees: k.terminees,
      devisSans: compter(
        (l) => l.consultation.nb_devis_recus === 0 && l.consultation.nb_demandes === 0,
      ),
      devisAttente: compter(
        (l) => l.consultation.nb_devis_recus === 0 && l.consultation.nb_demandes > 0,
      ),
      devisRecus: compter((l) => l.consultation.nb_devis_recus > 0),
    };
  }, [lignesRegistre]);
  // V8.26 — commandes réelles importées de l'exercice non liées à une opération
  // (lignes du registre de type 'commande') : cartes « en cours / terminées » qui
  // reflètent le dashboard annuel. Aucune écriture.
  const commandesReelles = useMemo<CarteCommandeReelle[]>(
    () =>
      lignesRegistre
        .map((l) => commandeReelleDepuisLigne(l))
        .filter((c): c is CarteCommandeReelle => c !== null),
    [lignesRegistre],
  );

  const migrationManquante =
    (cpsErreur as Error | null)?.message?.includes?.("kanban_commandes_passees") ?? false;

  const annees = useMemo(() => anneesKanban(operations), [operations]);
  // Si l'exercice sélectionné n'existe plus (ou avant chargement), bascule sur une année présente.
  useEffect(() => {
    if (annees.length > 0 && !annees.includes(exercice)) {
      const cible = annees.includes(anneeCourante) ? anneeCourante : (annees[0] ?? anneeCourante);
      setExercice(cible);
    }
  }, [annees, exercice, anneeCourante]);

  const cartes = useMemo(
    () => construireCartesKanban(operations, exercice, commandesPassees),
    [operations, exercice, commandesPassees],
  );
  // CC distincts parmi les cartes (opérations) ET les commandes réelles de l'exercice.
  const ccListe = useMemo(() => {
    const set = new Set<string>();
    for (const c of cartes) {
      const v = (c.cc ?? "").trim();
      if (v) set.add(v);
    }
    for (const c of commandesReelles) {
      const v = (c.cc ?? "").trim();
      if (v) set.add(v);
    }
    return [...set].sort((a, b) => a.localeCompare(b, "fr"));
  }, [cartes, commandesReelles]);
  // Cartes (opérations) après filtre par chargé clientèle puis recherche texte.
  const cartesFiltrees = useMemo(() => {
    const parCc = (list: CarteKanban[]) => {
      if (cc === CC_TOUS) return list;
      if (cc === CC_SANS) return list.filter((c) => !(c.cc ?? "").trim());
      return list.filter((c) => (c.cc ?? "").trim() === cc);
    };
    return parCc(cartes).filter((c) => carteCorrespondRecherche(c, q));
  }, [cartes, cc, q]);
  // Commandes réelles après le même filtre CC + recherche.
  const commandesReellesFiltrees = useMemo(() => {
    const parCc = (list: CarteCommandeReelle[]) => {
      if (cc === CC_TOUS) return list;
      if (cc === CC_SANS) return list.filter((c) => !(c.cc ?? "").trim());
      return list.filter((c) => (c.cc ?? "").trim() === cc);
    };
    return parCc(commandesReelles).filter((c) => commandeCorrespondRecherche(c, q));
  }, [commandesReelles, cc, q]);
  const parGroupe = useMemo(() => {
    const m = new Map<GroupeKanban, CarteKanban[]>();
    for (const g of GROUPES_KANBAN) m.set(g.code, []);
    for (const carte of cartesFiltrees) {
      const cloture = clotureParCle.get(`psp:${carte.psp_ligne_id}`);
      const reelleTerminee = carte.op.execution.statut === "travaux_termines";
      // V8.28 — signalée « terminée » mais pas encore confirmée par l'import → onglet Terminés.
      const groupe = !reelleTerminee && cloture ? "termines" : groupeDeColonne(carte.colonne);
      m.get(groupe)?.push(carte);
    }
    return m;
  }, [cartesFiltrees, clotureParCle]);
  const parGroupeCmds = useMemo(() => {
    const m = new Map<GroupeKanban, CarteCommandeReelle[]>();
    for (const g of GROUPES_KANBAN) m.set(g.code, []);
    for (const c of commandesReellesFiltrees) {
      const cloture = clotureParCle.get(c.key);
      const reelleTerminee = c.etat === "terminee";
      const groupe = !reelleTerminee && cloture ? "termines" : c.groupe;
      m.get(groupe)?.push(c);
    }
    return m;
  }, [commandesReellesFiltrees, clotureParCle]);
  // V8.26 — états forcés incohérents avec les données réelles (import).
  const cartesEnConflit = useMemo(
    () => cartesFiltrees.filter((c) => c.conflit_pilotage),
    [cartesFiltrees],
  );

  const invalider = async () => {
    await queryClient.invalidateQueries({ queryKey: [...OPS_KEY] });
    await queryClient.invalidateQueries({ queryKey: cpKey(exercice) });
    await queryClient.invalidateQueries({ queryKey: kpiKey(exercice) });
    await queryClient.invalidateQueries({ queryKey: clotKey(exercice) });
    // Synchronisation avec les écrans de devis (/suivi…) : mêmes sources.
    await queryClient.invalidateQueries({ queryKey: ["psp-suivi-annuel"] });
    await queryClient.invalidateQueries({ queryKey: ["psp-suivi-operations"] });
  };

  const lancerConfrontation = async () => {
    setConfrontant(true);
    try {
      const r = await confronter({ data: { exercice } });
      toast.success(`Confrontation : ${r.confirmees} confirmée(s), ${r.restantes} en attente.`);
      await invalider();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec de la confrontation.");
    } finally {
      setConfrontant(false);
    }
  };

  const supprimer = async (id: string) => {
    try {
      await supprimerCp({ data: { id } });
      await invalider();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Suppression impossible.");
    }
  };

  // V8.28 — retire un signalement « déclarée terminée » (et ses fichiers).
  const retirerClotureAction = async (id: string) => {
    try {
      await retirerClotureFn({ data: { id } });
      toast.success("Signalement « terminée » retiré.");
      await invalider();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Retrait impossible.");
    }
  };

  // Ouvre la fiche opération (workflow devis/commande complet) ; recharge le board après.
  const rafraichirFiche = async () => {
    await invalider();
    const data = await queryClient.fetchQuery({
      queryKey: [...OPS_KEY],
      queryFn: () => opsFn(),
    });
    const trouvee = (data?.operations ?? []).find(
      (o: SuiviOperationVue) => o.identite.id === ficheOp?.identite.id,
    );
    if (trouvee) setFicheOp(trouvee);
  };

  const total = cartesFiltrees.length + commandesReellesFiltrees.length;
  const nbTermines =
    (parGroupe.get("termines")?.length ?? 0) + (parGroupeCmds.get("termines")?.length ?? 0);

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col bg-background">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-5 py-3">
        <h1 className="text-base font-black uppercase tracking-wide text-foreground">Pilotage</h1>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Kanban devis → commande → travaux
        </span>
        {annees.length > 1 ? (
          <Select value={String(exercice)} onValueChange={(v) => setExercice(Number(v))}>
            <SelectTrigger className="h-8 w-28 text-xs">
              <SelectValue placeholder="Exercice" />
            </SelectTrigger>
            <SelectContent>
              {annees.map((a) => (
                <SelectItem key={a} value={String(a)}>
                  Exercice {a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Badge variant="outline" className="text-[10px]">
            Exercice {exercice}
          </Badge>
        )}
        <Badge variant="outline" className="text-[10px]">
          {total} opération(s)
        </Badge>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant={vueTermines ? "default" : "outline"}
            size="sm"
            className="h-8 text-xs"
            onClick={() => setVueTermines((v) => !v)}
            title="Afficher uniquement les opérations terminées (travaux finis)"
          >
            {vueTermines
              ? "‹ Revenir au tableau"
              : `Travaux terminés${nbTermines > 0 ? ` (${nbTermines})` : ""}`}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={() => void lancerConfrontation()}
            disabled={confrontant}
            title="Retrouve la commande réelle importée pour chaque « commande passée » en attente"
          >
            {confrontant ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            Confronter à l'import
          </Button>
        </div>
        <p className="w-full pt-1 text-[11px] text-muted-foreground">
          Cliquez sur une carte pour enregistrer l'étape suivante (demander un devis, saisir un
          devis reçu, le retenir, commande passée) ou forcer un état. Lien « Ouvrir la fiche »
          disponible depuis la fenêtre. Pastille : jaune = en attente · verte = devis reçu · ambre =
          à relancer.
        </p>
        {/* V8.24/8.27 — filtres du board : recherche texte + chargé clientèle + tri. */}
        <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-dashed pt-2">
          <div className="flex min-w-56 flex-1 items-center gap-1.5">
            <Search className="size-3.5 shrink-0 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Rechercher : TR, ville, description, entreprise, LB, corps d'état…"
              className="h-7 text-[11px]"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Chargé clientèle
            </span>
            <Select value={cc} onValueChange={setCc}>
              <SelectTrigger className="h-7 min-w-40 text-[11px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={CC_TOUS}>Tous les CC</SelectItem>
                {ccListe.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
                <SelectItem value={CC_SANS}>Sans CC</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Tri
            </span>
            <Select value={tri} onValueChange={(v) => setTri(v as TriCartesKanban)}>
              <SelectTrigger className="h-7 w-44 text-[11px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="recent">Dernière modification</SelectItem>
                <SelectItem value="tranche">Numéro de tranche</SelectItem>
                <SelectItem value="etat">État interne (attente → reçu)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {cc !== CC_TOUS ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px]"
              onClick={() => setCc(CC_TOUS)}
            >
              Réinitialiser le filtre CC
            </Button>
          ) : null}
        </div>
        {migrationManquante ? (
          <p className="mt-1 flex items-center gap-1.5 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
            <AlertTriangle className="size-3.5" />
            Table « kanban_commandes_passees » absente — appliquer la migration
            <code className="font-mono">20260907_kanban_commandes_passees.sql</code> dans l'éditeur
            SQL Supabase.
          </p>
        ) : cpsErreur ? (
          <p className="mt-1 flex items-start gap-1.5 rounded border border-rose-300 bg-rose-50 px-2 py-1 text-[11px] text-rose-700">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Persistance « commandes passées » indisponible : {(cpsErreur as Error).message} —
              appliquer la migration{" "}
              <code className="font-mono">20260907_kanban_commandes_passees.sql</code> (éditeur SQL
              Supabase).
            </span>
          </p>
        ) : null}
        {clotureTableAbsente ? (
          <p className="mt-1 flex items-center gap-1.5 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
            <AlertTriangle className="size-3.5" />
            Table « kanban_clotures » absente — appliquer la migration
            <code className="font-mono">20260908_kanban_cloture.sql</code> dans l'éditeur SQL
            Supabase pour activer « Déclarer terminée ».
          </p>
        ) : null}
      </header>

      {/* V8.26 — états forcés incohérents avec les données réelles (import). */}
      {cartesEnConflit.length > 0 ? (
        <div className="border-b border-amber-300 bg-amber-50 px-5 py-1.5">
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-amber-800">
            <AlertTriangle className="size-3.5 shrink-0" />
            <span className="font-semibold">
              {cartesEnConflit.length} état(s) forcé(s) incohérent(s) avec l'import — ouvrez la
              carte concernée pour « Suivre l'import » ou « Garder l'état forcé ».
            </span>
            <Button
              variant="outline"
              size="sm"
              className="ml-auto h-6 px-2 text-[10px]"
              onClick={() => {
                const c = cartesEnConflit[0];
                if (c) setEtapeCarte(c);
              }}
            >
              Examiner le 1er conflit
            </Button>
          </div>
        </div>
      ) : null}

      {/* V8.24 — mêmes 3 barres KPI que la page /suivi (registre de l'exercice). */}
      <div className="border-b bg-card px-5 py-2">
        {kpiChargement ? (
          <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <Loader2 className="size-3 animate-spin" /> Chargement des indicateurs de l'exercice…
          </p>
        ) : (
          <KanbanKpi kpi={kpiVue} />
        )}
      </div>

      {opsChargement ? (
        <p className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Chargement des opérations…
        </p>
      ) : opsErreur ? (
        <p className="p-6 text-sm text-destructive">{(opsErreur as Error).message}</p>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
          <div
            className="grid grid-flow-col grid-rows-1 gap-3"
            style={{ gridAutoColumns: "minmax(250px, 1fr)" }}
          >
            {(vueTermines
              ? GROUPES_KANBAN.filter((g) => g.code === "termines")
              : GROUPES_KANBAN.filter((g) => g.code !== "termines")
            ).map((g) => {
              const listeOps = parGroupe.get(g.code) ?? [];
              const listeCmds = parGroupeCmds.get(g.code) ?? [];
              const nb = listeOps.length + listeCmds.length;
              return (
                <div
                  key={g.code}
                  className="flex h-full max-h-[78vh] min-h-[200px] flex-col rounded-lg border bg-muted/30"
                >
                  <div className="flex items-center gap-2 px-3 py-2">
                    <span className={cn("size-2.5 rounded-full", g.dot)} />
                    <span className="text-[11px] font-black uppercase tracking-wider text-slate-700">
                      {g.label}
                    </span>
                    <Badge variant="secondary" className="ml-auto text-[10px]">
                      {nb}
                    </Badge>
                  </div>
                  <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
                    {cpsChargement
                      ? null
                      : trierCartesKanban(listeOps, tri).map((carte) => (
                          <CarteKanbanView
                            key={carte.key}
                            carte={carte}
                            cloture={clotureParCle.get(`psp:${carte.psp_ligne_id}`) ?? null}
                            surOuvrir={() => setEtapeCarte(carte)}
                            surCommander={() => setCommandeOuverte(carte)}
                            surSupprimer={(commandePassee) => void supprimer(commandePassee.id)}
                            surDeclarer={
                              clotureTableAbsente
                                ? undefined
                                : () => setClotureOuverte({ kind: "op", carte })
                            }
                            surRetirerCloture={(id) => void retirerClotureAction(id)}
                          />
                        ))}
                    {trierCommandesReelles(listeCmds, tri).map((c) => (
                      <CarteCommandeReelleView
                        key={c.key}
                        carte={c}
                        cloture={clotureParCle.get(c.key) ?? null}
                        surDeclarer={
                          clotureTableAbsente
                            ? undefined
                            : () => setClotureOuverte({ kind: "cmd", carte: c })
                        }
                        surRetirerCloture={(id) => void retirerClotureAction(id)}
                      />
                    ))}
                    {!cpsChargement && nb === 0 ? (
                      <p className="rounded border border-dashed px-2 py-3 text-center text-[11px] text-muted-foreground">
                        —
                      </p>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {commandeOuverte ? (
        <CommandePasseeDialog
          carte={commandeOuverte}
          exercice={exercice}
          onClose={() => setCommandeOuverte(null)}
          onSaved={async () => {
            setCommandeOuverte(null);
            await invalider();
          }}
          creer={async (p) => {
            await creerCp({ data: p });
          }}
        />
      ) : null}

      {etapeCarte ? (
        <EtapeSuivanteDialog
          carte={etapeCarte}
          exercice={exercice}
          onClose={() => setEtapeCarte(null)}
          surOuvrirFiche={() => {
            setFicheOp(etapeCarte.op);
            setEtapeCarte(null);
          }}
          surChangement={invalider}
        />
      ) : null}

      {clotureOuverte ? (
        <DeclarerTermineeDialog
          cible={clotureOuverte}
          exercice={exercice}
          cloture={
            clotureOuverte.kind === "op"
              ? (clotureParCle.get(`psp:${clotureOuverte.carte.psp_ligne_id}`) ?? null)
              : (clotureParCle.get(clotureOuverte.carte.key) ?? null)
          }
          onClose={() => setClotureOuverte(null)}
          onSaved={invalider}
        />
      ) : null}

      {ficheOp ? (
        <SuiviOperationFiche
          operation={ficheOp}
          onClose={() => setFicheOp(null)}
          onRefresh={rafraichirFiche}
        />
      ) : null}
    </div>
  );
}

/** Accès temporaire plein écran (la vraie page /pilotage attend la montée TanStack). */
export function KanbanOverlay({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-screen w-screen max-w-none flex-col gap-0 rounded-none border-0 p-0">
        <KanbanPage />
      </DialogContent>
    </Dialog>
  );
}

/** Carte « commande réelle » importée — affichage seul (déjà commandée/terminée). */
function CarteCommandeReelleView({
  carte,
  cloture,
  surDeclarer,
  surRetirerCloture,
}: {
  carte: CarteCommandeReelle;
  cloture?: ClotureKanban | null;
  surDeclarer?: (() => void) | undefined;
  surRetirerCloture?: (id: string) => void;
}) {
  // V8.28 — signalement « terminée » (réelle terminée = confirmée par l'import).
  const reelleTerminee = carte.etat === "terminee";
  const signalActive = Boolean(cloture && !reelleTerminee);
  return (
    <div className="rounded-md border border-dashed border-violet-300 bg-violet-50/40 p-2 text-slate-700">
      <div className="flex items-center gap-1.5">
        <span className="rounded bg-violet-900 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white">
          {carte.tranche}
        </span>
        <Badge variant="secondary" className="px-1 text-[8px]">
          Commande réelle
        </Badge>
        {carte.numeroCommande ? (
          <span className="font-mono text-[10px] text-violet-800">n° {carte.numeroCommande}</span>
        ) : null}
        <span className="ml-auto text-[11px] font-bold tabular-nums text-slate-800">
          {fmt(carte.montant)}
        </span>
      </div>
      {carte.ligne_budget || carte.corps_etat ? (
        <p className="mt-1 flex items-center gap-1.5 text-[9px] text-slate-500">
          {carte.ligne_budget ? (
            <span className="rounded bg-slate-200 px-1 font-mono font-bold text-slate-700">
              LB {carte.ligne_budget}
            </span>
          ) : null}
          {carte.corps_etat ? (
            <span className="uppercase tracking-wide">{carte.corps_etat}</span>
          ) : null}
        </p>
      ) : null}
      {carte.adresse ? (
        <p className="mt-1 truncate text-[10px] text-muted-foreground" title={carte.adresse}>
          {[carte.adresse, carte.ville].filter(Boolean).join(", ")}
        </p>
      ) : null}
      {carte.nature ? (
        <p className="mt-0.5 line-clamp-2 text-[11px] font-medium" title={carte.nature}>
          {carte.nature}
        </p>
      ) : null}
      <div className="mt-1.5 space-y-0.5 text-[10px] text-slate-600">
        <p className="flex items-center gap-1 rounded bg-white/60 px-1.5 py-0.5 font-semibold text-violet-900">
          {carte.entreprise ?? "—"}
          <span className="ml-auto font-normal text-slate-500">
            {carte.etatTravaux ?? ETAT_REEL_LABEL[carte.etat] ?? carte.etat}
          </span>
        </p>
      </div>
      {/* V8.28 — déclarer / gérer un signalement « terminée ». */}
      {surDeclarer && !reelleTerminee && !signalActive ? (
        <Button
          variant="outline"
          size="sm"
          className="mt-1.5 h-6 w-full text-[10px] text-teal-700"
          onClick={surDeclarer}
          title="Signaler la fin des travaux (cases + pièces jointes), à confirmer à l'import"
        >
          <CheckCircle2 className="size-3" /> Déclarer terminée
        </Button>
      ) : null}
      {signalActive ? (
        <div className="mt-1.5 flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-1.5 py-1">
          <span className="text-[9px] font-bold text-amber-800">
            Signalée · à confirmer à l'import
          </span>
          <span className="ml-auto flex items-center gap-0.5">
            {surDeclarer ? (
              <button
                type="button"
                onClick={surDeclarer}
                className="rounded p-0.5 text-amber-700 hover:bg-amber-100"
                title="Compléter (cases / pièces jointes)"
              >
                <FileText className="size-3" />
              </button>
            ) : null}
            {surRetirerCloture && cloture ? (
              <button
                type="button"
                onClick={() => surRetirerCloture(cloture.id)}
                className="rounded p-0.5 text-amber-700 hover:bg-amber-100 hover:text-destructive"
                title="Retirer le signalement"
              >
                <Trash2 className="size-3" />
              </button>
            ) : null}
          </span>
        </div>
      ) : null}
    </div>
  );
}

/** Carte individuelle — clic = ouvre la fiche opération (workflow complet). */
function CarteKanbanView({
  carte,
  cloture,
  surOuvrir,
  surCommander,
  surSupprimer,
  surDeclarer,
  surRetirerCloture,
}: {
  carte: CarteKanban;
  cloture?: ClotureKanban | null;
  surOuvrir: () => void;
  surCommander: () => void;
  surSupprimer: (cp: { id: string }) => void;
  surDeclarer?: (() => void) | undefined;
  surRetirerCloture?: (id: string) => void;
}) {
  const cp = carte.commandePassee;
  const commandeLiee = carte.commandesLiees[0];
  const entrepriseRetenue = carte.devisRetenu?.entreprise ?? null;
  const actionPossible =
    (carte.colonne === "devis_recus" || carte.colonne === "commande_a_passer") && !cp;
  const consultes = carte.entreprisesConsultees;
  // V8.28 — signalement « terminée » : réelle terminée (import) ou signalée à confirmer.
  const reelleTerminee = carte.op.execution.statut === "travaux_termines";
  const signalActive = Boolean(cloture && !reelleTerminee);
  const enExecution = carte.colonne === "commande_passee" || carte.colonne === "travaux_en_cours";

  const pastille = (etat: string) =>
    etat === "recu" ? "bg-emerald-500" : etat === "relance" ? "bg-amber-500" : "bg-yellow-400";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={surOuvrir}
      onKeyDown={(e) => e.key === "Enter" && surOuvrir()}
      className="cursor-pointer rounded-md border bg-white p-2 shadow-sm transition hover:ring-2 hover:ring-primary/40"
      title="Enregistrer l'étape suivante (devis, commande…) ou forcer un état"
    >
      {carte.conflit_pilotage ? (
        <p className="mb-1 flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-800">
          <AlertTriangle className="size-3 shrink-0" /> État forcé ≠ import
        </p>
      ) : null}
      <div className="flex items-center gap-1.5">
        <span className="rounded bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white">
          {carte.tranche}
        </span>
        <Badge variant="outline" className="px-1 text-[9px]">
          {carte.categorie}
        </Badge>
        {carte.origine === "hors_psp" ? (
          <Badge variant="secondary" className="px-1 text-[9px]">
            Hors PSP
          </Badge>
        ) : null}
        <span className="ml-auto text-[11px] font-bold tabular-nums text-slate-800">
          {fmt(carte.montant)}
        </span>
      </div>
      {carte.adresse ? (
        <p className="mt-1 truncate text-[10px] text-muted-foreground" title={carte.adresse ?? ""}>
          {carte.adresse}
        </p>
      ) : null}
      {carte.nature ? (
        <p
          className="mt-0.5 line-clamp-2 text-[11px] font-medium text-slate-700"
          title={carte.nature ?? ""}
        >
          {carte.nature}
        </p>
      ) : null}

      {carte.ligne_budget || carte.corps_etat ? (
        <p className="mt-1 flex items-center gap-1.5 text-[9px] text-slate-500">
          {carte.ligne_budget ? (
            <span className="rounded bg-slate-200 px-1 font-mono font-bold text-slate-700">
              LB {carte.ligne_budget}
            </span>
          ) : null}
          {carte.corps_etat ? (
            <span className="uppercase tracking-wide">{carte.corps_etat}</span>
          ) : null}
        </p>
      ) : null}

      {/* Infos du flux */}
      <div className="mt-1.5 space-y-0.5 text-[10px] text-slate-600">
        {cp ? (
          <p className="flex items-center gap-1 rounded bg-violet-50 px-1.5 py-0.5">
            <span className="font-semibold text-violet-800">{cp.entreprise}</span>
            {cp.numero_commande ? <span className="font-mono">n° {cp.numero_commande}</span> : null}
            {cp.statut === "a_confirmer" ? (
              <Badge className="bg-amber-100 text-amber-800">À confirmer à l'import</Badge>
            ) : cp.statut === "ecart" ? (
              <Badge className="bg-rose-100 text-rose-700">Écart</Badge>
            ) : (
              <Badge className="bg-emerald-100 text-emerald-700">
                <CheckCircle2 className="size-2.5" /> Confirmée
              </Badge>
            )}
          </p>
        ) : commandeLiee ? (
          <p className="flex items-center gap-1 rounded bg-violet-50 px-1.5 py-0.5">
            <span className="font-semibold">{commandeLiee.entreprise}</span>
            <span className="font-mono">n° {commandeLiee.numero}</span>
            <span className="ml-auto">{commandeLiee.etat_travaux ?? ""}</span>
          </p>
        ) : consultes.length > 0 ? (
          <div className="space-y-0.5">
            {consultes.slice(0, 4).map((d) => (
              <p key={d.entreprise} className="flex items-center gap-1.5 truncate">
                <span className={cn("size-2 shrink-0 rounded-full", pastille(d.etat))} />
                <span
                  className={cn(
                    "truncate",
                    d.entreprise === entrepriseRetenue && "font-semibold text-indigo-700",
                  )}
                  title={`${d.entreprise} — ${d.statut}`}
                >
                  {d.entreprise}
                </span>
                {d.entreprise === entrepriseRetenue ? (
                  <Badge variant="outline" className="px-1 text-[8px] text-indigo-700">
                    retenu
                  </Badge>
                ) : null}
                {d.etat === "recu" && d.montant != null ? (
                  <span className="ml-auto tabular-nums">{fmt(d.montant)}</span>
                ) : null}
              </p>
            ))}
            {consultes.length > 4 ? (
              <p className="text-[9px] text-muted-foreground">+{consultes.length - 4} autre(s)</p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="mt-1.5 flex items-center gap-1">
        <span className="text-[9px] text-muted-foreground">
          {carte.nb_demandes} demande(s) · {carte.nb_devis_recus} reçu(s)
        </span>
        {actionPossible ? (
          <Button
            variant="outline"
            size="sm"
            className="ml-auto h-6 px-2 text-[10px]"
            onClick={(e) => {
              e.stopPropagation();
              surCommander();
            }}
            title="Enregistrer la commande passée (entreprise + n° + date)"
          >
            <Plus className="size-3" /> Commande passée
          </Button>
        ) : null}
        {cp && cp.statut !== "confirme" ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              surSupprimer({ id: cp.id });
            }}
            className="ml-auto rounded p-1 text-muted-foreground hover:bg-slate-100 hover:text-destructive"
            title="Supprimer cette saisie"
          >
            <Trash2 className="size-3" />
          </button>
        ) : null}
      </div>
      {/* V8.28 — déclarer / gérer un signalement « terminée ». */}
      {surDeclarer && enExecution && !signalActive ? (
        <div className="mt-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-6 w-full text-[10px] text-teal-700"
            onClick={(e) => {
              e.stopPropagation();
              surDeclarer();
            }}
            title="Signaler la fin des travaux (cases + pièces jointes), à confirmer à l'import"
          >
            <CheckCircle2 className="size-3" /> Déclarer terminée
          </Button>
        </div>
      ) : null}
      {signalActive ? (
        <div className="mt-1.5 flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-1.5 py-1">
          <span className="text-[9px] font-bold text-amber-800">
            Signalée · à confirmer à l'import
          </span>
          <span className="ml-auto flex items-center gap-0.5">
            {surDeclarer ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  surDeclarer();
                }}
                className="rounded p-0.5 text-amber-700 hover:bg-amber-100"
                title="Compléter (cases / pièces jointes)"
              >
                <FileText className="size-3" />
              </button>
            ) : null}
            {surRetirerCloture && cloture ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  surRetirerCloture(cloture.id);
                }}
                className="rounded p-0.5 text-amber-700 hover:bg-amber-100 hover:text-destructive"
                title="Retirer le signalement"
              >
                <Trash2 className="size-3" />
              </button>
            ) : null}
          </span>
        </div>
      ) : null}
      <p className="mt-1 flex items-center justify-end gap-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary">
        Étape suivante <ChevronRight className="size-3" />
      </p>
    </div>
  );
}

type CandidatDevis = { id: string; entreprise: string };

/** Assistant « étape suivante » — enregistre l'action qui fait avancer la carte. */
function EtapeSuivanteDialog({
  carte,
  exercice,
  onClose,
  surOuvrirFiche,
  surChangement,
}: {
  carte: CarteKanban;
  exercice: number;
  onClose: () => void;
  surOuvrirFiche: () => void;
  surChangement: () => Promise<void>;
}) {
  const op = carte.op;
  const colonneLabel =
    COLONNES_KANBAN.find((c) => c.code === carte.colonne)?.label ?? carte.colonne;
  // V8.26 — colonne réelle déduite des données (sans le forçage) — pour l'alerte de conflit.
  const colonneNaturelle = colonneKanbanSansForcage(op, carte.commandePassee);
  const colonneNaturelleLabel =
    COLONNES_KANBAN.find((c) => c.code === colonneNaturelle)?.label ?? colonneNaturelle;
  const majDevis = useServerFn(updatePspDevis);
  const creerCp = useServerFn(creerCommandePassee);
  const forcer = useServerFn(updatePspLigneEtatPilotage);
  const [busy, setBusy] = useState(false);

  const demandes: CandidatDevis[] = op.consultation.entreprises.flatMap((e) =>
    e.devis
      .filter((d) => d.statut === "a_demander" || d.statut === "demande_envoyee")
      .map((d) => ({ id: d.id, entreprise: e.entreprise })),
  );
  const recus: CandidatDevis[] = op.consultation.entreprises.flatMap((e) =>
    e.devis
      .filter((d) => d.statut === "recu" || d.statut === "a_analyser")
      .map((d) => ({ id: d.id, entreprise: e.entreprise })),
  );
  // V8.24 — source de la demande de devis : réutilise le workflow de /suivi
  // (suggestions d'entreprises, recherche libre, modèles de mail, multi-envoi).
  const operationDevis = useMemo(
    () => ({
      id: carte.psp_ligne_id,
      tranche: carte.tranche,
      nature_travaux: carte.nature,
      corps_etat: carte.corps_etat,
      adresse: op.programmation.adresse ?? carte.adresse,
      ville: villeDepuisAdresse(op.programmation.adresse ?? ""),
      lots: (op.programmation.perimetre ?? [])
        .filter((x) => x.niveau === "lot")
        .map((x) => ({ lot_id: x.lot_id, niveau: x.niveau })),
    }),
    [carte, op],
  );
  const [choixRecu, setChoixRecu] = useState(demandes[0]?.id ?? "");
  const [montantRecu, setMontantRecu] = useState("");
  const [dateRecu, setDateRecu] = useState(aujourdhui());
  const [choixRetenu, setChoixRetenu] = useState(recus[0]?.id ?? "");
  const [cpEntreprise, setCpEntreprise] = useState(
    carte.devisRetenu?.entreprise ?? recus[0]?.entreprise ?? "",
  );
  const [cpNumero, setCpNumero] = useState("");
  const [cpDate, setCpDate] = useState(aujourdhui());
  const [pilotage, setPilotage] = useState<string>(op.identite.etat_pilotage ?? "");
  const [ouvrant, setOuvrant] = useState(false);

  const terminer = async (action: () => Promise<void>, ok: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      toast.success(ok);
      await surChangement();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec de l'action.");
    } finally {
      setBusy(false);
    }
  };

  const actionRecu = () =>
    terminer(async () => {
      const m = montantRecu.trim() === "" ? null : Number(montantRecu);
      await majDevis({
        data: {
          id: choixRecu,
          statut: "recu",
          montant: m != null && Number.isFinite(m) ? m : null,
          dateDevis: dateRecu,
        },
      });
    }, "Devis marqué reçu.");

  const actionRetenir = () =>
    terminer(async () => {
      await majDevis({ data: { id: choixRetenu, statut: "retenu" } });
    }, "Devis retenu.");

  const actionCommandePassee = () =>
    terminer(async () => {
      await creerCp({
        data: {
          exercice,
          psp_ligne_id: carte.psp_ligne_id,
          tranche_code: carte.tranche,
          adresse: carte.adresse,
          libelle: carte.nature,
          montant_prevu: carte.montant,
          entreprise: cpEntreprise.trim(),
          numero_commande: cpNumero.trim() || null,
          date_commande: cpDate,
        },
      });
    }, "Commande passée enregistrée — à confirmer à l'import.");

  const actionForcer = () =>
    terminer(
      async () => {
        await forcer({ data: { id: carte.psp_ligne_id, etatPilotage: pilotage || null } });
      },
      pilotage
        ? `État forcé : ${ETAT_PILOTAGE_LABELS[pilotage] ?? pilotage}.`
        : "Forçage retiré (état automatique).",
    );

  // V8.26 — résolution d'un conflit : retirer le forçage → l'opération suit les données réelles.
  const actionSuivreImport = () =>
    terminer(async () => {
      await forcer({ data: { id: carte.psp_ligne_id, etatPilotage: null } });
    }, "Forçage retiré — l'opération suit maintenant les données réelles (import).");

  const ouvrirFiche = () => {
    if (ouvrant) return;
    setOuvrant(true);
    onClose();
    surOuvrirFiche();
  };

  const forceLibelle = op.identite.etat_pilotage
    ? (ETAT_PILOTAGE_LABELS[op.identite.etat_pilotage] ?? op.identite.etat_pilotage)
    : null;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] w-[min(96vw,720px)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            Étape suivante — TR {carte.tranche} · {carte.categorie}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {[carte.adresse, carte.nature].filter(Boolean).join(" — ") || "—"} ·{" "}
            {fmt(carte.montant)} · colonne :{" "}
            <span className="font-semibold text-slate-700">{colonneLabel}</span>
            {forceLibelle ? ` · forçage : ${forceLibelle}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          {carte.conflit_pilotage ? (
            <section className="space-y-1.5 rounded-md border border-amber-300 bg-amber-50 p-3">
              <h3 className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wide text-amber-800">
                <AlertTriangle className="size-3.5" /> État forcé incohérent avec l'import
              </h3>
              <p className="text-[11px] text-amber-800">
                L'état forcé « {forceLibelle ?? "—"} » ne correspond plus aux données réelles :
                l'import indique « {colonneNaturelleLabel} ». Choisissez la suite :
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  className="h-7 text-[11px]"
                  onClick={() => void actionSuivreImport()}
                  disabled={busy}
                  title="Retire le forçage : l'opération suit la colonne réelle issue de l'import"
                >
                  <CheckCircle2 className="size-3.5" /> Suivre l'import ({colonneNaturelleLabel})
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[11px]"
                  onClick={onClose}
                  disabled={busy}
                >
                  Garder l'état forcé
                </Button>
              </div>
            </section>
          ) : null}

          {carte.colonne === "sans_devis" ? (
            <section className="space-y-1.5 rounded-md border border-sky-200 p-3">
              <h3 className="text-[11px] font-black uppercase tracking-wide text-sky-700">
                ① Demander des devis (une ou plusieurs entreprises)
              </h3>
              <p className="text-[11px] text-muted-foreground">
                Même procédure que la page Suivi devis : entreprises suggérées, recherche libre,
                modèles de mail. Chaque demande enregistrée met à jour le tableau de suivi des devis
                (la carte passe ensuite en colonne « Devis »).
              </p>
              <PspDemandeDevisWorkflow
                operation={operationDevis}
                figee={false}
                onEnvoye={surChangement}
              />
            </section>
          ) : null}

          {carte.colonne === "demande_devis" ? (
            <section className="space-y-1.5 rounded-md border p-3">
              <h3 className="text-[11px] font-black uppercase tracking-wide text-slate-700">
                ② Saisir le devis reçu
              </h3>
              {demandes.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Aucune demande en attente à marquer — ouvrez la fiche pour ajouter une demande.
                </p>
              ) : (
                <>
                  <Select value={choixRecu} onValueChange={setChoixRecu}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Entreprise" />
                    </SelectTrigger>
                    <SelectContent>
                      {demandes.map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.entreprise}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      type="number"
                      min={0}
                      value={montantRecu}
                      onChange={(e) => setMontantRecu(e.target.value)}
                      placeholder="Montant du devis (€)"
                    />
                    <Input
                      type="date"
                      value={dateRecu}
                      onChange={(e) => setDateRecu(e.target.value)}
                    />
                  </div>
                  <Button size="sm" onClick={() => void actionRecu()} disabled={!choixRecu || busy}>
                    Marquer le devis reçu
                  </Button>
                </>
              )}
            </section>
          ) : null}

          {carte.colonne === "devis_recus" ? (
            <section className="space-y-1.5 rounded-md border p-3">
              <h3 className="text-[11px] font-black uppercase tracking-wide text-slate-700">
                ③ Retenir un devis
              </h3>
              {recus.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Aucun devis reçu marqué — ouvrez la fiche pour saisir le devis reçu.
                </p>
              ) : (
                <>
                  <Select value={choixRetenu} onValueChange={setChoixRetenu}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Entreprise" />
                    </SelectTrigger>
                    <SelectContent>
                      {recus.map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.entreprise}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void actionRetenir()}
                    disabled={!choixRetenu || busy}
                  >
                    Retenir ce devis
                  </Button>
                </>
              )}
            </section>
          ) : null}

          {carte.colonne === "commande_a_passer" ? (
            <section className="space-y-1.5 rounded-md border p-3">
              <h3 className="text-[11px] font-black uppercase tracking-wide text-slate-700">
                ④ Commande passée (à confirmer à l'import)
              </h3>
              <Input
                value={cpEntreprise}
                onChange={(e) => setCpEntreprise(e.target.value)}
                placeholder="Entreprise retenue *"
              />
              <div className="grid grid-cols-2 gap-2">
                <Input
                  value={cpNumero}
                  onChange={(e) => setCpNumero(e.target.value)}
                  placeholder="N° de commande (si connu)"
                />
                <Input type="date" value={cpDate} onChange={(e) => setCpDate(e.target.value)} />
              </div>
              <Button
                size="sm"
                onClick={() => void actionCommandePassee()}
                disabled={!cpEntreprise.trim() || busy}
              >
                <Plus className="size-3.5" /> Enregistrer la commande passée
              </Button>
            </section>
          ) : null}

          {carte.colonne === "commande_passee" ||
          carte.colonne === "travaux_en_cours" ||
          carte.colonne === "fin_des_travaux" ? (
            <section className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
              Cette étape est pilotée par les données réelles (commande importée / travaux).
              Utilisez « Confronter à l'import » ou ouvrez la fiche complète pour les détails.
            </section>
          ) : null}

          <section className="space-y-1.5 rounded-md border border-indigo-200 bg-indigo-50/40 p-3">
            <h3 className="text-[11px] font-black uppercase tracking-wide text-indigo-800">
              Validation manuelle — forcer l'état
            </h3>
            <Select value={pilotage} onValueChange={setPilotage}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Aucun (état automatique)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Aucun (état automatique)</SelectItem>
                {Object.entries(ETAT_PILOTAGE_LABELS).map(([k, l]) => (
                  <SelectItem key={k} value={k}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => void actionForcer()} disabled={busy}>
              Forcer cet état
            </Button>
          </section>

          <div className="flex items-center justify-between gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
              Fermer
            </Button>
            <Button variant="outline" size="sm" onClick={ouvrirFiche} disabled={ouvrant}>
              Ouvrir la fiche complète <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Sous-dialogue : saisie d'une « commande passée » (entreprise + n° + date). */
function CommandePasseeDialog({
  carte,
  exercice,
  onClose,
  onSaved,
  creer,
}: {
  carte: CarteKanban;
  exercice: number;
  onClose: () => void;
  onSaved: () => Promise<void>;
  creer: (p: {
    exercice: number;
    psp_ligne_id: string;
    tranche_code: string;
    adresse: string | null;
    libelle: string | null;
    montant_prevu: number | null;
    entreprise: string;
    numero_commande: string | null;
    date_commande: string;
  }) => Promise<unknown>;
}) {
  const defautEntreprise =
    carte.devisRetenu?.entreprise ??
    carte.commandesLiees[0]?.entreprise ??
    carte.entreprisesConsultees.find((e) => e.statut === "Reçu")?.entreprise ??
    carte.entreprisesConsultees[0]?.entreprise ??
    "";
  const [entreprise, setEntreprise] = useState(defautEntreprise);
  const [numero, setNumero] = useState("");
  const [date, setDate] = useState(aujourdhui());
  const [envoyant, setEnvoyant] = useState(false);

  const enregistrer = async () => {
    if (!entreprise.trim() || envoyant) return;
    setEnvoyant(true);
    try {
      await creer({
        exercice,
        psp_ligne_id: carte.psp_ligne_id,
        tranche_code: carte.tranche,
        adresse: carte.adresse,
        libelle: carte.nature,
        montant_prevu: carte.montant,
        entreprise: entreprise.trim(),
        numero_commande: numero.trim() || null,
        date_commande: date,
      });
      toast.success("Commande passée enregistrée — à confirmer au prochain import.");
      await onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally {
      setEnvoyant(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">Commande passée — TR {carte.tranche}</DialogTitle>
          <DialogDescription className="text-xs">
            {carte.nature ?? carte.adresse ?? ""} · {fmt(carte.montant)} programmé sur {exercice}.
            La commande réelle sera confirmée au prochain import du suivi annuel.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1">
            <label className="text-[11px] font-semibold text-slate-600">Entreprise *</label>
            <Input value={entreprise} onChange={(e) => setEntreprise(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-600">
                N° de commande (si connu)
              </label>
              <Input
                value={numero}
                onChange={(e) => setNumero(e.target.value)}
                placeholder="ex. 5107622"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-600">Date de commande</label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={envoyant}>
            Annuler
          </Button>
          <Button
            size="sm"
            onClick={() => void enregistrer()}
            disabled={!entreprise.trim() || envoyant}
          >
            {envoyant ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Enregistrer la commande passée
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Type des indicateurs du haut (même structure que /suivi). */
type KanbanKpiVue = {
  totalOperations: number;
  budgetProgramme: number;
  engage: number;
  paye: number;
  travauxEnCours: number;
  terminees: number;
  devisSans: number;
  devisAttente: number;
  devisRecus: number;
};

/** V8.24 — petite barre empilée (copie de la page /suivi). */
function MiniBarreKanban({
  segments,
  legende,
}: {
  segments: { label: string; value: number; color: string }[];
  legende: string;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  return (
    <div className="rounded-lg border bg-card p-2">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
        {segments.map((s) =>
          s.value > 0 ? (
            <div
              key={s.label}
              className="h-full"
              style={{ width: `${(s.value / total) * 100}%`, backgroundColor: s.color }}
              title={`${s.label} : ${fmt(s.value)}`}
            />
          ) : null,
        )}
      </div>
      <p className="mt-1.5 text-[9px] font-black uppercase tracking-wide text-slate-400">
        {legende}
      </p>
    </div>
  );
}

/** V8.24 — bloc KPI du haut du Kanban : les 3 barres de la page /suivi. */
function KanbanKpi({ kpi }: { kpi: KanbanKpiVue }) {
  const reste = Math.max(0, kpi.budgetProgramme - kpi.engage);
  const autres = Math.max(0, kpi.totalOperations - kpi.travauxEnCours - kpi.terminees);
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      <MiniBarreKanban
        segments={[
          { label: "Engagé", value: kpi.engage, color: "#2563eb" },
          { label: "Reste", value: reste, color: "#e2e8f0" },
        ]}
        legende={`Engagé ${fmt(kpi.engage)} · Payé ${fmt(kpi.paye)} · Reste ${fmt(reste)}`}
      />
      <MiniBarreKanban
        segments={[
          { label: "En cours", value: kpi.travauxEnCours, color: "#2563eb" },
          { label: "Terminées", value: kpi.terminees, color: "#16a34a" },
          { label: "Autres", value: autres, color: "#e2e8f0" },
        ]}
        legende={`En cours ${kpi.travauxEnCours} · Terminées ${kpi.terminees} · Total ${kpi.totalOperations}`}
      />
      <MiniBarreKanban
        segments={[
          { label: "Sans devis", value: kpi.devisSans, color: "#f87171" },
          { label: "Demande faite", value: kpi.devisAttente, color: "#f59e0b" },
          { label: "Devis reçus", value: kpi.devisRecus, color: "#22c55e" },
        ]}
        legende={`Sans devis ${kpi.devisSans} · Demande faite ${kpi.devisAttente} · Devis reçus ${kpi.devisRecus}`}
      />
    </div>
  );
}

/** Lit un fichier en base64 (pour le téléversement côté serveur). */
function lireFichierB64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error("Lecture du fichier impossible."));
    r.onload = () => {
      const data = typeof r.result === "string" ? r.result : "";
      resolve(data.slice(data.indexOf(",") + 1));
    };
    r.readAsDataURL(file);
  });
}

/** Taille lisible d'un fichier (Ko/Mo). */
const tailleLisible = (n: number): string =>
  n < 1_048_576 ? `${Math.max(1, Math.round(n / 1024))} Ko` : `${(n / 1_048_576).toFixed(1)} Mo`;

/**
 * V8.28 — « Déclarer terminée » : signalement manuel de fin de travaux, en attente
 * de confirmation par l'import. Cases (facturé / PV de réception / rapport) +
 * note + pièces jointes (Supabase Storage, bucket « kanban-clotures »).
 */
function DeclarerTermineeDialog({
  cible,
  exercice,
  cloture,
  onClose,
  onSaved,
}: {
  cible: CibleCloture;
  exercice: number;
  cloture: ClotureKanban | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const declarer = useServerFn(declarerTerminee);
  const ajouterFichier = useServerFn(ajouterFichierCloture);
  const supprFichier = useServerFn(supprimerFichierCloture);
  const urlFichier = useServerFn(getUrlFichierCloture);

  const [facture, setFacture] = useState(cloture?.facture ?? false);
  const [pvReception, setPvReception] = useState(cloture?.pv_reception ?? false);
  const [rapport, setRapport] = useState(cloture?.rapport ?? false);
  const [note, setNote] = useState(cloture?.note ?? "");
  const [fichiers, setFichiers] = useState<FichierCloture[]>(cloture?.fichiers ?? []);
  const [pending, setPending] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const titre =
    cible.kind === "op"
      ? `TR ${cible.carte.tranche} · ${cible.carte.categorie}`
      : `TR ${cible.carte.tranche}${cible.carte.numeroCommande ? ` · n° ${cible.carte.numeroCommande}` : ""}`;
  const sousTitre =
    cible.kind === "op"
      ? [cible.carte.adresse, cible.carte.nature].filter(Boolean).join(" — ") || "—"
      : [cible.carte.adresse, cible.carte.ville, cible.carte.nature].filter(Boolean).join(" — ") ||
        "—";

  const commandeId =
    cible.kind === "cmd"
      ? cible.carte.key.startsWith("cmd:")
        ? cible.carte.key.slice(4)
        : undefined
      : undefined;

  const ouvrirFichier = async (f: FichierCloture) => {
    try {
      const u = await urlFichier({ data: { chemin: f.chemin } });
      window.open(u, "_blank", "noopener");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ouverture du fichier impossible.");
    }
  };

  const retirerFichierExistant = async (f: FichierCloture) => {
    if (!cloture?.id) return;
    try {
      const r = await supprFichier({ data: { id: cloture.id, chemin: f.chemin } });
      setFichiers(r.fichiers);
      toast.success("Pièce jointe supprimée.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Suppression impossible.");
    }
  };

  const choisirFichiers = (files: FileList | null) => {
    if (!files) return;
    const places = 5 - fichiers.length - pending.length;
    if (places <= 0) return;
    const arr = Array.from(files).slice(0, places);
    setPending((p) => [...p, ...arr]);
  };

  const enregistrer = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const payload =
        cible.kind === "op"
          ? {
              exercice,
              pspLigneId: cible.carte.psp_ligne_id,
              facture,
              pvReception,
              rapport,
              note: note.trim() || null,
            }
          : { exercice, commandeId, facture, pvReception, rapport, note: note.trim() || null };
      const row = await declarer({ data: payload });
      for (const file of pending) {
        const b64 = await lireFichierB64(file);
        const r = await ajouterFichier({
          data: {
            id: row.id,
            nom: file.name,
            type: file.type || null,
            taille: file.size,
            contenuB64: b64,
          },
        });
        setFichiers(r.fichiers);
      }
      toast.success(
        cloture
          ? "Signalement « terminée » mis à jour."
          : "Travaux signalés terminés — à confirmer à l'import.",
      );
      await onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  };

  const Case = ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: boolean;
    onChange: (v: boolean) => void;
  }) => (
    <label className="flex cursor-pointer items-center gap-2 rounded border border-slate-200 bg-white px-2 py-1.5 text-xs">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="size-3.5 accent-teal-600"
      />
      {label}
    </label>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] w-[min(96vw,640px)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="size-4 text-teal-600" /> Déclarer terminée — {titre}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {sousTitre} · exercice {exercice}. Signalement manuel, confirmé par le prochain import
            (l'état réel « Terminée »).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div>
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Éléments de clôture
            </p>
            <div className="flex flex-wrap gap-2">
              <Case label="Facturé" value={facture} onChange={setFacture} />
              <Case label="PV de réception" value={pvReception} onChange={setPvReception} />
              <Case label="Rapport" value={rapport} onChange={setRapport} />
            </div>
          </div>

          <div>
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Note (facultatif)
            </p>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-input bg-white px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-ring"
              placeholder="Commentaire de clôture…"
            />
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Pièces jointes ({fichiers.length + pending.length}/5)
              </p>
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-[10px]"
                onClick={() => inputRef.current?.click()}
                disabled={busy || fichiers.length + pending.length >= 5}
              >
                <Paperclip className="size-3" /> Ajouter des fichiers
              </Button>
              <input
                ref={inputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  choisirFichiers(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>
            {fichiers.length + pending.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                Aucune pièce jointe (facture, PV de réception, rapport…).
              </p>
            ) : (
              <ul className="space-y-1">
                {fichiers.map((f) => (
                  <li
                    key={f.chemin}
                    className="flex items-center gap-2 rounded border border-slate-200 bg-white px-2 py-1 text-[11px]"
                  >
                    <FileText className="size-3.5 shrink-0 text-slate-400" />
                    <span className="truncate font-medium" title={f.nom}>
                      {f.nom}
                    </span>
                    <span className="shrink-0 text-[9px] text-muted-foreground">
                      {tailleLisible(f.taille)}
                    </span>
                    <span className="ml-auto flex shrink-0 items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => void ouvrirFichier(f)}
                        className="rounded px-1 py-0.5 text-teal-700 hover:bg-teal-50"
                        title="Ouvrir"
                      >
                        Ouvrir
                      </button>
                      <button
                        type="button"
                        onClick={() => void retirerFichierExistant(f)}
                        className="rounded p-0.5 text-muted-foreground hover:bg-slate-100 hover:text-destructive"
                        title="Supprimer"
                      >
                        <X className="size-3.5" />
                      </button>
                    </span>
                  </li>
                ))}
                {pending.map((file, i) => (
                  <li
                    key={`${file.name}-${i}`}
                    className="flex items-center gap-2 rounded border border-dashed border-teal-300 bg-teal-50/50 px-2 py-1 text-[11px]"
                  >
                    <FileText className="size-3.5 shrink-0 text-teal-500" />
                    <span className="truncate font-medium">{file.name}</span>
                    <span className="shrink-0 text-[9px] text-muted-foreground">
                      {tailleLisible(file.size)} · à envoyer
                    </span>
                    <button
                      type="button"
                      onClick={() => setPending((p) => p.filter((_, j) => j !== i))}
                      className="ml-auto rounded p-0.5 text-muted-foreground hover:text-destructive"
                      title="Retirer"
                    >
                      <X className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button size="sm" onClick={() => void enregistrer()} disabled={busy}>
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <CheckCircle2 className="size-4" />
            )}
            {cloture ? "Mettre à jour" : "Déclarer terminée"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
