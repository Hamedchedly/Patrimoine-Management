/**
 * V8.16y (partie 2) — Ligne en ÉDITION : les CASES de la ligne sont débloquées
 * pour modification (comme la ligne d'ajout `PspQuickAddRow`), PAS de gros
 * formulaire. Un simple clic sur la ligne remplace la ligne d'affichage par
 * cette ligne éditable (TR, périmètre/adresse + ER lot, corps d'état, nature,
 * montants 2027-2031, priorité, statut, notes), puis [Enregistrer] persisté via
 * `updatePspOperationComplete` (handleModifier) et [Annuler] referme.
 */
import { useMemo, useState } from "react";
import { Check, Loader2, X } from "lucide-react";

import PspAdressePanel from "@/components/preparation-psp/PspAdressePanel";
import PspCorpsEtatSelect from "@/components/preparation-psp/PspCorpsEtatSelect";
import PspSecteurBadge from "@/components/preparation-psp/PspSecteurBadge";
import { useRecherchePatrimoine } from "@/components/preparation-psp/useRecherchePatrimoine";
import { useReferentielCorpsEtats } from "@/components/preparation-psp/useReferentielCorpsEtats";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TableCell, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  PSP_ANNEES,
  type PspAnnee,
  type PspCategorie,
  type PspOperation,
  type SaisieOperation,
} from "@/lib/psp.prep";
import { PRIORITE_LABELS, STATUT_LABELS, statutConsultationDepuisDevis } from "@/lib/psp.prep.v7";
import type { ReferencePatrimoine } from "@/lib/psp.prep.data";
import type { LotInfo, PerimetreLigne } from "@/lib/psp.prep.v7";

const CHARGE_OPERATION = "HCHEDLY";

/**
 * Ligne éditable — rend un <TableRow> aligné sur les colonnes du tableau,
 * pré-rempli avec les valeurs de l'opération. Enregistre via onSave (SaisieOperation).
 */
