/**
 * V1 VISUELLE — Futur module de préparation PSP (INTÉGRATION RÉELLE).
 *
 * Transformation progressive de /preparation-psp-v1 en interface fonctionnelle
 * en réutilisant les workflows PSP existants :
 *  · données RÉELLES via getPspBrouillon (psp_lignes, périmètres, devis,
 *    historique) + getPspReferencePatrimoine ;
 *  · UNE opération métier = UNE psp_ligne (programme multi-années) ;
 *  · création via PspOperationForm + createPspOperationComplete ;
 *  · modification via PspOperationDetail + updatePspOperationComplete
 *    (fusion des années — jamais d'écrasement) ;
 *  · revue via getPspRevueAnciennes + PspRevueAnciennes (lecture seule) ;
 *  · niveau Suivi orienté vers /suivi (registre annuel existant).
 *
 * Aucune nouvelle table, aucun nouveau moteur, aucune écriture directe
 * Supabase depuis ce composant (toujours via les server functions existantes).
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarRange, Eye, FolderClock, Plus, Search } from "lucide-react";
import { toast } from "sonner";

import PspOperationDetail from "@/components/preparation-psp/PspOperationDetail";
import PspRevueAnciennes from "@/components/preparation-psp/PspRevueAnciennes";
import PspV1Table from "@/components/preparation-psp/PspV1Table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  construireReferencePatrimoine,
  enrichirOperationsAvecReference,
  type ReferencePatrimoine,
} from "@/lib/psp.prep.data";
import { getPspReferencePatrimoine } from "@/lib/psp.prep.data.functions";
import {
  PSP_ANNEES,
  construirePerimetresDepuisSaisie,
  construireProgrammeDepuisSaisie,
  modifierOperationListe,
  supprimerOperationListe,
  type PspAnnee,
  type PspCategorie,
  type PspOperation,
  type SaisieOperation,
} from "@/lib/psp.prep";
import type { DevisEdit } from "@/components/preparation-psp/PspDevisPanel";
import type { PspLignePersist } from "@/lib/psp.prep.supabase.functions";
import {
  createPspDevis,
  deletePspDevis,
  deletePspLigne,
  getPspBrouillon,
  getPspRevueAnciennes,
  updatePspDevis,
  updatePspLigneStatutPriorite,
  updatePspOperationComplete,
} from "@/lib/psp.prep.supabase.functions";
import type { LotInfo, PerimetreLigne } from "@/lib/psp.prep.v7";
import { extraireCodeCorpsEtat } from "@/lib/psp.prep.v7";
import { cn } from "@/lib/utils";

/** Année de référence de la programmation pluriannuelle (2027-2031). */
export const ANNEE_REFERENCE_V1 = 2027;

export type NiveauV1 = "preparation" | "revue" | "suivi";

const NIVEAUX: Array<{ valeur: NiveauV1; label: string; description: string; icone: typeof Eye }> =
  [
    {
      valeur: "preparation",
      label: "Préparation",
      description: "Programmation actuelle 2027-2031",
      icone: CalendarRange,
    },
    {
      valeur: "revue",
      label: "Revue",
      description: "Anciennes programmations",
      icone: FolderClock,
    },
    {
      valeur: "suivi",
      label: "Suivi",
      description: "Exécution annuelle réelle",
      icone: Eye,
    },
  ];

