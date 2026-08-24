/**
 * V8.6 §4 — CORRESPONDANCE D'UNE COMMANDE IMPORTÉE AVEC LES OPÉRATIONS EXISTANTES.
 *
 * Flux anti-doublon : opération existante → commande importée ultérieurement →
 * PAT S11 propose l'opération existante (recherche inversée via
 * `rechercherOperationsPourCommande`, qui réutilise EXCLUSIVEMENT le moteur
 * V8.5.1 `suggererOperationsPourCommande`). L'utilisateur confirme →
 * `createPspCommandLink` (UNIQUE écriture, psp_command_links). AUCUNE nouvelle
 * psp_ligne n'est jamais créée par ce flux.
 *
 * Affiche le message clair « Cette commande semble correspondre à une opération
 * existante » avec TR, adresse, corps d'état, nature, montant, entreprise,
 * année, score, raisons et conflits éventuels. Aucun rattachement automatique.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, FileSearch, Loader2 } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  createPspCommandLink,
  rechercherOperationsPourCommande,
} from "@/lib/psp.prep.supabase.functions";
import { libelleEntreprise } from "@/lib/psp.prep.v7";
import { determinerRelationPeriode } from "@/lib/psp.suivi.rapprochement";

const fmtMontant = (v: number | null | undefined): string => {
  if (v == null) return "—";
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(v);
};

const NIVEAU_LABEL: Record<string, string> = {
  AUTO: "Correspondance forte",
  A_CONFIRMER: "À confirmer",
  MANUEL: "Correspondance faible",
  NON_RAPPROCHE: "Non rapprochée",
};

type CommandeCible = {
  id: string;
  numero_commande: string | null;
  tranche_code: string | null;
  adresse: string | null;
  corps_etat: string | null;
  descriptif: string | null;
  fournisseur: string | null;
  numero_fournisseur: string | null;
  budget: number | null;
  annee_exercice: number | null;
};

type PropositionCommande = {
  operationId: string;
  commandeId: string;
  score: number;
  niveau: "AUTO" | "A_CONFIRMER" | "MANUEL" | "NON_RAPPROCHE";
  raisons: string[];
  conflits: string[];
  criteres: Record<string, string>;
  dejaLie: boolean;
  operationLieeId: string | null;
  methodeLien: string | null;
  statutLien: string | null;
  annees_programmation: number[];
  operation: {
    id: string;
    tranche_code: string | null;
    corps_etat: string | null;
    nature_travaux: string | null;
    origine: string | null;
    montant_total: number | null;
    adresse: string | null;
  } | null;
};

/** Conflits bloquants identifiés par le moteur V8.5.1 (rattachement resté possible). */
const estConflitBloquant = (p: PropositionCommande): string[] =>
  (p.conflits ?? []).filter(
    (c) =>
      c.includes("TR différente") ||
      c.includes("Corps d'état différent") ||
      c.includes("Descriptif différent") ||
      c.includes("Entreprise explicitement") ||
      c.includes("Différence de montant > 30 %") ||
      c.includes("déjà liée"),
  );

