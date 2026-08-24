/**
 * V8.5.4 — RECHERCHE MANUELLE D'UNE COMMANDE (depuis la fiche opération).
 *
 * Recherche côté serveur (`rechercherCommandes`) par n° commande, entreprise,
 * TR, adresse ou descriptif. Chaque résultat propose [Rattacher] (réutilise
 * createPspCommandLink — workflow V8.5.3). Aucune écriture sauf le lien
 * explicite après confirmation.
 */
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Search } from "lucide-react";

import PspCorrespondanceCommandeDialog from "@/components/suivi/PspCorrespondanceCommandeDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { createPspCommandLink, rechercherCommandes } from "@/lib/psp.prep.supabase.functions";
import { libelleEntreprise } from "@/lib/psp.prep.v7";

const fmtMontant = (v: number | null | undefined): string => {
  if (v == null) return "—";
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(v);
};

type CommandeRecherchee = {
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
  rapprochement: {
    dejaLie: boolean;
    lienId?: string | null;
    pspLigneId?: string | null;
    methode?: string | null;
    statut?: string | null;
  };
};

export default function PspRechercheCommandeDialog({
  pspLigneId,
  open,
  onClose,
  onRattache,
}: {
  pspLigneId: string;
  open: boolean;
  onClose: () => void;
  onRattache?: () => Promise<void>;
}) {
  const rechercher = useServerFn(rechercherCommandes);
  const creerLien = useServerFn(createPspCommandLink);
  const [q, setQ] = useState("");
  const [resultats, setResultats] = useState<CommandeRecherchee[] | null>(null);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // V8.6 §4 — correspondances d'une commande avec les opérations existantes.
  const [commandeCorrespondance, setCommandeCorrespondance] = useState<string | null>(null);

  const lancerRecherche = async () => {
    if (!q.trim()) return;
    setChargement(true);
    setErreur(null);
    try {
      const res = await rechercher({ data: { q: q.trim() } });
      setResultats(res as unknown as CommandeRecherchee[]);
    } catch (e) {
      setErreur((e as Error)?.message ?? "Recherche impossible.");
      setResultats([]);
    } finally {
      setChargement(false);
    }
  };

  const rattacher = async (commandeId: string) => {
    setBusyId(commandeId);
    setErreur(null);
    try {
      await creerLien({
        data: { commandeId, pspLigneId, justification: "Rattachement manuel (recherche)" },
      });
      setResultats((r) =>
        (r ?? []).map((c) =>
          c.id === commandeId
            ? { ...c, rapprochement: { dejaLie: true, methode: "manuel", statut: "valide" } }
            : c,
        ),
      );
      if (onRattache) await onRattache();
    } catch (e) {
      setErreur(`Le rattachement n'a pas pu être enregistré. ${(e as Error)?.message ?? ""}`);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[min(94vw,720px)]">
        <DialogHeader>
          <DialogTitle className="text-sm">Rechercher une commande</DialogTitle>
        </DialogHeader>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-8 pl-7 text-[11px]"
              placeholder="N° commande, entreprise, TR, adresse, descriptif…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && lancerRecherche()}
            />
          </div>
          <Button
            size="sm"
            className="h-8 text-[11px]"
            onClick={lancerRecherche}
            disabled={chargement}
          >
            Rechercher
          </Button>
        </div>
        {erreur && <p className="text-[11px] font-semibold text-red-700">{erreur}</p>}
        {chargement && <p className="text-[11px] text-muted-foreground">Recherche…</p>}
        {resultats && !chargement && resultats.length === 0 && (
          <p className="text-[11px] text-muted-foreground">
            Aucune commande ne correspond à cette recherche.
          </p>
        )}

        {resultats && resultats.length > 0 && (
          <ul className="max-h-[50vh] space-y-1.5 overflow-y-auto">
            {resultats.map((c) => (
              <li key={c.id} className="rounded border border-dashed px-2 py-1.5 text-[11px]">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                  <span className="font-bold">{c.numero_commande ?? "—"}</span>
                  <Badge variant="outline">{c.tranche_code ?? "TR —"}</Badge>
                  <Badge variant={c.rapprochement.dejaLie ? "default" : "outline"}>
                    {c.rapprochement.dejaLie ? "Déjà rattachée" : "Non rattachée"}
                  </Badge>
                  <span className="text-muted-foreground">
                    Exercice : {c.annee_exercice ?? "—"}
                  </span>
                </div>
                <div className="mt-0.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground sm:grid-cols-3">
                  <span>{libelleEntreprise(c.fournisseur, c.numero_fournisseur)}</span>
                  <span>{c.adresse ?? "Adresse —"}</span>
                  <span>Commandé : {fmtMontant(c.budget)}</span>
                  <span>{c.corps_etat ?? "Corps d'état —"}</span>
                  <span className="col-span-2">{c.descriptif ?? "Descriptif —"}</span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  {!c.rapprochement.dejaLie ? (
                    <>
                      <Button
                        size="sm"
                        className="h-6 text-[10px]"
                        disabled={busyId === c.id}
                        onClick={() => rattacher(c.id)}
                      >
                        {busyId === c.id ? "Rattachement…" : "Rattacher"}
                      </Button>
                      {/* V8.6 §4 — correspondances de la commande avec les opérations existantes. */}
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-[10px]"
                        onClick={() => setCommandeCorrespondance(c.id)}
                      >
                        Opérations correspondantes
                      </Button>
                    </>
                  ) : (
                    <span className="text-[10px] text-muted-foreground">
                      {c.rapprochement.pspLigneId
                        ? `Liée à une autre opération (${c.rapprochement.pspLigneId.slice(0, 8)}…) — ${c.rapprochement.methode ?? "manuel"} · ${c.rapprochement.statut ?? ""}`
                        : `Méthode : ${c.rapprochement.methode ?? "manuel"} · ${c.rapprochement.statut ?? ""}`}
                    </span>
                  )}
                  <span className="text-[10px] text-muted-foreground">
                    {c.rapprochement.dejaLie
                      ? "Examiner le conflit — aucune modification automatique"
                      : "Examiner — l'utilisateur garde l'autorité métier"}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
      {commandeCorrespondance && (
        <PspCorrespondanceCommandeDialog
          commandeId={commandeCorrespondance}
          open={!!commandeCorrespondance}
          onClose={() => setCommandeCorrespondance(null)}
          onRattache={onRattache ?? (async () => undefined)}
        />
      )}
    </Dialog>
  );
}
