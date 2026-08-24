import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Eye,
  Filter,
  Layers,
  ListChecks,
  Pencil,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  Undo2,
  X,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { savePspFeedback } from "@/lib/psp.functions";
import {
  CHAMPS_MODIFIABLES,
  OPTIONS_DOMAINE_TECHNIQUE,
  OPTIONS_ELEMENT_PATRIMONIAL,
  OPTIONS_FAMILLE_PSP,
  OPTIONS_NATURE_EXCEPTIONNELLE,
  OPTIONS_TYPE_INTERVENTION,
  champsInterditsModification,
  construireCleMetierCommande,
  construireFeedbackPsp,
  filtrerCommandesValidation,
  rechercherCommandes,
  type PspCommandeValidation,
  type PspCategoriePsp,
  type PspFiltreValidation,
  type PspGroupeApercu,
  type PspMotifExclusion,
  type PspNiveauPriorite,
  type PspPerimetre,
} from "@/lib/psp.validation";
import {
  getPspDecision,
  getPspValidationApercu,
  getPspValidationDetail,
} from "@/lib/psp.validation.functions";

export const Route = createFileRoute("/psp-validation")({
  head: () => ({
    meta: [
      { title: "Analyse historique des commandes" },
      {
        name: "description",
        content:
          "Analyse, classification et identification des commandes hors périmètre PSP. Aucune écriture hors psp_feedback.",
      },
    ],
  }),
  component: PspValidationPage,
});

// ── Petits helpers d'affichage ──────────────────────────────────────────────

function BadgePriorite({ niveau }: { niveau: PspNiveauPriorite }) {
  const styles: Record<PspNiveauPriorite, string> = {
    elevee: "bg-red-500/15 text-red-700 border-red-500/30",
    moyenne: "bg-amber-500/15 text-amber-700 border-amber-500/30",
    faible: "bg-slate-500/15 text-slate-600 border-slate-400/30",
  };
  const labels: Record<PspNiveauPriorite, string> = {
    elevee: "ÉLEVÉE",
    moyenne: "MOYENNE",
    faible: "FAIBLE",
  };
  return (
    <Badge variant="outline" className={styles[niveau]}>
      {labels[niveau]}
    </Badge>
  );
}

