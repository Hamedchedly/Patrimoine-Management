/**
 * V8.20 — TABLEAU DE BORD des signalements de bugs.
 * Liste Date / Description / Page concernée, filtres (Tous/Ouverts/Résolus),
 * bouton « Valider la résolution » (après correction + push) et suppression.
 */
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bug, CheckCircle2, Circle, Loader2, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  getBugReports,
  resoudreBugReport,
  supprimerBugReport,
  type BugReport,
} from "@/lib/bugs/reports.functions";

export const BUG_REPORTS_KEY = ["bug-reports"] as const;

const fmtDate = (v: string | null | undefined): string =>
  v
    ? new Date(v).toLocaleString("fr-FR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

export function BugReportsDashboard({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const fetchListe = useServerFn(getBugReports);
  const resoudre = useServerFn(resoudreBugReport);
  const supprimer = useServerFn(supprimerBugReport);
  const [filtre, setFiltre] = useState<"tous" | "ouvert" | "resolu">("ouvert");
  const [busy, setBusy] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: [...BUG_REPORTS_KEY],
    queryFn: () => fetchListe(),
    enabled: open,
    staleTime: 30_000,
  });
  const rapports = useMemo(() => (data ?? []) as BugReport[], [data]);

  const filtres = useMemo(
    () =>
      rapports.filter((r) =>
        filtre === "tous"
          ? true
          : filtre === "ouvert"
            ? r.statut === "ouvert"
            : r.statut === "resolu",
      ),
    [rapports, filtre],
  );

  const rafraichir = async () => {
    await queryClient.invalidateQueries({ queryKey: [...BUG_REPORTS_KEY] });
    await queryClient.fetchQuery({
      queryKey: [...BUG_REPORTS_KEY],
      queryFn: () => fetchListe(),
    });
  };

  const valider = async (id: string) => {
    setBusy(id);
    try {
      await resoudre({ data: { id } });
      await rafraichir();
    } finally {
      setBusy(null);
    }
  };
  const supprimerUn = async (id: string) => {
    setBusy(id);
    try {
      await supprimer({ data: { id } });
      await rafraichir();
    } finally {
      setBusy(null);
    }
  };

  const onglet = (cle: "tous" | "ouvert" | "resolu", label: string, n: number) => (
    <button
      key={cle}
      type="button"
      onClick={() => setFiltre(cle)}
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
        filtre === cle
          ? "border-primary bg-primary text-primary-foreground"
          : "border-slate-200 text-slate-600 hover:bg-slate-50",
      )}
    >
      {label} ({n})
    </button>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[min(96vw,1000px)] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-0">
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Bug className="size-4 text-primary" /> Signalements de bugs
          </DialogTitle>
          <DialogDescription className="text-xs">
            Rapports utilisateur (bouton « Signaler ») — marquer comme résolu après correction &
            push.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-2 px-6 py-3">
          {onglet("ouvert", "Ouverts", rapports.filter((r) => r.statut === "ouvert").length)}
          {onglet("resolu", "Résolus", rapports.filter((r) => r.statut === "resolu").length)}
          {onglet("tous", "Tous", rapports.length)}
        </div>

        <ScrollArea className="min-h-0 flex-1 px-6 pb-4">
          {isLoading ? (
            <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Chargement…
            </p>
          ) : filtres.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">
              Aucun signalement{" "}
              {filtre === "ouvert" ? "ouvert" : filtre === "resolu" ? "résolu" : ""}.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="w-[45%]">Description</TableHead>
                  <TableHead>Page concernée</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtres.map((r) => (
                  <TableRow key={r.id} className="align-top">
                    <TableCell className="whitespace-nowrap text-xs">
                      {fmtDate(r.cree_le)}
                    </TableCell>
                    <TableCell className="text-xs">
                      <p className="whitespace-pre-wrap">{r.description}</p>
                      {r.categorie ? (
                        <Badge variant="outline" className="mt-1 text-[9px]">
                          {r.categorie}
                        </Badge>
                      ) : null}
                      {r.capture ? (
                        <img
                          src={r.capture}
                          alt="Capture"
                          className="mt-1 max-h-28 rounded border"
                        />
                      ) : null}
                      {r.url ? (
                        <p className="mt-1 truncate font-mono text-[9px] text-muted-foreground">
                          {r.url}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-xs">
                      <p>{r.page_titre ?? "—"}</p>
                    </TableCell>
                    <TableCell>
                      {r.statut === "ouvert" ? (
                        <Badge className="bg-amber-100 text-amber-800">
                          <Circle className="size-2.5" /> Ouvert
                        </Badge>
                      ) : (
                        <Badge className="bg-emerald-100 text-emerald-700">
                          <CheckCircle2 className="size-2.5" /> Résolu
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {r.statut === "ouvert" ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-[10px]"
                          disabled={busy === r.id}
                          onClick={() => void valider(r.id)}
                          title="Corrigé (après push GitHub) — marquer comme résolu"
                        >
                          <CheckCircle2 className="size-3.5" /> Valider la résolution
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="ml-1 size-7 text-muted-foreground hover:text-destructive"
                        disabled={busy === r.id}
                        title="Supprimer"
                        onClick={() => void supprimerUn(r.id)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
