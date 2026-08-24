import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Wand2, X } from "lucide-react";

import PspAdressePanel from "@/components/preparation-psp/PspAdressePanel";
import PspCorpsEtatSelect from "@/components/preparation-psp/PspCorpsEtatSelect";
import PspSecteurBadge from "@/components/preparation-psp/PspSecteurBadge";
import { useRecherchePatrimoine } from "@/components/preparation-psp/useRecherchePatrimoine";
import { useReferentielCorpsEtats } from "@/components/preparation-psp/useReferentielCorpsEtats";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { money0 } from "@/lib/formats";
import {
  PSP_ANNEES,
  type PspAnnee,
  type PspCategorie,
  type PspOperation,
  type SaisieOperation,
} from "@/lib/psp.prep";
import type { ReferencePatrimoine } from "@/lib/psp.prep.data";
import {
  PRIORITE_LABELS,
  STATUT_LABELS,
  type LotInfo,
  type PerimetreLigne,
} from "@/lib/psp.prep.v7";

/** Chargé d'opération FIXE pour la programmation — jamais saisi. */
const CHARGE_OPERATION = "HCHEDLY";

/**
 * V7.2 — Édition d'une opération (modèle métier) :
 * TR + CC calculés (jamais saisis), périmètre patrimonial (hiérarchie
 * TR → rues → numéros → lots), corps d'état (liste structurée GE/GT/CP) →
 * catégorie automatique, nature large, montants 2027-2031, devis (fiche),
 * statut, priorité, notes. Ch. Op. = HCHEDLY. Pas d'année principale ni d'adresse libre.
 */
