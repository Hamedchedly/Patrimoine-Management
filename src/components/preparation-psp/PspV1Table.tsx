/**
 * V1 VISUELLE — Tableau structuré de la programmation PSP (données RÉELLES).
 *
 * · Colonnes fixes d'IDENTIFICATION (TR, adresse, descriptif, corps d'état,
 *   ligne budgétaire) ;
 * · colonnes ANNÉES 2027-2031 + total (scroll horizontal) ;
 * · consultation/devis dérivés (statut psp_devis) + statut de préparation ;
 * · UNE opération multi-années = UNE ligne (aucune deuxième psp_ligne) ;
 * · cellule sans montant ≠ cellule programmée (visuellement distinctes).
 */
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown, Layers } from "lucide-react";

import PspSecteurBadge from "@/components/preparation-psp/PspSecteurBadge";
import PspV1QuickAddRow from "@/components/preparation-psp/PspV1QuickAddRow";
import { Badge } from "@/components/ui/badge";
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
import { PSP_ANNEES, montantAnnee, totalOperation, type PspOperation } from "@/lib/psp.prep";
import { statutConsultationDepuisDevis } from "@/lib/psp.prep.v7";
import { cn } from "@/lib/utils";

const STATUT_PSP_STYLES: Record<string, string> = {
  a_definir: "border-amber-200 bg-amber-50 text-amber-800",
  attente_agence: "border-blue-200 bg-blue-50 text-blue-800",
  attente_confirmation: "border-violet-200 bg-violet-50 text-violet-800",
};

const CONSULTATION_STYLES: Record<string, string> = {
  aucune: "border-slate-200 bg-slate-50 text-slate-600",
  a_demander: "border-amber-200 bg-amber-50 text-amber-700",
  demande_envoyee: "border-emerald-200 bg-emerald-50 text-emerald-700",
  devis_recu: "border-emerald-200 bg-emerald-50 text-emerald-700",
  devis_retenu: "border-emerald-300 bg-emerald-100 text-emerald-800",
};

type CleTriV1 = "tranche" | "nature" | "adresse" | "corps_etat" | "total";

const trier = (ops: PspOperation[], cle: CleTriV1, asc: boolean): PspOperation[] => {
  const valeur = (o: PspOperation): string | number => {
    switch (cle) {
      case "tranche":
        return o.tranche;
      case "nature":
        return o.nature_travaux ?? "";
      case "adresse":
        return o.adresse ?? "";
      case "corps_etat":
        return o.corps_etat ?? "";
      case "total":
        return totalOperation(o);
    }
  };
  const dir = asc ? 1 : -1;
  return [...ops].sort((a, b) => {
    const va = valeur(a);
    const vb = valeur(b);
    if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
    return String(va).localeCompare(String(vb), "fr", { sensitivity: "base" }) * dir;
  });
};

const NB_IDENTIFICATION = 6; // TR, C, adresse, descriptif, corps, LB

