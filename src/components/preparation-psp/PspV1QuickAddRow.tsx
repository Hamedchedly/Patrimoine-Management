/**
 * V1 VISUELLE — Ligne d'ajout DIRECT dans le tableau V1.
 *
 * Nouvelle PRÉSENTATION du workflow EXISTANT de /preparation-psp — aucun moteur
 * métier parallèle : même hook de recherche patrimoine (useRecherchePatrimoine),
 * même panneau adresse (PspAdressePanel), même création ATOMIQUE via
 * createPspOperationComplete (psp_lignes + psp_ligne_patrimoine + psp_devis +
 * historique via le trigger existant). Seule la DISPOSITION des colonnes est
 * alignée sur PspV1Table (TR · C · Adresse · Descriptif · Corps · LB · années).
 */
import { useMemo, useState } from "react";
import { Check, Loader2, Search, X } from "lucide-react";

import PspAdressePanel from "@/components/preparation-psp/PspAdressePanel";
import PspCorpsEtatSelect from "@/components/preparation-psp/PspCorpsEtatSelect";
import PspFournisseurSearch, {
  type FournisseurSelection,
} from "@/components/preparation-psp/PspFournisseurSearch";
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
import { money0 } from "@/lib/formats";
import {
  PSP_ANNEES,
  construirePerimetresDepuisSaisie,
  construireProgrammeDepuisMontants,
  type PspCategorie,
} from "@/lib/psp.prep";
import type { ReferencePatrimoine } from "@/lib/psp.prep.data";
import { createPspOperationComplete } from "@/lib/psp.prep.supabase.functions";
import { STATUT_LABELS, extraireCodeCorpsEtat, libelleEntreprise } from "@/lib/psp.prep.v7";

const CHARGE_OPERATION = "HCHEDLY";

