/**
 * V8.9.1 â€” REVUE DES ANCIENNES PROGRAMMATIONS (lecture seule).
 *
 * Source de vÃ©ritÃ© : `psp_lignes.programme` (multi-annÃ©es) â€” une entrÃ©e par
 * couple (opÃ©ration, annÃ©e < rÃ©fÃ©rence rÃ©ellement programmÃ©e). Aucune Ã©criture,
 * aucun mock, aucune donnÃ©e inventÃ©e : une ligne sans clÃ© historique n'apparaÃ®t
 * pas ; un devis/une commande seule ne crÃ©ent pas d'entrÃ©e.
 *
 * Badges :
 *  Â· Â« Sans commande Â» â€” aucune commande liÃ©e (psp_command_links vide) ;
 *  Â· Â« En cours Â» / Â« TerminÃ©e Â» / Â« Ã€ vÃ©rifier Â» â€” dÃ©rivÃ©s de l'Ã©tat rÃ©el
 *    de la commande liÃ©e (travaux_commandes, READ-ONLY).
 */
import { useMemo, useState } from "react";
import { Archive, Info } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { money0 } from "@/lib/formats";
import {
  ETAT_REVUE_ANCIENNE_LABEL,
  type EtatRevueAncienne,
  type RevueAncienneProgrammation,
} from "@/lib/psp.prep.suivi";
import { STATUT_CONSULTATION_PREP_LABELS, statutConsultationDepuisDevis } from "@/lib/psp.prep.v7";
import { cn } from "@/lib/utils";

const ETAT_BADGE: Record<EtatRevueAncienne, string> = {
  sans_commande: "border-amber-200 bg-amber-50 text-amber-700",
  en_cours: "border-blue-200 bg-blue-50 text-blue-700",
  terminee: "border-emerald-200 bg-emerald-50 text-emerald-700",
  a_verifier: "border-red-200 bg-red-50 text-red-600",
};

type FiltresRevueAnciennes = {
  etat: "toutes" | EtatRevueAncienne;
  annee: number | "toutes";
};

