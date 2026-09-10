/**
 * V8.16z — Section « Informations de l'intervention — Lots concernés » des
 * demandes de devis.
 *
 * Lit les lots du PÉRIMÈTRE de la ligne (adresse/périmètre), récupère leurs
 * informations complètes depuis le référentiel (lecture seule) et affiche une
 * fiche préremplie, modifiable UNIQUEMENT pour la demande. Le bouton
 * « Ajouter les informations du lot au mail » injecte le bloc composé dans le
 * corps du mail. AUCUNE persistance — le référentiel patrimoine n'est jamais
 * modifié.
 */
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, MapPin, Pencil, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  STATUT_OCCUPATION_LABELS,
  composerBlocLotsMail,
  construireFicheLot,
  formaterSurface,
  type BlocLotsMailOptions,
  type FicheLotDevis,
  type StatutOccupation,
} from "@/lib/psp/devis.lots.view";
import { getLotsPourDevis } from "@/lib/psp/devis.lots.functions";
import { cn } from "@/lib/utils";

type LotContexte = { lot_id: string | null; niveau?: string | null };

/** Détail compact d'une fiche (vue lecture) — lignes renseignées uniquement. */
function lignesFiche(f: FicheLotDevis): string[] {
  const lignes: string[] = [];
  if (f.adresse) lignes.push(f.ville ? `${f.adresse}, ${f.ville}` : f.adresse);
  else if (f.ville) lignes.push(f.ville);
  const bat = [f.batiment ? `Bâtiment ${f.batiment}` : null, f.entree ? `Entrée ${f.entree}` : null]
    .filter(Boolean)
    .join(" — ");
  if (bat) lignes.push(bat);
  const app = [
    f.appartement ? `Appartement ${f.appartement}` : null,
    f.etage ? `${f.etage}e étage` : null,
  ]
    .filter(Boolean)
    .join(" — ");
  if (app) lignes.push(app);
  const surface = formaterSurface(f.surface);
  if (surface) lignes.push(`Surface : ${surface}`);
  if (f.locataire_nom) lignes.push(`Locataire : ${f.locataire_nom}`);
  if (f.locataire_telephone) lignes.push(`Téléphone : ${f.locataire_telephone}`);
  if (f.conditions_acces.trim()) lignes.push(`Accès : ${f.conditions_acces.trim()}`);
  if (f.creneaux.trim()) lignes.push(`Créneaux : ${f.creneaux.trim()}`);
  return lignes;
}

