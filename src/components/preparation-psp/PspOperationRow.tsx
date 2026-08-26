import { Building2, Pencil, Trash2 } from "lucide-react";

import PspSecteurBadge from "@/components/preparation-psp/PspSecteurBadge";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";
import { money0 } from "@/lib/formats";
import { PSP_ANNEES, montantAnnee, totalOperation, type PspOperation } from "@/lib/psp.prep";
import {
  PRIORITE_LABELS,
  STATUT_LABELS,
  libelleAdressePerimetre,
  statutConsultationDepuisDevis,
  type LotInfo,
  type PerimetreLigne,
} from "@/lib/psp.prep.v7";
import { cn } from "@/lib/utils";

const STATUT_STYLES: Record<string, string> = {
  a_definir: "border-amber-200 bg-amber-50 text-amber-800",
  attente_agence: "border-blue-200 bg-blue-50 text-blue-800",
  attente_confirmation: "border-violet-200 bg-violet-50 text-violet-800",
};
const PRIORITE_STYLES: Record<string, string> = {
  prioritaire: "border-red-200 bg-red-50 text-red-800",
  normale: "border-slate-200 bg-slate-100 text-slate-700",
  non_prioritaire: "border-border bg-muted text-muted-foreground",
};

/**
 * Ligne d'opération du tableau (V7.2) — cliquable (fiche opération).
 * Colonnes : TR, CC, Adresse / périmètre réel, Corps d'état, Catégorie,
 * Nature travaux, 2027-2031, Total, Devis, Statut (éditable), Priorité
 * (éditable), Notes (éditables), Actions. Modifier / Supprimer / fiche.
 */