export default function PspRevueAnciennes({
  entrees,
  anneeReference,
}: {
  entrees: RevueAncienneProgrammation[];
  anneeReference: number;
}) {
  const [filtres, setFiltres] = useState<FiltresRevueAnciennes>({
    etat: "toutes",
    annee: "toutes",
  });

  const annees = useMemo(
    () => [...new Set(entrees.map((e) => e.annee))].sort((a, b) => a - b),
    [entrees],
  );

  const visibles = useMemo(
    () =>
      entrees.filter((e) => {
        if (filtres.etat !== "toutes" && e.etat !== filtres.etat) return false;
        if (filtres.annee !== "toutes" && e.annee !== filtres.annee) return false;
        return true;
      }),
    [entrees, filtres],
  );

  const comptes = useMemo(() => {
    const compte: Record<EtatRevueAncienne, number> = {
      sans_commande: 0,
      en_cours: 0,
      terminee: 0,
      a_verifier: 0,
    };
    for (const e of entrees) compte[e.etat]++;
    return compte;
  }, [entrees]);

  return (
    <Card className="shadow-panel">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <Archive className="size-4 text-muted-foreground" />
          Anciennes programmations rÃ©ellement conservÃ©es
          <span className="ml-auto text-[10px] font-black uppercase tracking-widest text-muted-foreground">
            source : psp_lignes.programme (annÃ©es &lt; {anneeReference})
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {entrees.length === 0 ? (
          <p className="flex items-center gap-1.5 rounded-lg border border-dashed px-3 py-4 text-xs text-muted-foreground">
            <Info className="size-3.5" />
            Aucune ancienne programmation rÃ©ellement conservÃ©e dans psp_lignes.programme pour
            cette annÃ©e de rÃ©fÃ©rence. Aucune donnÃ©e n'est reconstituÃ©e.
          </p>
        ) : (
          <>
            {/* Filtres */}
            <div className="flex flex-wrap items-center gap-1.5">
              {(["toutes", "sans_commande", "en_cours", "terminee", "a_verifier"] as const).map(
                (etat) => (
                  <button
                    key={etat}
                    type="button"
                    onClick={() => setFiltres((f) => ({ ...f, etat }))}
                    className={cn(
                      "rounded-full border px-2.5 py-0.5 text-[11px] font-bold transition-colors",
                      etat === "toutes" && "border-slate-200 bg-slate-100 text-slate-700",
                      etat === "sans_commande" && ETAT_BADGE.sans_commande,
                      etat === "en_cours" && ETAT_BADGE.en_cours,
                      etat === "terminee" && ETAT_BADGE.terminee,
                      etat === "a_verifier" && ETAT_BADGE.a_verifier,
                      filtres.etat === etat && "ring-2 ring-primary ring-offset-1",
                    )}
                  >
                    {etat === "toutes"
                      ? `Toutes (${entrees.length})`
                      : `${comptes[etat]} ${ETAT_REVUE_ANCIENNE_LABEL[etat].toLowerCase()}`}
                  </button>
                ),
              )}
              <select
                value={filtres.annee === "toutes" ? "toutes" : String(filtres.annee)}
                onChange={(e) =>
                  setFiltres((f) => ({
                    ...f,
                    annee: e.target.value === "toutes" ? "toutes" : Number(e.target.value),
                  }))
                }
                className="h-7 rounded-md border bg-card px-2 text-[11px] focus:outline-none"
              >
                <option value="toutes">Toutes annÃ©es</option>
                {annees.map((a) => (
                  <option key={a} value={String(a)}>
                    {a}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-2 overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>TR</TableHead>
                    <TableHead>Adresse</TableHead>
                    <TableHead>Descriptif</TableHead>
                    <TableHead>Corps d'Ã©tat</TableHead>
                    <TableHead className="text-right">AnnÃ©e</TableHead>
                    <TableHead className="text-right">Montant programmÃ©</TableHead>
                    <TableHead>Origine</TableHead>
                    <TableHead>Commande</TableHead>
                    <TableHead>Ã‰tat</TableHead>
                    <TableHead>Consultation / Devis</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibles.map((e, i) => (
                    <TableRow key={`${e.pspLigneId}-${e.annee}-${i}`}>
                      <TableCell className="font-mono text-xs font-bold">{e.tranche}</TableCell>
                      <TableCell className="text-[11px]">{e.adresse ?? "â€”"}</TableCell>
                      <TableCell className="text-[11px]">{e.nature ?? "â€”"}</TableCell>
                      <TableCell className="text-[11px]">{e.corps_etat ?? "â€”"}</TableCell>
                      <TableCell className="text-right text-xs font-bold">{e.annee}</TableCell>
                      <TableCell className="text-right tabnum text-xs">
                        {money0(e.montant)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[9px]">
                          {e.origine}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-[11px]">
                        {e.commande ? (
                          <>
                            <p className="font-semibold">{e.commande.numero_commande}</p>
                            {e.commande.etat_commande ? (
                              <p className="text-[9px] text-muted-foreground">
                                {e.commande.etat_commande}
                              </p>
                            ) : null}
                          </>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">Sans commande</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge className={ETAT_BADGE[e.etat]}>
                          {ETAT_REVUE_ANCIENNE_LABEL[e.etat]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-[11px]">
                        {e.devis.length > 0 ? (
                          <>
                            <Badge className="mb-1 text-[9px]">
                              {
                                STATUT_CONSULTATION_PREP_LABELS[
                                  statutConsultationDepuisDevis(e.devis).code
                                ]
                              }
                            </Badge>
                            <ul className="space-y-0.5">
                              {e.devis.map((d, j) => (
                                <li key={j} className="flex items-center gap-1">
                                  <span className="text-[10px]">{d.entreprise ?? "â€”"}</span>
                                  <Badge variant="outline" className="text-[9px]">
                                    {d.statut}
                                  </Badge>
                                  {d.montant != null ? (
                                    <span className="tabnum text-[10px]">{money0(d.montant)}</span>
                                  ) : null}
                                </li>
                              ))}
                            </ul>
                          </>
                        ) : (
                          <span className="text-muted-foreground">Aucune demande</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {visibles.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={10}
                        className="py-4 text-center text-xs text-muted-foreground"
                      >
                        Aucune entrÃ©e pour ces filtres.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </div>
            <p className="mt-1.5 text-[10px] text-muted-foreground">
              {visibles.length} entrÃ©e(s) affichÃ©e(s) sur {entrees.length} â€” une entrÃ©e par
              couple (opÃ©ration, annÃ©e &lt; {anneeReference} rÃ©ellement programmÃ©e). Ã‰tats
              dÃ©rivÃ©s de la commande liÃ©e ; Â« Sans commande Â» = aucune commande liÃ©e
              (psp_command_links).
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