/** Carte d'un lot : lecture compacte OU édition (champs débloqués, mail uniquement). */
function FicheLotCard({
  fiche,
  onFiche,
  onSupprimer,
}: {
  fiche: FicheLotDevis;
  onFiche: (f: FicheLotDevis) => void;
  onSupprimer: () => void;
}) {
  const [edition, setEdition] = useState(false);
  const set = (patch: Partial<FicheLotDevis>) => onFiche({ ...fiche, ...patch });

  if (!edition) {
    return (
      <div className="rounded-md border bg-card px-2 py-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[11px] font-black text-primary">{fiche.code}</span>
          <span className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setEdition(true)}
              className="inline-flex items-center gap-1 text-[9px] font-bold text-primary hover:underline"
            >
              <Pencil className="size-2.5" /> Modifier
            </button>
            <button
              type="button"
              onClick={onSupprimer}
              className="inline-flex items-center gap-1 text-[9px] font-bold text-muted-foreground hover:text-destructive"
              title="Retirer de cette demande (le lot du référentiel n'est pas touché)"
            >
              <Trash2 className="size-2.5" /> Supprimer
            </button>
          </span>
        </div>
        <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">
          {lignesFiche(fiche).join("\n") || "Aucune information disponible."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5 rounded-md border bg-card p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] font-black text-primary">{fiche.code}</span>
        <button
          type="button"
          onClick={() => setEdition(false)}
          className="text-[9px] font-bold text-muted-foreground hover:text-primary"
        >
          Fermer l'édition
        </button>
      </div>
      {/* Identification — référentiel (lecture seule, jamais modifié) */}
      <div className="rounded bg-muted/40 px-1.5 py-1 text-[10px] leading-snug text-muted-foreground">
        {[
          fiche.adresse ? (fiche.ville ? `${fiche.adresse}, ${fiche.ville}` : fiche.adresse) : null,
          fiche.batiment ? `Bâtiment ${fiche.batiment}` : null,
          fiche.entree ? `Entrée ${fiche.entree}` : null,
          fiche.appartement ? `Appartement ${fiche.appartement}` : null,
          fiche.etage ? `${fiche.etage}e étage` : null,
          fiche.tranche
            ? `Tranche ${fiche.tranche}${fiche.localite_tranche ? ` — ${fiche.localite_tranche}` : ""}`
            : null,
          formaterSurface(fiche.surface) ? `Surface ${formaterSurface(fiche.surface)}` : null,
          fiche.dpe ? `DPE ${fiche.dpe}` : null,
        ]
          .filter(Boolean)
          .join(" · ") || "Aucune information d'identification disponible."}
      </div>
      {/* Occupation + champs pour la demande (mail uniquement) */}
      <div className="grid grid-cols-2 gap-1.5">
        <label className="space-y-0.5">
          <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
            Statut
          </span>
          <Select
            value={fiche.statut_occupation}
            onValueChange={(v) => set({ statut_occupation: v as StatutOccupation })}
          >
            <SelectTrigger className="h-7 text-[10px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(STATUT_OCCUPATION_LABELS).map(([v, l]) => (
                <SelectItem key={v} value={v}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="space-y-0.5">
          <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
            Locataire
          </span>
          <Input
            value={fiche.locataire_nom ?? ""}
            onChange={(e) => set({ locataire_nom: e.target.value || null })}
            className="h-7 text-[10px]"
            placeholder="Nom du locataire"
          />
        </label>
        <label className="space-y-0.5">
          <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
            Téléphone
          </span>
          <Input
            value={fiche.locataire_telephone ?? ""}
            onChange={(e) => set({ locataire_telephone: e.target.value || null })}
            className="h-7 text-[10px]"
            placeholder="Téléphone"
          />
        </label>
        <label className="space-y-0.5">
          <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
            Contact complémentaire
          </span>
          <Input
            value={fiche.contact_complement}
            onChange={(e) => set({ contact_complement: e.target.value })}
            className="h-7 text-[10px]"
            placeholder="Email, gardien…"
          />
        </label>
        <label className="space-y-0.5">
          <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
            Surface (m²)
          </span>
          <Input
            inputMode="numeric"
            value={fiche.surface ?? ""}
            onChange={(e) => {
              const n = Number(e.target.value.replace(/[^\d]/g, "")) || 0;
              set({ surface: e.target.value === "" ? null : n });
            }}
            className="h-7 text-[10px]"
            placeholder="Surface"
          />
        </label>
        <label className="space-y-0.5">
          <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
            Nb de pièces
          </span>
          <Input
            value={fiche.nb_pieces}
            onChange={(e) => set({ nb_pieces: e.target.value })}
            className="h-7 text-[10px]"
            placeholder="Nombre de pièces"
          />
        </label>
      </div>
      <label className="space-y-0.5">
        <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
          Localisation précise de l'intervention
        </span>
        <Input
          value={fiche.localisation_intervention}
          onChange={(e) => set({ localisation_intervention: e.target.value })}
          className="h-7 text-[10px]"
          placeholder="Cuisine, salle de bain, toiture…"
        />
      </label>
      <label className="space-y-0.5">
        <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
          Conditions d'accès
        </span>
        <Input
          value={fiche.conditions_acces}
          onChange={(e) => set({ conditions_acces: e.target.value })}
          className="h-7 text-[10px]"
          placeholder="Accès, présence du locataire…"
        />
      </label>
      <div className="grid grid-cols-2 gap-1.5">
        <label className="space-y-0.5">
          <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
            Contraintes
          </span>
          <Input
            value={fiche.contraintes}
            onChange={(e) => set({ contraintes: e.target.value })}
            className="h-7 text-[10px]"
            placeholder="Contraintes particulières"
          />
        </label>
        <label className="space-y-0.5">
          <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
            Créneaux / disponibilités
          </span>
          <Input
            value={fiche.creneaux}
            onChange={(e) => set({ creneaux: e.target.value })}
            className="h-7 text-[10px]"
            placeholder="Créneaux possibles"
          />
        </label>
      </div>
      <label className="space-y-0.5">
        <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
          Observations complémentaires
        </span>
        <Textarea
          value={fiche.observations}
          onChange={(e) => set({ observations: e.target.value })}
          rows={2}
          className="text-[10px]"
          placeholder="Informations utiles à l'entreprise"
        />
      </label>
    </div>
  );
}

