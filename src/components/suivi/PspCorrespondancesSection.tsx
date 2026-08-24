/**
 * V8.5.3 â€” REVUE DES CORRESPONDANCES COMMANDES (avec validation manuelle).
 *
 * Affiche les propositions du moteur V8.5.1 et permet de RATTACHER MANUELLEMENT
 * une commande Ã  l'opÃ©ration (via createPspCommandLink / deletePspCommandLink).
 * Le moteur ne rattache jamais automatiquement. Les tables d'import/exÃ©cution
 * restent INTANGIBLES â€” seul psp_command_links est Ã©crit par ce workflow.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { FileSearch, Link2, Unlink } from "lucide-react";

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
import {
  createPspCommandLink,
  deletePspCommandLink,
  getPspCorrespondances,
} from "@/lib/psp.prep.supabase.functions";
import { deriverExerciceCorrespondance } from "@/lib/psp.suivi.rapprochement";

const fmtMontant = (v: number | null | undefined): string => {
  if (v == null) return "â€”";
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(v);
};

const NIVEAU_LABEL: Record<string, string> = {
  AUTO: "Correspondance forte",
  A_CONFIRMER: "Ã€ confirmer",
  MANUEL: "Correspondance faible",
  NON_RAPPROCHE: "Non rapprochÃ©e",
};

type CommandeRevue = {
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

type PropositionRevue = {
  operationId: string;
  commandeId: string;
  lienId: string | null;
  score: number;
  niveau: string;
  raisons: string[];
  conflits: string[];
  criteres: Record<string, string> | null;
  candidatsAlternatifs: { operationId: string; score: number }[] | null;
  dejaLie: boolean;
  methodeLien: string | null;
  statutLien: string | null;
  commande: CommandeRevue | null;
};

/** Conflits bloquants identifiÃ©s par V8.5.1 (rattachement manuel restÃ© possible). */
const estConflitBloquant = (p: PropositionRevue): string[] =>
  (p.conflits ?? []).filter(
    (c) =>
      c.includes("TR diffÃ©rente") ||
      c.includes("Corps d'Ã©tat diffÃ©rent") ||
      c.includes("Descriptif diffÃ©rent") ||
      c.includes("Entreprise explicitement") ||
      c.includes("DiffÃ©rence de montant > 30 %") ||
      c.includes("dÃ©jÃ  liÃ©e"),
  );

