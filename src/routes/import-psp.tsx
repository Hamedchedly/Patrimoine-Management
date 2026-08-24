import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Eraser,
  Eye,
  FileSpreadsheet,
  ListFilter,
  Upload,
  XCircle,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { parsePspWorkbook, type PspParsedRow, type PspParsedTravaux } from "@/lib/psp";
import {
  createPspImport,
  finalizePspImport,
  failPspImport,
  importPspBatch,
} from "@/lib/psp.functions";
import {
  TAILLE_LOT_PSP,
  construireAnalyse,
  construireResumeImport,
  construireStructureDetectee,
  decouperEnLots,
  estFichierExcel,
  filtrerLignesPsp,
  statutFinalImport,
  type PspAnalyse,
  type PspFiltre,
} from "@/lib/psp.preview";

export const Route = createFileRoute("/import-psp")({
  head: () => ({
    meta: [
      { title: "Import Historique CMD" },
      {
        name: "description",
        content:
          "Importation de l'historique complet des travaux et commandes : lecture, vérification humaine, puis enregistrement dans les tables psp_*.",
      },
    ],
  }),
  component: ImportPspPage,
});

type Report = {
  id: string;
  statut: string;
  lignes: number;
};

function ImportPspPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const createImport = useServerFn(createPspImport);
  const runBatch = useServerFn(importPspBatch);
  const finalize = useServerFn(finalizePspImport);
  const failImport = useServerFn(failPspImport);

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fichierNom, setFichierNom] = useState<string | null>(null);
  const [parsed, setParsed] = useState<PspParsedTravaux | null>(null);
  const [filtre, setFiltre] = useState<PspFiltre>("tous");
  const [ligneDetail, setLigneDetail] = useState<PspParsedRow | null>(null);
  const [confirmOuvert, setConfirmOuvert] = useState(false);
  const [report, setReport] = useState<Report | null>(null);

  /** Lecture du fichier : parsing + aperçu, AUCUNE écriture Supabase. */
  const handleFile = async (file: File) => {
    setBusy(true);
    setError(null);
    setReport(null);
    setParsed(null);
    setFiltre("tous");
    setProgress(0);
    try {
      if (!estFichierExcel(file.name)) {
        setError("Format non pris en charge : veuillez choisir un fichier .xlsx ou .xls.");
        return;
      }
      setMessage("Analyse du fichier…");
      setProgress(10);
      const resultat = parsePspWorkbook(await file.arrayBuffer());
      setParsed(resultat);
      setFichierNom(file.name);
      setProgress(100);
      setMessage(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Lecture du fichier impossible");
    } finally {
      setBusy(false);
    }
  };

  /** Réinitialise l'écran (import annulé). */
  const annuler = () => {
    setParsed(null);
    setFichierNom(null);
    setFiltre("tous");
    setReport(null);
    setError(null);
  };

  /** Validation humaine confirmée : createPspImport → lots → finalize, sinon fail. */
  const confirmerImport = async () => {
    if (!parsed) return;
    setConfirmOuvert(false);
    setBusy(true);
    setError(null);
    setReport(null);
    let execution: { id: string } | undefined;
    try {
      const resume = construireResumeImport(parsed);
      const exercice = new Date().getFullYear();
      setMessage("Préparation…");
      setProgress(15);
      const importResult = await createImport({
        data: {
          fichier_nom: fichierNom ?? "inconnu.xlsx",
          exercice,
          lignes_total: parsed.total_lignes,
          lignes_valides: parsed.valides,
          lignes_erreur: parsed.erreurs,
          doublons: parsed.doublons_identiques,
          structure_detectee: construireStructureDetectee(parsed),
          erreurs_detail: parsed.issues,
        },
      });
      execution = { id: importResult.id };

      const lots = decouperEnLots(parsed.lignes, TAILLE_LOT_PSP);
      for (let index = 0; index < lots.length; index += 1) {
        setMessage(`Enregistrement ${index + 1}/${lots.length}…`);
        setProgress(20 + Math.round(((index + 1) / Math.max(lots.length, 1)) * 60));
        await runBatch({
          data: { import_id: execution.id, annee_exercice: exercice, rows: lots[index]! },
        });
      }

      setMessage("Finalisation…");
      setProgress(90);
      const statut = statutFinalImport(resume);
      await finalize({ data: { import_id: execution.id, statut } });
      setProgress(100);
      setReport({ id: execution.id, statut, lignes: resume.lignes_a_importer });
      setMessage(null);
    } catch (cause) {
      if (execution) {
        try {
          await failImport({
            data: {
              import_id: execution.id,
              erreur_message: cause instanceof Error ? cause.message : "Import impossible",
            },
          });
        } catch {
          // Échec silencieux : l'import sera marqué erreur au prochain nettoyage.
        }
      }
      setError(cause instanceof Error ? cause.message : "Import impossible");
    } finally {
      setBusy(false);
    }
  };

  const analyse: PspAnalyse | null = parsed ? construireAnalyse(parsed) : null;
  const resume = parsed ? construireResumeImport(parsed) : null;
  const lignesAffichées = parsed ? filtrerLignesPsp(parsed, filtre) : [];

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 sm:p-8">
      <PageHeader
        title="Import Historique CMD"
        subtitle="Importation de l'historique complet des travaux et commandes. Lecture, vérification humaine, puis enregistrement isolé dans les tables psp_*. Aucune écriture avant validation."
      >
        <Button asChild variant="outline">
          <Link to="/">Accueil</Link>
        </Button>
      </PageHeader>

      {!parsed ? (
        <div className="rounded-xl border border-dashed bg-surface p-8 text-center">
          <FileSpreadsheet className="mx-auto size-8 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">
            Déposez un fichier Excel (.xlsx ou .xls) d'export des commandes de travaux.
          </p>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
          <Button className="mt-4" disabled={busy} onClick={() => inputRef.current?.click()}>
            <Upload className="size-4" /> Déposer un fichier Excel
          </Button>
        </div>
      ) : null}

      {busy || message ? (
        <div className="space-y-2">
          <Progress value={progress} />
          <p className="text-sm text-muted-foreground">{message}</p>
        </div>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle>Import impossible</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {parsed && analyse && resume ? (
        <section className="space-y-6">
          <Card className="p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1">
                <h2 className="font-semibold">Analyse du fichier</h2>
                <p className="text-sm text-muted-foreground">
                  {fichierNom} — feuille utilisée : {analyse.feuille ?? "inconnue"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() => setConfirmOuvert(true)}
                  disabled={busy}
                >
                  <Upload className="size-4" /> Importer dans l'historique CMD
                </Button>
                <Button variant="ghost" onClick={annuler} disabled={busy}>
                  <Eraser className="size-4" /> Annuler
                </Button>
              </div>
            </div>

            <Separator className="my-4" />

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              <Stat label="Lignes totales" value={analyse.total_lignes} />
              <Stat label="Lignes valides" value={analyse.lignes_valides} />
              <Stat label="Lignes en erreur" value={analyse.lignes_erreur} />
              <Stat label="Doublons" value={analyse.doublons} />
              <Stat label="Conflits" value={analyse.conflits} />
              <Stat label="Commandes détectées" value={analyse.commandes_detectees} />
              <Stat label="Références ER détectées" value={analyse.er_detectes} />
              <Stat label="Codes corps d'état détectés" value={analyse.corps_etat_detectes} />
            </div>
          </Card>

          <Card className="p-4 sm:p-5">
            <h3 className="font-semibold">Synthèse</h3>
            <div className="mt-3 grid gap-2 sm:grid-cols-5">
              <SyntheseCell label="Valide" count={analyse.synthese.valide} color="green" />
              <SyntheseCell label="À contrôler" count={analyse.synthese.a_controler} color="amber" />
              <SyntheseCell label="Erreur" count={analyse.synthese.erreur} color="red" />
              <SyntheseCell label="Doublon" count={analyse.synthese.doublon} color="slate" />
              <SyntheseCell label="Conflit" count={analyse.synthese.conflit} color="violet" />
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <ListFilter className="size-4 text-muted-foreground" />
              <FiltreBouton actif={filtre === "tous"} onClick={() => setFiltre("tous")}>
                Toutes ({parsed.lignes.length})
              </FiltreBouton>
              <FiltreBouton actif={filtre === "valides"} onClick={() => setFiltre("valides")}>
                <CheckCircle2 className="size-3.5" /> Valides ({analyse.synthese.valide})
              </FiltreBouton>
              <FiltreBouton actif={filtre === "erreurs"} onClick={() => setFiltre("erreurs")}>
                <XCircle className="size-3.5" /> Erreurs ({analyse.synthese.erreur})
              </FiltreBouton>
              <FiltreBouton actif={filtre === "doublons"} onClick={() => setFiltre("doublons")}>
                Doublons ({analyse.synthese.doublon})
              </FiltreBouton>
              <FiltreBouton actif={filtre === "conflits"} onClick={() => setFiltre("conflits")}>
                Conflits ({analyse.synthese.conflit})
              </FiltreBouton>
              <FiltreBouton actif={filtre === "ambiguites"} onClick={() => setFiltre("ambiguites")}>
                Ambiguïtés ER ({parsed.lignes.filter((l) => l.er_ambigue).length})
              </FiltreBouton>
            </div>

            <ScrollArea className="mt-4 max-h-[55vh] rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ligne</TableHead>
                    <TableHead>N° commande</TableHead>
                    <TableHead>ER</TableHead>
                    <TableHead>Corps d'état</TableHead>
                    <TableHead className="text-right">Engagé</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lignesAffichées.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">
                        Aucune ligne pour ce filtre.
                      </TableCell>
                    </TableRow>
                  ) : (
                    lignesAffichées.map((ligne) => (
                      <TableRow
                        key={`${ligne.numero_commande || "vide"}-${ligne.ligne}`}
                        className="cursor-pointer"
                        onClick={() => setLigneDetail(ligne)}
                      >
                        <TableCell className="text-muted-foreground">{ligne.ligne}</TableCell>
                        <TableCell className="font-medium">
                          {ligne.numero_commande || "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {ligne.er_ambigue ? (
                            <span className="text-warning-foreground">ambigu</span>
                          ) : (
                            ligne.er_reference ?? "—"
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {ligne.corps_etat ?? "—"}
                        </TableCell>
                        <TableCell className="text-right">{money(ligne.engage)}</TableCell>
                        <TableCell>
                          <StatutBadge statut={ligne.statut} />
                        </TableCell>
                        <TableCell>
                          <Eye className="size-4 text-muted-foreground" />
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </ScrollArea>
          </Card>
        </section>
      ) : null}

      {report ? (
        <Alert variant={report.statut === "termine" ? "default" : "destructive"}>
          {report.statut === "termine" ? (
            <CheckCircle2 className="size-4" />
          ) : (
            <AlertTriangle className="size-4" />
          )}
          <AlertTitle>Import terminé</AlertTitle>
          <AlertDescription>
            {report.lignes} ligne(s) enregistrée(s) — import {report.id}. Statut : {report.statut}
            {report.statut !== "termine"
              ? " (des lignes sont en erreur ou à contrôler : elles restent visibles)."
              : "."}
          </AlertDescription>
        </Alert>
      ) : null}

      <ConfirmImportDialog
        open={confirmOuvert}
        resume={resume}
        onConfirm={confirmerImport}
        onCancel={() => setConfirmOuvert(false)}
        busy={busy}
      />

      <LigneDetailDialog ligne={ligneDetail} onClose={() => setLigneDetail(null)} />
    </main>
  );
}

/** Cellule de statistique de l'analyse. */
function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-surface p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

/** Cellule du tableau de synthèse (Statut | Nombre). */
function SyntheseCell({
  label,
  count,
  color,
}: {
  label: string;
  count: number;
  color: "green" | "amber" | "red" | "slate" | "violet";
}) {
  const colors = {
    green: "text-emerald-600",
    amber: "text-amber-600",
    red: "text-red-600",
    slate: "text-slate-600",
    violet: "text-violet-600",
  } as const;
  return (
    <div className="rounded-lg border bg-surface p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${colors[color]}`}>{count}</p>
    </div>
  );
}

/** Bouton de filtre des lignes. */
function FiltreBouton({
  actif,
  onClick,
  children,
}: {
  actif: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
        actif
          ? "border-primary bg-primary text-primary-foreground"
          : "border-input bg-background text-muted-foreground hover:bg-accent"
      }`}
    >
      {children}
    </button>
  );
}

/** Badge de statut d'une ligne. */
function StatutBadge({ statut }: { statut: PspParsedRow["statut"] }) {
  const styles = {
    valide: "border-transparent bg-emerald-500/15 text-emerald-700",
    a_controler: "border-transparent bg-amber-500/15 text-amber-700",
    erreur: "border-transparent bg-red-500/15 text-red-700",
  } as const;
  const labels = {
    valide: "Valide",
    a_controler: "À contrôler",
    erreur: "Erreur",
  } as const;
  return <Badge className={styles[statut]}>{labels[statut]}</Badge>;
}

/** Dialog de confirmation avant écriture (validation humaine). */
function ConfirmImportDialog({
  open,
  resume,
  onConfirm,
  onCancel,
  busy,
}: {
  open: boolean;
  resume: ReturnType<typeof construireResumeImport> | null;
  onConfirm: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  if (!resume) return null;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-md rounded-3xl">
        <DialogHeader>
          <DialogTitle>Confirmer l'import dans l'historique CMD</DialogTitle>
          <DialogDescription>
            Vérifiez le résumé avant l'enregistrement dans les tables psp_*.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 text-sm">
          <p>
            <strong>{resume.lignes_a_importer}</strong> ligne(s) vont être importées
          </p>
          <p>
            {resume.lignes_valides} valide(s)
          </p>
          <p>
            {resume.lignes_a_controler} à contrôler
          </p>
          <p>
            {resume.lignes_erreur} en erreur (elles restent visibles, jamais supprimées)
          </p>
          <p className="text-muted-foreground">{resume.lots} lot(s) d'enregistrement</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            Annuler
          </Button>
          <Button onClick={onConfirm} disabled={busy}>
            <Upload className="size-4" /> Importer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Détail complet d'une ligne (données source jamais masquées). */
function LigneDetailDialog({
  ligne,
  onClose,
}: {
  ligne: PspParsedRow | null;
  onClose: () => void;
}) {
  if (!ligne) return null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-hidden rounded-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Commande {ligne.numero_commande || "sans numéro"}
            <StatutBadge statut={ligne.statut} />
          </DialogTitle>
          <DialogDescription>Ligne Excel n° {ligne.ligne}</DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh] rounded-xl border">
          <div className="space-y-3 p-4">
            <DetailsGrid
              items={[
                { label: "Numéro commande", value: ligne.numero_commande || "—" },
                {
                  label: "ER détecté",
                  value: ligne.er_ambigue ? ligne.er_references.join(", ") : (ligne.er_reference ?? "—"),
                },
                { label: "Tranche", value: ligne.tranche_er ?? ligne.tranche_code ?? "—" },
                { label: "Bâtiment", value: ligne.batiment_er ?? ligne.batiment ?? "—" },
                { label: "Entrée", value: ligne.entree_er ?? ligne.entree ?? "—" },
                { label: "Lot", value: ligne.lot_er ?? ligne.lot_code ?? "—" },
                { label: "Corps d'état", value: ligne.corps_etat ?? "—" },
                { label: "Code corps d'état", value: ligne.corps_etat_code ?? "—" },
                { label: "Nature analytique", value: ligne.nature_analytique ?? "—" },
                { label: "Montant engagé", value: money(ligne.engage) },
                { label: "Montant payé", value: money(ligne.paye) },
                { label: "Année", value: "—" },
                { label: "Descriptif", value: ligne.descriptif ?? "—" },
                { label: "Observations", value: ligne.observations ?? "—" },
              ]}
            />
            {ligne.erreurs_psp.length > 0 ? (
              <div>
                <Label className="text-sm font-medium">Erreurs / contrôles</Label>
                <ul className="mt-1 space-y-1">
                  {ligne.erreurs_psp.map((issue, index) => (
                    <li
                      key={`${issue.code}-${index}`}
                      className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive"
                    >
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                      <span>
                        <span className="font-semibold">{issue.code}</span> — {issue.message}
                        {issue.champ ? ` (${issue.champ})` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </ScrollArea>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Fermer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Grille label / valeur du détail d'une ligne. */
function DetailsGrid({ items }: { items: Array<{ label: string; value: string }> }) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label} className="rounded-lg border bg-surface p-2.5">
          <p className="text-xs text-muted-foreground">{item.label}</p>
          <p className="mt-0.5 break-words text-sm font-medium">{item.value}</p>
        </div>
      ))}
    </div>
  );
}

const money = (value: number | null) =>
  typeof value === "number"
    ? new Intl.NumberFormat("fr-FR", {
        style: "currency",
        currency: "EUR",
        maximumFractionDigits: 0,
      }).format(value)
    : "—";
