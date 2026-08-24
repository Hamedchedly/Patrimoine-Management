/**
 * V7.3 — Saisie directe : VRAIE LIGNE du tableau (une cellule par colonne).
 * Corrections apportées :
 *  · la TR sélectionnée reste visible (chip [TR 1976 — THORIGNY ✕]) —
 *    indépendante du texte de recherche ;
 *  · les panneaux de suggestions se ferment sans annuler la sélection ;
 *  · recherche lot (ER / locataire) dans la tranche, adresse sans ER obligatoire ;
 *  · devis = case à cocher → Entreprise (recherche fournisseurs) / Montant /
 *    N° devis / Date ;
 *  · colonnes : … Total, Devis, Priorité, Statut / Notes, Actions ;
 *  · au moins une année > 0 obligatoire ;
 *  · création ATOMIQUE via createPspOperationComplete (ligne + périmètre + devis).
 */
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Loader2, Search, X } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";

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
  construireProgrammeDepuisMontants,
  construirePerimetresDepuisSaisie,
  type PspAnnee,
  type PspCategorie,
} from "@/lib/psp.prep";
import {
  createPspOperationComplete,
  rechercherFournisseursDevis,
} from "@/lib/psp.prep.supabase.functions";
import { PRIORITE_LABELS, STATUT_LABELS, extraireCodeCorpsEtat } from "@/lib/psp.prep.v7";
import type { ReferencePatrimoine } from "@/lib/psp.prep.data";

const CHARGE_OPERATION = "HCHEDLY";

type SuggestionFournisseur = { id: string; nom: string; ville: string | null; codes: string[] };

/**
 * Ligne de saisie directe — rend un <TableRow> aligné sur les colonnes du tableau.
 * Enregistre de façon ATOMIQUE : psp_lignes + psp_ligne_patrimoine + psp_devis.
 */