export default function PspCorrespondancesSection({
  pspLigneId,
  onRattache,
}: {
  pspLigneId: string;
  onRattache?: () => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const fetchCorresp = useServerFn(getPspCorrespondances);
  const creerLien = useServerFn(createPspCommandLink);
  const retirerLien = useServerFn(deletePspCommandLink);

  const { data, isLoading } = useQuery({
    queryKey: ["psp-correspondances", pspLigneId],
    queryFn: () => fetchCorresp({ data: { pspLigneId } }),
    staleTime: 1000 * 60 * 5,
    retry: 1,
  });

  const [aRattacher, setARattacher] = useState<PropositionRevue | null>(null);
  const [aRetirer, setARetirer] = useState<PropositionRevue | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const propositions = ((data as { propositions?: PropositionRevue[] } | undefined)?.propositions ??
    []) as PropositionRevue[];
  const annees = ((data as { annees_programmation?: number[] } | undefined)?.annees_programmation ??
    []) as number[];

  const rafraichir = async () => {
    await queryClient.invalidateQueries({ queryKey: ["psp-correspondances", pspLigneId] });
    await queryClient.invalidateQueries({ queryKey: ["psp-suivi"] });
    await queryClient.invalidateQueries({ queryKey: ["psp-suivi-operations"] });
    if (onRattache) await onRattache();
  };

  const confirmerRattachement = async () => {
    if (!aRattacher || busy) return;
    setBusy(true);
    setErreur(null);
    try {
      await creerLien({
        data: {
          commandeId: aRattacher.commandeId,
          pspLigneId,
          justification: "Validation manuelle par l'utilisateur",
        },
      });
      setARattacher(null);
      await rafraichir();
    } catch (e) {
      setErreur(`Le rattachement n'a pas pu Ãªtre enregistrÃ©. ${(e as Error)?.message ?? ""}`);
    } finally {
      setBusy(false);
    }
  };

  const confirmerRetrait = async () => {
    if (!aRetirer?.lienId || busy) return;
    setBusy(true);
    setErreur(null);
    try {
      await retirerLien({ data: { id: aRetirer.lienId } });
      setARetirer(null);
      await rafraichir();
    } catch (e) {
      setErreur(
        `Le retrait du rattachement n'a pas pu Ãªtre enregistrÃ©. ${(e as Error)?.message ?? ""}`,
      );
    } finally {
      setBusy(false);
    }
  };

  if (isLoading)
    return (
      <p className="text-[11px] text-muted-foreground">Analyse des correspondances commandesâ€¦</p>
    );

  if (propositions.length === 0) {
    return (
      <p className="rounded border border-dashed px-2 py-1.5 text-[11px] text-muted-foreground">
        Aucune commande à rapprocher — ce bloc sert uniquement à rattacher une commande réellement
        importée à cette opération ; il ne crée jamais d&apos;opération ni de commande.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {erreur && <p className="text-[11px] font-semibold text-red-700">{erreur}</p>}
      {propositions.map((p) => {
        const cmd = p.commande;
        if (!cmd) return null;
        const exercice = deriverExerciceCorrespondance(annees, cmd.annee_exercice ?? null);
        const historique = exercice.type === "historique";
        const conflits = estConflitBloquant(p);
        return (
          <div
            key={p.commandeId}
            className={`rounded border px-2 py-1.5 text-[11px] ${historique ? "border-dashed opacity-80" : ""}`}
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
              <span className="font-bold">Commande {cmd.numero_commande ?? "â€”"}</span>
              <Badge variant={p.dejaLie ? "default" : "outline"}>
                {p.dejaLie ? "RapprochÃ©e" : (NIVEAU_LABEL[p.niveau] ?? p.niveau)}
              </Badge>
              <span className="text-muted-foreground">Score : {p.score} %</span>
              {historique && <Badge variant="outline">{exercice.libelle}</Badge>}
              {!historique && <span className="text-muted-foreground">{exercice.libelle}</span>}
              {p.dejaLie && (
                <span className="text-[10px] text-muted-foreground">
                  <Link2 className="mr-1 inline size-3" /> MÃ©thode : {p.methodeLien ?? "manuel"} Â·{" "}
                  {p.statutLien ?? ""}
                </span>
              )}
            </div>
            <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground sm:grid-cols-3">
              <span>{cmd.tranche_code ?? "TR â€”"}</span>
              <span>{cmd.adresse ?? "Adresse â€”"}</span>
              <span>{cmd.corps_etat ?? "Corps d'Ã©tat â€”"}</span>
              <span>{cmd.fournisseur ?? cmd.numero_fournisseur ?? "Entreprise â€”"}</span>
              <span>CommandÃ© : {fmtMontant(cmd.budget)}</span>
              <span>{cmd.descriptif ?? "Descriptif â€”"}</span>
            </div>
            <details className="mt-1">
              <summary className="cursor-pointer text-[10px] text-muted-foreground">
                Pourquoi cette correspondance ?
              </summary>
              <ul className="mt-1 space-y-0.5 text-[10px]">
                {p.raisons?.map((r) => (
                  <li key={r} className="text-emerald-700">
                    âœ“ {r}
                  </li>
                ))}
                {p.conflits?.map((c) => (
                  <li key={c} className="text-amber-700">
                    âš {c}
                  </li>
                ))}
                {p.criteres && (
                  <li className="text-muted-foreground">
                    AnnÃ©e :{" "}
                    {p.criteres["annee"] === "inconnu" ? "non comparable" : p.criteres["annee"]} Â·
                    Montant :{" "}
                    {p.criteres["montant"] === "inconnu" ? "non comparable" : p.criteres["montant"]}
                  </li>
                )}
              </ul>
            </details>
            {p.candidatsAlternatifs && p.candidatsAlternatifs.length > 0 && (
              <p className="mt-1 text-[10px] font-semibold text-amber-700">
                Plusieurs correspondances possibles â€” Ã confirmer :{" "}
                {p.candidatsAlternatifs.map((c) => `CMD (${c.score} %)`).join(" Â· ")}
              </p>
            )}
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {!p.dejaLie ? (
                <Button
                  size="sm"
                  variant={conflits.length > 0 ? "destructive" : "default"}
                  className="h-6 text-[10px]"
                  onClick={() => setARattacher(p)}
                >
                  Rattacher cette commande
                </Button>
              ) : (
                p.lienId && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-[10px]"
                    onClick={() => setARetirer(p)}
                  >
                    <Unlink className="size-3" /> Retirer le rattachement
                  </Button>
                )
              )}
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <FileSearch className="size-3" />
                {p.dejaLie
                  ? "RapprochÃ©e manuellement"
                  : "Le score est une aide â€” la dÃ©cision reste Ã  l'utilisateur."}
              </span>
            </div>
          </div>
        );
      })}

      <AlertDialog open={!!aRattacher} onOpenChange={(o) => !o && !busy && setARattacher(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Rattacher la commande {aRattacher?.commande?.numero_commande ?? ""} Ã l'opÃ©ration ?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {aRattacher && (
                <div className="space-y-1 text-[11px]">
                  <p>
                    Commande : {aRattacher.commande?.fournisseur ?? "â€”"} Â· CommandÃ© :{" "}
                    {fmtMontant(aRattacher.commande?.budget)}
                  </p>
                  <p>
                    Exercice : {aRattacher.commande?.annee_exercice ?? "â€”"} Â· Score :{" "}
                    {aRattacher.score} %
                  </p>
                  {estConflitBloquant(aRattacher).length > 0 && (
                    <p className="font-semibold text-amber-700">
                      Des incohÃ©rences ont Ã©tÃ© dÃ©tectÃ©es (TR, corps d'Ã©tat, montant,
                      entreprise, etc.). Vous Ãªtes sur le point de crÃ©er un rattachement manuel
                      malgrÃ© ces diffÃ©rences.
                    </p>
                  )}
                  {aRattacher.niveau === "A_CONFIRMER" && (
                    <p className="font-semibold text-amber-700">
                      Cette correspondance prÃ©sente des Ã©lÃ©ments ambigus. VÃ©rifiez les
                      informations avant de rattacher.
                    </p>
                  )}
                  <p className="text-muted-foreground">
                    Seul un lien psp_command_links est crÃ©Ã©. La commande importÃ©e reste intacte.
                  </p>
                </div>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Annuler</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={confirmerRattachement}>
              {busy ? "Enregistrementâ€¦" : "Confirmer le rattachement"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!aRetirer} onOpenChange={(o) => !o && !busy && setARetirer(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Retirer le rattachement de la commande ?</AlertDialogTitle>
            <AlertDialogDescription>
              Cette action supprime uniquement le lien entre cette commande et cette opÃ©ration. La
              commande importÃ©e, les imports et l'historique restent intacts.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Annuler</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={confirmerRetrait}>
              {busy ? "Enregistrementâ€¦" : "Retirer le rattachement"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