function BadgePerimetre({
  perimetre,
  motif,
  estPmr,
}: {
  perimetre: string;
  motif: string | null;
  estPmr: boolean;
}) {
  if (perimetre === "eligible") {
    return (
      <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700">
        Éligible
      </Badge>
    );
  }
  if (perimetre === "hors_psp") {
    const label = estPmr
      ? "Hors PSP · PMR"
      : motif === "autre_charge_operation"
        ? "Hors PSP · Chargé"
        : motif === "naac_hors_psp"
          ? "Hors PSP · AC/HO"
          : "Hors PSP";
    return (
      <Badge variant="outline" className="border-slate-400/30 bg-slate-500/10 text-slate-600">
        {label}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-700">
      À examiner
    </Badge>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent?: boolean;
}) {
  return (
    <Card>
      <CardContent className="pt-4">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className={`mt-1 text-2xl font-semibold ${accent ? "text-red-600" : ""}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

const fmtEuro = (v: number) =>
  new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(v);

const fmtConf = (c: number) => c.toFixed(2);

// ── Page principale ─────────────────────────────────────────────────────────

type Apercu = {
  import: {
    id: string;
    fichier_nom: string | null;
    exercice: number | null;
    statut: string | null;
    created_at: string | null;
  };
  stats: {
    a_valider: number;
    groupes: number;
    haute_priorite: number;
    multi_domaines: number;
    exceptionnelles: number;
    faible_confiance: number;
    montant_total: number;
    // périmètre PSP
    eligible: number;
    hors_psp: number;
    a_examiner: number;
    pmr: number;
    charges: string[];
    montant_psp: number;
  };
  groupes: PspGroupeApercu[];
  commandes: PspCommandeValidation[];
  suggestions: Array<{
    domaine: string;
    type: string;
    occurrences: number;
    motif_exemple: string | null;
  }>;
  configuration: { charges_operation_exclus: string[] };
};

function PspValidationPage() {
  const apercuFn = useServerFn(getPspValidationApercu);
  const detailFn = useServerFn(getPspValidationDetail);
  const saveFn = useServerFn(savePspFeedback);

  const [apercu, setApercu] = useState<Apercu | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // vues + filtres
  const [vue, setVue] = useState<"groupes" | "commandes">("groupes");
  const [filtre, setFiltre] = useState<PspFiltreValidation>("toutes");
  const [naac, setNaac] = useState<string>("tous");
  const [domaine, setDomaine] = useState<string>("tous");
  const [typeInt, setTypeInt] = useState<string>("tous");
  const [aValiderSeul, setAValiderSeul] = useState(true);
  const [recherche, setRecherche] = useState("");
  // périmètre PSP
  const [perimetre, setPerimetre] = useState<string>("tous");
  const [motifExcl, setMotifExcl] = useState<string>("tous");
  const [charge, setCharge] = useState<string>("tous");
  const [pmrSeul, setPmrSeul] = useState(false);

  // dialogues
  const [groupeOuvert, setGroupeOuvert] = useState<PspGroupeApercu | null>(null);
  const [commandeDetail, setCommandeDetail] = useState<{
    comn: string;
    detail: Awaited<ReturnType<typeof getPspValidationDetail>> | null;
  } | null>(null);
  const [modifierCible, setModifierCible] = useState<
    | { type: "commande"; commande: PspCommandeValidation }
    | { type: "groupe"; groupe: PspGroupeApercu }
    | null
  >(null);
  const [confirmation, setConfirmation] = useState<
    | { type: "validate_groupe"; groupe: PspGroupeApercu }
    | {
        type: "modify_groupe";
        groupe: PspGroupeApercu;
        correction: Record<string, unknown>;
        motif: string;
      }
    | { type: "creer_regle"; suggestion: { domaine: string; type: string; occurrences: number } }
    | null
  >(null);

  const charger = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apercuFn({ data: {} });
      setApercu(result as unknown as Apercu);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Chargement impossible");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Commandes filtrées + recherchées (pur)
  const commandesFiltrees = useMemo(() => {
    if (!apercu) return [];
    let list = filtrerCommandesValidation(apercu.commandes, {
      filtre,
      naac: naac === "tous" ? null : naac,
      domaine: domaine === "tous" ? null : domaine,
      type: typeInt === "tous" ? null : typeInt,
      aValiderSeulement: aValiderSeul,
      perimetre:
        perimetre === "tous" ? null : (perimetre as "eligible" | "hors_psp" | "a_examiner"),
      motif_exclusion:
        motifExcl === "tous"
          ? null
          : (motifExcl as "pmr" | "autre_charge_operation" | "naac_hors_psp"),
      pmr_seulement: pmrSeul,
      charges_operation: charge === "tous" ? null : charge === "__inconnu__" ? [""] : [charge],
    });
    list = rechercherCommandes(list, recherche);
    return list;
  }, [
    apercu,
    filtre,
    naac,
    domaine,
    typeInt,
    aValiderSeul,
    perimetre,
    motifExcl,
    charge,
    pmrSeul,
    recherche,
  ]);

  const propositionDe = (c: PspCommandeValidation): Record<string, unknown> => ({
    comn: c.comn,
    libelle_normalise: c.libelle_normalise,
    type_intervention: c.type_intervention,
    domaine_technique: c.domaine_technique,
    famille_psp: c.famille_psp,
    element_patrimonial: c.element_patrimonial,
    nature_exceptionnelle: c.nature_exceptionnelle,
    confiance: c.confiance,
    regle_appliquee: c.regle_appliquee,
    justification: c.justification,
  });

  /** Écrit une décision via savePspFeedback (jamais d'écriture directe). */
  const enregistrer = async (
    decision: "validate" | "modify" | "reject" | "indeterminate",
    cible_id: string,
    proposition: Record<string, unknown> | null,
    correction: Record<string, unknown> | null,
    motif: string | null,
  ) => {
    setMessage(null);
    try {
      await saveFn({
        data: construireFeedbackPsp({
          cible_id,
          proposition_initiale: proposition,
          decision,
          correction,
          motif,
        }),
      });
      setMessage(`Décision « ${decision} » enregistrée pour ${cible_id}.`);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Enregistrement du feedback impossible");
      return false;
    }
  };

  const validerCommande = async (c: PspCommandeValidation, motif: string) => {
    if (await enregistrer("validate", c.comn, propositionDe(c), null, motif || null)) {
      setCommandeDetail(null);
    }
  };

  const rejeterCommande = async (c: PspCommandeValidation, motif: string) => {
    if (await enregistrer("reject", c.comn, propositionDe(c), null, motif || null)) {
      setCommandeDetail(null);
    }
  };

  const marquerIndetermine = async (c: PspCommandeValidation, motif: string) => {
    if (await enregistrer("indeterminate", c.comn, propositionDe(c), null, motif || null)) {
      setCommandeDetail(null);
    }
  };

  const ouvrirCommande = async (c: PspCommandeValidation) => {
    setCommandeDetail({ comn: c.comn, detail: null });
    try {
      const detail = await detailFn({ data: { comn: c.comn } });
      setCommandeDetail({ comn: c.comn, detail: detail as never });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Détail indisponible");
    }
  };

  const validerGroupe = async (g: PspGroupeApercu) => {
    setMessage(null);
    try {
      for (const comn of g.comn_liste) {
        const c = apercu?.commandes.find((x) => x.comn === comn);
        if (!c) continue;
        await saveFn({
          data: construireFeedbackPsp({
            cible_id: comn,
            proposition_initiale: propositionDe(c),
            decision: "validate",
            correction: null,
            motif: `Validation groupe ${g.libelle_normalise}`,
          }),
        });
      }
      setMessage(`${g.occurrences} commande(s) du groupe « ${g.libelle_normalise} » validée(s).`);
      setConfirmation(null);
      setGroupeOuvert(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Validation du groupe impossible");
    }
  };

  const modifierGroupe = async (
    g: PspGroupeApercu,
    correction: Record<string, unknown>,
    motif: string,
  ) => {
    setMessage(null);
    const interdits = champsInterditsModification(correction);
    if (interdits.length > 0) {
      setError(`Champs source non modifiables : ${interdits.join(", ")}`);
      return;
    }
    try {
      for (const comn of g.comn_liste) {
        const c = apercu?.commandes.find((x) => x.comn === comn);
        if (!c) continue;
        await saveFn({
          data: construireFeedbackPsp({
            cible_id: comn,
            proposition_initiale: propositionDe(c),
            decision: "modify",
            correction,
            motif: motif || `Modification groupe ${g.libelle_normalise}`,
          }),
        });
      }
      setMessage(`${g.occurrences} commande(s) du groupe « ${g.libelle_normalise} » modifiée(s).`);
      setConfirmation(null);
      setModifierCible(null);
      setGroupeOuvert(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Modification du groupe impossible");
    }
  };

  const proposerRegle = async (s: { domaine: string; type: string; occurrences: number }) => {
    setMessage(null);
    try {
      await saveFn({
        data: construireFeedbackPsp({
          cible_id: `regle:${s.domaine}:${s.type}`,
          proposition_initiale: null,
          decision: "proposer_regle",
          correction: { domaine_technique: s.domaine, type_intervention: s.type },
          motif: `Proposition de règle récurrente (${s.occurrences} corrections) — à valider humainement avant toute application`,
          cible_type: "autre",
        }),
      });
      setMessage(
        `Intention de règle enregistrée (${s.domaine}/${s.type}). Une future règle générale restera soumise à validation humaine.`,
      );
      setConfirmation(null);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Enregistrement de la proposition impossible",
      );
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto max-w-6xl px-4 py-8">
        <div className="flex items-center gap-2 text-muted-foreground">
          <RefreshCw className="size-4 animate-spin" /> Chargement des classifications…
        </div>
      </div>
    );
  }

  if (error && !apercu) {
    return (
      <div className="container mx-auto max-w-6xl px-4 py-8">
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertTitle>Impossible de charger la validation</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!apercu) return null;

  return (
    <div className="container mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Analyse historique des commandes</h1>
          <p className="text-sm text-muted-foreground">
            Analyse, classification et identification des commandes hors périmètre PSP
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/import-psp">
              <Undo2 className="size-3.5" /> Import Historique CMD
            </Link>
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void charger()}>
            <RefreshCw className="size-3.5" /> Recharger
          </Button>
        </div>
      </div>

      {apercu.import && (
        <p className="mb-4 text-xs text-muted-foreground">
          Import « {apercu.import.fichier_nom} » · exercice {apercu.import.exercice ?? "—"} · statut{" "}
          {apercu.import.statut ?? "—"}
        </p>
      )}

      {message && (
        <Alert className="mb-4">
          <CheckCircle2 className="size-4" />
          <AlertTitle>Enregistré</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}
      {error && apercu && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="size-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Indicateurs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Commandes à valider" value={apercu.stats.a_valider} accent />
        <StatCard label="Groupes de validation" value={apercu.stats.groupes} />
        <StatCard label="Haute priorité" value={apercu.stats.haute_priorite} accent />
        <StatCard label="Multi-domaines" value={apercu.stats.multi_domaines} />
        <StatCard label="Commandes exceptionnelles" value={apercu.stats.exceptionnelles} />
        <StatCard label="Montant PSP (éligible)" value={fmtEuro(apercu.stats.montant_psp)} accent />
      </div>
      {/* Périmètre PSP */}
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Éligibles" value={apercu.stats.eligible} />
        <StatCard label="Hors périmètre" value={apercu.stats.hors_psp} />
        <StatCard label="À examiner" value={apercu.stats.a_examiner} />
        <StatCard label="PMR (hors PSP)" value={apercu.stats.pmr} />
        <StatCard label="Montant total (contexte)" value={fmtEuro(apercu.stats.montant_total)} />
        <StatCard label="Chargés d'opération" value={apercu.stats.charges.length} />
      </div>

      {/* Suggestions de règles récurrentes */}
      {apercu.suggestions.length > 0 && (
        <Alert className="mt-4 border-violet-500/40 bg-violet-500/5">
          <Sparkles className="size-4" />
          <AlertTitle>Cette correction semble récurrente</AlertTitle>
          <AlertDescription>
            {apercu.suggestions.map((s) => (
              <div
                key={`${s.domaine}::${s.type}`}
                className="mt-1 flex flex-wrap items-center gap-2"
              >
                <span>
                  Vous avez corrigé <strong>{s.occurrences}</strong> commande(s) similaires en{" "}
                  <strong>{s.domaine}</strong> / <strong>{s.type}</strong>
                  {s.motif_exemple ? ` (ex. « ${s.motif_exemple} »)` : ""}.
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setConfirmation({
                      type: "creer_regle",
                      suggestion: { domaine: s.domaine, type: s.type, occurrences: s.occurrences },
                    })
                  }
                >
                  Créer une règle
                </Button>
              </div>
            ))}
          </AlertDescription>
        </Alert>
      )}

      {/* Filtres */}
      <Card className="mt-4">
        <CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <Label className="text-xs">Recherche</Label>
            <div className="relative">
              <Search className="absolute left-2 top-2.5 size-3.5 text-muted-foreground" />
              <Input
                className="pl-7"
                placeholder="COMN_NUM, COMC_NOLIG, ER, WNATURE, adresse, commune…"
                value={recherche}
                onChange={(e) => setRecherche(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Priorité / cas</Label>
            <Select value={filtre} onValueChange={(v) => setFiltre(v as PspFiltreValidation)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="toutes">Toutes</SelectItem>
                <SelectItem value="haute_priorite">Haute priorité</SelectItem>
                <SelectItem value="moyenne_priorite">Moyenne priorité</SelectItem>
                <SelectItem value="faible_priorite">Faible priorité</SelectItem>
                <SelectItem value="multi_domaines">Multi-domaines</SelectItem>
                <SelectItem value="exceptionnelles">Exceptionnelles</SelectItem>
                <SelectItem value="faible_confiance">Faible confiance</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">NAAC</Label>
            <Select value={naac} onValueChange={setNaac}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tous">Tous</SelectItem>
                <SelectItem value="GE">GE</SelectItem>
                <SelectItem value="GT">GT</SelectItem>
                <SelectItem value="CP">CP</SelectItem>
                <SelectItem value="AC">AC</SelectItem>
                <SelectItem value="HO">HO</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Domaine technique</Label>
            <Select value={domaine} onValueChange={setDomaine}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tous">Tous</SelectItem>
                {OPTIONS_DOMAINE_TECHNIQUE.map((d) => (
                  <SelectItem key={d} value={d}>
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Type d'intervention</Label>
            <Select value={typeInt} onValueChange={setTypeInt}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tous">Tous</SelectItem>
                {OPTIONS_TYPE_INTERVENTION.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Périmètre PSP</Label>
            <Select value={perimetre} onValueChange={setPerimetre}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tous">Tous</SelectItem>
                <SelectItem value="eligible">Éligible</SelectItem>
                <SelectItem value="hors_psp">Hors périmètre</SelectItem>
                <SelectItem value="a_examiner">À examiner</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Motif d'exclusion</Label>
            <Select value={motifExcl} onValueChange={setMotifExcl}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tous">Tous</SelectItem>
                <SelectItem value="pmr">PMR</SelectItem>
                <SelectItem value="autre_charge_operation">Chargé d'opération exclu</SelectItem>
                <SelectItem value="naac_hors_psp">NAAC AC/HO</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Chargé d'opération</Label>
            <Select value={charge} onValueChange={setCharge}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tous">Tous</SelectItem>
                {apercu.stats.charges.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
                <SelectItem value="__inconnu__">Inconnu / non importé</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end gap-2">
            <Button
              variant={pmrSeul ? "default" : "outline"}
              className="w-full"
              onClick={() => setPmrSeul((v) => !v)}
            >
              <ShieldAlert className="size-3.5" /> PMR seulement
            </Button>
          </div>
          <div className="flex items-end gap-2">
            <Button
              variant={aValiderSeul ? "default" : "outline"}
              className="w-full"
              onClick={() => setAValiderSeul((v) => !v)}
            >
              <Filter className="size-3.5" /> À valider seulement
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Contenu : groupes / commandes */}
      <Tabs
        value={vue}
        onValueChange={(v) => setVue(v as "groupes" | "commandes")}
        className="mt-4"
      >
        <TabsList>
          <TabsTrigger value="groupes">
            <Layers className="mr-1.5 size-3.5" /> Groupes ({apercu.stats.groupes})
          </TabsTrigger>
          <TabsTrigger value="commandes">
            <ListChecks className="mr-1.5 size-3.5" /> Commandes ({commandesFiltrees.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="groupes" className="mt-3">
          {apercu.groupes.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun groupe à valider.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Groupe</TableHead>
                    <TableHead className="text-right">Nb</TableHead>
                    <TableHead className="text-right">Montant</TableHead>
                    <TableHead>Proposition IA</TableHead>
                    <TableHead className="text-right">Confiance</TableHead>
                    <TableHead>Priorité</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {apercu.groupes.map((g) => (
                    <TableRow key={g.cle}>
                      <TableCell className="max-w-[260px]">
                        <p className="truncate font-medium" title={g.libelle_normalise}>
                          {g.libelle_normalise}
                        </p>
                        <p className="text-xs text-muted-foreground">règle {g.regle_appliquee}</p>
                      </TableCell>
                      <TableCell className="text-right">{g.occurrences}</TableCell>
                      <TableCell className="text-right">{fmtEuro(g.montant_total)}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{g.type_intervention}</Badge>{" "}
                        <Badge variant="outline">{g.domaine_technique}</Badge>
                      </TableCell>
                      <TableCell className="text-right">{fmtConf(g.confiance_moyenne)}</TableCell>
                      <TableCell>
                        <BadgePriorite niveau={g.niveau_priorite} />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="default"
                            onClick={() => setConfirmation({ type: "validate_groupe", groupe: g })}
                          >
                            Valider
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setModifierCible({ type: "groupe", groupe: g })}
                          >
                            <Pencil className="size-3.5" /> Modifier
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setGroupeOuvert(g)}>
                            <Eye className="size-3.5" /> Voir
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="commandes" className="mt-3">
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Priorité</TableHead>
                  <TableHead>COMN_NUM</TableHead>
                  <TableHead>COMC</TableHead>
                  <TableHead>NAAC</TableHead>
                  <TableHead>Périmètre</TableHead>
                  <TableHead>WNATURE</TableHead>
                  <TableHead>Type / Domaine</TableHead>
                  <TableHead className="text-right">Montant</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {commandesFiltrees.slice(0, 200).map((c) => (
                  <TableRow key={c.comn}>
                    <TableCell>
                      <BadgePriorite niveau={c.niveau_priorite} />
                    </TableCell>
                    <TableCell className="font-mono text-xs">{c.comn}</TableCell>
                    <TableCell className="text-xs">{c.comc ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{c.naac ?? "—"}</Badge>
                    </TableCell>
                    <TableCell>
                      <BadgePerimetre
                        perimetre={c.perimetre_psp}
                        motif={c.motif_exclusion}
                        estPmr={c.est_pmr}
                      />
                    </TableCell>
                    <TableCell className="max-w-[220px]">
                      <p className="truncate text-xs" title={c.wnature}>
                        {c.wnature}
                      </p>
                    </TableCell>
                    <TableCell className="text-xs">
                      {c.type_intervention} / {c.domaine_technique}
                    </TableCell>
                    <TableCell className="text-right text-xs">
                      {fmtEuro(c.montant_engage ?? 0)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => void ouvrirCommande(c)}>
                        <ChevronRight className="size-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {commandesFiltrees.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-muted-foreground">
                      Aucune commande ne correspond aux filtres.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          {commandesFiltrees.length > 200 && (
            <p className="mt-1 text-xs text-muted-foreground">
              {commandesFiltrees.length} résultats — affichage limité à 200. Affinez avec la
              recherche ou les filtres.
            </p>
          )}
        </TabsContent>
      </Tabs>

      {/* Dialog : voir un groupe */}
      <GroupeDialog
        groupe={groupeOuvert}
        onClose={() => setGroupeOuvert(null)}
        onValider={(g) => setConfirmation({ type: "validate_groupe", groupe: g })}
        onOuvrirCommande={(comn) => {
          const c = apercu.commandes.find((x) => x.comn === comn);
          setGroupeOuvert(null);
          if (c) void ouvrirCommande(c);
        }}
      />

      {/* Dialog : détail d'une commande */}
      <DetailCommandeDialog
        state={commandeDetail}
        onClose={() => setCommandeDetail(null)}
        onValider={(c) => void validerCommande(c, "")}
        onModifier={(c) => setModifierCible({ type: "commande", commande: c })}
        onRejeter={(c) => void rejeterCommande(c, "")}
        onIndetermine={(c) => void marquerIndetermine(c, "")}
      />

      {/* Dialog : modifier (commande ou groupe) */}
      <ModifierDialog
        cible={modifierCible}
        onClose={() => setModifierCible(null)}
        onConfirmer={(correction, motif) => {
          if (modifierCible?.type === "groupe") {
            setConfirmation({
              type: "modify_groupe",
              groupe: modifierCible.groupe,
              correction,
              motif,
            });
            setModifierCible(null);
          } else if (modifierCible?.type === "commande") {
            const c = modifierCible.commande;
            void (async () => {
              const interdits = champsInterditsModification(correction);
              if (interdits.length > 0) {
                setError(`Champs source non modifiables : ${interdits.join(", ")}`);
                return;
              }
              if (
                await enregistrer("modify", c.comn, propositionDe(c), correction, motif || null)
              ) {
                setCommandeDetail(null);
              }
            })();
          }
        }}
      />

      {/* Dialog : confirmation groupe / règle */}
      <ConfirmationDialog
        confirmation={confirmation}
        onClose={() => setConfirmation(null)}
        onConfirmer={() => {
          if (confirmation?.type === "validate_groupe") void validerGroupe(confirmation.groupe);
          else if (confirmation?.type === "modify_groupe")
            void modifierGroupe(confirmation.groupe, confirmation.correction, confirmation.motif);
          else if (confirmation?.type === "creer_regle")
            void proposerRegle(confirmation.suggestion);
        }}
      />
    </div>
  );
}

// ── Dialog : groupe ─────────────────────────────────────────────────────────

function GroupeDialog({
  groupe,
  onClose,
  onValider,
  onOuvrirCommande,
}: {
  groupe: PspGroupeApercu | null;
  onClose: () => void;
  onValider: (g: PspGroupeApercu) => void;
  onOuvrirCommande: (comn: string) => void;
}) {
  return (
    <Dialog open={Boolean(groupe)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Groupe — {groupe?.libelle_normalise ?? ""}</DialogTitle>
          <DialogDescription>
            {groupe
              ? `${groupe.occurrences} commande(s) · ${fmtEuro(groupe.montant_total)} · proposition ${groupe.type_intervention} / ${groupe.domaine_technique} · confiance ${fmtConf(groupe.confiance_moyenne)} · priorité ${groupe.niveau_priorite}`
              : ""}
          </DialogDescription>
        </DialogHeader>
        {groupe && (
          <>
            <div className="text-xs text-muted-foreground">
              Règle appliquée : <code>{groupe.regle_appliquee}</code>
              <br />
              Pourquoi cette priorité ? {groupe.raisons_priorite.join(" · ") || "—"}
            </div>
            <ScrollArea className="max-h-72">
              <div className="space-y-1">
                {groupe.comn_liste.map((comn) => (
                  <Button
                    key={comn}
                    variant="ghost"
                    className="w-full justify-between font-mono text-xs"
                    onClick={() => onOuvrirCommande(comn)}
                  >
                    {comn} <ChevronRight className="size-3.5" />
                  </Button>
                ))}
              </div>
            </ScrollArea>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Fermer
              </Button>
              <Button onClick={() => onValider(groupe)}>Valider le groupe</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Dialog : détail d'une commande ──────────────────────────────────────────

function DetailCommandeDialog({
  state,
  onClose,
  onValider,
  onModifier,
  onRejeter,
  onIndetermine,
}: {
  state: { comn: string; detail: unknown } | null;
  onClose: () => void;
  onValider: (c: PspCommandeValidation) => void;
  onModifier: (c: PspCommandeValidation) => void;
  onRejeter: (c: PspCommandeValidation) => void;
  onIndetermine: (c: PspCommandeValidation) => void;
}) {
  // Décisions humaines déjà enregistrées (réutilisation automatique) pour cette commande —
  // simple information, aucune écriture ici.
  const fetchGetDecision = useServerFn(getPspDecision);
  const [decisionInfo, setDecisionInfo] = useState<string | null>(null);
  useEffect(() => {
    const comn = state
      ? String(
          (state.detail as { row?: { numero_commande_interne?: unknown } } | null)?.row
            ?.numero_commande_interne ?? "",
        )
      : "";
    if (!comn) {
      setDecisionInfo(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [resNature, resCorps] = await Promise.all([
          fetchGetDecision({
            data: {
              cleMetier: construireCleMetierCommande(comn, "nature"),
              typeDecision: "nature",
            },
          }),
          fetchGetDecision({
            data: {
              cleMetier: construireCleMetierCommande(comn, "corps_etat"),
              typeDecision: "corps_etat",
            },
          }),
        ]);
        if (cancelled) return;
        const valeurs: string[] = [];
        const nV = (resNature as { decision_utilisateur?: string } | null)?.decision_utilisateur;
        const cV = (resCorps as { decision_utilisateur?: string } | null)?.decision_utilisateur;
        if (nV) valeurs.push(`nature : ${nV}`);
        if (cV) valeurs.push(`corps d'état : ${cV}`);
        setDecisionInfo(valeurs.length > 0 ? valeurs.join(" · ") : null);
      } catch {
        if (!cancelled) setDecisionInfo(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // La commande affichée vient du détail chargé (row + classification).
  if (!state) return null;
  const d = state.detail as {
    row: Record<string, unknown>;
    classification: {
      comn: string;
      type_intervention: string;
      domaine_technique: string;
      famille_psp: string;
      element_patrimonial: string;
      nature_exceptionnelle: string;
      confiance: number;
      regle_appliquee: string;
      justification: string;
      libelle_normalise: string;
      besoin_validation_humaine: boolean;
    } | null;
    score: { score: number; niveau: PspNiveauPriorite; raisons: string[] };
    perimetre: {
      perimetre_psp: string;
      motif_exclusion: string | null;
      categorie_psp: string | null;
      est_pmr: boolean;
    } | null;
  } | null;

  if (!d) {
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Chargement de {state.comn}…</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
  }

  const row = d.row as Record<string, unknown>;
  const cls = d.classification;
  const rowToCommande = (): PspCommandeValidation => ({
    comn: String(row["numero_commande_interne"] ?? ""),
    comc: (row["numero_commande"] as string | null) ?? null,
    naac: (row["nature_analytique"] as string | null) ?? null,
    patrimoine: (row["patrimoine"] as string | null) ?? null,
    adresse: (row["adresse"] as string | null) ?? null,
    commune: (row["commune"] as string | null) ?? null,
    wnature: String(row["corps_etat_libelle"] ?? ""),
    montant_budget: (row["montant_budget"] as number | null) ?? null,
    montant_engage: (row["montant_engage"] as number | null) ?? null,
    fournisseur: (row["fournisseur"] as string | null) ?? null,
    date_commande: (row["date_commande"] as string | null) ?? null,
    er_reference: (row["er_reference"] as string | null) ?? null,
    type_intervention: cls?.type_intervention ?? "indetermine",
    domaine_technique: cls?.domaine_technique ?? "indetermine",
    domaines_detectes: [],
    famille_psp: cls?.famille_psp ?? "indetermine",
    element_patrimonial: cls?.element_patrimonial ?? "autre",
    nature_exceptionnelle: cls?.nature_exceptionnelle ?? "aucune",
    confiance: cls?.confiance ?? 0,
    besoin_validation_humaine: cls?.besoin_validation_humaine ?? false,
    regle_appliquee: cls?.regle_appliquee ?? "",
    justification: cls?.justification ?? "",
    projet_relais_chelles: false,
    libelle_normalise: cls?.libelle_normalise ?? "",
    score_priorite: d.score.score,
    niveau_priorite: d.score.niveau,
    raisons_priorite: d.score.raisons,
    motif_validation: [],
    charge_operation:
      ((row["donnees_brutes"] as Record<string, unknown> | null)?.["charge_operation"] as
        string | null) ?? null,
    perimetre_psp: (d.perimetre?.perimetre_psp as PspPerimetre) ?? "a_examiner",
    motif_exclusion: (d.perimetre?.motif_exclusion ?? "naac_hors_psp") as PspMotifExclusion,
    categorie_psp: (d.perimetre?.categorie_psp ?? null) as PspCategoriePsp,
    est_pmr: d.perimetre?.est_pmr ?? false,
  });

  const c = rowToCommande();

  const Ligne = ({ label, value }: { label: string; value: ReactNode }) => (
    <div className="grid grid-cols-[170px_1fr] gap-2 py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="break-words">{value}</span>
    </div>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Commande {c.comn}</DialogTitle>
          <DialogDescription>Source historique + proposition IA</DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[65vh] pr-3">
          <div className="rounded-md border p-3">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Données source (non modifiables)
            </p>
            <Ligne label="COMC_NOLIG" value={c.comc ?? "—"} />
            <Ligne label="ER / patrimoine" value={c.patrimoine ?? "—"} />
            <Ligne label="Adresse" value={c.adresse ?? "—"} />
            <Ligne label="Commune" value={c.commune ?? "—"} />
            <Ligne label="NAAC_CODE" value={c.naac ?? "—"} />
            <Ligne
              label="Montant budget"
              value={c.montant_budget != null ? fmtEuro(c.montant_budget) : "—"}
            />
            <Ligne
              label="Montant engagé"
              value={c.montant_engage != null ? fmtEuro(c.montant_engage) : "—"}
            />
            <Ligne label="Fournisseur" value={c.fournisseur ?? "—"} />
            <Ligne label="Date commande" value={c.date_commande ?? "—"} />
            <Ligne label="WNATURE" value={c.wnature} />
            <Ligne
              label="Descriptif"
              value={String(
                (row["donnees_brutes"] as Record<string, unknown> | null)?.["descriptif"] ?? "—",
              )}
            />
            <Ligne
              label="Observations"
              value={String(
                (row["donnees_brutes"] as Record<string, unknown> | null)?.["observations"] ?? "—",
              )}
            />
          </div>

          <Separator className="my-3" />

          <div className="rounded-md border p-3">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Périmètre PSP
            </p>
            <Ligne
              label="Périmètre"
              value={
                <BadgePerimetre
                  perimetre={d.perimetre?.perimetre_psp ?? "a_examiner"}
                  motif={d.perimetre?.motif_exclusion ?? null}
                  estPmr={d.perimetre?.est_pmr ?? false}
                />
              }
            />
            <Ligne
              label="Motif d'exclusion"
              value={
                d.perimetre?.motif_exclusion === "pmr"
                  ? "Travaux PMR"
                  : d.perimetre?.motif_exclusion === "autre_charge_operation"
                    ? "Chargé d'opération hors périmètre"
                    : d.perimetre?.motif_exclusion === "naac_hors_psp"
                      ? "NAAC AC/HO"
                      : "—"
              }
            />
            <Ligne label="Catégorie PSP" value={d.perimetre?.categorie_psp ?? "—"} />
            <Ligne label="PMR" value={d.perimetre?.est_pmr ? "Oui (hors PSP)" : "Non"} />
            <Ligne
              label="Chargé d'opération"
              value={String(
                (row["donnees_brutes"] as Record<string, unknown> | null)?.["charge_operation"] ??
                  "Inconnu / non importé",
              )}
            />
            {decisionInfo ? (
              <div className="mt-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-2 text-xs text-emerald-700">
                <span className="font-bold">Décision enregistrée — </span>
                {decisionInfo}
              </div>
            ) : null}
          </div>

          <Separator className="my-3" />

          <div className="rounded-md border border-violet-500/30 p-3">
            <p className="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-violet-600">
              <Sparkles className="size-3.5" /> Proposition IA
            </p>
            <Ligne label="Type d'intervention" value={c.type_intervention} />
            <Ligne label="Domaine technique" value={c.domaine_technique} />
            <Ligne label="Famille PSP" value={c.famille_psp} />
            <Ligne label="Élément patrimonial" value={c.element_patrimonial} />
            <Ligne label="Nature exceptionnelle" value={c.nature_exceptionnelle} />
            <Ligne label="Confiance" value={fmtConf(c.confiance)} />
            <Ligne label="Règle appliquée" value={<code>{c.regle_appliquee || "—"}</code>} />
            <Ligne label="Justification IA" value={c.justification} />
            <Ligne label="Priorité" value={<BadgePriorite niveau={c.niveau_priorite} />} />
            <Ligne
              label="Pourquoi cette priorité ?"
              value={c.raisons_priorite.join(" · ") || "—"}
            />
            <Ligne label="Motif de validation" value={c.motif_validation.join(" · ") || "—"} />
          </div>

          {(row["donnees_brutes"] as Record<string, unknown> | null) && (
            <details className="mt-3 rounded-md border p-3 text-xs">
              <summary className="cursor-pointer font-medium">donnees_brutes (JSON brut)</summary>
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-muted-foreground">
                {JSON.stringify(row["donnees_brutes"], null, 2)}
              </pre>
            </details>
          )}
        </ScrollArea>
        <DialogFooter className="flex-wrap gap-2">
          <Button variant="destructive" size="sm" onClick={() => onRejeter(c)}>
            Rejeter la proposition
          </Button>
          <Button variant="outline" size="sm" onClick={() => onIndetermine(c)}>
            Indéterminé
          </Button>
          <Button variant="outline" size="sm" onClick={() => onModifier(c)}>
            <Pencil className="size-3.5" /> Modifier
          </Button>
          <Button size="sm" onClick={() => onValider(c)}>
            <CheckCircle2 className="size-3.5" /> Valider
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Dialog : modifier (commande / groupe) ───────────────────────────────────

function ModifierDialog({
  cible,
  onClose,
  onConfirmer,
}: {
  cible:
    | { type: "commande"; commande: PspCommandeValidation }
    | { type: "groupe"; groupe: PspGroupeApercu }
    | null;
  onClose: () => void;
  onConfirmer: (correction: Record<string, unknown>, motif: string) => void;
}) {
  const base =
    cible?.type === "commande"
      ? {
          type_intervention: cible.commande.type_intervention,
          domaine_technique: cible.commande.domaine_technique,
          famille_psp: cible.commande.famille_psp,
          element_patrimonial: cible.commande.element_patrimonial,
          nature_exceptionnelle: cible.commande.nature_exceptionnelle,
        }
      : cible?.type === "groupe"
        ? {
            type_intervention: cible.groupe.type_intervention,
            domaine_technique: cible.groupe.domaine_technique,
            famille_psp: cible.groupe.famille_psp,
            element_patrimonial: "autre",
            nature_exceptionnelle: "aucune",
          }
        : null;

  const [champs, setChamps] = useState<Record<string, string> | null>(base);
  const [motif, setMotif] = useState("");

  useEffect(() => {
    setChamps(base);
    setMotif("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cible]);

  if (!cible || !base || !champs) return null;

  const set = (k: string, v: string) => setChamps((c) => ({ ...(c ?? {}), [k]: v }));

  const champSelect = (label: string, key: string, options: readonly string[]) => (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Select value={champs[key] ?? ""} onValueChange={(v) => set(key, v)}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o} value={o}>
              {o}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  const titre =
    cible.type === "commande"
      ? `Modifier la proposition — ${cible.commande.comn}`
      : `Modifier le groupe — ${cible.groupe.libelle_normalise}`;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{titre}</DialogTitle>
          <DialogDescription>
            Seuls les champs de classification sont modifiables. Les données source (COMN_NUM,
            COMC_NOLIG, NAAC_CODE, montants, WNATURE…) ne le sont jamais.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {champSelect("Type d'intervention", "type_intervention", OPTIONS_TYPE_INTERVENTION)}
          {champSelect("Domaine technique", "domaine_technique", OPTIONS_DOMAINE_TECHNIQUE)}
          {champSelect("Famille PSP", "famille_psp", OPTIONS_FAMILLE_PSP)}
          {champSelect("Élément patrimonial", "element_patrimonial", OPTIONS_ELEMENT_PATRIMONIAL)}
          {champSelect(
            "Nature exceptionnelle",
            "nature_exceptionnelle",
            OPTIONS_NATURE_EXCEPTIONNELLE,
          )}
          <div className="space-y-1">
            <Label className="text-xs">Motif (facultatif)</Label>
            <Textarea
              value={motif}
              onChange={(e) => setMotif(e.target.value)}
              placeholder="Pourquoi cette décision ?"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={() => onConfirmer(champs, motif)}>Confirmer la modification</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Dialog : confirmation (groupe / règle) ──────────────────────────────────

function ConfirmationDialog({
  confirmation,
  onClose,
  onConfirmer,
}: {
  confirmation:
    | { type: "validate_groupe"; groupe: PspGroupeApercu }
    | {
        type: "modify_groupe";
        groupe: PspGroupeApercu;
        correction: Record<string, unknown>;
        motif: string;
      }
    | { type: "creer_regle"; suggestion: { domaine: string; type: string; occurrences: number } }
    | null;
  onClose: () => void;
  onConfirmer: () => void;
}) {
  if (!confirmation) return null;

  const titre =
    confirmation.type === "validate_groupe"
      ? "Valider le groupe"
      : confirmation.type === "modify_groupe"
        ? "Appliquer la modification au groupe"
        : "Proposer une règle générale ?";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{titre}</DialogTitle>
          <DialogDescription>Confirmation avant enregistrement du feedback.</DialogDescription>
        </DialogHeader>
        {confirmation.type === "validate_groupe" && (
          <div className="space-y-1 text-sm">
            <p>
              Vous êtes sur le point de valider <strong>{confirmation.groupe.occurrences}</strong>{" "}
              commande(s).
            </p>
            <p>
              Montant total : <strong>{fmtEuro(confirmation.groupe.montant_total)}</strong>
            </p>
            <p>
              Classification appliquée : <strong>{confirmation.groupe.type_intervention}</strong> /{" "}
              <strong>{confirmation.groupe.domaine_technique}</strong> /{" "}
              <strong>{confirmation.groupe.famille_psp}</strong>
            </p>
            <p className="text-xs text-muted-foreground">
              Groupe « {confirmation.groupe.libelle_normalise} »
            </p>
          </div>
        )}
        {confirmation.type === "modify_groupe" && (
          <div className="space-y-1 text-sm">
            <p>
              Vous allez appliquer une modification à{" "}
              <strong>{confirmation.groupe.occurrences}</strong> commande(s).
            </p>
            <p>
              Montant total : <strong>{fmtEuro(confirmation.groupe.montant_total)}</strong>
            </p>
            <p>
              Nouvelle classification :{" "}
              <strong>{String(confirmation.correction["type_intervention"] ?? "")}</strong> /{" "}
              <strong>{String(confirmation.correction["domaine_technique"] ?? "")}</strong> /{" "}
              <strong>{String(confirmation.correction["famille_psp"] ?? "")}</strong>
            </p>
            {confirmation.motif && (
              <p className="text-xs text-muted-foreground">Motif : {confirmation.motif}</p>
            )}
            <p className="text-xs text-muted-foreground">
              Aucune autre commande ne sera modifiée automatiquement.
            </p>
          </div>
        )}
        {confirmation.type === "creer_regle" && (
          <div className="space-y-1 text-sm">
            <p>
              Vous avez corrigé <strong>{confirmation.suggestion.occurrences}</strong> commandes en{" "}
              <strong>{confirmation.suggestion.domaine}</strong> /{" "}
              <strong>{confirmation.suggestion.type}</strong>.
            </p>
            <p>
              L'intention de règle sera tracée. La règle générale ne sera <strong>jamais</strong>{" "}
              appliquée automatiquement : elle restera soumise à validation humaine avant toute
              utilisation.
            </p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={onConfirmer}>Confirmer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