export default function PspQuickAddRow({
  programmationId,
  reference,
  onSaved,
  figee,
}: {
  programmationId: string;
  reference: ReferencePatrimoine | null;
  onSaved: () => void;
  figee: boolean;
}) {
  const rec = useRecherchePatrimoine({ reference });
  const fournisseursFn = useServerFn(rechercherFournisseursDevis);
  /** V7.6 §13 — catégorie C dérivée du RÉFÉRENTIEL corps d'état (autorité). */
  const { categorieDe } = useReferentielCorpsEtats();

  const [corpsEtat, setCorpsEtat] = useState("");
  const [nature, setNature] = useState("");
  const [montants, setMontants] = useState<Record<string, number>>({});
  const [devisCoche, setDevisCoche] = useState(false);
  const [fournisseurQ, setFournisseurQ] = useState("");
  const [sugFournisseurs, setSugFournisseurs] = useState<SuggestionFournisseur[]>([]);
  const [fournisseur, setFournisseur] = useState<SuggestionFournisseur | null>(null);
  const [devisMontant, setDevisMontant] = useState("");
  const [devisNumero, setDevisNumero] = useState("");
  const [devisDate, setDevisDate] = useState("");
  const [priorite, setPriorite] = useState("normale");
  const [statut, setStatut] = useState("a_definir");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const categorie: PspCategorie = categorieDe(corpsEtat);
  const total = useMemo(
    () => PSP_ANNEES.reduce((s, a) => s + (montants[String(a)] ?? 0), 0),
    [montants],
  );
  const anneeValide = PSP_ANNEES.some((a) => (montants[String(a)] ?? 0) > 0);
  /**
   * V7.6 §1 — le brouillon est PERMISSIF : la TR seule suffit. Corps d'état,
   * montant et année sont FACULTATIFS à la saisie (contrôlés à l'export).
   * Restent bloquantes les incohérences structurelles (conflit de TR).
   */
  const donneesMinimalesValides = Boolean(rec.tranche) && !rec.conflit;

  // Fournisseurs (devis) — recherche progressive nom OU code/alias.
  useEffect(() => {
    if (!devisCoche || fournisseurQ.trim().length < 2) {
      setSugFournisseurs([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const r = (await fournisseursFn({ data: { q: fournisseurQ } })) ?? [];
        setSugFournisseurs(r as SuggestionFournisseur[]);
      } catch {
        setSugFournisseurs([]);
      }
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devisCoche, fournisseurQ]);

  const enregistrer = async () => {
    if (figee || !rec.tranche || rec.conflit) return;
    setSaving(true);
    try {
      await createPspOperationComplete({
        data: {
          programmationId,
          trancheCode: rec.tranche,
          categorie,
          corpsEtatCode: extraireCodeCorpsEtat(corpsEtat),
          corpsEtat: corpsEtat || null,
          natureTravaux: nature || null,
          programme: construireProgrammeDepuisMontants(montants),
          ligneBudget: null,
          remarques: notes.trim() || null,
          statut,
          priorite,
          origine: "preparation",
          perimetres: construirePerimetresDepuisSaisie(rec.perimetres),
          devis: devisCoche
            ? [
                {
                  fournisseurId: fournisseur?.id,
                  entreprise: fournisseur?.nom ?? null,
                  dateDevis: devisDate || null,
                  montant: devisMontant.trim() === "" ? null : Number(devisMontant),
                  statut: "recu",
                  commentaire: null,
                  documentReference: devisNumero.trim() || null,
                },
              ]
            : undefined,
        },
      });
      // V7.5 §6 — reset complet de la saisie directe (ligne vierge sous l'en-tête).
      setCorpsEtat("");
      setNature("");
      setMontants({});
      setDevisCoche(false);
      setFournisseurQ("");
      setSugFournisseurs([]);
      setFournisseur(null);
      setDevisMontant("");
      setDevisNumero("");
      setDevisDate("");
      setPriorite("normale");
      setStatut("a_definir");
      setNotes("");
      rec.resetTout();
      onSaved();
    } catch (e) {
      console.error("Échec de la saisie directe :", e);
      rec.setConflit(`Enregistrement impossible : ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  /** V7.8 §5 — case « Devis » Oui/Non : décoché ⇒ champs masqués ET vidés. */
  const basculerDevis = (checked: boolean) => {
    setDevisCoche(checked);
    if (!checked) {
      setFournisseurQ("");
      setSugFournisseurs([]);
      setFournisseur(null);
      setDevisMontant("");
      setDevisNumero("");
      setDevisDate("");
    }
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
              className="h-8 pl-6 text-xs"
            />
            <Search className="pointer-events-none absolute left-2 top-2 size-3 text-muted-foreground" />
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
                <AlertTriangle className="size-3" />
                {rec.alerteTranche}
              </p>
            ) : null}
          </div>
        )}
      </TableCell>

      {/* CC — calculé automatiquement (référentiel sous-secteur → CC, V7.6 §8) */}
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

      {/* Adresse / périmètre — hiérarchie TR → rues → numéros → lots (V7.4) */}
      <TableCell className="min-w-[240px] py-1.5">
        {rec.tranche ? (
          <PspAdressePanel rec={rec} />
        ) : (
          <p className="text-[10px] text-muted-foreground">
            Sélectionnez d'abord un TR pour définir l'adresse / le périmètre.
          </p>
        )}
      </TableCell>

      {/* Corps d'état — liste déroulante structurée GE / GT / CP (V7.4) */}
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

      {/* Devis — case à cocher ; si cochée : Entreprise / Montant / N° / Date */}
      <TableCell className="min-w-[170px] py-1.5">
        <label className="flex cursor-pointer items-center gap-1.5 text-xs font-bold">
          <input
            type="checkbox"
            checked={devisCoche}
            onChange={(e) => basculerDevis(e.target.checked)}
            className="size-3.5 cursor-pointer"
          />
          Devis
        </label>
        {devisCoche ? (
          <div className="mt-1 space-y-1">
            <div className="relative">
              <Input
                value={fournisseurQ}
                onChange={(e) => setFournisseurQ(e.target.value)}
                placeholder="Entreprise…"
                className="h-7 text-[10px]"
              />
              {sugFournisseurs.length > 0 ? (
                <div className="absolute z-40 mt-1 max-h-36 w-64 overflow-auto rounded-lg border bg-popover p-1 shadow-lg">
                  {sugFournisseurs.map((f) => (
                    <button
                      key={f.id}
                      className="flex w-full justify-between gap-2 rounded px-2 py-1 text-left text-[10px] hover:bg-accent"
                      onClick={() => {
                        setFournisseur(f);
                        setFournisseurQ(f.nom);
                        setSugFournisseurs([]);
                      }}
                    >
                      <span className="truncate font-medium">{f.nom}</span>
                      <span className="text-muted-foreground">
                        {f.codes[0] ? `#${f.codes[0]}` : ""}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            {fournisseur ? (
              <p className="text-[9px] text-muted-foreground">
                {fournisseur.nom}
                {fournisseur.codes.length > 0 ? ` · ${fournisseur.codes.join(" / ")}` : ""}
                {fournisseur.ville ? ` · ${fournisseur.ville}` : ""}
              </p>
            ) : null}
            <Input
              type="text"
              inputMode="numeric"
              value={devisMontant}
              onChange={(e) => setDevisMontant(e.target.value.replace(/[^\d]/g, ""))}
              placeholder="Montant"
              className="tabnum h-7 text-[10px]"
            />
            <Input
              value={devisNumero}
              onChange={(e) => setDevisNumero(e.target.value)}
              placeholder="N° devis"
              className="h-7 text-[10px]"
            />
            <Input
              type="date"
              value={devisDate}
              onChange={(e) => setDevisDate(e.target.value)}
              className="h-7 text-[10px]"
            />
          </div>
        ) : null}
      </TableCell>

      {/* Priorité — AVANT Statut */}
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

      {/* Statut / Notes — UNE seule cellule (statut structuré + texte libre) */}
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

      {/* Actions */}
      <TableCell className="py-1.5">
        <div className="flex flex-col items-start gap-1">
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
          {rec.tranche && !anneeValide ? (
            <p className="max-w-[180px] text-[9px] leading-tight text-muted-foreground">
              Brouillon : corps d'état, montant et année facultatifs — la complétude est vérifiée au
              moment de l'export.
            </p>
          ) : null}
          {rec.conflit ? (
            <p className="max-w-[180px] text-[9px] font-bold leading-tight text-destructive">
              {rec.conflit}
            </p>
          ) : null}
          <span className="text-[9px] text-muted-foreground">
            Ch. Op. : {CHARGE_OPERATION} · C : {categorie}
          </span>
        </div>
      </TableCell>
    </TableRow>
  );
}
