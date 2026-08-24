import { useState, type ReactNode } from "react";
import { Building2, Check, Pencil, Plus, Trash2, TrendingDown, TrendingUp, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import PspFournisseurSearch, {
  type FournisseurSelection,
} from "@/components/preparation-psp/PspFournisseurSearch";
import { money0 } from "@/lib/formats";
import {
  PSP_ANNEES,
  statsDevis,
  totalOperation,
  type PspDevis,
  type PspOperation,
} from "@/lib/psp.prep";
import { DEVIS_STATUT_LABELS, libelleEntrepriseAvecId } from "@/lib/psp.prep.v7";
import { cn } from "@/lib/utils";

export type DevisEdit = {
  fournisseurId?: string | null;
  entreprise?: string;
  dateDevis?: string | null;
  /** V7.10 §6 — montant NULLABLE (une demande de devis peut être sans montant). */
  montant?: number | null;
  statut?: string | null;
  commentaire?: string | null;
  /** Numéro / référence du devis (psp_devis.document_reference). */
  documentReference?: string | null;
};

/**
 * Bloc « Devis » de la fiche opération (V7.1) — CONSULTABLE, AJOUTABLE,
 * MODIFIABLE via psp_devis (réutilise createPspDevis / updatePspDevis /
 * deletePspDevis). Le montant du devis alimente l'estimation (calculée, jamais
 * stockée). Badge « Devis reçu ? » : ☑ dès qu'un devis est enregistré.
 */
export default function PspDevisPanel({
  operation,
  onAdd,
  onUpdate,
  onDelete,
  figee,
}: {
  operation: PspOperation;
  onAdd: (d: DevisEdit) => Promise<void>;
  onUpdate: (id: string, d: DevisEdit) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  figee: boolean;
}) {
  const [ajoutOuvert, setAjoutOuvert] = useState(false);
  const [editionId, setEditionId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{
    fournisseur_id: string | null;
    entreprise: string;
    date_devis: string;
    montant: string;
    statut: string;
    commentaire: string;
    document_reference: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const [entre, setEntre] = useState("");
  const [fournisseurSel, setFournisseurSel] = useState<FournisseurSelection | null>(null);
  const [date, setDate] = useState("");
  const [montant, setMontant] = useState("");
  const [statut, setStatut] = useState("recu");
  const [commentaire, setCommentaire] = useState("");
  const [numero, setNumero] = useState("");

  const stats = statsDevis(operation.devis);
  const budget = totalOperation(operation);
  const estimation = stats?.moyenne ?? null;
  const ecart = estimation !== null ? budget - estimation : null;

  const reinitFormulaire = () => {
    setEntre("");
    setFournisseurSel(null);
    setDate("");
    setMontant("");
    setStatut("recu");
    setCommentaire("");
    setNumero("");
  };

  const ajouter = async () => {
    if (!entre.trim() || figee) return;
    setBusy(true);
    try {
      await onAdd({
        fournisseurId: fournisseurSel?.id ?? null,
        entreprise: entre.trim(),
        dateDevis: date || null,
        montant: montant.trim() === "" ? null : Number(montant),
        statut,
        commentaire: commentaire.trim() || null,
        documentReference: numero.trim() || null,
      });
      reinitFormulaire();
      setAjoutOuvert(false);
    } finally {
      setBusy(false);
    }
  };

  const sauver = async () => {
    if (!editionId || !editForm || figee) return;
    setBusy(true);
    try {
      await onUpdate(editionId, {
        fournisseurId: editForm.fournisseur_id ?? null,
        entreprise: editForm.entreprise,
        dateDevis: editForm.date_devis || null,
        montant: editForm.montant.trim() === "" ? null : Number(editForm.montant),
        statut: editForm.statut || null,
        commentaire: editForm.commentaire.trim() || null,
        documentReference: editForm.document_reference.trim() || null,
      });
      setEditionId(null);
      setEditForm(null);
    } finally {
      setBusy(false);
    }
  };

  const ouvrirEdition = (d: PspDevis) => {
    setEditionId(d.id ?? null);
    setEditForm({
      fournisseur_id: (d as PspDevis & { fournisseur_id?: string | null }).fournisseur_id ?? null,
      entreprise: d.entreprise,
      date_devis: d.date_devis ?? "",
      montant: String(d.montant || ""),
      statut: d.statut ?? "recu",
      commentaire: d.commentaire ?? "",
      document_reference: d.document_reference ?? "",
    });
  };

  const annulerEdition = () => {
    setEditionId(null);
    setEditForm(null);
  };

  const devisRecu = operation.devis.some(
    (d) => d.statut && d.statut !== "a_demander" && d.statut !== "annule",
  );
  /** V7.9 §3 — OUI dès qu'au moins un devis existe (case Devis). */
  const devisOui = operation.devis.length > 0;

  return (
    <div className="rounded-lg border bg-surface/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-black uppercase tracking-widest text-muted-foreground">
          <Building2 className="size-3.5" />
          Devis
        </p>
        <div className="flex items-center gap-2">
          {/* V7.9 §3 — case Oui/Non unifiée : NON → aucun formulaire ; OUI →
              formulaire (ajout si aucun devis, sinon édition existante). */}
          <label className="flex cursor-pointer items-center gap-1.5 text-xs font-bold">
            <input
              type="checkbox"
              checked={devisOui || ajoutOuvert}
              onChange={(e) => {
                const coche = e.target.checked;
                if (!coche) {
                  // V7.9/V7.10 — décoché : on neutralise les devis existants
                  // (deletePspDevis) et on ferme le formulaire d'ajout.
                  for (const d of operation.devis) {
                    if (d.id) void onDelete(d.id);
                  }
                  setAjoutOuvert(false);
                  reinitFormulaire();
                } else if (!devisOui) {
                  setAjoutOuvert(true);
                }
              }}
              className="size-3.5 cursor-pointer"
            />
            Devis
          </label>
          <Badge
            className={cn(
              "font-bold",
              devisRecu
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-border bg-muted text-muted-foreground",
            )}
          >
            {devisRecu ? "☑ Devis reçu" : "☐ Non"}
          </Badge>
        </div>
      </div>

      {operation.devis.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Aucun devis renseigné pour cette opération.
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {operation.devis.map((d) => (
            <li
              key={d.id ?? `${d.entreprise}-${d.montant}`}
              className="rounded-md border bg-card p-2"
            >
              {editionId === d.id && editForm ? (
                <div className="space-y-1.5">
                  <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                    <PspFournisseurSearch
                      value={editForm.entreprise}
                      onSelect={(f) =>
                        setEditForm({
                          ...editForm,
                          entreprise: f?.nom ?? "",
                          fournisseur_id: f?.id ?? null,
                        })
                      }
                      placeholder="Entreprise…"
                    />
                    <Input
                      type="date"
                      value={editForm.date_devis}
                      onChange={(e) => setEditForm({ ...editForm, date_devis: e.target.value })}
                      className="h-7 text-xs"
                    />
                    <Input
                      type="number"
                      min={0}
                      value={editForm.montant}
                      onChange={(e) => setEditForm({ ...editForm, montant: e.target.value })}
                      placeholder="Montant"
                      className="h-7 text-xs"
                    />
                    <Select
                      value={editForm.statut}
                      onValueChange={(v) => setEditForm({ ...editForm, statut: v })}
                    >
                      <SelectTrigger className="h-7 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(DEVIS_STATUT_LABELS).map(([v, l]) => (
                          <SelectItem key={v} value={v}>
                            {l}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Input
                    value={editForm.document_reference}
                    onChange={(e) =>
                      setEditForm({ ...editForm, document_reference: e.target.value })
                    }
                    placeholder="N° de devis"
                    className="h-7 text-xs"
                  />
                  <Input
                    value={editForm.commentaire}
                    onChange={(e) => setEditForm({ ...editForm, commentaire: e.target.value })}
                    placeholder="Commentaire"
                    className="h-7 text-xs"
                  />
                  <div className="flex items-center gap-1">
                    <Button size="sm" className="h-7" disabled={busy} onClick={() => void sauver()}>
                      <Check className="size-3" /> Enregistrer
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7" onClick={annulerEdition}>
                      <X className="size-3" /> Annuler
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-1">
                  <span className="flex flex-wrap items-center gap-1.5 text-xs font-medium">
                    {/* V8.8 §1 — nom absent → « Fournisseur n°… » / « Entreprise non
                        renseignée » (aucune valeur vide, aucun nom inventé). */}
                    <span className="font-black">
                      {libelleEntrepriseAvecId(
                        d.entreprise,
                        (d as PspDevis & { numero_fournisseur?: string | null }).numero_fournisseur,
                        d.fournisseur_id,
                      )}
                    </span>
                    {d.document_reference ? (
                      <span className="font-mono text-[10px] text-muted-foreground">
                        N° {d.document_reference}
                      </span>
                    ) : null}
                    {d.date_demande ? (
                      <span className="text-[10px] text-muted-foreground">
                        Demande le {new Date(d.date_demande).toLocaleDateString("fr-FR")}
                      </span>
                    ) : null}
                    {d.date_devis ? (
                      <span className="text-[10px] text-muted-foreground">
                        Devis le {new Date(d.date_devis).toLocaleDateString("fr-FR")}
                      </span>
                    ) : null}
                    {d.statut ? (
                      <span className="text-[10px] text-muted-foreground">
                        {DEVIS_STATUT_LABELS[d.statut] ?? d.statut}
                      </span>
                    ) : null}
                    {d.commentaire ? (
                      <span className="text-[10px] font-normal text-muted-foreground">
                        — {d.commentaire}
                      </span>
                    ) : null}
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="tabnum text-xs font-bold">{money0(d.montant)}</span>
                    {!figee ? (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-6 text-muted-foreground hover:text-primary"
                          title="Modifier"
                          onClick={() => ouvrirEdition(d)}
                        >
                          <Pencil className="size-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-6 text-muted-foreground hover:text-destructive"
                          title="Supprimer"
                          onClick={() => d.id && void onDelete(d.id)}
                        >
                          <Trash2 className="size-3" />
                        </Button>
                      </>
                    ) : null}
                  </span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {!figee ? (
        <div className="mt-2">
          {ajoutOuvert ? (
            <div className="space-y-1.5 rounded-md border bg-card p-2">
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                <PspFournisseurSearch
                  value={entre}
                  onSelect={(f) => {
                    setFournisseurSel(f);
                    setEntre(f?.nom ?? "");
                  }}
                  placeholder="Rechercher une entreprise…"
                />
                <Input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="h-7 text-xs"
                />
                <Input
                  type="number"
                  min={0}
                  value={montant}
                  onChange={(e) => setMontant(e.target.value)}
                  placeholder="Montant (€)"
                  className="h-7 text-xs"
                />
                <Select value={statut} onValueChange={setStatut}>
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(DEVIS_STATUT_LABELS).map(([v, l]) => (
                      <SelectItem key={v} value={v}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Input
                value={numero}
                onChange={(e) => setNumero(e.target.value)}
                placeholder="N° de devis"
                className="h-7 text-xs"
              />
              <Input
                value={commentaire}
                onChange={(e) => setCommentaire(e.target.value)}
                placeholder="Commentaire"
                className="h-7 text-xs"
              />
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  className="h-7"
                  disabled={busy || !entre.trim()}
                  onClick={() => void ajouter()}
                >
                  <Plus className="size-3" /> Ajouter
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7"
                  onClick={() => {
                    setAjoutOuvert(false);
                    reinitFormulaire();
                  }}
                >
                  Annuler
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {operation.devis.length > 0 ? (
        <>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <MiniStat
              icone={<TrendingDown className="size-3" />}
              label="Minimum"
              valeur={money0(stats?.min)}
              className="text-emerald-600"
            />
            <MiniStat label="Moyenne" valeur={money0(stats?.moyenne)} className="text-foreground" />
            <MiniStat
              icone={<TrendingUp className="size-3" />}
              label="Maximum"
              valeur={money0(stats?.max)}
              className="text-orange-600"
            />
          </div>

          <div className="mt-2 space-y-1 border-t border-dashed pt-2">
            <LigneComparaison label="Budget programmé" valeur={money0(budget)} />
            <LigneComparaison
              label="Estimation devis"
              valeur={estimation !== null ? money0(estimation) : "—"}
            />
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-muted-foreground">Écart</span>
              <span
                className={cn(
                  "tabnum text-xs font-black",
                  ecart === null
                    ? "text-muted-foreground"
                    : ecart >= 0
                      ? "text-emerald-600"
                      : "text-destructive",
                )}
              >
                {ecart !== null ? `${ecart >= 0 ? "+" : ""}${money0(ecart)}` : "—"}
              </span>
            </div>
          </div>
        </>
      ) : null}

      <p className="mt-2 text-[10px] text-muted-foreground">
        Programmation couverte : {PSP_ANNEES[0] ?? 2027} →{" "}
        {PSP_ANNEES[PSP_ANNEES.length - 1] ?? 2031} — devis persistés dans psp_devis.
      </p>
    </div>
  );
}

function MiniStat({
  icone,
  label,
  valeur,
  className,
}: {
  icone?: ReactNode;
  label: string;
  valeur: string;
  className?: string;
}) {
  return (
    <div className="rounded-md border bg-card px-2 py-1.5">
      <p className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-muted-foreground">
        {icone}
        {label}
      </p>
      <p className={cn("tabnum mt-0.5 text-xs font-black", className)}>{valeur}</p>
    </div>
  );
}

function LigneComparaison({ label, valeur }: { label: string; valeur: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="tabnum text-xs font-bold">{valeur}</span>
    </div>
  );
}
