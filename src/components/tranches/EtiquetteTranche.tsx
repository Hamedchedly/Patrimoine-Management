/**
 * V8.18 — ÉTIQUETTE DE TRANCHE : badge + éditeur (libre avec suggestions).
 * Valeurs suggérées : VEFA · RACHAT · USUFRUIT · BAIL À CONSTRUIRE.
 * L'éditeur écrit `tranches.etiquette` (migration 20260903_psp_v818_tranches_etiquette.sql).
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Tag } from "lucide-react";

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
import { updateTrancheEtiquette } from "@/lib/isis.functions";
import { TRANCHES_ETIQUETTES_KEY } from "@/lib/tranches.etiquettes.hooks";
import { cn } from "@/lib/utils";

/** Couleurs des étiquettes connues (valeurs libres → neutre). */
const PALETTE: Record<string, string> = {
  VEFA: "border-sky-200 bg-sky-100 text-sky-700",
  RACHAT: "border-violet-200 bg-violet-100 text-violet-700",
  USUFRUIT: "border-amber-200 bg-amber-100 text-amber-700",
  "BAIL À CONSTRUIRE": "border-emerald-200 bg-emerald-100 text-emerald-700",
};

/** Badge d'étiquette de tranche (rien si vide). */
export function EtiquetteTranche({
  etiquette,
  className,
}: {
  etiquette: string | null | undefined;
  className?: string;
}) {
  const valeur = etiquette?.trim();
  if (!valeur) return null;
  const cle = valeur.toUpperCase();
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider whitespace-nowrap",
        PALETTE[cle] ?? "border-slate-200 bg-slate-100 text-slate-600",
        className,
      )}
      title={`Étiquette : ${valeur}`}
    >
      <Tag className="size-2.5" />
      {valeur}
    </span>
  );
}

/** Éditeur d'étiquette d'une tranche (libre avec suggestions). */
export function EtiquetteTrancheEditeur({
  open,
  trancheCode,
  etiquette,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  trancheCode: string | null;
  etiquette: string | null | undefined;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}) {
  const queryClient = useQueryClient();
  const fetchUpdate = useServerFn(updateTrancheEtiquette);
  const [valeur, setValeur] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Réinitialise le champ à chaque ouverture.
  const initial = etiquette?.trim() ?? "";
  const ouvrir = (o: boolean) => {
    setMessage(null);
    if (o) setValeur(initial);
    onOpenChange(o);
  };

  const enregistrer = async () => {
    if (!trancheCode || saving) return;
    setSaving(true);
    setMessage(null);
    try {
      const propre = valeur.trim() === "" ? null : valeur.trim();
      await fetchUpdate({ data: { code: trancheCode, etiquette: propre } });
      await queryClient.invalidateQueries({ queryKey: [...TRANCHES_ETIQUETTES_KEY] });
      await queryClient.invalidateQueries({ queryKey: ["tranches-etiquettes"] });
      onSaved?.();
      onOpenChange(false);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Échec de l'enregistrement.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={ouvrir}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Tag className="size-4 text-primary" /> Étiquette — Tranche {trancheCode}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Précisez la nature / le mode d'acquisition de la tranche (ex. VEFA, RACHAT…) pour mieux
            la comprendre dans les vues.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div className="flex flex-wrap gap-1.5">
            {["VEFA", "RACHAT", "USUFRUIT", "BAIL À CONSTRUIRE"].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setValeur(s)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide transition-colors",
                  valeur.toUpperCase() === s.toUpperCase()
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-slate-200 text-slate-500 hover:border-slate-300 hover:bg-muted",
                )}
              >
                {s}
              </button>
            ))}
          </div>
          <Input
            value={valeur}
            onChange={(e) => setValeur(e.target.value)}
            placeholder="Ou saisir une étiquette libre…"
            maxLength={80}
            onKeyDown={(e) => {
              if (e.key === "Enter") void enregistrer();
            }}
          />
          {message ? <p className="text-xs text-destructive">{message}</p> : null}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={() => ouvrir(false)} disabled={saving}>
            Annuler
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setValeur("")} disabled={saving}>
            Effacer
          </Button>
          <Button size="sm" onClick={() => void enregistrer()} disabled={saving}>
            {saving ? "Enregistrement…" : "Enregistrer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
