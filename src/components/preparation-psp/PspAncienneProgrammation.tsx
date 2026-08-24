import { useMemo } from "react";
import { Archive, ArrowRightLeft, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

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
import { money0 } from "@/lib/formats";
import {
  ANCIENNE_PROGRAMMATION,
  comparerProgrammation,
  type PspOperation,
  type StatutComparaison,
} from "@/lib/psp.prep";
import { cn } from "@/lib/utils";

const simulé = (action: string) =>
  toast.info(`${action} — simulation locale, aucune écriture en base.`);

const STATUTS: Record<StatutComparaison, { label: string; className: string }> = {
  inchangee: {
    label: "Inchangée",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  modifiee: {
    label: "Modifiée",
    className: "border-amber-200 bg-amber-50 text-amber-700",
  },
  deplacee: {
    label: "Déplacée",
    className: "border-blue-200 bg-blue-50 text-blue-700",
  },
  supprimee: {
    label: "Supprimée",
    className: "border-red-200 bg-red-50 text-red-600",
  },
  nouvelle: {
    label: "Nouvelle",
    className: "border-violet-200 bg-violet-50 text-violet-700",
  },
};

/**
 * Modal « Ancienne programmation » : lignes issues de la programmation 2026,
 * comparées à la préparation actuelle (inchangée / modifiée / déplacée /
 * supprimée / nouvelle). La source reste le jeu mock tant que le fichier
 * d'origine n'est pas disponible dans le projet. Aucune action n'écrit en base.
 */
export default function PspAncienneProgrammation({
  open,
  operations,
  onClose,
}: {
  open: boolean;
  operations: PspOperation[];
  onClose: () => void;
}) {
  const { lignes, nouvelles } = useMemo(
    () => comparerProgrammation(ANCIENNE_PROGRAMMATION, operations),
    [operations],
  );

  const totalAncien = ANCIENNE_PROGRAMMATION.reduce((s, l) => s + l.montant, 0);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[min(92vw,680px)] sm:max-w-[680px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Archive className="size-4 text-muted-foreground" />
            Ancienne programmation
          </DialogTitle>
          <DialogDescription>
            Programmation 2026 comparée à la préparation actuelle (lecture seule). Actions locales
            (V2), aucune écriture en base.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(STATUTS) as StatutComparaison[]).map((s) => {
            const compte =
              s === "nouvelle" ? nouvelles.length : lignes.filter((l) => l.statut === s).length;
            if (compte === 0) return null;
            return (
              <Badge key={s} className={cn("border text-[10px]", STATUTS[s].className)}>
                {compte} {STATUTS[s].label}
                {compte > 1 ? "s" : ""}
              </Badge>
            );
          })}
        </div>

        <ScrollArea className="max-h-[52vh] pr-2">
          <ul className="mt-2 space-y-2">
            {lignes.map(({ item, statut, montantActuel, anneeActuelle }) => (
              <li key={item.id} className="rounded-lg border bg-surface/60 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold">{item.nature_travaux}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {item.adresse}, {item.ville} — Tranche {item.tranche}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge className={cn("border text-[9px]", STATUTS[statut].className)}>
                      {STATUTS[statut].label}
                    </Badge>
                    <p className="text-sm font-black">
                      <span className="text-muted-foreground">{item.annee} → </span>
                      <span className="tabnum">{money0(item.montant)}</span>
                    </p>
                    {statut !== "supprimee" && montantActuel !== null ? (
                      <p className="tabnum text-[10px] text-muted-foreground">
                        actuel : {anneeActuelle ?? "—"} · {money0(montantActuel)}
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-[11px]"
                    onClick={() => simulé("Conserver l'opération")}
                  >
                    <Archive className="size-3" />
                    Conserver
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-[11px]"
                    onClick={() => simulé("Reporter l'opération")}
                  >
                    <ArrowRightLeft className="size-3" />
                    Reporter
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-[11px]"
                    onClick={() => simulé("Modifier l'opération")}
                  >
                    <Pencil className="size-3" />
                    Modifier
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-[11px] text-destructive hover:text-destructive"
                    onClick={() => simulé("Supprimer l'opération")}
                  >
                    <Trash2 className="size-3" />
                    Supprimer
                  </Button>
                </div>
              </li>
            ))}
            {nouvelles.length > 0 ? (
              <li className="rounded-lg border border-violet-200 bg-violet-50/50 p-3">
                <p className="text-xs font-bold text-violet-700">
                  {nouvelles.length} nouvelle{nouvelles.length > 1 ? "s" : ""} opération
                  {nouvelles.length > 1 ? "s" : ""} dans la préparation actuelle
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {nouvelles
                    .slice(0, 6)
                    .map((o) => `${o.tranche} · ${o.nature_travaux}`)
                    .join(" — ")}
                  {nouvelles.length > 6 ? "…" : ""}
                </p>
              </li>
            ) : null}
          </ul>
        </ScrollArea>

        <div className="flex items-center justify-between gap-2 border-t pt-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
            {ANCIENNE_PROGRAMMATION.length} lignes — {money0(totalAncien)}
          </p>
          <Button variant="outline" size="sm" onClick={onClose}>
            Fermer
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