export default function PspV1Table({
  operations,
  totalParAnnee,
  onOpen,
  ajoutOuvert,
  reference,
  programmationId,
  onSaved,
  onAnnuler,
}: {
  operations: PspOperation[];
  totalParAnnee: Record<string, number>;
  onOpen: (id: string) => void;
  /** V1 — ligne d'ajout direct (même workflow que /preparation-psp). */
  ajoutOuvert?: boolean;
  reference?: import("@/lib/psp.prep.data").ReferencePatrimoine | null;
  programmationId?: string | null;
  onSaved?: () => void;
  onAnnuler?: () => void;
}) {
  const [tri, setTri] = useState<{ cle: CleTriV1; asc: boolean }>({ cle: "tranche", asc: true });

  const triees = useMemo(() => trier(operations, tri.cle, tri.asc), [operations, tri]);
  const trierSur = (cle: CleTriV1) =>
    setTri((t) => (t.cle === cle ? { cle, asc: !t.asc } : { cle, asc: true }));
  const fleche = (cle: CleTriV1) =>
    tri.cle === cle ? (
      tri.asc ? (
        <ArrowUp className="size-3" />
      ) : (
        <ArrowDown className="size-3" />
      )
    ) : (
      <ChevronsUpDown className="size-3 text-muted-foreground/50" />
    );

  const totalGlobal = operations.reduce((s, o) => s + totalOperation(o), 0);

  const headerTd = (cle: CleTriV1, label: string, align?: "right") => (
    <TableHead
      className={cn(
        "cursor-pointer select-none whitespace-nowrap text-[10px]",
        align === "right" && "text-right",
      )}
      onClick={() => trierSur(cle)}
    >
      <span className="inline-flex items-center gap-1">
        {label} {fleche(cle)}
      </span>
    </TableHead>
  );

  return (
    <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
      <Table>
        <TableHeader>
          <TableRow>
            {headerTd("tranche", "TR")}
            <TableHead className="w-[40px] text-[10px]">C</TableHead>
            {headerTd("adresse", "Adresse")}
            {headerTd("nature", "Descriptif")}
            {headerTd("corps_etat", "Corps d'état")}
            <TableHead className="whitespace-nowrap text-[10px]">Ligne budgétaire</TableHead>
            {PSP_ANNEES.map((a) => (
              <TableHead key={a} className="whitespace-nowrap text-right text-[10px]">
                {a}
              </TableHead>
            ))}
            {headerTd("total", "Total", "right")}
            <TableHead className="whitespace-nowrap text-[10px]">Consultation</TableHead>
            <TableHead className="whitespace-nowrap text-[10px]">Statut</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ajoutOuvert && programmationId ? (
            <PspV1QuickAddRow
              programmationId={programmationId}
              reference={reference ?? null}
              onSaved={onSaved ?? (() => undefined)}
              onAnnuler={onAnnuler ?? (() => undefined)}
            />
          ) : null}
          {triees.map((op) => {
            const consultation = statutConsultationDepuisDevis(op.devis);
            const statut = op.statut ?? "a_definir";
            const adresse = [op.adresse, op.ville].filter(Boolean).join(" – ") || null;
            return (
              <TableRow
                key={op.id}
                className="cursor-pointer transition-colors hover:bg-primary/5"
                onClick={() => onOpen(op.id)}
                title="Ouvrir la fiche opération (workflow réel)"
              >
                <TableCell className="sticky left-0 z-10 bg-card font-mono text-xs font-bold">
                  {op.tranche}
                </TableCell>
                <TableCell className="py-2">
                  <PspSecteurBadge categorie={op.categorie} />
                </TableCell>
                <TableCell className="max-w-[200px] py-2">
                  <span className="block truncate text-[11px]" title={adresse ?? ""}>
                    {adresse ?? "—"}
                  </span>
                </TableCell>
                <TableCell className="max-w-[220px] py-2">
                  <span className="block truncate text-[11px]" title={op.nature_travaux ?? ""}>
                    {op.nature_travaux ?? "—"}
                  </span>
                </TableCell>
                <TableCell className="max-w-[140px] py-2">
                  <span className="block truncate text-[11px]" title={op.corps_etat ?? ""}>
                    {op.corps_etat ?? "—"}
                  </span>
                </TableCell>
                <TableCell className="py-2 font-mono text-[11px]">
                  {op.ligne_budget ?? "—"}
                </TableCell>
                {PSP_ANNEES.map((a) => {
                  const montant = montantAnnee(op, a);
                  return (
                    <TableCell
                      key={a}
                      className={cn(
                        "py-2 text-right tabnum text-[11px]",
                        montant > 0 ? "font-semibold text-foreground" : "text-muted-foreground/60",
                      )}
                    >
                      {montant > 0 ? money0(montant) : "—"}
                    </TableCell>
                  );
                })}
                <TableCell className="py-2 text-right tabnum text-xs font-black text-primary">
                  {money0(totalOperation(op))}
                </TableCell>
                <TableCell className="py-2">
                  <Badge className={cn("text-[9px]", CONSULTATION_STYLES[consultation.code] ?? "")}>
                    {consultation.label}
                  </Badge>
                </TableCell>
                <TableCell className="py-2">
                  <Badge className={cn("text-[9px]", STATUT_PSP_STYLES[statut] ?? "")}>
                    {statut}
                  </Badge>
                </TableCell>
              </TableRow>
            );
          })}
          {triees.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={NB_IDENTIFICATION + PSP_ANNEES.length + 4}
                className="py-6 text-center text-xs text-muted-foreground"
              >
                Aucune opération programmée pour ces critères.
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>

        {triees.length > 0 ? (
          <TableFooter>
            <TableRow>
              <TableCell
                colSpan={NB_IDENTIFICATION}
                className="py-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground"
              >
                Total — {triees.length} opération(s)
              </TableCell>
              {PSP_ANNEES.map((a) => (
                <TableCell key={a} className="py-2 text-right">
                  <span className="tabnum text-[11px] font-bold">
                    {(totalParAnnee[String(a)] ?? 0) > 0
                      ? money0(totalParAnnee[String(a)] ?? 0)
                      : "—"}
                  </span>
                </TableCell>
              ))}
              <TableCell className="py-2 text-right">
                <span className="tabnum text-xs font-black text-primary">
                  {money0(totalGlobal)}
                </span>
              </TableCell>
              <TableCell colSpan={2} className="py-2" />
            </TableRow>
          </TableFooter>
        ) : null}
      </Table>
      <p className="flex items-center gap-1.5 border-t px-3 py-1.5 text-[9px] text-muted-foreground">
        <Layers className="size-3" />
        Une ligne = une opération (une psp_ligne) · montants 2027-2031 par année · « — » = année non
        programmée · clic sur une ligne → fiche opération (prototype, lecture seule).
      </p>
    </div>
  );
}
