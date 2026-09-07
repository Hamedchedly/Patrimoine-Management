/**
 * V8.20 — BOUTON FLOTTANT « Signaler un bug » + formulaire.
 *  · visible sur tout le site ;
 *  · capture d'écran automatique (html-to-image, compatible Tailwind 4 / oklch)
 *    + repli contexte texte ;
 *  · URL, titre de page et historique des derniers clics (fil d'Ariane d'action) ;
 *  · description libre → enregistré dans `bug_reports`.
 */
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Bug, Camera, Loader2, Send } from "lucide-react";
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
import { creerBugReport } from "@/lib/bug_reports.functions";

const MAX_CLICS = 12;
type ClicHistorique = { h: string; cible: string };
const clicsModule: ClicHistorique[] = [];

const horloge = () =>
  new Date().toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

const libelleCible = (e: MouseEvent): string => {
  const t = e.target as HTMLElement | null;
  if (!t) return "";
  const label =
    t.getAttribute?.("aria-label") ??
    t.getAttribute?.("title") ??
    t.getAttribute?.("placeholder") ??
    "";
  const texte = (t.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 90);
  return label || texte || t.tagName.toLowerCase();
};

const capterClic = (e: MouseEvent) => {
  const cible = libelleCible(e);
  if (!cible) return;
  clicsModule.unshift({ h: horloge(), cible });
  if (clicsModule.length > MAX_CLICS) clicsModule.pop();
};

/** Capture d'écran réelle de la page (repli : null si échec). */
const capturePage = async (): Promise<string | null> => {
  try {
    // Import dynamique du MODULE (chunk séparé) — l'import dynamique d'une
    // dépendance brute échoue sous Vite ; html-to-image est importé
    // statiquement dans src/lib/bug.capture.ts.
    const mod = await import("@/lib/bug.capture");
    return await mod.capturePage();
  } catch (e) {
    console.error("[BugReport] capture", e);
    return null;
  }
};

export function BugReportLauncher() {
  const [ouvert, setOuvert] = useState(false);
  const [capture, setCapture] = useState<string | null>(null);
  const [capturant, setCapturant] = useState(false);
  const [description, setDescription] = useState("");
  const [categorie, setCategorie] = useState("");
  const [envoyant, setEnvoyant] = useState(false);
  const creer = useServerFn(creerBugReport);

  // Historique des derniers clics (fil d'Ariane d'action) — enregistré en continu.
  useEffect(() => {
    window.addEventListener("click", capterClic, { capture: true });
    return () => window.removeEventListener("click", capterClic, { capture: true });
  }, []);

  // Prise de vue de la PAGE (sans le dialogue) puis ouverture du formulaire.
  const lancer = async () => {
    if (capturant) return;
    setCapturant(true);
    setDescription("");
    setCategorie("");
    setCapture(null);
    try {
      // Capture automatique au déclenchement (repli : contexte texte seul).
      setCapture(await capturePage());
    } finally {
      setCapturant(false);
      setOuvert(true);
    }
  };

  const contexte = useMemo(
    () => ({
      url: typeof location !== "undefined" ? location.href : null,
      date: new Date().toISOString(),
      page: typeof document !== "undefined" ? document.title : null,
      clics: clicsModule.slice(0, MAX_CLICS),
      navigateur: navigator.userAgent.slice(0, 200),
    }),
    [ouvert], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const envoyer = async () => {
    if (description.trim().length < 3 || envoyant) return;
    setEnvoyant(true);
    try {
      await creer({
        data: {
          description: description.trim(),
          categorie: categorie.trim() || null,
          url: contexte.url ?? null,
          page_titre: contexte.page ?? null,
          contexte,
          capture,
        },
      });
      toast.success("Signalement envoyé. Merci !");
      setOuvert(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec de l'envoi du signalement.");
    } finally {
      setEnvoyant(false);
    }
  };

  return (
    <>
      {/* Bouton flottant universel (bas droite) */}
      <button
        type="button"
        data-bug-report="true"
        disabled={capturant}
        onClick={() => void lancer()}
        className="fixed bottom-5 right-5 z-[1400] flex h-12 items-center gap-2 rounded-full bg-slate-900 px-4 text-xs font-black uppercase tracking-wide text-white shadow-xl ring-1 ring-white/20 transition-transform hover:scale-105 hover:bg-slate-800 disabled:cursor-wait disabled:opacity-80"
        title="Signaler un bug"
      >
        {capturant ? (
          <>
            <Loader2 className="size-4 animate-spin" /> Capture…
          </>
        ) : (
          <>
            <Bug className="size-4" /> Signaler
          </>
        )}
      </button>

      <Dialog open={ouvert} onOpenChange={(o) => !o && setOuvert(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Bug className="size-4 text-primary" /> Signaler un bug
            </DialogTitle>
            <DialogDescription className="text-xs">
              La capture d'écran, l'URL et les derniers clics sont joints automatiquement pour le
              débogage.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-1">
            <Input
              value={categorie}
              onChange={(e) => setCategorie(e.target.value)}
              placeholder="Page / module concerné (ex. Préparation PSP, Import, Fiche logement…) — facultatif"
              maxLength={60}
            />
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Décrivez précisément le problème (étapes, ce que vous attendiez, ce qui se passe)…"
              rows={4}
            />
            <div className="flex items-start gap-2 rounded-md border bg-muted/40 p-2 text-[11px] text-muted-foreground">
              {capturant ? (
                <p className="flex items-center gap-1.5">
                  <Loader2 className="size-3.5 animate-spin" />
                  Capture d'écran en cours…
                </p>
              ) : capture ? (
                <>
                  <Camera className="mt-0.5 size-3.5 shrink-0" />
                  <div>
                    <p className="font-semibold text-foreground">Capture d'écran jointe ✓</p>
                    <img
                      src={capture}
                      alt="Capture d'écran"
                      className="mt-1 max-h-36 rounded border bg-white"
                    />
                  </div>
                </>
              ) : (
                <p>
                  <Camera className="mr-1 inline size-3.5" />
                  Capture impossible ici — URL, page et derniers clics seront joints.
                </p>
              )}
              <p className="ml-auto shrink-0 text-right">
                {clicsModule.length} dernier(s) clic(s) mémorisé(s)
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOuvert(false)}
              disabled={envoyant}
            >
              Annuler
            </Button>
            <Button
              size="sm"
              onClick={() => void envoyer()}
              disabled={description.trim().length < 3 || envoyant}
            >
              {envoyant ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              Envoyer le signalement
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