export default function PspOperationRow({
  op,
  perimetres,
  lotsParId,
  onOpen,
  onModifier,
  onDevis,
  onDelete,
  editionActive,
  onEditRequest,
}: {
  op: PspOperation;
  perimetres: PerimetreLigne[];
  lotsParId: Map<string, LotInfo>;
  onOpen: (op: PspOperation) => void;
  onModifier: (op: PspOperation) => void;
  /** V7.5 §10 — clic « Devis » : ouvre la fiche unique sur la section Devis. */
  onDevis: (op: PspOperation) => void;
  /** V8.16y — suppression d'une ligne (bouton corbeille, confirmation AlertDialog). */
  onDelete: (id: string) => void;
  /** V8.16y — vrai si la ligne est éditée (formulaire complet étendu sous la ligne). */
  editionActive: boolean;
  /** V8.16y — clic simple → ouvre/ferme le formulaire d'édition complet sous la ligne. */
  onEditRequest: () => void;
}) {
  // V8.16y — édition : le clic simple ouvre le formulaire COMPLET étendu sous la
  // ligne (périmètre/ER lot, montants, tranche, corps, nature, statut, priorité,
  // notes) ; plus aucun état inline dans la ligne elle-même.
  const adresse = libelleAdressePerimetre(perimetres, lotsParId, {
    adresse: op.adresse,
    ville: op.ville,
  });
  const statut = op.statut ?? "a_definir";
  const priorite = op.priorite ?? "normale";
  const nbDevis = op.devis.length;
  // V8.7 §3.2 — statut consultation DÉRIVÉ des psp_devis.statut existants
  // (Aucune demande / Demande à envoyer / Demande envoyée / Devis reçu /
  // Devis retenu). Aucun état stocké, aucun moteur parallèle.
  const consultation = statutConsultationDepuisDevis(op.devis);

  return (
    <TableRow
      className={cn(
        "cursor-pointer transition-colors hover:bg-primary/5",
        editionActive && "bg-primary/10",
      )}
      onClick={onEditRequest}
      title="Cliquer pour modifier sur le tableau"
    >
      <TableCell className="py-2 font-mono text-xs font-semibold">{op.tranche}</TableCell>
      <TableCell className="py-2 text-xs font-medium">{op.charge_clientele}</TableCell>
      <TableCell className="max-w-[220px] py-2">
        <span className="block truncate text-xs" title={adresse}>
          {adresse}
        </span>
      </TableCell>
      <TableCell className="max-w-[180px] py-2">
        <span className="block truncate text-xs" title={op.corps_etat}>
          {op.corps_etat || "—"}
        </span>
      </TableCell>
      <TableCell className="py-2">
        <PspSecteurBadge categorie={op.categorie} />
      </TableCell>
      <TableCell className="max-w-[240px] py-2">
        <span className="flex items-center gap-1.5">
          <span className="block truncate text-xs font-medium" title={op.nature_travaux}>
            {op.nature_travaux}
          </span>
          {op.reportee ? (
            <Badge className="shrink-0 border-amber-200 bg-amber-50 px-1.5 py-0 text-[9px] font-black text-amber-700">
              REPORTÉ{op.ancienne_annee ? ` DE ${op.ancienne_annee}` : ""}
            </Badge>
          ) : null}
        </span>
      </TableCell>
      {PSP_ANNEES.map((annee) => {
        const montant = montantAnnee(op, annee);
        return (
          <TableCell key={annee} className="py-2 text-right">
            <span
              className={
                montant > 0
                  ? "tabnum text-xs font-semibold text-foreground"
                  : "text-xs text-muted-foreground/40"
              }
            >
              {montant > 0 ? money0(montant) : "—"}
            </span>
          </TableCell>
        );
      })}
      <TableCell className="py-2 text-right">
        <span className="tabnum text-xs font-black">{money0(totalOperation(op))}</span>
      </TableCell>
      <TableCell className="py-2">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDevis(op);
          }}
          title="Ouvrir la fiche d'édition sur la section Devis"
          className={cn(
            "inline-flex items-center gap-1 text-[11px] font-bold hover:underline",
            nbDevis > 0 ? "text-emerald-700" : "text-muted-foreground",
          )}
        >
          <Building2 className="size-3" />
          {consultation.code === "aucune" ? "Aucune demande" : `${consultation.label} (${nbDevis})`}
        </button>
      </TableCell>

      {/* Priorité — affichage (édition via le formulaire étendu sous la ligne). */}
      <TableCell className="py-2" onClick={(e) => e.stopPropagation()}>
        <Badge className={cn("font-bold", PRIORITE_STYLES[priorite] ?? PRIORITE_STYLES["normale"])}>
          {PRIORITE_LABELS[priorite] ?? priorite}
        </Badge>
      </TableCell>

      {/* Statut / Notes — affichage (édition via le formulaire étendu sous la ligne). */}
      <TableCell className="min-w-[180px] py-2" onClick={(e) => e.stopPropagation()}>
        <Badge className={cn("font-bold", STATUT_STYLES[statut] ?? STATUT_STYLES["a_definir"])}>
          {STATUT_LABELS[statut] ?? statut}
        </Badge>
        <p
          className="mt-1 truncate text-[11px] text-muted-foreground"
          title={op.remarques ?? undefined}
        >
          {op.remarques || ""}
        </p>
      </TableCell>

      {/* Actions — V8.16y : ouvrir la fiche + supprimer. L'édition se fait par un
          clic simple → formulaire complet étendu sous la ligne (PspTable). */}
      <TableCell className="py-2" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-primary"
            title="Ouvrir la fiche opération (opération + devis + historique)"
            onClick={() => onModifier(op)}
          >
            <Pencil className="size-3.5" />
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-destructive"
                title="Supprimer la ligne"
              >
                <Trash2 className="size-3.5" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Supprimer cette ligne ?</AlertDialogTitle>
                <AlertDialogDescription>
                  {op.tranche} — {op.nature_travaux || "sans nature"}. Cette action est définitive
                  (psp_lignes).
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Annuler</AlertDialogCancel>
                <AlertDialogAction onClick={() => onDelete(op.id)}>Supprimer</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </TableCell>
    </TableRow>
  );
}
