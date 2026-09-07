/**
 * V8.21 — KANBAN devis → commande → travaux (PAGE « Pilotage »).
 * Sélecteur d'exercice ; cartes = opérations (préparation PSP + lignes suivi sans
 * commande) classées en colonnes dérivées (devis → commande → travaux).
 * Cliquer une carte ouvre la fiche opération (workflow complet) ; « Commande
 * passée » persiste entreprise/n°/date (table kanban_commandes_passees) à
 * confronter à l'import.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
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
import { getPspSuiviOperations } from "@/lib/psp.prep.supabase.functions";
import {
  creerCommandePassee,
  confronterKanbanCommandesPassees,
  getKanbanCommandesPassees,
  supprimerCommandePassee,
} from "@/lib/kanban.functions";
import type { SuiviOperationVue } from "@/lib/psp.suivi.foundation";
import {
  COLONNES_KANBAN,
  anneesKanban,
  construireCartesKanban,
  type CarteKanban,
  type ColonneKanban,
  type CommandePasseeKanban,
} from "@/lib/kanban.view";

const OPS_KEY = ["kanban-operations"] as const;
const cpKey = (exercice: number) => ["kanban-commandes-passees", exercice] as const;

const fmt = (n: number | null | undefined): string =>
  n == null
    ? "—"
    : new Intl.NumberFormat("fr-FR", {
        style: "currency",
        currency: "EUR",
        maximumFractionDigits: 0,
      }).format(n);

const aujourdhui = () => new Date().toISOString().slice(0, 10);

export function KanbanPage() {
  const queryClient = useQueryClient();
  const anneeCourante = useMemo(() => new Date().getFullYear(), []);
  const [exercice, setExercice] = useState<number>(anneeCourante);
  const [commandeOuverte, setCommandeOuverte] = useState<CarteKanban | null>(null);
  const [ficheOp, setFicheOp] = useState<SuiviOperationVue | null>(null);
  const [confrontant, setConfrontant] = useState(false);

  const opsFn = useServerFn(getPspSuiviOperations);
  const cpFn = useServerFn(getKanbanCommandesPassees);
  const creerCp = useServerFn(creerCommandePassee);
  const supprimerCp = useServerFn(supprimerCommandePassee);
  const confronter = useServerFn(confronterKanbanCommandesPassees);

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
  const parColonne = useMemo(() => {
    const m = new Map<ColonneKanban, CarteKanban[]>();
    for (const c of COLONNES_KANBAN) m.set(c.code, []);
    for (const carte of cartes) m.get(carte.colonne)?.push(carte);
    return m;
  }, [cartes]);

  const invalider = async () => {
    await queryClient.invalidateQueries({ queryKey: [...OPS_KEY] });
    await queryClient.invalidateQueries({ queryKey: cpKey(exercice) });
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

  const ouvrirFiche = (carte: CarteKanban) => setFicheOp(carte.op);

  const total = cartes.length;

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col bg-background">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-5 py-3">
        <h1 className="text-base font-black uppercase tracking-wide text-foreground">
          Pilotage — Kanban devis → commande → travaux
        </h1>
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
          Cartes : opérations programmées + suivi sans commande de l'exercice. Cliquez sur une carte
          pour ouvrir la fiche (demande de devis, devis reçus, retenus, commande…) et faire avancer
          l'opération. Pastille : jaune = en attente · verte = devis reçu · ambre = à relancer.
        </p>
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
      </header>

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
            {COLONNES_KANBAN.map((col) => {
              const liste = parColonne.get(col.code) ?? [];
              return (
                <div
                  key={col.code}
                  className="flex h-full max-h-[78vh] min-h-[200px] flex-col rounded-lg border bg-muted/30"
                >
                  <div className="flex items-center gap-2 px-3 py-2">
                    <span className={cn("size-2.5 rounded-full", col.dot)} />
                    <span className="text-[11px] font-black uppercase tracking-wider text-slate-700">
                      {col.label}
                    </span>
                    <Badge variant="secondary" className="ml-auto text-[10px]">
                      {liste.length}
                    </Badge>
                  </div>
                  <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
                    {cpsChargement
                      ? null
                      : liste.map((carte) => (
                          <CarteKanbanView
                            key={carte.key}
                            carte={carte}
                            surOuvrir={() => ouvrirFiche(carte)}
                            surCommander={() => setCommandeOuverte(carte)}
                            surSupprimer={(commandePassee) => void supprimer(commandePassee.id)}
                          />
                        ))}
                    {!cpsChargement && liste.length === 0 ? (
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

/** Carte individuelle — clic = ouvre la fiche opération (workflow complet). */
function CarteKanbanView({
  carte,
  surOuvrir,
  surCommander,
  surSupprimer,
}: {
  carte: CarteKanban;
  surOuvrir: () => void;
  surCommander: () => void;
  surSupprimer: (cp: { id: string }) => void;
}) {
  const cp = carte.commandePassee;
  const commandeLiee = carte.commandesLiees[0];
  const entrepriseRetenue = carte.devisRetenu?.entreprise ?? null;
  const actionPossible =
    (carte.colonne === "devis_recus" || carte.colonne === "commande_a_passer") && !cp;
  const consultes = carte.entreprisesConsultees;

  const pastille = (etat: string) =>
    etat === "recu" ? "bg-emerald-500" : etat === "relance" ? "bg-amber-500" : "bg-yellow-400";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={surOuvrir}
      onKeyDown={(e) => e.key === "Enter" && surOuvrir()}
      className="cursor-pointer rounded-md border bg-white p-2 shadow-sm transition hover:ring-2 hover:ring-primary/40"
      title="Ouvrir la fiche opération (devis, commande, travaux)"
    >
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
      <p className="mt-1 flex items-center justify-end gap-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary">
        Ouvrir la fiche <ChevronRight className="size-3" />
      </p>
    </div>
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
