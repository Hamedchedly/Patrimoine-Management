/**
 * V7.5 §10-12 — FICHE UNIQUE d'édition d'une opération (fusion saisie/modification
 * et devis) :
 *  · formulaire complet embarqué (TR, CC, périmètre/ER, corps d'état, catégorie,
 *    nature, années/montants, statut, priorité, notes) via `PspOperationForm` ;
 *  · section Devis (PspDevisPanel) ;
 *  · historique des modifications (psp_ligne_historique, repliable) ;
 *  · [Supprimer] UNIQUEMENT ici (confirmation) + [Fermer] ;
 *  · le clic « Devis » ouvre la fiche sur la section Devis (focusDevis).
 */
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, FileText, History, Trash2 } from "lucide-react";

import PspDevisPanel, { type DevisEdit } from "@/components/preparation-psp/PspDevisPanel";
import PspDemandeDevisWorkflow from "@/components/preparation-psp/PspDemandeDevisWorkflow";
import PspOperationForm from "@/components/preparation-psp/PspOperationForm";
import PspSecteurBadge from "@/components/preparation-psp/PspSecteurBadge";
import PspSuiviApercu from "@/components/preparation-psp/PspSuiviApercu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { diffHistorique } from "@/lib/psp.prep.v7";
import type { LotInfo, PerimetreLigne } from "@/lib/psp.prep.v7";
import type { PspOperation, SaisieOperation } from "@/lib/psp.prep";
import type { ReferencePatrimoine } from "@/lib/psp.prep.data";