export default function PspV1Page() {
  const queryClient = useQueryClient();

  // ── Données réelles ──────────────────────────────────────────────────────
  const fetchBrouillon = useServerFn(getPspBrouillon);
  const { data: brouillon } = useQuery({
    queryKey: ["psp-v1-brouillon"],
    queryFn: () => fetchBrouillon(),
    staleTime: 1000 * 30,
    retry: 1,
  });

  const fetchReference = useServerFn(getPspReferencePatrimoine);
  const { data: refBrute } = useQuery({
    queryKey: ["psp-v1-reference"],
    queryFn: () => fetchReference(),
    staleTime: 1000 * 60 * 60,
    retry: 1,
  });

  const fetchRevue = useServerFn(getPspRevueAnciennes);
  const { data: revue } = useQuery({
    queryKey: ["psp-v1-revue"],
    queryFn: () => fetchRevue({ data: { anneeReference: ANNEE_REFERENCE_V1 } }),
    staleTime: 1000 * 60,
    retry: 1,
  });

  // ── État ─────────────────────────────────────────────────────────────────
  const [operations, setOperations] = useState<PspOperation[]>([]);
  const [reference, setReference] = useState<ReferencePatrimoine | null>(null);
  const [lotsParId, setLotsParId] = useState<Map<string, LotInfo>>(new Map());
  const [perimetresParLigne, setPerimetresParLigne] = useState<Map<string, PerimetreLigne[]>>(
    new Map(),
  );
  const [historiqueParLigne, setHistoriqueParLigne] = useState<
    Map<string, Array<Record<string, unknown>>>
  >(new Map());
  const [programmationId, setProgrammationId] = useState<string | null>(null);

  const [niveau, setNiveau] = useState<NiveauV1>("preparation");
  const [recherche, setRecherche] = useState("");
  const [categorie, setCategorie] = useState<string>("");
  const [selectedOpId, setSelectedOpId] = useState<string | null>(null);
  const [ajoutOuvert, setAjoutOuvert] = useState(false);

  // ── Chargement brouillon → PspOperation (même mapping que /preparation-psp) ─
  useEffect(() => {
    if (!brouillon) return;
    if (!brouillon.programmation) {
      setOperations([]);
      setProgrammationId(null);
      return;
    }
    setProgrammationId(brouillon.programmation.id);
    const devisParLigne = new Map<string, Array<Record<string, unknown>>>();
    for (const d of brouillon.devis ?? []) {
      const id = String(d["psp_ligne_id"] ?? "");
      if (!id) continue;
      devisParLigne.set(id, [...(devisParLigne.get(id) ?? []), d]);
    }
    const perimetres = new Map<string, PerimetreLigne[]>();
    for (const p of brouillon.perimetres ?? []) {
      const cle = p.psp_ligne_id;
      if (!cle) continue;
      perimetres.set(cle, [
        ...(perimetres.get(cle) ?? []),
        { niveau: p.niveau, rue: p.rue, numero: p.numero, lot_id: p.lot_id },
      ]);
    }
    setPerimetresParLigne(perimetres);
    const hist = new Map<string, Array<Record<string, unknown>>>();
    for (const h of brouillon.historique ?? []) {
      const cle = String(h["ligne_id"] ?? "");
      if (!cle) continue;
      hist.set(cle, [...(hist.get(cle) ?? []), h]);
    }
    setHistoriqueParLigne(hist);
    const ops: PspOperation[] = (brouillon.lignes ?? []).map((l: PspLignePersist) => ({
      id: l.id,
      annee: 2027 as PspAnnee,
      tranche: l.tranche_code,
      charge_clientele: "",
      charge_operation: "",
      categorie: (l.categorie as PspCategorie) ?? "GT",
      corps_etat_code: l.corps_etat_code ?? "",
      corps_etat: l.corps_etat ?? "",
      adresse: "",
      ville: "",
      sous_secteur: null,
      nature_travaux: l.nature_travaux ?? "",
      budget: PSP_ANNEES.reduce((s, a) => s + (l.programme?.[String(a)] ?? 0), 0),
      programme: l.programme ?? {},
      remarques: l.remarques,
      ligne_budget: l.ligne_budget ?? null,
      devis: (devisParLigne.get(l.id) ?? []).map((d) => ({
        id: String(d["id"] ?? ""),
        fournisseur_id: (d["fournisseur_id"] as string | null) ?? null,
        entreprise: String(d["entreprise"] ?? ""),
        date_demande: (d["created_at"] as string | null) ?? null,
        montant: Number(d["montant"] ?? 0) || null,
        date_devis: (d["date_devis"] as string | null) ?? null,
        statut: String(d["statut"] ?? ""),
        remarque: (d["commentaire"] as string | null) ?? null,
        commentaire: (d["commentaire"] as string | null) ?? null,
        document_reference: (d["document_reference"] as string | null) ?? null,
      })),
      reportee: l.origine === "report",
      statut: l.statut,
      priorite: l.priorite,
      ancienne_annee: null,
      ancien_montant: null,
    }));
    setOperations(reference ? enrichirOperationsAvecReference(ops, reference) : ops);
  }, [brouillon, reference]);

  // Référence patrimoine réelle (lecture seule, ~3 requêtes).
  useEffect(() => {
    if (!refBrute) return;
    const ref = construireReferencePatrimoine(
      refBrute.tranches,
      refBrute.lots,
      refBrute.commandes,
      refBrute.chargesClientele,
    );
    setReference(ref);
    const lots: Map<string, LotInfo> = new Map();
    for (const l of refBrute.lots) {
      if (!l.id) continue;
      lots.set(l.id, {
        code_patrimoine: l.code_patrimoine ?? null,
        adresse: l.adresse,
        ville: l.ville,
      });
    }
    setLotsParId(lots);
  }, [refBrute]);

  // ── Handlers réels (réutilisent les server functions existantes) ─────────
  const updateCompleteFn = useServerFn(updatePspOperationComplete);
  const deleteLigneFn = useServerFn(deletePspLigne);
  const createDevisFn = useServerFn(createPspDevis);
  const updateDevisFn = useServerFn(updatePspDevis);
  const deleteDevisFn = useServerFn(deletePspDevis);
  const statutPrioriteFn = useServerFn(updatePspLigneStatutPriorite);

  const handleModifier = async (saisie: SaisieOperation, operation?: PspOperation | null) => {
    const cible = operation ?? operations.find((o) => o.id === selectedOpId) ?? null;
    if (!cible) return;
    const programme = construireProgrammeDepuisSaisie(saisie.programme);
    const patch: Parameters<typeof modifierOperationListe>[2] = {
      tranche: saisie.tranche,
      categorie: saisie.categorie,
      charge_clientele: saisie.charge_clientele,
      charge_operation: saisie.charge_operation,
      corps_etat: saisie.corps_etat,
      adresse: saisie.adresse,
      ville: saisie.ville,
      sous_secteur: reference?.tranches.get(saisie.tranche)?.sous_secteur ?? null,
      nature_travaux: saisie.nature_travaux,
      annee: saisie.annee,
      programme,
      remarques: saisie.remarques,
    };
    if (saisie.statut !== undefined) patch.statut = saisie.statut;
    if (saisie.priorite !== undefined) patch.priorite = saisie.priorite;
    setOperations((prev) => modifierOperationListe(prev, cible.id, patch));
    try {
      const ligne = await updateCompleteFn({
        data: {
          id: cible.id,
          trancheCode: saisie.tranche,
          categorie: saisie.categorie,
          corpsEtatCode: extraireCodeCorpsEtat(saisie.corps_etat),
          corpsEtat: saisie.corps_etat || null,
          natureTravaux: saisie.nature_travaux || null,
          programme,
          remarques: saisie.remarques ?? null,
          statut: saisie.statut ?? null,
          priorite: saisie.priorite ?? null,
          perimetres: construirePerimetresDepuisSaisie(saisie.perimetres),
        },
      });
      setOperations((prev) =>
        prev.map((o) =>
          o.id === cible.id
            ? {
                ...o,
                tranche: ligne.tranche_code,
                categorie: (ligne.categorie as PspCategorie) ?? "GT",
                corps_etat_code: ligne.corps_etat_code ?? "",
                corps_etat: ligne.corps_etat ?? "",
                nature_travaux: ligne.nature_travaux ?? "",
                programme: ligne.programme ?? {},
                budget: PSP_ANNEES.reduce((s, a) => s + (ligne.programme?.[String(a)] ?? 0), 0),
                remarques: ligne.remarques,
                statut: ligne.statut,
                priorite: ligne.priorite,
              }
            : o,
        ),
      );
      toast.success("Opération modifiée — totaux recalculés et persistés.");
    } catch (e) {
      toast.error(`Échec de la persistance : ${(e as Error).message}`);
    }
  };

  const handleSupprimer = async (id: string) => {
    setOperations((prev) => supprimerOperationListe(prev, id));
    setSelectedOpId(null);
    try {
      await deleteLigneFn({ data: { id } });
      toast.success("Opération supprimée (persistance Supabase).");
      void queryClient.invalidateQueries({ queryKey: ["psp-v1-brouillon"] });
      void queryClient.invalidateQueries({ queryKey: ["psp-v1-revue"] });
    } catch (e) {
      toast.error(`Échec de la suppression : ${(e as Error).message}`);
    }
  };

  const majDevisOperation = (id: string, devis: PspOperation["devis"]) => {
    setOperations((prev) => prev.map((o) => (o.id === id ? { ...o, devis } : o)));
  };

  const handleDevisAdd = async (ligneId: string, d: DevisEdit) => {
    const devis = await createDevisFn({
      data: {
        pspLigneId: ligneId,
        fournisseurId: d.fournisseurId ?? null,
        entreprise: d.entreprise ?? "",
        dateDevis: d.dateDevis ?? null,
        montant: d.montant ?? null,
        statut: (d.statut ?? "recu") as "recu",
        commentaire: d.commentaire ?? null,
        documentReference: d.documentReference ?? null,
      },
    });
    const ligne = operations.find((o) => o.id === ligneId);
    const list = ligne?.devis ?? [];
    majDevisOperation(ligneId, [
      ...list,
      {
        id: String(devis["id"] ?? ""),
        fournisseur_id: (devis["fournisseur_id"] as string | null) ?? null,
        entreprise: String(devis["entreprise"] ?? ""),
        date_demande: (devis["created_at"] as string | null) ?? null,
        montant: (devis["montant"] as number | null) ?? null,
        date_devis: (devis["date_devis"] as string | null) ?? null,
        statut: String(devis["statut"] ?? ""),
        remarque: (devis["commentaire"] as string | null) ?? null,
        commentaire: (devis["commentaire"] as string | null) ?? null,
        document_reference: (devis["document_reference"] as string | null) ?? null,
      },
    ]);
    toast.success("Devis ajouté et persisté (psp_devis).");
  };

  const handleDevisUpdate = async (id: string, d: DevisEdit) => {
    await updateDevisFn({
      data: {
        id,
        fournisseurId: d.fournisseurId ?? null,
        entreprise: d.entreprise,
        dateDevis: d.dateDevis,
        montant: d.montant,
        statut: (d.statut ?? undefined) as
          | "a_demander"
          | "demande_envoyee"
          | "recu"
          | "a_analyser"
          | "retenu"
          | "non_retenu"
          | "expire"
          | "annule"
          | undefined,
        commentaire: d.commentaire,
        documentReference: d.documentReference ?? null,
      },
    });
    setOperations((prev) =>
      prev.map((o) => ({
        ...o,
        devis: o.devis.map((dv) =>
          dv.id === id
            ? {
                ...dv,
                entreprise: d.entreprise ?? dv.entreprise,
                montant: d.montant ?? null,
                date_devis: d.dateDevis ?? dv.date_devis ?? null,
                statut: d.statut ?? dv.statut ?? "",
                commentaire: d.commentaire ?? dv.commentaire ?? null,
                remarque: d.commentaire ?? dv.remarque ?? null,
                document_reference: d.documentReference ?? dv.document_reference ?? null,
              }
            : dv,
        ),
      })),
    );
    toast.success("Devis modifié et persisté.");
  };

  const handleDevisDelete = async (id: string) => {
    await deleteDevisFn({ data: { id } });
    setOperations((prev) =>
      prev.map((o) => ({ ...o, devis: o.devis.filter((dv) => dv.id !== id) })),
    );
    toast.success("Devis supprimé (psp_devis).");
  };

  const handleStatutPriorite = async (
    id: string,
    patch: { statut?: string; priorite?: string },
  ) => {
    setOperations((prev) => prev.map((o) => (o.id === id ? { ...o, ...patch } : o)));
    try {
      await statutPrioriteFn({ data: { id, ...patch } });
    } catch (e) {
      toast.error(`Statut / priorité non persisté : ${(e as Error).message}`);
    }
  };

  const selectedOp = useMemo(
    () => operations.find((o) => o.id === selectedOpId) ?? null,
    [operations, selectedOpId],
  );

  const filtered = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    return operations.filter((op) => {
      if (categorie && op.categorie !== categorie) return false;
      if (!q) return true;
      const haystack = [
        op.tranche,
        op.nature_travaux,
        op.adresse,
        op.ville,
        op.corps_etat,
        op.ligne_budget,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [operations, recherche, categorie]);

  const totalParAnnee = useMemo(() => {
    const totaux: Record<string, number> = {};
    for (const a of PSP_ANNEES) totaux[String(a)] = 0;
    for (const op of filtered) {
      for (const a of PSP_ANNEES) {
        totaux[String(a)] = (totaux[String(a)] ?? 0) + (op.programme?.[String(a)] ?? 0);
      }
    }
    return totaux;
  }, [filtered]);

  return (
    <div className="space-y-5">
      {/* ── En-tête ────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4 shadow-sm">
        <div>
          <p className="text-xs font-black uppercase tracking-widest text-muted-foreground">
            Préparation PSP
          </p>
          <h1 className="text-lg font-black tracking-tight">
            Programmation pluriannuelle 2027-2031
          </h1>
        </div>
        {niveau === "preparation" ? (
          <Button
            size="sm"
            className="ml-auto gap-2"
            variant={ajoutOuvert ? "secondary" : "default"}
            onClick={() => setAjoutOuvert((o) => !o)}
          >
            <Plus className="size-4" />
            {ajoutOuvert ? "Fermer la ligne d'ajout" : "Ajouter une opération"}
          </Button>
        ) : null}
      </div>

      {/* ── Navigation 3 niveaux ───────────────────────────────────────────── */}
      <nav className="flex gap-1 rounded-xl border bg-card p-1 shadow-sm">
        {NIVEAUX.map((n) => {
          const Icone = n.icone;
          const actif = niveau === n.valeur;
          return (
            <button
              key={n.valeur}
              onClick={() => setNiveau(n.valeur)}
              className={cn(
                "flex flex-1 items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors",
                actif ? "bg-primary text-primary-foreground shadow-sm" : "hover:bg-muted",
              )}
            >
              <Icone className="size-4 shrink-0" />
              <span>
                <span className="block text-xs font-black leading-none">{n.label}</span>
                <span
                  className={cn(
                    "mt-0.5 block text-[9px] leading-none",
                    actif ? "text-primary-foreground/80" : "text-muted-foreground",
                  )}
                >
                  {n.description}
                </span>
              </span>
            </button>
          );
        })}
      </nav>

      {/* ── Niveau PRÉPARATION ─────────────────────────────────────────────── */}
      {niveau === "preparation" ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-2 size-3.5 text-muted-foreground" />
              <Input
                value={recherche}
                onChange={(e) => setRecherche(e.target.value)}
                placeholder="Rechercher TR, adresse, descriptif…"
                className="h-8 w-[260px] pl-7 text-xs"
              />
            </div>
            <select
              value={categorie}
              onChange={(e) => setCategorie(e.target.value)}
              className="h-8 rounded-md border bg-card px-2 text-xs focus:outline-none"
            >
              <option value="">Toutes catégories (GE/GT/CP)</option>
              <option value="GE">GE</option>
              <option value="GT">GT</option>
              <option value="CP">CP</option>
            </select>
            <span className="ml-auto text-[10px] font-black uppercase tracking-widest text-muted-foreground">
              {filtered.length} opération(s) programmée(s)
            </span>
          </div>

          <PspV1Table
            operations={filtered}
            totalParAnnee={totalParAnnee}
            onOpen={setSelectedOpId}
            ajoutOuvert={ajoutOuvert}
            reference={reference}
            programmationId={programmationId}
            onSaved={() => {
              setAjoutOuvert(false);
              void queryClient.invalidateQueries({ queryKey: ["psp-v1-brouillon"] });
              void queryClient.invalidateQueries({ queryKey: ["psp-v1-revue"] });
            }}
            onAnnuler={() => setAjoutOuvert(false)}
          />

          {selectedOp ? (
            <PspOperationDetail
              operation={selectedOp}
              perimetresLigne={perimetresParLigne.get(selectedOp?.id ?? "") ?? []}
              lotsParId={lotsParId}
              reference={reference}
              figee={false}
              historique={historiqueParLigne.get(selectedOp?.id ?? "") ?? []}
              focusDevis={false}
              onClose={() => setSelectedOpId(null)}
              onSave={(saisie) => void handleModifier(saisie, selectedOp)}
              onSupprimer={handleSupprimer}
              onDevisAdd={handleDevisAdd}
              onDevisUpdate={handleDevisUpdate}
              onDevisDelete={handleDevisDelete}
              onDemandeEnvoyee={async () => {
                await queryClient.invalidateQueries({ queryKey: ["psp-v1-brouillon"] });
              }}
            />
          ) : null}
        </>
      ) : null}

      {/* ── Niveau REVUE ───────────────────────────────────────────────────── */}
      {niveau === "revue" ? (
        <PspRevueAnciennes entrees={revue ?? []} anneeReference={ANNEE_REFERENCE_V1} />
      ) : null}

      {/* ── Niveau SUIVI ───────────────────────────────────────────────────── */}
      {niveau === "suivi" ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <a
            href="/suivi"
            className="rounded-xl border bg-card p-4 shadow-sm transition-colors hover:border-primary"
          >
            <p className="text-xs font-black uppercase tracking-widest text-foreground">/suivi</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Registre annuel réel — l'exécution de l'exercice. Un devis ne détermine jamais l'année
              ; aucune commande future n'apparaît artificiellement.
            </p>
            <Badge className="mt-2">Ouvrir le registre annuel →</Badge>
          </a>
          <div className="rounded-xl border bg-card p-4 shadow-sm">
            <p className="text-xs font-black uppercase tracking-widest text-muted-foreground">
              /preparation-psp
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Ce que nous prévoyons — la programmation pluriannuelle 2027-2031.
            </p>
          </div>
          <div className="rounded-xl border bg-card p-4 shadow-sm">
            <p className="text-xs font-black uppercase tracking-widest text-muted-foreground">
              /dashboard-travaux
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Information issue des commandes et des imports (source READ-ONLY).
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
