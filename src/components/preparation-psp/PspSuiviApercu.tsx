/**
 * V8.1 — SOCLE SUIVI : aperçu lecture seule d'une opération (test du socle).
 *
 * Consomme `getPspSuiviOperation` (vue métier agrégée : programmation +
 * consultation + commandes liées + exécution). Aucune écriture, aucun MOCK :
 * les sections vides affichent « Aucune donnée disponible ».
 * Interface volontairement minimale — le module final viendra en V8.2+.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Circle, CheckCircle2, GitBranch, Building2, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { money0 } from "@/lib/formats";
import { getPspSuiviOperation } from "@/lib/psp.prep.supabase.functions";

const fmtDate = (v: string | null | undefined): string =>
  v ? new Date(v).toLocaleDateString("fr-FR") : "—";

export default function PspSuiviApercu({ pspLigneId }: { pspLigneId: string }) {
  const fetchSuivi = useServerFn(getPspSuiviOperation);
  const { data, isLoading, error } = useQuery({
    queryKey: ["psp-suivi-operation", pspLigneId],
    queryFn: () => fetchSuivi({ data: { pspLigneId } }),
    staleTime: 1000 * 60 * 5,
    retry: 1,
  });

  return (
    <div className="rounded-lg border bg-card p-3">
      <p className="mb-2 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
        <GitBranch className="size-3.5" />
        Suivi — aperçu (socle V8.1)
      </p>

      {isLoading ? (
        <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Loader2 className="size-3 animate-spin" /> Chargement du suivi…
        </p>
      ) : error || !data ? (
        <p className="text-[11px] text-muted-foreground">Aucune donnée disponible.</p>
      ) : (
        <div className="space-y-3">
          {/* Synthèse du parcours (PROGRAMMÉ → … → TERMINÉ) */}
          <div className="flex flex-wrap gap-1.5">
            {data.synthese.map((etape) => (
              <span
                key={etape.code}
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-bold ${
                  etape.atteint
                    ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                    : "border-muted bg-muted/40 text-muted-foreground"
                }`}
              >
                {etape.atteint ? (
                  <CheckCircle2 className="size-2.5" />
                ) : (
                  <Circle className="size-2.5" />
                )}
                {etape.label}
              </span>
            ))}
          </div>

          {/* Statuts séparés : PSP / CONSULTATION / RAPPROCHEMENT / EXÉCUTION */}
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline" className="text-[10px]">
              PSP : {data.programmation.statut_psp_label}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              Consultation : {data.consultation.statut_label}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              Commande : {data.commandes.statut_rapprochement_label}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              Exécution : {data.execution.statut_label}
            </Badge>
            {data.consultation.relance_necessaire && (
              <Badge className="bg-amber-100 text-amber-800 text-[10px]">Relance nécessaire</Badge>
            )}
          </div>

          {/* Entreprises consultées (multi-devis) */}
          <div>
            <p className="mb-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              <Building2 className="size-3" />
              Entreprises consultées ({data.consultation.nb_entreprises_consultees})
            </p>
            {data.consultation.entreprises.length === 0 ? (
              <p className="text-[10px] text-muted-foreground">Aucune donnée disponible.</p>
            ) : (
              <ul className="space-y-1">
                {data.consultation.entreprises.map((e) => (
                  <li
                    key={e.fournisseur_id ?? e.entreprise}
                    className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded border border-dashed px-2 py-1 text-[10px]"
                  >
                    <span className="font-semibold">{e.entreprise}</span>
                    <span className="text-muted-foreground">
                      Demande : {fmtDate(e.date_demande)}
                    </span>
                    {e.date_devis && (
                      <span className="text-muted-foreground">Devis : {fmtDate(e.date_devis)}</span>
                    )}
                    <span>
                      {e.statut_consultation === "devis_retenu" ? "Devis retenu" : e.statut_devis}
                    </span>
                    <span className="font-semibold">
                      {e.montant == null ? "—" : money0(e.montant)}
                    </span>
                    {e.relance_necessaire && (
                      <Badge className="bg-amber-100 text-amber-800 text-[9px]">Relance</Badge>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Commandes rattachées */}
          <div>
            <p className="mb-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              <GitBranch className="size-3" />
              Commandes rattachées ({data.commandes.nb_commandes})
            </p>
            {data.commandes.liees.length === 0 ? (
              <p className="text-[10px] text-muted-foreground">Aucune donnée disponible.</p>
            ) : (
              <ul className="space-y-1">
                {data.commandes.liees.map((c) => (
                  <li
                    key={c.lien_id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded border border-dashed px-2 py-1 text-[10px]"
                  >
                    <span className="font-semibold">{c.numero_commande ?? "—"}</span>
                    <span className="text-muted-foreground">{c.entreprise ?? "—"}</span>
                    <span className="text-muted-foreground">
                      {c.budget == null ? "—" : money0(c.budget)}
                    </span>
                    <span className="text-muted-foreground">{c.etat_commande ?? "—"}</span>
                    <Badge variant="outline" className="text-[9px]">
                      {c.statut_rapprochement_label}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Financier agrégé (B programmé + C commandé/engagé/payé — sources réelles) */}
          <div className="grid grid-cols-2 gap-1.5 rounded border border-dashed p-2 text-[10px] sm:grid-cols-5">
            <div>
              <p className="text-muted-foreground">Programmé</p>
              <p className="font-semibold">{money0(data.programmation.montant_total)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Commandé</p>
              <p className="font-semibold">{money0(data.commandes.budget_commande)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Engagé</p>
              <p className="font-semibold">{money0(data.commandes.engage)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Payé</p>
              <p className="font-semibold">{money0(data.commandes.paye)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Reste</p>
              <p className="font-semibold">
                {money0(data.programmation.montant_total - data.commandes.engage)}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