/** Ligne de saisie directe — un <TableRow> aligné sur les colonnes de PspV1Table. */
export default function PspV1QuickAddRow({
  programmationId,
  reference,
  onSaved,
  onAnnuler,
}: {
  programmationId: string;
  reference: ReferencePatrimoine | null;
  onSaved: () => void;
  onAnnuler: () => void;
}) {
  const rec = useRecherchePatrimoine({ reference });
  /** V7.6 §13 — catégorie C dérivée du RÉFÉRENTIEL corps d'état (autorité). */
  const { categorieDe } = useReferentielCorpsEtats();

  const [corpsEtat, setCorpsEtat] = useState("");
  const [nature, setNature] = useState("");
  const [ligneBudget, setLigneBudget] = useState("");
  const [montants, setMontants] = useState<Record<string, number>>({});
  const [devisCoche, setDevisCoche] = useState(false);
  const [fournisseur, setFournisseur] = useState<FournisseurSelection | null>(null);
  const [devisMontant, setDevisMontant] = useState("");
  const [devisNumero, setDevisNumero] = useState("");
  const [statut, setStatut] = useState("a_definir");
  const [saving, setSaving] = useState(false);

  const categorie: PspCategorie = categorieDe(corpsEtat);
  const total = useMemo(
    () => PSP_ANNEES.reduce((s, a) => s + (montants[String(a)] ?? 0), 0),
    [montants],
  );
  /**
   * V7.6 §1 — le brouillon est PERMISSIF : la TR seule suffit. Corps d'état,
   * montant et année sont FACULTATIFS à la saisie (contrôlés à l'export).
   */
  const donneesMinimalesValides = Boolean(rec.tranche) && !rec.conflit;

  const enregistrer = async () => {
    if (saving || !rec.tranche || rec.conflit) return;
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
          ligneBudget: ligneBudget.trim() || null,
          remarques: null,
          statut,
          priorite: "normale",
          origine: "preparation",
          perimetres: construirePerimetresDepuisSaisie(rec.perimetres),
          devis: devisCoche
            ? [
                {
                  fournisseurId: fournisseur?.id,
                  entreprise: fournisseur?.nom ?? null,
                  dateDevis: null,
                  montant: devisMontant.trim() === "" ? null : Number(devisMontant),
                  statut: "recu",
                  commentaire: null,
                  documentReference: devisNumero.trim() || null,
                },
              ]
            : undefined,
        },
      });
      // Reset complet de la ligne (même comportement que PspQuickAddRow).
      rec.resetTout();
      setCorpsEtat("");
      setNature("");
      setLigneBudget("");
      setMontants({});
      setDevisCoche(false);
      setFournisseur(null);
      setDevisMontant("");
      setDevisNumero("");
      setStatut("a_definir");
      onSaved();
    } catch (e) {
      rec.setConflit(`Enregistrement impossible : ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <TableRow className="bg-primary/5 align-top hover:bg-primary/5">
      {/* TR — sélectionnée (chip) ou recherche globale */}
      <TableCell className="sticky left-0 z-10 bg-card py-1.5">
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
            {rec.alerteTranche ? (
              <p className="mt-0.5 text-[9px] font-bold text-amber-600">{rec.alerteTranche}</p>
            ) : null}
          </div>
        )}
      </TableCell>

      {/* C — catégorie (auto) */}
      <TableCell className="py-1.5">
        <PspSecteurBadge categorie={categorie} />
      </TableCell>

      {/* Adresse / périmètre */}
      <TableCell className="min-w-[240px] py-1.5">
        {rec.tranche ? (
          <PspAdressePanel rec={rec} />
        ) : (
          <p className="text-[10px] text-muted-foreground">
            Sélectionnez d'abord un TR pour définir l'adresse / le périmètre.
          </p>
        )}
      </TableCell>

      {/* Descriptif */}
      <TableCell className="min-w-[200px] py-1.5">
        <Textarea
          value={nature}
          onChange={(e) => setNature(e.target.value)}
          placeholder="Description métier…"
          rows={2}
          className="text-xs"
        />
      </TableCell>

      {/* Corps d'état */}
      <TableCell className="min-w-[170px] py-1.5">
        <PspCorpsEtatSelect value={corpsEtat} onValueChange={setCorpsEtat} />
      </TableCell>

      {/* Ligne budgétaire */}
      <TableCell className="min-w-[120px] py-1.5">
        <Input
          value={ligneBudget}
          onChange={(e) => setLigneBudget(e.target.value)}
          placeholder="525 · 551 · 561…"
          className="h-8 text-xs"
        />
      </TableCell>

      {/* Montants 2027-2031 */}
      {PSP_ANNEES.map((a) => (
        <TableCell key={a} className="py-1.5">
          <Input
            type="text"
            inputMode="numeric"
            value={montants[String(a)] || ""}
            onChange={(e) =>
              setMontants((m) => ({
                ...m,
                [String(a)]: Number(e.target.value.replace(/[^\d]/g, "")) || 0,
              }))
            }
            placeholder="0"
            className="tabnum h-8 text-right text-xs"
          />
        </TableCell>
      ))}

      {/* Total */}
      <TableCell className="py-1.5 text-right text-xs font-black text-primary">
        {money0(total)}
      </TableCell>

      {/* Consultation / Devis */}
      <TableCell className="min-w-[220px] py-1.5">
        <label className="flex items-center gap-1.5 text-[10px] font-bold">
          <input
            type="checkbox"
            checked={devisCoche}
            onChange={(e) => {
              setDevisCoche(e.target.checked);
              if (!e.target.checked) {
                setFournisseur(null);
                setDevisMontant("");
                setDevisNumero("");
              }
            }}
          />
          Devis
        </label>
        {devisCoche ? (
          <div className="mt-1 space-y-1">
            <PspFournisseurSearch
              value={fournisseur ? libelleEntreprise(fournisseur.nom, fournisseur.numero) : ""}
              onSelect={setFournisseur}
              placeholder="Entreprise…"
            />
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
          </div>
        ) : null}
      </TableCell>

      {/* Statut + actions */}
      <TableCell className="min-w-[180px] py-1.5">
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
        <div className="mt-1 flex items-center gap-1">
          <Button
            size="sm"
            className="h-7"
            onClick={() => void enregistrer()}
            disabled={!donneesMinimalesValides || saving}
          >
            {saving ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
            Enregistrer
          </Button>
          <Button size="sm" variant="ghost" className="h-7" onClick={onAnnuler}>
            Annuler
          </Button>
        </div>
        {rec.conflit ? (
          <p className="mt-1 text-[9px] font-bold leading-tight text-destructive">{rec.conflit}</p>
        ) : null}
        <p className="mt-0.5 text-[9px] text-muted-foreground">
          Ch. Op. : {CHARGE_OPERATION} · C : {categorie}
        </p>
      </TableCell>
    </TableRow>
  );
}
