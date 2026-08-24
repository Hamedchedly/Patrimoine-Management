/**
 * V8.5.4 — PANNEAU « COMMANDES À RAPPROCHER » (dans /suivi).
 *
 * Un seul bloc compact : décomptes (total, fortes, à confirmer, faibles,
 * sans correspondance, déjà rattachées) + liste des commandes. Le calcul est
 * fait côté serveur (batch — pas de N+1) via `getPspCommandesARapprocher`,
 * qui réutilise le moteur V8.5.1. Aucune liaison automatique.
 */
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { FileSearch, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getPspCommandesARapprocher } from "@/lib/psp.prep.supabase.functions";
import PspCorrespondanceCommandeDialog from "@/components/suivi/PspCorrespondanceCommandeDialog";

type LigneCompacte = {
  commande: {
    id: string;
    numero_commande: string | null;
    tranche_code: string | null;
    adresse: string | null;
    budget: number | null;
    annee_exercice: number | null;
    etat_travaux: string | null;
  };
  etat: "deja_rattachee" | "proposition_forte" | "a_confirmer" | "faible" | "sans_correspondance";
  meilleure_proposition: {
    operationId: string;
    score: number;
    niveau: string;
    operation: { id: string; tranche_code: string | null; adresse: string | null } | null;
  } | null;
  operation_liee: {
    id: string;
    tranche_code: string | null;
    adresse: string | null;
    methode: string | null;
    statut: string | null;
  } | null;
  periode: { type: string; libelle: string } | null;
};

const fmtMontant = (v: number | null | undefined): string => {
  if (v == null) return "—";
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(v);
};

const LIBELLES_ETAT: Record<
  LigneCompacte["etat"],
  { label: string; badge: "default" | "outline" | "secondary" | "destructive" }
> = {
  deja_rattachee: { label: "Déjà rattachée", badge: "default" },
  proposition_forte: { label: "Proposition forte", badge: "outline" },
  a_confirmer: { label: "À confirmer", badge: "secondary" },
  faible: { label: "Faible", badge: "outline" },
  sans_correspondance: { label: "Sans correspondance", badge: "destructive" },
};

