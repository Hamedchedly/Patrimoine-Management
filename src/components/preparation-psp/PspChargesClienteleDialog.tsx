/**
 * V7.5 §8 + V7.6 §9-11 + V7.7 §8 — RÉFÉRENTIEL CHARGÉ CLIENTÈLE.
 *  · consultation / modification / ajout / désactivation (service_role) ;
 *  · un même CC peut gérer plusieurs sous-secteurs (clé = sous_secteur) ;
 *  · le code sous-secteur reste celui du fichier patrimoine (jamais modifié) ;
 *  · signale les sous-secteurs du patrimoine sans CC renseigné ;
 *  · `onChanged` permet d'invalider la référence (rafraîchissement du CC partout).
 */
import { useEffect, useState } from "react";
import { Users, X } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";

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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getPspChargesClientele } from "@/lib/psp.prep.data.functions";
import type { ChargesClienteleReferentiel } from "@/lib/psp.prep.data";
import { savePspChargeClientele } from "@/lib/psp.prep.supabase.functions";

type LigneEditable = {
  sousSecteur: string;
  chargeClientele: string;
  identifiantPersonnel: string;
  actif: boolean;
};

const LIGNE_VIDE = (): LigneEditable => ({
  sousSecteur: "",
  chargeClientele: "",
  identifiantPersonnel: "",
  actif: true,
});

/**
 * V7.7 §7 — CORPS réutilisable (table + ajout + actions) : affiché dans la
 * console « Paramètres PSP » (onglet Chargés clientèle) et dans le dialogue seul.
 */