export default function PspOperationRowEdit({
  op,
  reference,
  perimetres,
  lotsParId,
  figee,
  onSave,
  onCancel,
}: {
  op: PspOperation;
  reference: ReferencePatrimoine | null;
  perimetres: PerimetreLigne[];
  lotsParId: Map<string, LotInfo>;
  figee: boolean;
  onSave: (saisie: SaisieOperation) => void;
  onCancel: () => void;
}) {
  const rec = useRecherchePatrimoine({
    reference,
    initial: { tranche: op.tranche, perimetres },
    lotsParId,
  });
  const { categorieDe } = useReferentielCorpsEtats();

  const [corpsEtat, setCorpsEtat] = useState(op.corps_etat ?? "");
  const [nature, setNature] = useState(op.nature_travaux ?? "");
  const [montants, setMontants] = useState<Record<string, number>>(() =>
    PSP_ANNEES.reduce((acc, a) => ({ ...acc, [String(a)]: op.programme[String(a)] ?? 0 }), {}),
  );
  const [priorite, setPriorite] = useState(op.priorite ?? "normale");
  const [statut, setStatut] = useState(op.statut ?? "a_definir");
  const [notes, setNotes] = useState(op.remarques ?? "");
  const [saving, setSaving] = useState(false);

  const categorie: PspCategorie = categorieDe(corpsEtat);
  const total = useMemo(
    () => PSP_ANNEES.reduce((s, a) => s + (montants[String(a)] ?? 0), 0),
    [montants],
  );
  const anneeValide = PSP_ANNEES.some((a) => (montants[String(a)] ?? 0) > 0);
  /** Brouillon permissif : la TR seule suffit (contrôle structurel uniquement). */
  const donneesMinimalesValides = Boolean(rec.tranche) && !rec.conflit;

  const consultation = statutConsultationDepuisDevis(op.devis);
  const nbDevis = op.devis.length;

  const enregistrer = () => {
    if (saving || figee || !rec.tranche || rec.conflit) return;
    setSaving(true);
    onSave({
      tranche: rec.tranche,
      categorie,
      charge_clientele: rec.cc,
      charge_operation: op.charge_operation || CHARGE_OPERATION,
      corps_etat: corpsEtat.trim(),
      adresse: op.adresse,
      ville: op.ville,
      nature_travaux: nature.trim(),
      annee: op.annee as PspAnnee,
      programme: PSP_ANNEES.map((a) => montants[String(a)] ?? 0),
      remarques: notes.trim() || null,
      perimetres: rec.perimetres,
      statut,
      priorite,
    });
  };

  return (
    <TableRow className="bg-primary/5 align-top hover:bg-primary/5">
      {/* TR — sélectionnée (chip persistante) ou recherche globale */}
      <TableCell className="min-w-[150px] py-1.5">
        {rec.tranche ? (
          <div className="flex items-center justify-between gap-1 rounded-md border border-primary/40 bg-primary/10 px-2 py-1">
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
              placeholder="TR · ER · locataire…"
              className="h-8 pl-2 text-xs"
            />
            {rec.trPanelOuvert && (rec.sugTranches.length > 0 || rec.sugLotsVisibles.length > 0) ? (
              <div className="absolute z-40 mt-1 max-h-52 w-72 overflow-auto rounded-lg border bg-popover p-1 shadow-lg">
                <div className="flex items-center justify-between px-1 py-0.5">
                  <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                    Suggestions
                  </span>
                  <button
                    onClick={() => rec.setTrPanelOuvert(false)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <X className="size-3" />
                  </button>
                </div>
                {rec.sugTranches.length > 0 ? (
                  <>
                    <p className="px-1 text-[9px] font-black uppercase text-primary">Tranches</p>
                    {rec.sugTranches.map((t) => (
                      <button
                        key={t.code}
                        className="flex w-full justify-between gap-2 rounded px-2 py-1 text-left text-xs hover:bg-accent"
                        onClick={() => rec.choisirTranche(t.code)}
                      >
                        <span className="font-mono font-bold">{t.code}</span>
                        <span className="text-muted-foreground">
                          {t.localite ?? t.libelle ?? ""}
                        </span>
                      </button>
                    ))}
                  </>
                ) : null}
                {rec.sugLotsVisibles.length > 0 ? (
                  <>
                    <p className="px-1 text-[9px] font-black uppercase text-primary">Lots</p>
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
                  </>
                ) : null}
              </div>
            ) : null}
            {rec.alerteTranche ? (
              <p className="mt-0.5 flex items-center gap-1 text-[10px] font-bold text-amber-600">
                {rec.alerteTranche}
              </p>
            ) : null}
          </div>
        )}
      </TableCell>

      {/* CC — calculé automatiquement */}
      <TableCell className="min-w-[90px] py-1.5">
        <Input value={rec.cc} readOnly placeholder="auto" className="h-8 text-xs" />
        {rec.alerteCc ? (
          <p
            className="mt-0.5 max-w-[150px] text-[8px] font-bold leading-tight text-amber-600"
            title={rec.alerteCc}
          >
            {rec.alerteCc}
          </p>
        ) : null}
      </TableCell>

      {/* Adresse / périmètre — hiérarchie TR → rues → numéros → lots */}
      <TableCell className="min-w-[240px] py-1.5">
        {rec.tranche ? (
          <PspAdressePanel rec={rec} />
        ) : (
          <p className="text-[10px] text-muted-foreground">
            Sélectionnez d'abord un TR pour définir l'adresse / le périmètre.
          </p>
        )}
      </TableCell>

      {/* Corps d'état — liste déroulante structurée GE / GT / CP */}
      <TableCell className="min-w-[170px] py-1.5">
        <PspCorpsEtatSelect value={corpsEtat} onValueChange={setCorpsEtat} />
      </TableCell>

      {/* C — calculée automatiquement */}
      <TableCell className="py-1.5">
        <PspSecteurBadge categorie={categorie} />
      </TableCell>

      {/* Nature travaux — zone multi-ligne */}
      <TableCell className="min-w-[200px] py-1.5">
        <Textarea
          value={nature}
          onChange={(e) => setNature(e.target.value)}
          placeholder="Description métier…"
          rows={2}
          className="text-xs"
        />
      </TableCell>

      {/* Montants 2027-2031 */}
      {PSP_ANNEES.map((a: PspAnnee) => (
        <TableCell key={a} className="py-1.5">
          <Input
            type="text"
            inputMode="numeric"
            className="tabnum h-8 w-20 text-right text-xs"
            value={montants[String(a)] ?? ""}
            onChange={(e) => {
              const n = Number(e.target.value.replace(/[^\d]/g, "")) || 0;
              setMontants((prev) => ({ ...prev, [String(a)]: n }));
            }}
            placeholder="0"
          />
        </TableCell>
      ))}

      {/* Total — calculé */}
      <TableCell className="py-1.5 text-right">
        <span className="tabnum text-xs font-black text-primary">
          {total.toLocaleString("fr-FR")}
        </span>
      </TableCell>

      {/* Devis — affichage (édition via la fiche) */}
      <TableCell className="min-w-[120px] py-1.5">
        <span className="text-[11px] font-bold text-muted-foreground">
          {nbDevis > 0 ? `${consultation.label} (${nbDevis})` : "Aucune demande"}
        </span>
      </TableCell>

      {/* Priorité */}
      <TableCell className="min-w-[100px] py-1.5">
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
      </TableCell>

      {/* Statut / Notes — UNE seule cellule */}
      <TableCell className="min-w-[170px] py-1.5">
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
        <Input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Note libre…"
          className="mt-1 h-7 text-[10px]"
        />
      </TableCell>

      {/* Actions — Enregistrer / Annuler */}
      <TableCell className="py-1.5">
        <div className="flex flex-col items-start gap-1">
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              className="h-8"
              onClick={() => void enregistrer()}
              disabled={!donneesMinimalesValides || saving || figee}
            >
              {saving ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Check className="size-3.5" />
              )}
              Enregistrer
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8"
              onClick={onCancel}
              disabled={saving}
              title="Annuler la modification"
            >
              <X className="size-3.5" />
              Annuler
            </Button>
          </div>
          {rec.tranche && !anneeValide ? (
            <p className="max-w-[180px] text-[9px] leading-tight text-muted-foreground">
              Brouillon : corps d'état, montant et année facultatifs.
            </p>
          ) : null}
          {rec.conflit ? (
            <p className="max-w-[180px] text-[9px] font-bold leading-tight text-destructive">
              {rec.conflit}
            </p>
          ) : null}
          <span className="text-[9px] text-muted-foreground">
            Ch. Op. : {op.charge_operation || CHARGE_OPERATION} · C : {categorie}
          </span>
        </div>
      </TableCell>
    </TableRow>
  );
}