export default function PspCorrespondanceCommandeDialog({
  commandeId,
  open,
  onClose,
  onRattache,
}: {
  commandeId: string;
  open: boolean;
  onClose: () => void;
  /** V8.6 — rafraîchit le registre / la fiche après un rattachement humain. */
  onRattache?: () => Promise<void>;
}) {
  const charger = useServerFn(rechercherOperationsPourCommande);
  const creerLien = useServerFn(createPspCommandLink);

  const { data, isLoading } = useQuery({
    queryKey: ["psp-cmd-correspondance", commandeId],
    queryFn: () => charger({ data: { commandeId } }),
    enabled: open && !!commandeId,
    staleTime: 1000 * 60 * 5,
    retry: 1,
  });

  const commande = (data?.commande ?? null) as CommandeCible | null;
  const propositions = (data?.propositions ?? []) as PropositionCommande[];

  const [aRattacher, setARattacher] = useState<PropositionCommande | null>(null);
  const [rattachee, setRattachee] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const dejaLiee = propositions.length > 0 && propositions.every((p) => p.dejaLie);

  const confirmerRattachement = async () => {
    if (!aRattacher || busy) return;
    setBusy(true);
    setErreur(null);
    try {
      await creerLien({
        data: {
          commandeId,
          pspLigneId: aRattacher.operationId,
          justification:
            "Rattachement manuel — la commande importée correspond à une opération existante (V8.6)",
        },
      });
      setRattachee(aRattacher.operationId);
      setARattacher(null);
      if (onRattache) await onRattache();
    } catch (e) {
      setErreur((e as Error)?.message ?? "Le rattachement n'a pas pu être enregistré.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
        <DialogContent className="w-[min(94vw,760px)]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <FileSearch className="size-4 text-primary" />
              Commande {commande?.numero_commande ?? "—"} — opérations existantes
            </DialogTitle>
          </DialogHeader>

          {/* La commande importée (lecture seule, jamais modifiée). */}
          {commande && (
            <div className="rounded border border-dashed px-2 py-1.5 text-[11px]">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                <Badge variant="outline">{commande.tranche_code ?? "TR —"}</Badge>
                <span className="font-semibold">
                  {libelleEntreprise(commande.fournisseur, commande.numero_fournisseur)}
                </span>
                <span>Commandé : {fmtMontant(commande.budget)}</span>
                <span>Exercice : {commande.annee_exercice ?? "—"}</span>
              </div>
              <div className="mt-0.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground sm:grid-cols-3">
                <span>{commande.adresse ?? "Adresse —"}</span>
                <span>{commande.corps_etat ?? "Corps d'état —"}</span>
                <span className="col-span-2">{commande.descriptif ?? "Descriptif —"}</span>
              </div>
            </div>
          )}

          {isLoading && (
            <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <Loader2 className="size-3 animate-spin" /> Analyse des correspondances…
            </p>
          )}

          {!isLoading && commande && propositions.length === 0 && (
            <div className="rounded border border-dashed px-3 py-2 text-[11px]">
              <p className="font-semibold">
                Aucune correspondance fiable trouvée pour cette commande.
              </p>
              <p className="mt-0.5 text-muted-foreground">
                La commande importée reste consultable. Si elle correspond à une opération
                existante, utilisez « Rechercher une commande » depuis la fiche pour la rattacher
                manuellement.
              </p>
            </div>
          )}

          {!isLoading && propositions.length > 0 && (
            <>
              {/* Message central du flux anti-doublon (§4). */}
              <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-[11px]">
                <p className="flex items-center gap-1.5 font-black text-amber-800">
                  <AlertTriangle className="size-3.5" />
                  {dejaLiee
                    ? "Cette commande est déjà rattachée à une opération existante."
                    : "Cette commande semble correspondre à une opération existante."}
                </p>
                <p className="mt-0.5 text-amber-700">
                  Un rattachement ne crée JAMAIS une nouvelle opération : seul un lien{" "}
                  <span className="font-semibold">psp_command_links</span> est créé, après
                  confirmation humaine. La commande importée reste intacte dans sa table source.
                </p>
              </div>

              <ul className="max-h-[46vh] space-y-2 overflow-y-auto pr-1">
                {propositions.map((p) => {
                  const operation = p.operation;
                  const bloquants = estConflitBloquant(p);
                  const periode = determinerRelationPeriode(
                    p.annees_programmation ?? [],
                    commande?.annee_exercice ?? null,
                    null,
                  );
                  const rattache = rattachee === p.operationId;
                  return (
                    <li
                      key={p.operationId}
                      className="rounded border border-dashed px-2 py-1.5 text-[11px]"
                    >
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                        <span className="font-bold">TR {operation?.tranche_code ?? "—"}</span>
                        <Badge variant="outline">
                          {operation?.origine === "hors_psp" ? "Hors PSP" : "PSP"}
                        </Badge>
                        <Badge
                          variant={
                            p.niveau === "AUTO"
                              ? "default"
                              : p.niveau === "A_CONFIRMER"
                                ? "secondary"
                                : "outline"
                          }
                        >
                          {NIVEAU_LABEL[p.niveau] ?? p.niveau} · {Math.round(p.score)} %
                        </Badge>
                        {p.dejaLie ? (
                          <Badge variant="default">Déjà rattachée</Badge>
                        ) : rattache ? (
                          <Badge className="bg-emerald-100 text-emerald-800">Rattachée</Badge>
                        ) : null}
                        <span className="text-muted-foreground">{periode.libelle}</span>
                      </div>
                      <div className="mt-0.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground sm:grid-cols-3">
                        <span>Adresse : {operation?.adresse ?? "—"}</span>
                        <span>Corps d'état : {operation?.corps_etat ?? "—"}</span>
                        <span>Nature : {operation?.nature_travaux ?? "—"}</span>
                        <span>Programmé : {fmtMontant(operation?.montant_total)}</span>
                        <span>
                          Entreprise :{" "}
                          {libelleEntreprise(commande?.fournisseur, commande?.numero_fournisseur)}
                        </span>
                        <span>
                          Année commande : {commande?.annee_exercice ?? "—"}
                          {p.annees_programmation?.length
                            ? ` · Programmation : ${p.annees_programmation.join(", ")}`
                            : " · Aucune année de programmation"}
                        </span>
                      </div>
                      {p.raisons?.length > 0 && (
                        <ul className="mt-1 space-y-0.5 border-t border-dashed pt-1 text-[10px] text-emerald-700">
                          {p.raisons.map((r) => (
                            <li key={r}>✓ {r}</li>
                          ))}
                        </ul>
                      )}
                      {p.conflits?.length > 0 && (
                        <ul className="mt-1 space-y-0.5 border-t border-dashed pt-1 text-[10px] text-amber-700">
                          {p.conflits.map((c) => (
                            <li key={c}>⚠ {c}</li>
                          ))}
                        </ul>
                      )}
                      <div className="mt-1 flex items-center gap-2">
                        {!p.dejaLie && !rattache ? (
                          <Button
                            size="sm"
                            className="h-6 text-[10px]"
                            disabled={busy}
                            onClick={() => setARattacher(p)}
                          >
                            Rattacher cette commande à l'opération TR{" "}
                            {operation?.tranche_code ?? "—"}
                          </Button>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">
                            {p.dejaLie
                              ? "Commande déjà liée (opération existante) — aucune modification automatique."
                              : "Rattachement enregistré."}
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {erreur && <p className="text-[11px] font-semibold text-red-700">{erreur}</p>}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!aRattacher} onOpenChange={(o) => !o && !busy && setARattacher(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Rattacher la commande {commande?.numero_commande ?? ""} à l'opération TR{" "}
              {aRattacher?.operation?.tranche_code ?? ""} ?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {aRattacher && (
                <div className="space-y-1 text-[11px]">
                  <p>
                    Commande :{" "}
                    {libelleEntreprise(commande?.fournisseur, commande?.numero_fournisseur)} ·
                    Commandé : {fmtMontant(commande?.budget)} · Exercice :{" "}
                    {commande?.annee_exercice ?? "—"}
                  </p>
                  <p>
                    Opération existante : TR {aRattacher.operation?.tranche_code ?? "—"} · Score :{" "}
                    {Math.round(aRattacher.score)} % ·{" "}
                    {NIVEAU_LABEL[aRattacher.niveau] ?? aRattacher.niveau}
                  </p>
                  {estConflitBloquant(aRattacher).length > 0 && (
                    <p className="font-semibold text-amber-700">
                      Des incohérences ont été détectées (TR, corps d'état, montant, entreprise,
                      etc.). Vous êtes sur le point de créer un rattachement manuel malgré ces
                      différences.
                    </p>
                  )}
                  <p className="text-muted-foreground">
                    Seul un lien psp_command_links est créé : la commande importée, les imports et
                    les tables d'exécution restent INTACTS. Aucune nouvelle opération n'est créée.
                  </p>
                </div>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Annuler</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={confirmerRattachement}>
              {busy ? "Enregistrement…" : "Confirmer le rattachement"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
