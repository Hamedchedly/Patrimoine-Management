import { Fragment, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";

import PspDetailFilters from "@/components/preparation-psp/PspDetailFilters";
import PspOperationRow from "@/components/preparation-psp/PspOperationRow";
import PspQuickAddRow from "@/components/preparation-psp/PspQuickAddRow";
import type { ModeAffichage } from "@/components/preparation-psp/PspGroupingSelector";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { money0 } from "@/lib/formats";
import {
  PSP_ANNEES,
  filtrerOperations,
  sommeParAnnee,
  statsOperations,
  trierOperationsDetail,
  type CleTri,
  type FiltresDetail,
  type PspOperation,
} from "@/lib/psp.prep";
import type { LotInfo, PerimetreLigne } from "@/lib/psp.prep.v7";
import type { ReferencePatrimoine } from "@/lib/psp.prep.data";
import { cn } from "@/lib/utils";

const FILTRES_VIDES: FiltresDetail = {
  q: "",
  categorie: "",
  tranche: "",
  charge_clientele: "",
  corps_etat: "",
  annee: "",
};

const filtersActive = (f: FiltresDetail): boolean =>
  Boolean(f.q || f.categorie || f.tranche || f.charge_clientele || f.corps_etat || f.annee);

/** Colonnes descriptives (avant les années) : TR CC Adresse Corps C Nature. */
const NB_COLS_DESCRIPTIVES = 6;
/** Colonnes après Total : Devis, Priorité, Statut / Notes, Actions. */
const NB_COLS_TRAILING = 4;
/** Nombre total de colonnes (pour les lignes de séparateur). */
const NB_COLS_TOTAL = NB_COLS_DESCRIPTIVES + PSP_ANNEES.length + 1 + NB_COLS_TRAILING;

const COLONNES: Array<{ cle: CleTri | null; label: string; align?: "right" }> = [
  { cle: "tranche", label: "TR" },
  { cle: "charge_clientele", label: "CC" },
  { cle: "adresse", label: "Adresse / périmètre" },
  { cle: "corps_etat", label: "Corps d'état" },
  { cle: "secteur", label: "C" },
  { cle: "nature_travaux", label: "Nature travaux" },
  ...PSP_ANNEES.map((a) => ({
    cle: String(a) as CleTri,
    label: String(a),
    align: "right" as const,
  })),
  { cle: "total", label: "Total", align: "right" as const },
  { cle: null, label: "Devis" },
  { cle: "priorite", label: "Priorité" },
  { cle: null, label: "Statut / Notes" },
  { cle: null, label: "Actions" },
];

/** Ligne de séparateur VISUEL (non repliable) — V7.4 §8-9. */
function SeparateurLigne({ label }: { label: string }) {
  return (
    <TableRow className="border-y border-slate-300 bg-slate-100/90 hover:bg-slate-100/90">
      <TableCell colSpan={NB_COLS_TOTAL} className="px-3 py-1.5">
        <span className="text-[11px] font-black uppercase tracking-wide text-slate-700">
          {label}
        </span>
      </TableCell>
    </TableRow>
  );
}

/**
 * Tableau principal du module (V7.4) :
 *  · mode « Détail » (défaut) : toutes les lignes, tri par clic sur les en-têtes ;
 *  · modes « Par tranche » / « Par chargé de clientèle » : TABLEAU CONTINU avec
 *    SÉPARATEURS VISUELS (aucun groupe repliable) — le tri suit l'ordre réel et
 *    le séparateur s'insère au changement de groupe ;
 *  · la ligne de saisie directe reste sous l'en-tête.
 */
export default function PspTable({
  mode,
  operations,
  filters,
  onFiltersChange,
  onOpenOperation,
  onModifier,
  onDevis,
  onStatutPriorite,
  onNotes,
  perimetresParLigne,
  lotsParId,
  quickAdd,
  figee,
  reference = null,
}: {
  mode: ModeAffichage;
  operations: PspOperation[];
  filters: FiltresDetail;
  onFiltersChange: (f: FiltresDetail) => void;
  onOpenOperation: (op: PspOperation) => void;
  onModifier: (op: PspOperation) => void;
  onDevis: (op: PspOperation) => void;
  onStatutPriorite: (id: string, patch: { statut?: string; priorite?: string }) => void;
  onNotes: (id: string, remarques: string) => void;
  perimetresParLigne: Map<string, PerimetreLigne[]>;
  lotsParId: Map<string, LotInfo>;
  quickAdd: {
    programmationId: string;
    reference: ReferencePatrimoine | null;
    onSaved: () => void;
  } | null;
  figee: boolean;
  reference?: ReferencePatrimoine | null;
}) {
  const [tri, setTri] = useState<{ cle: CleTri; asc: boolean } | null>(null);

  const filtrees = useMemo(() => filtrerOperations(operations, filters), [operations, filters]);
  const triees = useMemo(
    () => (tri ? trierOperationsDetail(filtrees, tri.cle, tri.asc) : filtrees),
    [filtrees, tri],
  );
  const totauxDetail = useMemo(() => statsOperations(triees), [triees]);
  const parAnneeDetail = useMemo(() => sommeParAnnee(triees), [triees]);

  const changerTri = (cle: CleTri) => {
    setTri((prev) => {
      if (prev?.cle === cle) return { cle, asc: !prev.asc };
      const numerique = cle === "total" || PSP_ANNEES.map(String).includes(cle);
      return { cle, asc: !numerique };
    });
  };

  const localiteTranche = (code: string): string => reference?.tranches.get(code)?.localite ?? "";

  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-panel">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-surface/50 px-3 py-2">
        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
          {mode === "tranche" && `Par tranche — ${triees.length} opérations (séparateurs visuels)`}
          {mode === "charge" &&
            `Par chargé de clientèle — ${triees.length} opérations (séparateurs visuels)`}
          {mode === "detail" && `Détail — ${triees.length} opérations`}
        </p>
        {mode === "detail" && filtersActive(filters) ? (
          <button
            type="button"
            onClick={() => onFiltersChange(FILTRES_VIDES)}
            className="text-[10px] font-bold text-primary hover:underline"
          >
            Réinitialiser les filtres
          </button>
        ) : null}
      </div>

      {mode === "detail" ? (
        <div className="border-b px-3 py-2">
          <PspDetailFilters filters={filters} onChange={onFiltersChange} operations={operations} />
        </div>
      ) : null}

      <div className="max-h-[62vh] overflow-auto">
        <Table className="min-w-[1700px]">
          <TableHeader>
            <TableRow className="border-b bg-muted/50">
              {COLONNES.map((col, i) => (
                <TableHead
                  key={`${col.label}-${i}`}
                  className={cn(
                    "sticky top-0 z-10 whitespace-nowrap bg-muted/95 text-[10px] font-black uppercase tracking-widest",
                    col.align === "right" && "text-right",
                    col.cle && "cursor-pointer select-none hover:text-foreground",
                  )}
                  onClick={col.cle ? () => changerTri(col.cle as CleTri) : undefined}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.label}
                    {col.cle ? (
                      tri?.cle === col.cle ? (
                        tri.asc ? (
                          <ArrowUp className="size-3" />
                        ) : (
                          <ArrowDown className="size-3" />
                        )
                      ) : (
                        <ChevronsUpDown className="size-3 opacity-40" />
                      )
                    ) : null}
                  </span>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>

          <TableBody>
            {/* Ligne de saisie directe — VRAIE LIGNE, juste sous l'en-tête */}
            {quickAdd ? (
              <PspQuickAddRow
                programmationId={quickAdd.programmationId}
                reference={quickAdd.reference}
                onSaved={quickAdd.onSaved}
                figee={figee}
              />
            ) : null}

            {mode === "detail"
              ? triees.map((op) => (
                  <PspOperationRow
                    key={op.id}
                    op={op}
                    perimetres={perimetresParLigne.get(op.id) ?? []}
                    lotsParId={lotsParId}
                    onOpen={onOpenOperation}
                    onModifier={onModifier}
                    onDevis={onDevis}
                    onStatutPriorite={onStatutPriorite}
                    onNotes={onNotes}
                  />
                ))
              : null}

            {mode === "tranche"
              ? triees.map((op, i) => {
                  const precedent = i > 0 ? triees[i - 1] : null;
                  const nouveauGroupe = !precedent || precedent.tranche !== op.tranche;
                  return (
                    <Fragment key={op.id}>
                      {nouveauGroupe ? (
                        <SeparateurLigne
                          label={[`TR ${op.tranche}`, localiteTranche(op.tranche)]
                            .filter(Boolean)
                            .join(" — ")}
                        />
                      ) : null}
                      <PspOperationRow
                        op={op}
                        perimetres={perimetresParLigne.get(op.id) ?? []}
                        lotsParId={lotsParId}
                        onOpen={onOpenOperation}
                        onModifier={onModifier}
                        onDevis={onDevis}
                        onStatutPriorite={onStatutPriorite}
                        onNotes={onNotes}
                      />
                    </Fragment>
                  );
                })
              : null}

            {mode === "charge"
              ? triees.map((op, i) => {
                  const precedent = i > 0 ? triees[i - 1] : null;
                  const nouveauGroupe =
                    !precedent ||
                    (op.charge_clientele ?? "") !== (precedent.charge_clientele ?? "");
                  return (
                    <Fragment key={op.id}>
                      {nouveauGroupe ? (
                        <SeparateurLigne
                          label={op.charge_clientele || "Sans chargé de clientèle"}
                        />
                      ) : null}
                      <PspOperationRow
                        op={op}
                        perimetres={perimetresParLigne.get(op.id) ?? []}
                        lotsParId={lotsParId}
                        onOpen={onOpenOperation}
                        onModifier={onModifier}
                        onDevis={onDevis}
                        onStatutPriorite={onStatutPriorite}
                        onNotes={onNotes}
                      />
                    </Fragment>
                  );
                })
              : null}
          </TableBody>

          {mode === "detail" ? (
            <TableFooter>
              <TableRow>
                <TableCell colSpan={NB_COLS_DESCRIPTIVES} className="py-2 text-xs font-bold">
                  Total — {triees.length} opération{triees.length > 1 ? "s" : ""}
                </TableCell>
                {PSP_ANNEES.map((annee) => (
                  <TableCell key={annee} className="py-2 text-right">
                    <span className="tabnum text-xs font-bold">
                      {(parAnneeDetail[String(annee)] ?? 0) > 0
                        ? money0(parAnneeDetail[String(annee)] ?? 0)
                        : "—"}
                    </span>
                  </TableCell>
                ))}
                <TableCell className="py-2 text-right">
                  <span className="tabnum text-xs font-black text-primary">
                    {money0(totauxDetail.total)}
                  </span>
                </TableCell>
                <TableCell colSpan={NB_COLS_TRAILING} className="py-2" />
              </TableRow>
            </TableFooter>
          ) : null}
        </Table>
      </div>
    </div>
  );
}