/**
 * Section complète — rendue dans l'éditeur de mail de la demande de devis.
 * `lots` = lots du périmètre de la ligne (niveau === "lot").
 */
export default function PspLotsDevisSection({
  lots,
  onAjouterAuMail,
}: {
  lots: LotContexte[];
  onAjouterAuMail?: (bloc: string) => void;
}) {
  const lotIds = [
    ...new Set((lots ?? []).map((l) => l.lot_id).filter((x): x is string => Boolean(x))),
  ];
  const getFn = useServerFn(getLotsPourDevis);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["psp-devis-lots", lotIds.join(",")],
    queryFn: () => getFn({ data: { lotIds } }),
    enabled: lotIds.length > 0,
    staleTime: 1000 * 60 * 10,
    retry: 1,
  });

  const [fiches, setFiches] = useState<FicheLotDevis[]>([]);
  const [initialise, setInitialise] = useState(false);
  // V8.16z — choix des catégories d'informations à inclure dans le mail.
  const [optionsMail, setOptionsMail] = useState<Required<BlocLotsMailOptions>>({
    identification: true,
    occupation: true,
    caracteristiques: true,
    acces: true,
    observations: true,
  });
  // V8.16z — retour visuel « ajouté au mail » (bouton + confirmation).
  const [confirme, setConfirme] = useState(false);
  const confirmeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (data && !initialise) {
      setFiches(data.map(construireFicheLot));
      setInitialise(true);
    }
  }, [data, initialise]);

  const mettreAJourFiche = (f: FicheLotDevis) =>
    setFiches((prev) => prev.map((x) => (x.lot_id === f.lot_id ? f : x)));

  if (lotIds.length === 0) {
    return (
      <p className="text-[10px] text-muted-foreground">
        Aucun lot concerné dans le périmètre (adresse/périmètre) de la ligne.
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
        <MapPin className="size-3" /> Informations de l'intervention — Lots concernés
      </p>
      {isLoading ? (
        <p className="text-[10px] text-muted-foreground">Chargement des informations des lots…</p>
      ) : isError ? (
        <p className="text-[10px] font-bold text-destructive">
          Impossible de charger les informations des lots.
        </p>
      ) : fiches.length === 0 ? (
        <p className="text-[10px] text-muted-foreground">
          Aucune information disponible pour les lots du périmètre.
        </p>
      ) : (
        <div className="space-y-1.5">
          {fiches.map((f) => (
            <FicheLotCard
              key={f.lot_id}
              fiche={f}
              onFiche={mettreAJourFiche}
              onSupprimer={() => setFiches((prev) => prev.filter((x) => x.lot_id !== f.lot_id))}
            />
          ))}
        </div>
      )}
      {fiches.length > 0 && onAjouterAuMail ? (
        <div className="space-y-1.5 rounded-md border bg-card px-2 py-1.5">
          <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
            Champs à inclure dans le mail
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {(
              [
                ["identification", "Identification"],
                ["occupation", "Occupation"],
                ["caracteristiques", "Caractéristiques"],
                ["acces", "Accès"],
                ["observations", "Observations"],
              ] as const
            ).map(([cle, label]) => (
              <label key={cle} className="flex cursor-pointer items-center gap-1 text-[10px]">
                <input
                  type="checkbox"
                  checked={optionsMail[cle]}
                  onChange={(e) => setOptionsMail((prev) => ({ ...prev, [cle]: e.target.checked }))}
                  className="size-3 cursor-pointer"
                />
                {label}
              </label>
            ))}
          </div>
          <Button
            type="button"
            size="sm"
            variant={confirme ? "default" : "outline"}
            className={cn(
              "h-6 gap-1 text-[10px]",
              confirme && "border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-600",
            )}
            onClick={() => {
              onAjouterAuMail(composerBlocLotsMail(fiches, optionsMail));
              setConfirme(true);
              if (confirmeTimer.current) clearTimeout(confirmeTimer.current);
              confirmeTimer.current = setTimeout(() => setConfirme(false), 1800);
            }}
          >
            {confirme ? <Check className="size-3" /> : <Plus className="size-3" />}
            {confirme ? "Ajouté au mail ✓" : "Ajouter les informations du lot au mail"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
