/**
 * V7.6 §12-13 + V7.7 §9 — RÉFÉRENTIEL CORPS D'ÉTAT (consultation + ajout +
 * modification + désactivation + rattachement GE/GT/CP). Table `psp_corps_etats` :
 * code → libellé → catégorie → actif. Jamais de suppression physique.
 * `onChanged` invalide le cache du référentiel (sélecteurs mis à jour).
 */
import { useEffect, useState } from "react";
import { Layers, Plus, X } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";

import { Badge } from "@/components/ui/badge";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { PspCategorie } from "@/lib/psp.prep";
import { getCorpsEtats, savePspCorpsEtat } from "@/lib/psp.prep.supabase.functions";
import type { CorpsEtatReferentiel } from "@/lib/psp.prep.v7";

type LigneEditable = {
  id: string | null;
  code: string;
  libelle: string;
  categorie: PspCategorie;
  actif: boolean;
};

const LIGNE_VIDE = (): LigneEditable => ({
  id: null,
  code: "",
  libelle: "",
  categorie: "GT",
  actif: true,
});

/**
 * V7.7 §7 — CORPS réutilisable (table + ajout + actions), affiché dans la
 * console « Paramètres PSP » (onglet Corps d'état) et dans le dialogue seul.
 */
export function ReferentielCorpsEtatsBody({ onChanged }: { onChanged?: (() => void) | undefined }) {
  const fetchFn = useServerFn(getCorpsEtats);
  const saveFn = useServerFn(savePspCorpsEtat);
  const [lignes, setLignes] = useState<CorpsEtatReferentiel[]>([]);
  const [charge, setCharge] = useState(false);
  const [edition, setEdition] = useState<LigneEditable | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const recharger = () => {
    setCharge(true);
    setMessage(null);
    void fetchFn({ data: { q: "", tout: true } }).then((data) => {
      setLignes((data ?? []) as CorpsEtatReferentiel[]);
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
    if (!edition.libelle.trim()) {
      setMessage("Le corps d'état (libellé) est obligatoire.");
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await saveFn({
        data: {
          id: edition.id ?? undefined,
          code: edition.code.trim() || null,
          libelle: edition.libelle.trim(),
          categorie: edition.categorie,
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

  const basculerActif = async (l: CorpsEtatReferentiel) => {
    setSaving(true);
    setMessage(null);
    try {
      await saveFn({
        data: {
          id: l.id,
          code: l.code,
          libelle: l.libelle,
          categorie: l.categorie,
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
  return (
    <div className="space-y-2">
      <div className="max-h-[50vh] overflow-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="w-16 text-[10px] font-black uppercase tracking-widest">
                Code
              </TableHead>
              <TableHead className="text-[10px] font-black uppercase tracking-widest">
                Corps d'état
              </TableHead>
              <TableHead className="w-20 text-[10px] font-black uppercase tracking-widest">
                Catégorie
              </TableHead>
              <TableHead className="w-16 text-[10px] font-black uppercase tracking-widest">
                Actif
              </TableHead>
              <TableHead className="w-40 text-[10px] font-black uppercase tracking-widest">
                Actions
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {charge ? (
              <TableRow>
                <TableCell colSpan={5} className="py-3 text-center text-xs text-muted-foreground">
                  Chargement…
                </TableCell>
              </TableRow>
            ) : null}
            {!charge && lignes.length === 0 && !edition ? (
              <TableRow>
                <TableCell colSpan={5} className="py-3 text-center text-xs text-muted-foreground">
                  Aucun corps d'état — ajoutez-en un.
                </TableCell>
              </TableRow>
            ) : null}
            {edition ? (
              <TableRow className="bg-primary/5">
                <TableCell>
                  <Input
                    value={edition.code}
                    onChange={(e) => setEdition({ ...edition, code: e.target.value })}
                    placeholder="d"
                    className="h-7 w-14 font-mono text-xs"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    value={edition.libelle}
                    onChange={(e) => setEdition({ ...edition, libelle: e.target.value })}
                    placeholder="(d) Couverture"
                    className="h-7 text-xs"
                  />
                </TableCell>
                <TableCell>
                  <Select
                    value={edition.categorie}
                    onValueChange={(v) => setEdition({ ...edition, categorie: v as PspCategorie })}
                  >
                    <SelectTrigger className="h-7 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(["GE", "GT", "CP"] as PspCategorie[]).map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <input
                    type="checkbox"
                    checked={edition.actif}
                    onChange={(e) => setEdition({ ...edition, actif: e.target.checked })}
                  />
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
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
                <TableRow key={l.id ?? l.libelle}>
                  <TableCell className="font-mono text-xs font-bold">{l.code ?? "—"}</TableCell>
                  <TableCell className="text-xs">{l.libelle}</TableCell>
                  <TableCell>
                    <Badge
                      className={
                        l.categorie === "GE"
                          ? "border-blue-200 bg-blue-50 text-blue-700"
                          : l.categorie === "CP"
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-amber-200 bg-amber-50 text-amber-700"
                      }
                    >
                      {l.categorie}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {l.actif ? (
                      <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">
                        Oui
                      </Badge>
                    ) : (
                      <Badge className="border-red-200 bg-red-50 text-red-700">Non</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-[10px]"
                        onClick={() =>
                          setEdition({
                            id: l.id ?? null,
                            code: l.code ?? "",
                            libelle: l.libelle,
                            categorie: l.categorie,
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
              <Plus className="size-3.5" /> Ajouter un corps d'état
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
/** Dialogue seul (compatibilité) — le CORPS est réutilisé par « Paramètres PSP ». */
export default function PspCorpsEtatsDialog({
  open,
  onClose,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  onChanged?: (() => void) | undefined;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[min(94vw,760px)]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="size-4 text-primary" />
            Référentiel corps d'état
          </DialogTitle>
          <DialogDescription>
            Source de vérité des corps disponibles et de leur catégorie GE / GT / CP (table
            `psp_corps_etats`). Jamais de suppression physique — actif/inactif.
          </DialogDescription>
        </DialogHeader>
        <ReferentielCorpsEtatsBody onChanged={onChanged} />
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            Fermer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