export default function PspCommandesARapprocherPanel({
  open,
  onClose,
  onExaminer,
}: {
  open: boolean;
  onClose: () => void;
  /** Ouvre la fiche d'une opération (identifiée par psp_lignes.id). */
  onExaminer: (pspLigneId: string) => void;
}) {
  const charger = useServerFn(getPspCommandesARapprocher);
  const [data, setData] = useState<{
    total: number;
    propositions_fortes: number;
    propositions_a_confirmer: number;
    correspondances_faibles: number;
    sans_correspondance: number;
    deja_rattachees: number;
    commandes: LigneCompacte[];
  } | null>(null);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  // V8.6 §4 — correspondance détaillée d'une commande avec les opérations existantes.
  const [commandeCorrespondance, setCommandeCorrespondance] = useState<string | null>(null);

  const ouvrir = async () => {
    if (data) return;
    setChargement(true);
    setErreur(null);
    try {
      const res = await charger({ data: {} });
      setData(res as unknown as typeof data);
    } catch (e) {
      setErreur((e as Error)?.message ?? "Chargement impossible.");
    } finally {
      setChargement(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? ouvrir() : onClose())}>
      <DialogContent className="w-[min(94vw,760px)]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <FileSearch className="size-4" /> Commandes à rapprocher
          </DialogTitle>
          <DialogDescription className="text-[11px]">
            Propositions issues du moteur de rapprochement — aucune liaison automatique.
            L'utilisateur garde l'autorité métier.
          </DialogDescription>
        </DialogHeader>
        {erreur && <p className="text-[11px] font-semibold text-red-700">{erreur}</p>}
        {chargement && (
          <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <Loader2 className="size-3 animate-spin" /> Analyse des commandes…
          </p>
        )}

        {data && (
          <>
            <div className="grid grid-cols-2 gap-1.5 rounded-lg border bg-muted/30 p-2 sm:grid-cols-3">
              <div className="rounded border bg-card px-2 py-1">
                <p className="text-[9px] text-muted-foreground">Total commandes</p>
                <p className="text-sm font-bold">{data.total}</p>
              </div>
              <div className="rounded border bg-card px-2 py-1">
                <p className="text-[9px] text-muted-foreground">Propositions fortes</p>
                <p className="text-sm font-bold text-green-700">{data.propositions_fortes}</p>
              </div>
              <div className="rounded border bg-card px-2 py-1">
                <p className="text-[9px] text-muted-foreground">À confirmer</p>
                <p className="text-sm font-bold text-amber-700">{data.propositions_a_confirmer}</p>
              </div>
              <div className="rounded border bg-card px-2 py-1">
                <p className="text-[9px] text-muted-foreground">Faibles</p>
                <p className="text-sm font-bold">{data.correspondances_faibles}</p>
              </div>
              <div className="rounded border bg-card px-2 py-1">
                <p className="text-[9px] text-muted-foreground">Sans correspondance</p>
                <p className="text-sm font-bold text-red-700">{data.sans_correspondance}</p>
              </div>
              <div className="rounded border bg-card px-2 py-1">
                <p className="text-[9px] text-muted-foreground">Déjà rattachées</p>
                <p className="text-sm font-bold text-blue-700">{data.deja_rattachees}</p>
              </div>
            </div>

            <ul className="max-h-[46vh] space-y-1.5 overflow-y-auto">
              {data.commandes.map((c) => {
                const etat = LIBELLES_ETAT[c.etat];
                const cible =
                  c.etat === "deja_rattachee"
                    ? c.operation_liee
                    : (c.meilleure_proposition?.operation ?? null);
                const score = c.meilleure_proposition?.score ?? null;
                return (
                  <li
                    key={c.commande.id}
                    className="rounded border border-dashed px-2 py-1.5 text-[11px]"
                  >
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-bold">{c.commande.numero_commande ?? "—"}</span>
                      <Badge variant={etat.badge}>{etat.label}</Badge>
                      {c.etat === "deja_rattachee" ? (
                        <span className="text-muted-foreground">
                          → {c.operation_liee?.tranche_code ?? "TR —"} ·{" "}
                          {c.operation_liee?.adresse ?? "Adresse —"} (
                          {c.operation_liee?.methode ?? "manuel"} · {c.operation_liee?.statut ?? ""}
                          )
                        </span>
                      ) : c.meilleure_proposition ? (
                        <span className="text-muted-foreground">
                          TR proposé : {c.meilleure_proposition.operation?.tranche_code ?? "—"} ·
                          Score : {Math.round(score ?? 0)} %
                        </span>
                      ) : (
                        <span className="text-muted-foreground">
                          Aucune correspondance fiable trouvée.
                        </span>
                      )}
                      {c.periode && (
                        <span className="text-muted-foreground">
                          {c.periode.type === "historique" ? "⚠ " : ""}
                          {c.periode.libelle}
                        </span>
                      )}
                      <span className="ml-auto flex items-center gap-2">
                        {c.etat !== "deja_rattachee" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-[10px]"
                            onClick={() => setCommandeCorrespondance(c.commande.id)}
                          >
                            Correspondance
                          </Button>
                        )}
                        {cible && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-[10px]"
                            onClick={() => onExaminer(cible.id)}
                          >
                            Examiner
                          </Button>
                        )}
                        <span className="text-[10px] text-muted-foreground">
                          {c.commande.tranche_code ?? "TR —"} · {fmtMontant(c.commande.budget)} ·
                          Exercice {c.commande.annee_exercice ?? "—"}
                        </span>
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        {commandeCorrespondance && (
          <PspCorrespondanceCommandeDialog
            commandeId={commandeCorrespondance}
            open={!!commandeCorrespondance}
            onClose={() => setCommandeCorrespondance(null)}
            onRattache={async () => {
              // V8.6 — après rattachement, le panneau se referme ; le registre sera
              // rafraîchi au prochain chargement (aucune écriture ici).
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
