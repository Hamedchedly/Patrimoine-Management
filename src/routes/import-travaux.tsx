import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronRight, FileSpreadsheet, Upload, Calendar } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { exerciceCourant, parseTravauxWorkbook, type ParsedTravaux } from "@/lib/travaux";
import {
  createTravauxImport,
  failTravauxImport,
  finalizeTravauxImport,
  importTravauxBatch,
} from "@/lib/travaux.functions";
import { getTravauxImportDetails } from "@/lib/travaux.dashboard.functions";

export const Route = createFileRoute("/import-travaux")({
  head: () => ({
    meta: [
      { title: "Import Suivi budgétaire annuel" },
      {
        name: "description",
        content:
          "Importation du suivi budgétaire et financier de l'exercice : rapprochement des commandes par numéro, suivi des modifications, archivage des absentes.",
      },
    ],
  }),
  component: ImportTravauxPage,
});

type Report = {
  creees: number;
  modifiees: number;
  inchangees: number;
  conflits: number;
  reports: number;
  archivees: number;
  ignorees: number;
  erreurs: number;
  doublons: number;
  sansCommande: number;
};

function ImportTravauxPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const createImport = useServerFn(createTravauxImport);
  const runBatch = useServerFn(importTravauxBatch);
  const finalize = useServerFn(finalizeTravauxImport);
  const failImport = useServerFn(failTravauxImport);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<ParsedTravaux | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastImportId, setLastImportId] = useState<string | null>(null);
  const [detailsType, setDetailsType] = useState<ImportDetailsType | null>(null);
  const [anneeExercice, setAnneeExercice] = useState<string>(exerciceCourant().toString());

  const handleFile = async (file: File) => {
    setBusy(true);
    setError(null);
    setReport(null);
    setPreview(null);
    setProgress(0);
    let execution: { id: string } | undefined;
    try {
      setMessage("Analyse du fichier…");
      const parsed = parseTravauxWorkbook(await file.arrayBuffer());
      setPreview(parsed);
      const importResult = await createImport({
        data: {
          fichier: file.name,
          lignes: parsed.lignes,
          doublons: parsed.doublons,
          erreurs: parsed.erreurs.length,
          annee_exercice: parseInt(anneeExercice),
          doublonsDetails: parsed.doublonsDetails,
          erreursDetails: parsed.erreurs,
          sansCommandeDetails: parsed.sansCommande,
        },
      });
      execution = { id: importResult.id };
      const parts = Array.from({ length: Math.ceil(parsed.commandes.length / 100) }, (_, index) =>
        parsed.commandes.slice(index * 100, index * 100 + 100),
      );
      let totals = { creees: 0, modifiees: 0, inchangees: 0, ignorees: 0, conflits: 0, reports: 0 };
      for (let index = 0; index < parts.length; index += 1) {
        const result = await runBatch({
          data: {
            importId: importResult.id,
            annee_exercice: importResult.annee_exercice,
            commandes: parts[index]!,
          },
        });
        totals = {
          creees: totals.creees + result.creees,
          modifiees: totals.modifiees + result.modifiees,
          inchangees: totals.inchangees + result.inchangees,
          ignorees: totals.ignorees + result.ignorees,
          conflits: totals.conflits + result.conflits,
          reports: totals.reports + result.reports,
        };
        setProgress(Math.round(((index + 1) / Math.max(parts.length, 1)) * 100));
        setMessage(
          `Synchronisation ${index + 1}/${parts.length} — ${parsed.commandes.length} commandes`,
        );
      }
      setMessage("Archivage des commandes absentes de la même année…");
      const result = await finalize({
        data: {
          importId: execution.id,
          creees: totals.creees,
          modifiees: totals.modifiees,
          inchangees: totals.inchangees,
          ignorees: totals.ignorees,
          conflits: totals.conflits,
          reports: totals.reports,
        },
      });
      setReport({
        ...totals,
        archivees: result.archivees,
        erreurs: parsed.erreurs.length,
        doublons: parsed.doublons,
        sansCommande: parsed.sansCommande.length,
      });
      setLastImportId(execution.id);
      setMessage(null);
      // V8.10 — l'import matérialise de nouvelles lignes « suivi » sans commande :
      // on invalide le cache du registre /suivi pour que l'onglet « Suivi annuel »
      // reflète immédiatement les nouvelles opérations à demander en devis.
      await queryClient.invalidateQueries({ queryKey: ["psp-suivi-annuel"] });
      await queryClient.invalidateQueries({ queryKey: ["psp-suivi-operations"] });
    } catch (cause) {
      if (typeof execution !== "undefined") {
        try {
          await failImport({ data: { importId: execution.id } });
        } catch {
          // Échec silencieux : l'import sera marqué comme erreur au prochain nettoyage
        }
      }
      setError(cause instanceof Error ? cause.message : "Import impossible");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4 sm:p-8">
      <PageHeader
        title="Import Suivi budgétaire annuel"
        subtitle="Importation du suivi budgétaire et financier de l'exercice. Les commandes sont rapprochées par numéro, les changements sont historisés et les absentes archivées."
      >
        <Button asChild variant="outline">
          <Link to="/">Accueil</Link>
        </Button>
      </PageHeader>
      <div className="rounded-xl border border-dashed bg-surface p-8 text-center space-y-6">
        <div className="mx-auto max-w-xs text-left space-y-2">
          <Label htmlFor="annee-exercice" className="flex items-center gap-2">
            <Calendar className="size-4" /> Année de l'exercice
          </Label>
          <Select value={anneeExercice} onValueChange={setAnneeExercice} disabled={busy}>
            <SelectTrigger id="annee-exercice">
              <SelectValue placeholder="Sélectionner l'année" />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 10 }, (_, i) => exerciceCourant() - 5 + i).map(
                (year) => (
                  <SelectItem key={year} value={year.toString()}>
                    {year}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        </div>

        <div className="pt-4 border-t border-dashed">
          <FileSpreadsheet className="mx-auto size-8 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">
            Export Excel des commandes de travaux (.xlsx ou .xls)
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
            <Upload className="size-4" /> Choisir le fichier
          </Button>
        </div>
      </div>
      {busy || message ? (
        <div className="space-y-2">
          <Progress value={progress} />
          <p className="text-sm text-muted-foreground">{message}</p>
        </div>
      ) : null}
      {error ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {preview ? (
        <section className="space-y-2 rounded-xl border bg-surface p-4 text-sm">
          <h2 className="font-semibold">Résumé de lecture</h2>
          <ul className="space-y-1 text-muted-foreground">
            <li>
              {preview.commandes.length} commandes reconnues sur {preview.lignes} lignes
            </li>
            <li>
              {preview.doublons} doublon(s) interne(s), dont {preview.conflits.length} conflit(s)
            </li>
            <li>{preview.sansCommande.length} ligne(s) sans n° de commande</li>
            <li>{preview.erreurs.length} ligne(s) invalide(s)</li>
          </ul>
          {preview.conflits.length || preview.erreurs.length ? (
            <p className="text-warning-foreground">
              Les lignes valides sont importées ; les anomalies restent comptabilisées dans le
              rapport.
            </p>
          ) : null}
        </section>
      ) : null}
      {report ? (
        <section className="space-y-2 rounded-xl border bg-surface p-4 text-sm">
          <h2 className="font-semibold">Rapport d’import</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            <ReportCounter
              label="créée(s)"
              count={report.creees}
              onClick={() => setDetailsType("creee")}
            />
            <ReportCounter
              label="inchangée(s)"
              count={report.inchangees}
              onClick={() => setDetailsType("inchangee")}
            />
            <ReportCounter
              label="conflit(s) à valider"
              count={report.conflits}
              onClick={() => setDetailsType("conflit")}
            />
            <ReportCounter
              label="report(s) d'exercice"
              count={report.reports}
              onClick={() => setDetailsType("report")}
            />
            <ReportCounter
              label="archivée(s)"
              count={report.archivees}
              onClick={() => setDetailsType("archivee")}
            />
            <ReportCounter
              label="doublon(s)"
              count={report.doublons}
              onClick={() => setDetailsType("doublon")}
            />
            <ReportCounter
              label="rattachement(s) non résolu(s)"
              count={report.ignorees}
              onClick={() => setDetailsType("ignoree")}
            />
            <ReportCounter
              label="sans n° de commande"
              count={report.sansCommande}
              onClick={() => setDetailsType("sans_commande")}
            />
            <ReportCounter
              label="erreur(s)"
              count={report.erreurs}
              onClick={() => setDetailsType("erreur")}
            />
          </div>
        </section>
      ) : null}
      {detailsType && lastImportId ? (
        <ImportDetailsDialog
          importId={lastImportId}
          type={detailsType}
          onClose={() => setDetailsType(null)}
        />
      ) : null}
    </main>
  );
}
type ImportDetailsType =
  | "creee"
  | "conflit"
  | "inchangee"
  | "archivee"
  | "doublon"
  | "ignoree"
  | "erreur"
  | "sans_commande"
  | "report";

const DETAILS_LABELS: Record<ImportDetailsType, string> = {
  creee: "Créées",
  conflit: "Conflits à valider",
  inchangee: "Inchangées",
  archivee: "Archivées",
  doublon: "Doublons",
  ignoree: "Rattachements non résolus",
  erreur: "Erreurs",
  sans_commande: "Lignes sans n° de commande",
  report: "Reports d'exercice",
};

const money = (value: unknown) =>
  typeof value === "number"
    ? new Intl.NumberFormat("fr-FR", {
        style: "currency",
        currency: "EUR",
        maximumFractionDigits: 0,
      }).format(value)
    : "—";

const txt = (value: unknown) =>
  value === null || value === undefined || value === "" ? "—" : String(value);

/** Compteur cliquable : interactif uniquement si > 0. */
function ReportCounter({
  label,
  count,
  onClick,
}: {
  label: string;
  count: number;
  onClick: () => void;
}) {
  if (count <= 0) {
    return (
      <p className="text-muted-foreground">
        {count} {label}
      </p>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 text-left font-medium text-primary underline underline-offset-4 decoration-primary/40 hover:decoration-primary cursor-pointer"
    >
      {count} {label} <ChevronRight className="size-3.5" />
    </button>
  );
}

/** Différences d'un conflit (ancienne → nouvelle valeur). */
function ConflitDiff({ detail }: { detail: Record<string, unknown> }) {
  const avant = (detail["avant"] ?? {}) as Record<string, unknown>;
  const apres = (detail["apres"] ?? {}) as Record<string, unknown>;
  const changed = (detail["champs_differents"] ?? []) as string[];
  if (!changed.length) return <span className="text-muted-foreground">—</span>;
  return (
    <ul className="space-y-0.5 text-xs">
      {changed.slice(0, 6).map((key) => (
        <li key={key}>
          <span className="font-semibold text-slate-600">{key} :</span>{" "}
          <span className="text-red-500 line-through decoration-red-300">{txt(avant[key])}</span>{" "}
          → <span className="font-semibold text-green-600">{txt(apres[key])}</span>
        </li>
      ))}
      {changed.length > 6 ? (
        <li className="text-muted-foreground">… {changed.length - 6} champ(s) de plus</li>
      ) : null}
    </ul>
  );
}

/**
 * Modale de détail d'un compteur d'import : charge uniquement à l'ouverture,
 * liste exacte et immuable des éléments de la catégorie pour cet import.
 */
function ImportDetailsDialog({
  importId,
  type,
  onClose,
}: {
  importId: string;
  type: ImportDetailsType;
  onClose: () => void;
}) {
  const fetchDetails = useServerFn(getTravauxImportDetails);
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const { data, isLoading } = useQuery({
    queryKey: ["travaux-import-details", importId, type, page],
    queryFn: () => fetchDetails({ data: { importId, type, page, pageSize } }),
  });
  const rows = (data?.rows ?? []) as Record<string, unknown>[];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const detailOf = (row: Record<string, unknown>) =>
    (row["details"] ?? {}) as Record<string, unknown>;
  const cell = (row: Record<string, unknown>, key: string) =>
    txt(detailOf(row)[key] ?? row[key]);

  const isCommandType =
    type === "creee" || type === "archivee" || type === "inchangee" || type === "report";
  const isLineType =
    type === "doublon" || type === "ignoree" || type === "erreur" || type === "sans_commande";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden rounded-3xl">
        <DialogHeader>
          <DialogTitle>{DETAILS_LABELS[type]}</DialogTitle>
          <DialogDescription>
            {total} résultat{total > 1 ? "s" : ""} pour cet import
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[55vh] rounded-xl border">
          {isLoading ? (
            <p className="p-4 text-sm text-muted-foreground">Chargement…</p>
          ) : rows.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              Aucun élément pour cette catégorie.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {isLineType ? <TableHead>Ligne Excel</TableHead> : null}
                  <TableHead>N° commande</TableHead>
                  {!isLineType ? <TableHead>Année</TableHead> : null}
                  {isCommandType ? <TableHead>Lot</TableHead> : null}
                  {isCommandType && type !== "inchangee" ? <TableHead>Adresse</TableHead> : null}
                  {type === "creee" || type === "archivee" ? (
                    <TableHead>Fournisseur</TableHead>
                  ) : null}
                  {type === "creee" || type === "archivee" ? <TableHead>Montant</TableHead> : null}
                  {type === "conflit" || type === "report" ? (
                    <TableHead>Changements</TableHead>
                  ) : null}
                  {type === "archivee" ? <TableHead>Motif</TableHead> : null}
                  {isLineType ? <TableHead>Message</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow
                    key={String(
                      row["id"] ?? row["numero_commande"] ?? JSON.stringify(row).slice(0, 40),
                    )}
                  >
                    {isLineType ? <TableCell>{txt(row["ligne"])}</TableCell> : null}
                    <TableCell className="font-semibold">
                      {cell(row, "numero_commande")}
                    </TableCell>
                    {!isLineType ? <TableCell>{cell(row, "annee_exercice")}</TableCell> : null}
                    {isCommandType ? <TableCell>{cell(row, "lot_code")}</TableCell> : null}
                    {isCommandType && type !== "inchangee" ? (
                      <TableCell>{cell(row, "adresse")}</TableCell>
                    ) : null}
                    {type === "creee" || type === "archivee" ? (
                      <TableCell>{cell(row, "fournisseur")}</TableCell>
                    ) : null}
                    {type === "creee" || type === "archivee" ? (
                      <TableCell>{money(detailOf(row)["montant"])}</TableCell>
                    ) : null}
                    {type === "conflit" || type === "report" ? (
                      <TableCell>
                        <ConflitDiff detail={detailOf(row)} />
                      </TableCell>
                    ) : null}
                    {type === "archivee" ? (
                      <TableCell>
                        <Badge variant="outline">{txt(row["message"])}</Badge>
                      </TableCell>
                    ) : null}
                    {isLineType ? <TableCell>{txt(row["message"])}</TableCell> : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </ScrollArea>

        <div className="flex items-center justify-between gap-4 pt-2">
          <p className="text-xs text-muted-foreground">
            Page {page} / {totalPages}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || isLoading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Précédent
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages || isLoading}
              onClick={() => setPage((p) => p + 1)}
            >
              Suivant
            </Button>
          </div>
        </div>
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