export function ReferentielChargesClienteleBody({
  sousSecteursConnus = [],
  onChanged,
}: {
  sousSecteursConnus?: string[] | undefined;
  onChanged?: (() => void) | undefined;
}) {
  const fetchFn = useServerFn(getPspChargesClientele);
  const saveFn = useServerFn(savePspChargeClientele);
  const [lignes, setLignes] = useState<ChargesClienteleReferentiel[]>([]);
  const [charge, setCharge] = useState(false);
  const [edition, setEdition] = useState<LigneEditable | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const recharger = () => {
    setCharge(true);
    setMessage(null);
    void fetchFn().then((data) => {
      setLignes((data ?? []) as ChargesClienteleReferentiel[]);
      setCharge(false);
    });
  };

  useEffect(() => {
    recharger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const apresSauvegarde = () => {
    setEdition(null);
    recharger();
    onChanged?.();
  };

  const enregistrer = async () => {
    if (!edition) return;
    if (!edition.sousSecteur.trim()) {
      setMessage("Le sous-secteur est obligatoire.");
      return;
    }
    if (!edition.identifiantPersonnel.trim()) {
      setMessage("L'ID chargé clientèle est obligatoire.");
      return;
    }
    // V7.9 §5 — ID normalisé en MAJUSCULES (la règle est aussi appliquée serveur).
    const id = edition.identifiantPersonnel.trim().toUpperCase();
    // V7.9 §4 — le nom complet n'est plus saisi dans cette grille : il est
    // conservé pour l'existant ; pour un NOUVEAU sous-secteur, il prend la valeur
    // de l'ID (la table PSP affiche alors cet ID dans la colonne CC).
    const nom = edition.chargeClientele?.trim() || id;
    setSaving(true);
    setMessage(null);
    try {
      await saveFn({
        data: {
          sousSecteur: edition.sousSecteur.trim(),
          chargeClientele: nom,
          identifiantPersonnel: id,
          actif: edition.actif,
        },
      });
      apresSauvegarde();
    } catch (e) {
      setMessage(`Enregistrement impossible : ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const basculerActif = async (l: ChargesClienteleReferentiel) => {
    setSaving(true);
    setMessage(null);
    try {
      await saveFn({
        data: {
          sousSecteur: l.sous_secteur,
          chargeClientele: l.charge_clientele,
          identifiantPersonnel: l.identifiant_personnel ?? null,
          actif: !l.actif,
        },
      });
      apresSauvegarde();
    } catch (e) {
      setMessage(`Mise à jour impossible : ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const manquants = sousSecteursConnus
    .filter((ss) => !lignes.some((l) => l.sous_secteur === ss && l.actif))
    .sort((a, b) => a.localeCompare(b, "fr", { numeric: true }));
  return (
    <div className="space-y-2">
      {manquants.length > 0 ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-[10px] font-bold leading-tight text-amber-800">
          Sous-secteur(s) du patrimoine sans chargé clientèle renseigné : {manquants.join(", ")}.
          Ajoutez-les ci-dessous.
        </p>
      ) : null}

      <div className="max-h-[50vh] overflow-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="w-24 text-[10px] font-black uppercase tracking-widest">
                Sous-secteur
              </TableHead>
              <TableHead className="text-[10px] font-black uppercase tracking-widest">
                ID CC
              </TableHead>
              <TableHead className="w-44 text-[10px] font-black uppercase tracking-widest">
                Actions
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {charge ? (
              <TableRow>
                <TableCell colSpan={3} className="py-3 text-center text-xs text-muted-foreground">
                  Chargement…
                </TableCell>
              </TableRow>
            ) : null}
            {!charge && lignes.length === 0 && !edition ? (
              <TableRow>
                <TableCell colSpan={3} className="py-3 text-center text-xs text-muted-foreground">
                  Aucune entrée — le référentiel n'est pas encore renseigné.
                </TableCell>
              </TableRow>
            ) : null}
            {edition ? (
              <TableRow className="bg-primary/5">
                <TableCell>
                  <Input
                    value={edition.sousSecteur}
                    onChange={(e) => setEdition({ ...edition, sousSecteur: e.target.value })}
                    placeholder="2"
                    className="h-7 w-16 font-mono text-xs"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    value={edition.identifiantPersonnel}
                    onChange={(e) =>
                      setEdition({ ...edition, identifiantPersonnel: e.target.value.toUpperCase() })
                    }
                    placeholder="CMICHEL"
                    className="h-7 text-xs uppercase"
                  />
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <label className="flex cursor-pointer items-center gap-1 text-[10px] font-bold text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={edition.actif}
                        onChange={(e) => setEdition({ ...edition, actif: e.target.checked })}
                        className="size-3.5 cursor-pointer"
                      />
                      Actif
                    </label>
                    <Button
                      size="sm"
                      className="h-7 text-[10px]"
                      disabled={saving}
                      onClick={() => void enregistrer()}
                    >
                      Enregistrer
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      onClick={() => setEdition(null)}
                    >
                      <X className="size-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ) : null}
            {!charge &&
              lignes.map((l) => (
                <TableRow key={l.sous_secteur}>
                  <TableCell className="font-mono text-xs font-bold">{l.sous_secteur}</TableCell>
                  <TableCell className="font-mono text-xs font-bold uppercase">
                    {l.identifiant_personnel ?? "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-[10px]"
                        onClick={() =>
                          setEdition({
                            sousSecteur: l.sous_secteur,
                            chargeClientele: l.charge_clientele,
                            identifiantPersonnel: l.identifiant_personnel ?? "",
                            actif: l.actif,
                          })
                        }
                      >
                        Modifier
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-[10px]"
                        disabled={saving}
                        onClick={() => void basculerActif(l)}
                      >
                        {l.actif ? "Désactiver" : "Activer"}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </div>

      {message ? (
        <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-800">
          {message}
        </p>
      ) : null}

      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setEdition(edition ? null : LIGNE_VIDE())}
        >
          {edition ? (
            "Annuler l'ajout"
          ) : (
            <>
              <Users className="size-3.5" /> Ajouter un sous-secteur
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
/** Dialogue seul (compatibilité) — le CORPS est réutilisé par « Paramètres PSP ». */
export default function PspChargesClienteleDialog({
  open,
  onClose,
  sousSecteursConnus = [],
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  sousSecteursConnus?: string[] | undefined;
  onChanged?: (() => void) | undefined;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[min(94vw,700px)]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="size-4 text-primary" />
            Référentiel chargé clientèle
          </DialogTitle>
          <DialogDescription>
            Sous-secteur → chargé de clientèle ACTUEL (`psp_charges_clientele`). Résolution :
            tranches.sous_secteur → CC. Le CC n'est JAMAIS déduit des commandes historiques.
          </DialogDescription>
        </DialogHeader>
        <ReferentielChargesClienteleBody
          sousSecteursConnus={sousSecteursConnus}
          onChanged={onChanged}
        />
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            Fermer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