export default function PspOperationDetail({
  operation,
  perimetresLigne,
  lotsParId,
  reference,
  historique = [],
  figee,
  focusDevis = false,
  onSave,
  onSupprimer,
  onDevisAdd,
  onDevisUpdate,
  onDevisDelete,
  onDemandeEnvoyee = async () => undefined,
  onClose,
}: {
  operation: PspOperation | null;
  perimetresLigne: PerimetreLigne[];
  /** V8.2.1 — restauration du périmètre (lots) en modification. */
  lotsParId?: Map<string, LotInfo> | null | undefined;
  reference: ReferencePatrimoine | null;
  historique?: Array<Record<string, unknown>>;
  figee: boolean;
  /** V7.5 §10 — clic « Devis » : ouvre la fiche sur la section Devis. */
  focusDevis?: boolean;
  onSave: (saisie: SaisieOperation) => void;
  onSupprimer: (id: string) => void;
  onDevisAdd: (ligneId: string, d: DevisEdit) => Promise<void>;
  onDevisUpdate: (id: string, d: DevisEdit) => Promise<void>;
  onDevisDelete: (id: string) => Promise<void>;
  /** V8.2.1 — rafraîchit le brouillon après enregistrement d'une demande de devis. */
  onDemandeEnvoyee?: () => Promise<void>;
  onClose: () => void;
}) {
  const devisRef = useRef<HTMLDivElement>(null);
  const [historiqueOuvert, setHistoriqueOuvert] = useState(false);

  useEffect(() => {
    if (!operation) return undefined;
    setHistoriqueOuvert(false);
    if (focusDevis) {
      const t = window.setTimeout(
        () => devisRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }),
        200,
      );
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [operation, focusDevis]);

  if (!operation) return null;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] w-[min(94vw,840px)] gap-0 p-0 sm:max-w-[840px]">
        <ScrollArea className="max-h-[calc(92vh-4rem)]">
          <div className="p-5">
            <DialogHeader className="space-y-2">
              <DialogTitle className="flex items-center gap-2 text-base">
                <FileText className="size-4 text-primary" />
                Modifier l'opération — TR {operation.tranche}
                <PspSecteurBadge categorie={operation.categorie} />
              </DialogTitle>
              <DialogDescription>
                Fiche unique : périmètre / ER, corps d'état, montants 2027-2031, devis, statut,
                priorité, notes, historique. Ch. Op. = HCHEDLY.
              </DialogDescription>
            </DialogHeader>

            {/* Formulaire complet (embedded) */}
            <div className="mt-4">
              <PspOperationForm
                embedded
                open={false}
                mode="modification"
                operation={operation}
                reference={reference}
                perimetresLigne={perimetresLigne}
                lotsParId={lotsParId}
                onSave={onSave}
                onClose={onClose}
              />
            </div>

            {/* Section Devis (focus via clic « Devis ») */}
            <div ref={devisRef} className="mt-4">
              <p className="mb-1 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                <FileText className="size-3.5" />
                Devis
              </p>
              <PspDevisPanel
                operation={operation}
                figee={figee}
                onAdd={(d) => onDevisAdd(operation.id, d)}
                onUpdate={onDevisUpdate}
                onDelete={onDevisDelete}
              />
            </div>

            {/* V8.2.1 — workflow demande de devis (suggestions + mailto + enregistrement) */}
            <div className="mt-3">
              <PspDemandeDevisWorkflow
                operation={operation}
                figee={figee}
                onEnvoye={onDemandeEnvoyee}
              />
            </div>

            {/* Aperçu Suivi V8.1 (lecture seule — test du socle) */}
            <div className="mt-3">
              <PspSuiviApercu pspLigneId={operation.id} />
            </div>

            {/* Historique des modifications (psp_ligne_historique) — repliable */}
            <div className="mt-3 rounded-lg border bg-card">
              <Collapsible open={historiqueOuvert} onOpenChange={setHistoriqueOuvert}>
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
                  >
                    <span className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                      <History className="size-3.5" />
                      Historique des modifications
                    </span>
                    <span className="flex items-center gap-1 text-[10px] font-bold text-muted-foreground">
                      {historique.length > 0 ? `${historique.length} entrée(s)` : ""}
                      {historiqueOuvert ? (
                        <ChevronDown className="size-3.5" />
                      ) : (
                        <ChevronRight className="size-3.5" />
                      )}
                    </span>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  {historique.length > 0 ? (
                    <ol className="space-y-2 border-t px-3 py-2">
                      {historique.map((h, i) => {
                        const operationText = String(h["operation"] ?? "modification");
                        const created = h["created_at"] as string | null;
                        const date = created
                          ? new Date(created).toLocaleDateString("fr-FR", {
                              day: "2-digit",
                              month: "2-digit",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "";
                        const diffs = diffHistorique(h["avant"], h["apres"]);
                        return (
                          <li key={i} className="rounded border bg-surface/60 p-2">
                            <div className="flex flex-wrap items-center justify-between gap-1">
                              <span
                                className={
                                  operationText === "creation"
                                    ? "rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-black uppercase text-emerald-800"
                                    : "rounded bg-blue-100 px-1.5 py-0.5 text-[9px] font-black uppercase text-blue-800"
                                }
                              >
                                {operationText === "creation" ? "Création" : "Modification"}
                              </span>
                              <span className="text-[9px] text-muted-foreground">{date}</span>
                            </div>
                            {diffs.length > 0 ? (
                              <ul className="mt-1.5 space-y-0.5">
                                {diffs.map((d, j) => (
                                  <li key={j} className="text-[10px] leading-snug">
                                    <span className="font-bold">{d.champ}</span> :{" "}
                                    <span className="text-muted-foreground line-through">
                                      {d.avant}
                                    </span>{" "}
                                    <span className="text-foreground">→</span>{" "}
                                    <span className="font-medium text-primary">{d.apres}</span>
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p className="mt-1 text-[10px] text-muted-foreground">
                                Détail non diffusable.
                              </p>
                            )}
                          </li>
                        );
                      })}
                    </ol>
                  ) : (
                    <p className="border-t px-3 py-2 text-[10px] text-muted-foreground">
                      Aucune modification enregistrée.
                    </p>
                  )}
                </CollapsibleContent>
              </Collapsible>
            </div>

            {/* Suppression — UNIQUEMENT ici (V7.5 §11), séparée des actions */}
            <DialogFooter className="mt-4 flex-col-reverse items-stretch gap-2 border-t border-dashed pt-3 sm:flex-row sm:items-center sm:justify-between">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm" disabled={figee}>
                    <Trash2 className="size-3.5" />
                    Supprimer l'opération
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Supprimer cette opération ?</AlertDialogTitle>
                    <AlertDialogDescription>
                      La suppression est définitive : DELETE réel dans Supabase, périmètre
                      patrimonial supprimé par cascade. L'historique de la ligne est également
                      supprimé (cascade du mécanisme existant).
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Annuler</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-white hover:bg-destructive/90"
                      onClick={() => onSupprimer(operation.id)}
                    >
                      Supprimer
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <Button variant="outline" size="sm" onClick={onClose}>
                Fermer
              </Button>
            </DialogFooter>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