export default function PspOperationForm({
  open,
  mode,
  operation,
  reference,
  perimetresLigne,
  lotsParId,
  onSave,
  onClose,
  embedded = false,
  horsPsp = false,
}: {
  open: boolean;
  mode: "ajout" | "modification";
  operation: PspOperation | null;
  reference: ReferencePatrimoine | null;
  perimetresLigne?: PerimetreLigne[];
  /** V8.2.1 — restauration des lots du périmètre en modification. */
  lotsParId?: Map<string, LotInfo> | null | undefined;
  onSave: (saisie: SaisieOperation) => void;
  onClose: () => void;
  /** V7.5 §10 — rend le corps du formulaire sans wrapper Dialog (fiche fusionnée). */
  embedded?: boolean;
  /**
   * V8.3 — opération HORS PSP : aucun montant / aucune année programmée.
   * Masque le bloc « Montants programmés » ; le programme enregistré est vide.
   */
  horsPsp?: boolean;
}) {
  const [corpsEtat, setCorpsEtat] = useState("");
  const [nature, setNature] = useState("");
  const [programme, setProgramme] = useState<number[]>([0, 0, 0, 0, 0]);
  const [statut, setStatut] = useState("a_definir");
  const [priorite, setPriorite] = useState("normale");
  const [remarques, setRemarques] = useState("");
  const [saving, setSaving] = useState(false);

  const rec = useRecherchePatrimoine({
    reference,
    initial: {
      tranche: operation?.tranche ?? null,
      perimetres: perimetresLigne ?? [],
    },
    lotsParId,
  });
  /** V7.6 §13 — catégorie C dérivée du RÉFÉRENTIEL corps d'état (autorité). */
  const { categorieDe } = useReferentielCorpsEtats();

  useEffect(() => {
    if (!open && !embedded) return;
    if (mode === "modification" && operation) {
      setCorpsEtat(operation.corps_etat ?? "");
      setNature(operation.nature_travaux ?? "");
      setProgramme(PSP_ANNEES.map((a) => operation.programme[String(a)] ?? 0));
      setStatut(operation.statut ?? "a_definir");
      setPriorite(operation.priorite ?? "normale");
      setRemarques(operation.remarques ?? "");
    } else {
      setCorpsEtat("");
      setNature("");
      setProgramme([0, 0, 0, 0, 0]);
      setStatut("a_definir");
      setPriorite("normale");
      setRemarques("");
    }
  }, [open, mode, operation, embedded]);

  const total = useMemo(
    () => PSP_ANNEES.reduce((s, a, i) => s + (Number(programme[i]) || 0), 0),
    [programme],
  );

  /** Catégorie dérivée du corps d'état (référentiel GE/GT/CP) — jamais saisie manuellement. */
  const categorie: PspCategorie = categorieDe(corpsEtat);

  const enregistrer = () => {
    if (saving) return;
    // V7.6 §1 — brouillon PERMISSIF : la TR seule suffit (corps d'état, montant,
    // année facultatifs). Restent bloquantes les incohérences structurelles.
    if (!rec.tranche || rec.conflit) return;
    setSaving(true);
    onSave({
      tranche: rec.tranche ?? "",
      categorie,
      charge_clientele: rec.cc,
      charge_operation: CHARGE_OPERATION,
      corps_etat: corpsEtat.trim(),
      adresse: "",
      ville: "",
      nature_travaux: nature.trim(),
      annee: 2027 as PspAnnee,
      // V8.3 — hors PSP : aucun montant programmé (programme vide).
      programme: horsPsp ? [] : programme,
      remarques: remarques.trim() || null,
      perimetres: rec.perimetres,
      statut,
      priorite,
    });
    onClose();
  };

  const anneeValide = programme.some((v) => Number(v) > 0);
  const valide = Boolean(rec.tranche) && !rec.conflit;

  const corpsFormulaire = (
    <div className="mt-4 space-y-3">
      {/* TR + CC + Ch.Op */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="space-y-1 sm:col-span-2">
          <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
            TR (recherche)
          </Label>
          {rec.tranche ? (
            <div className="flex items-center justify-between gap-1 rounded-md border border-primary/40 bg-primary/10 px-2 py-1.5">
              <span className="font-mono text-xs font-black">
                {rec.tranche}
                {rec.referenceTranche?.localite ? ` — ${rec.referenceTranche.localite}` : ""}
              </span>
              <button
                onClick={rec.effacerTranche}
                className="text-muted-foreground hover:text-destructive"
                title="Changer de TR"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ) : (
            <div className="relative">
              <Input
                value={rec.searchQuery}
                onChange={(e) => {
                  rec.setSearchQuery(e.target.value);
                  rec.setTrPanelOuvert(true);
                }}
                onFocus={() => rec.setTrPanelOuvert(true)}
                placeholder="1976 · ER.123 · DUPONT…"
                className="h-8 text-xs"
              />
              {rec.trPanelOuvert &&
              (rec.sugTranches.length > 0 || rec.sugLotsVisibles.length > 0) ? (
                <div className="absolute z-40 mt-1 max-h-44 w-full overflow-auto rounded-lg border bg-popover p-1 shadow-lg">
                  {rec.sugTranches.map((t) => (
                    <button
                      key={t.code}
                      className="flex w-full justify-between gap-2 rounded px-2 py-1 text-left text-xs hover:bg-accent"
                      onClick={() => rec.choisirTranche(t.code)}
                    >
                      <span className="font-mono font-bold">{t.code}</span>
                      <span className="text-muted-foreground">{t.localite ?? t.libelle}</span>
                    </button>
                  ))}
                  {rec.sugLotsVisibles.map((l) => (
                    <button
                      key={l.id}
                      className="flex w-full justify-between gap-2 rounded px-2 py-1 text-left text-xs hover:bg-accent"
                      onClick={() => rec.choisirLotGlobal(l)}
                    >
                      <span className="font-mono font-bold">{l.code_patrimoine}</span>
                      <span className="truncate text-muted-foreground">
                        {l.locataire_nom ? `${l.locataire_nom} · ` : ""}
                        {l.adresse}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          )}
          {rec.alerteTranche ? (
            <p className="text-[10px] font-bold text-amber-600">{rec.alerteTranche}</p>
          ) : null}
          <p className="text-[10px] text-muted-foreground">
            Tranche : <span className="font-mono font-bold">{rec.tranche ?? "—"}</span> · CC :{" "}
            <span className="font-bold">{rec.cc || "calculée"}</span>
          </p>
        </div>

        <div className="space-y-1">
          <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
            C — catégorie (auto)
          </Label>
          <div className="flex h-8 items-center gap-2 rounded-md border bg-surface px-2">
            <PspSecteurBadge categorie={categorie} />
            <span className="font-mono text-xs font-black text-primary">{categorie}</span>
          </div>
        </div>

        <div className="space-y-1">
          <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
            Ch. Op.
          </Label>
          <Input
            value={CHARGE_OPERATION}
            readOnly
            className="h-8 text-xs font-black uppercase"
            title="Chargé d'opération fixe pour cette programmation"
          />
        </div>
      </div>

      {rec.referenceTranche ? (
        <div className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 p-2.5 text-xs">
          <Wand2 className="mt-0.5 size-3.5 shrink-0 text-primary" />
          <span>
            Référence réelle — {rec.referenceTranche.localite ?? "ville inconnue"} · sous-secteur{" "}
            {rec.referenceTranche.sous_secteur ?? "—"} · {rec.referenceTranche.nb_logements ?? "—"}{" "}
            logements
          </span>
        </div>
      ) : null}
      {rec.alerteCc ? (
        <p className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-[10px] font-bold leading-tight text-amber-800">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          {rec.alerteCc}
        </p>
      ) : null}

      {/* Périmètre patrimonial — hiérarchie TR → rues → numéros → lots (V7.4) */}
      <div className="rounded-lg border bg-surface/60 p-2.5">
        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
          Périmètre patrimonial
        </p>
        <div className="relative mt-1">
          <PspAdressePanel rec={rec} />
        </div>
        {rec.conflit ? (
          <p className="mt-1 text-[10px] font-bold text-destructive">{rec.conflit}</p>
        ) : null}
      </div>

      {/* Corps d'état + nature */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="space-y-1 sm:col-span-1">
          <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
            Corps d'état (GE / GT / CP)
          </Label>
          <PspCorpsEtatSelect value={corpsEtat} onValueChange={setCorpsEtat} />
          <p className="text-[9px] text-muted-foreground">
            Catégorie C recalculée automatiquement.
          </p>
        </div>

        <div className="space-y-1 sm:col-span-2">
          <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
            Nature des travaux
          </Label>
          <Textarea
            value={nature}
            onChange={(e) => setNature(e.target.value)}
            placeholder="Description métier des travaux (zone large)…"
            rows={3}
            className="text-xs"
          />
        </div>
      </div>

      {/* Montants 2027-2031 — masqués pour une opération HORS PSP (V8.3) */}
      {horsPsp ? (
        <div className="rounded-lg border border-dashed bg-surface/40 px-2.5 py-2 text-[11px] text-muted-foreground">
          <p className="font-semibold text-foreground">Hors programmation PSP</p>
          <p className="mt-0.5">
            Aucun montant ni année programmée — l'opération est suivie dans le registre Opérations
            (consultation, devis, commandes importées, travaux).
          </p>
        </div>
      ) : (
        <div>
          <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
            Montants programmés 2027-2031 (€)
          </Label>
          <div className="mt-1 grid grid-cols-5 gap-1.5">
            {PSP_ANNEES.map((a, i) => (
              <div key={a} className="space-y-1">
                <span className="block text-center font-mono text-[10px] font-black text-muted-foreground">
                  {a}
                </span>
                <Input
                  type="number"
                  min={0}
                  step={1000}
                  value={Number(programme[i]) || ""}
                  onChange={(e) =>
                    setProgramme((p) => {
                      const next = [...p];
                      next[i] = Math.max(0, Number(e.target.value) || 0);
                      return next;
                    })
                  }
                  className="h-8 text-center text-xs tabular-nums"
                />
              </div>
            ))}
          </div>
          <p className="tabnum mt-1.5 text-right text-xs font-black text-primary">
            Total : {money0(total)}
          </p>
          {!anneeValide ? (
            <p className="mt-1 rounded border border-dashed border-muted px-2 py-1 text-[10px] text-muted-foreground">
              Brouillon : les montants / années sont facultatifs à la saisie — la complétude est
              vérifiée au moment de l'export.
            </p>
          ) : null}
        </div>
      )}

      {/* Statut + Priorité */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="space-y-1">
          <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
            Statut
          </Label>
          <Select value={statut} onValueChange={setStatut}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(STATUT_LABELS).map(([v, l]) => (
                <SelectItem key={v} value={v}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
            Priorité
          </Label>
          <Select value={priorite} onValueChange={setPriorite}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(PRIORITE_LABELS).map(([v, l]) => (
                <SelectItem key={v} value={v}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
            Notes / remarques
          </Label>
          <Textarea
            value={remarques}
            onChange={(e) => setRemarques(e.target.value)}
            rows={2}
            className="text-xs"
            placeholder="Observations libres (persistées dans psp_lignes.remarques)"
          />
        </div>
      </div>
    </div>
  );

  return embedded ? (
    <div className="space-y-3">
      {corpsFormulaire}
      <div className="flex justify-end">
        <Button size="sm" disabled={!valide || saving} onClick={enregistrer}>
          {mode === "ajout" ? "Ajouter l'opération" : "Enregistrer les modifications"}
        </Button>
      </div>
    </div>
  ) : (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] w-[min(92vw,760px)] gap-0 p-0 sm:max-w-[760px]">
        <div className="max-h-[calc(90vh-4rem)] overflow-y-auto p-5">
          <DialogHeader>
            <DialogTitle>
              {mode === "ajout" ? "Ajouter une opération" : "Modifier l'opération"}
            </DialogTitle>
            <DialogDescription>
              Modèle métier : TR / CC calculés, périmètre patrimonial, corps d'état → catégorie
              automatique, Ch. Op. = HCHEDLY. Aucune donnée patrimoniale recopiée.
            </DialogDescription>
          </DialogHeader>
          {corpsFormulaire}
          <DialogFooter className="mt-4">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Annuler
            </Button>
            <Button size="sm" disabled={!valide || saving} onClick={enregistrer}>
              {mode === "ajout" ? "Ajouter l'opération" : "Enregistrer les modifications"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
