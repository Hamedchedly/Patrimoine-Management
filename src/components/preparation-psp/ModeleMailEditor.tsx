/**
 * V8.16p/r — ÉDITEUR des modèles de mail (mail_modeles). Le hook partagé
 * `useMailModeles` vit dans src/lib/psp.mail.hooks.ts (utilisé par l'envoi par
 * ligne et l'envoi groupé). Le moteur de composition (composerMail /
 * remplacerVariablesMail) est inchangé.
 *
 * `ModeleMailEditor` : liste des modèles (demande de devis, relance, groupé) +
 * édition sujet/corps + DÉLAI DE RÉPONSE (jours, défaut 7) + aide des variables
 * disponibles ({TR}, {VILLE}, {CODE_LOT}…), sauvegarde en base.
 */
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Mail, RefreshCcw, Save } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { JOURS_REPONSE_DEFAUT_MAIL, VARIABLES_MAIL } from "@/lib/psp.suivi.foundation";
import { saveMailModele, type ModeleMail } from "@/lib/psp.mail.functions";
import { MAIL_MODELES_QUERY_KEY, MODELES_REPLI, useMailModeles } from "@/lib/psp.mail.hooks";

export default function ModeleMailEditor({
  ouvert,
  onFermer,
}: {
  ouvert: boolean;
  onFermer: () => void;
}) {
  const queryClient = useQueryClient();
  const saveFn = useServerFn(saveMailModele);
  const { modeles } = useMailModeles();
  const [actifId, setActifId] = useState<string>(MODELES_REPLI[0]?.id ?? "demande_devis");
  const [sujet, setSujet] = useState("");
  const [corps, setCorps] = useState("");
  const [delai, setDelai] = useState<number>(JOURS_REPONSE_DEFAUT_MAIL);
  const [sauvegarde, setSauvegarde] = useState(false);

  const actif = modeles.find((m) => m.id === actifId) ?? modeles[0] ?? null;

  // À l'ouverture, charge le modèle actif courant.
  useEffect(() => {
    if (!ouvert) return;
    if (actif) {
      setActifId(actif.id);
      setSujet(actif.sujet);
      setCorps(actif.corps);
      setDelai(actif.delai_jours ?? JOURS_REPONSE_DEFAUT_MAIL);
    }
    setSauvegarde(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ouvert]);

  const charger = (m: ModeleMail) => {
    setActifId(m.id);
    setSujet(m.sujet);
    setCorps(m.corps);
    setDelai(m.delai_jours ?? JOURS_REPONSE_DEFAUT_MAIL);
    setSauvegarde(false);
  };

  const reinitialiser = () => {
    const defaut = MODELES_REPLI.find((m) => m.id === actifId);
    if (defaut) {
      setSujet(defaut.sujet);
      setCorps(defaut.corps);
      setDelai(defaut.delai_jours ?? JOURS_REPONSE_DEFAUT_MAIL);
      setSauvegarde(false);
    }
  };

  const enregistrer = async () => {
    if (!actif) return;
    try {
      await saveFn({
        data: {
          id: actif.id,
          libelle: actif.libelle,
          sujet,
          corps,
          delai_jours: delai,
        },
      });
      setSauvegarde(true);
      toast.success("Modèle de mail enregistré.");
      await queryClient.invalidateQueries({ queryKey: MAIL_MODELES_QUERY_KEY });
    } catch {
      toast.error("Enregistrement impossible.");
    }
  };

  return (
    <Dialog open={ouvert} onOpenChange={(o) => !o && onFermer()}>
      <DialogContent className="w-[min(96vw,720px)]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Mail className="size-4" /> Modèles de mail
          </DialogTitle>
          <DialogDescription>
            Modèles par défaut (demande de devis / relance) — persistés en base, utilisés par
            l&apos;envoi par ligne et l&apos;envoi groupé.
          </DialogDescription>
        </DialogHeader>

        {modeles.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun modèle disponible.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              {modeles.map((m) => (
                <Button
                  key={m.id}
                  type="button"
                  size="sm"
                  variant={m.id === actifId ? "default" : "outline"}
                  className="h-7 text-[10px]"
                  onClick={() => charger(m)}
                >
                  {m.libelle}
                </Button>
              ))}
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Sujet
              </label>
              <Input
                value={sujet}
                onChange={(e) => setSujet(e.target.value)}
                className="h-8 text-[11px]"
              />
              <div className="flex items-center gap-2">
                <label className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Délai de réponse (jours)
                </label>
                <Input
                  type="number"
                  min={1}
                  max={365}
                  value={delai}
                  onChange={(e) => setDelai(Number(e.target.value) || JOURS_REPONSE_DEFAUT_MAIL)}
                  className="h-8 w-24 text-[11px]"
                  title="Date de retour souhaitée = date d'envoi + délai"
                />
                <span className="text-[10px] text-muted-foreground">
                  (défaut : 7 = une semaine)
                </span>
              </div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Corps
              </label>
              <Textarea
                value={corps}
                onChange={(e) => setCorps(e.target.value)}
                rows={14}
                className="text-[11px]"
              />
            </div>

            <div className="flex flex-wrap items-center gap-1.5 border-t border-dashed pt-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Variables :
              </span>
              {VARIABLES_MAIL.map((v) => (
                <button
                  key={v.cle}
                  type="button"
                  onClick={() => setCorps((c) => `${c}\n{${v.cle}}`)}
                  className="rounded border border-dashed px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground hover:bg-accent"
                  title={v.libelle}
                >
                  {`{${v.cle}}`}
                </button>
              ))}
            </div>

            {sauvegarde && (
              <p className="text-[11px] font-semibold text-emerald-700">
                ✓ Modèle enregistré — utilisé pour les prochains mails.
              </p>
            )}
          </>
        )}

        <DialogFooter className="flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[10px]"
            disabled={!actif}
            onClick={reinitialiser}
          >
            <RefreshCcw className="size-3" /> Réinitialiser le modèle
          </Button>
          <Button
            size="sm"
            className="h-7 text-[10px]"
            disabled={!actif}
            onClick={() => void enregistrer()}
          >
            <Save className="size-3" /> Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
