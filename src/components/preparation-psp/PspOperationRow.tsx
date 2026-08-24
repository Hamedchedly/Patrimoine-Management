import { useState } from "react";
import { Building2, Pencil } from "lucide-react";

import PspSecteurBadge from "@/components/preparation-psp/PspSecteurBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  onStatutPriorite,
  onNotes,
}: {
  op: PspOperation;
  perimetres: PerimetreLigne[];
  lotsParId: Map<string, LotInfo>;
  onOpen: (op: PspOperation) => void;
  onModifier: (op: PspOperation) => void;
  /** V7.5 §10 — clic « Devis » : ouvre la fiche unique sur la section Devis. */
  onDevis: (op: PspOperation) => void;
  onStatutPriorite: (id: string, patch: { statut?: string; priorite?: string }) => void;
  onNotes: (id: string, remarques: string) => void;
}) {
  const [editing, setEditing] = useState<{ statut?: boolean; priorite?: boolean }>({});
  const [notes, setNotes] = useState(op.remarques ?? "");

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
      className="cursor-pointer transition-colors hover:bg-primary/5"
      onClick={() => onOpen(op)}
      title={`Ouvrir la fiche — ${op.nature_travaux}`}
    >
      <TableCell className="py-2 font-mono text-xs font-semibold">{op.tranche}</TableCell>
      <TableCell className="py-2 text-xs font-medium">{op.charge_clientele}</TableCell>
      <TableCell className="max-w-[220px] py-2">
        <span className="block truncate text-xs" title={adresse}>
          {adresse}
        </span>
      </TableCell>
      <TableCell className="max-w-[160px] py-2">
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

      {/* Priorité — AVANT Statut : badge + sélecteur inline */}
      <TableCell className="py-2" onClick={(e) => e.stopPropagation()}>
        {editing.priorite ? (
          <Select
            value={priorite}
            onValueChange={(v) => {
              onStatutPriorite(op.id, { priorite: v });
              setEditing({ ...editing, priorite: false });
            }}
          >
            <SelectTrigger className="h-7 w-[130px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(PRIORITE_LABELS).map(([v, l]) => (
                <SelectItem key={v} value={v}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <button
            type="button"
            onClick={() => setEditing({ ...editing, priorite: true })}
            title="Cliquer pour modifier la priorité"
          >
            <Badge
              className={cn("font-bold", PRIORITE_STYLES[priorite] ?? PRIORITE_STYLES["normale"])}
            >
              {PRIORITE_LABELS[priorite] ?? priorite}
            </Badge>
          </button>
        )}
      </TableCell>

      {/* Statut / Notes — UNE seule cellule : statut structuré + texte libre */}
      <TableCell className="min-w-[180px] py-2" onClick={(e) => e.stopPropagation()}>
        {editing.statut ? (
          <Select
            value={statut}
            onValueChange={(v) => {
              onStatutPriorite(op.id, { statut: v });
              setEditing({ ...editing, statut: false });
            }}
          >
            <SelectTrigger className="h-7 w-[150px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(STATUT_LABELS).map(([v, l]) => (
                <SelectItem key={v} value={v}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <button
            type="button"
            onClick={() => setEditing({ ...editing, statut: true })}
            title="Cliquer pour modifier le statut"
          >
            <Badge className={cn("font-bold", STATUT_STYLES[statut] ?? STATUT_STYLES["a_definir"])}>
              {STATUT_LABELS[statut] ?? statut}
            </Badge>
          </button>
        )}
        <Input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => {
            const value = notes.trim();
            const actuelle = (op.remarques ?? "").trim();
            if (value !== actuelle) onNotes(op.id, value);
          }}
          placeholder="Note libre…"
          className="mt-1 h-7 text-xs"
        />
      </TableCell>

      {/* Actions */}
      <TableCell className="py-2" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-primary"
            title="Modifier (fiche unique : opération + devis + historique)"
            onClick={() => onModifier(op)}
          >
            <Pencil className="size-3.5" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
