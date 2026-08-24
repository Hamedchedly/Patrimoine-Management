import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, FlaskConical, Plus, Settings2 } from "lucide-react";
import { toast } from "sonner";

import PspAncienneProgrammation from "@/components/preparation-psp/PspAncienneProgrammation";
import PspGroupingSelector, {
  type ModeAffichage,
} from "@/components/preparation-psp/PspGroupingSelector";
import PspHeader from "@/components/preparation-psp/PspHeader";
import PspKpi from "@/components/preparation-psp/PspKpi";
import PspOperationDetail from "@/components/preparation-psp/PspOperationDetail";
import PspOperationForm from "@/components/preparation-psp/PspOperationForm";
import PspSettingsDialog, {
  type OngletParametres,
} from "@/components/preparation-psp/PspSettingsDialog";
import PspSecteurBadge from "@/components/preparation-psp/PspSecteurBadge";
import type { DevisEdit } from "@/components/preparation-psp/PspDevisPanel";
import PspRevueAnciennes from "@/components/preparation-psp/PspRevueAnciennes";
import PspRevueReports from "@/components/preparation-psp/PspRevueReports";
import PspTable from "@/components/preparation-psp/PspTable";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { money0 } from "@/lib/formats";
import * as XLSX from "xlsx";
import {
  construireDonneesExportXlsx,
  FILTRES_VIDES,
  PSP_ANNEES,
  construirePerimetresDepuisSaisie,
  construireProgrammeDepuisSaisie,
  ajouterOperationListe,
  fusionnerProgramme,
  modifierOperationListe,
  programmerAnnee,
  supprimerOperationListe,
  totalOperation,
  type FiltresDetail,
  type PspAnnee,
  type PspCategorie,
  type PspOperation,
  type SaisieOperation,
} from "@/lib/psp.prep";
import {
  construireReferencePatrimoine,
  enrichirOperationsAvecReference,
  parseEsquisse2027Workbook,
  type ReferencePatrimoine,
} from "@/lib/psp.prep.data";
import { getPspFichiers2026, getPspReferencePatrimoine } from "@/lib/psp.prep.data.functions";
import {
  HISTORIQUE_MODIFICATIONS_MOCK,
  PSP_PROGRAMMATION_2026,
  SUIVI_2026_MOCK,
  cleModification,
  detecterModificationsLigne,
  extraireConfirmationsHistorique,
  ligneSuiviDepuisRaw,
  type CategorieSuivi,
  type LigneArbitrage,
  type LigneProgrammee,
  type LigneSuivi,
  type ModificationSuivi,
} from "@/lib/psp.prep.suivi";
import { getTravauxDashboard } from "@/lib/travaux.dashboard.functions";
import {
  createPspDevis,
  createPspLigne,
  createPspOperationComplete,
  createPspProgrammation,
  deletePspDevis,
  deletePspLigne,
  getPspBrouillon,
  getPspRevueAnciennes,
  savePspEnveloppes,
  updatePspDevis,
  updatePspLigne,
  updatePspLigneStatutPriorite,
  updatePspOperationComplete,
  type PspLignePersist,
  type PspPerimetrePersist,
} from "@/lib/psp.prep.supabase.functions";
import {
  analyserCompletudeExport,
  calculEnveloppe,
  type EnveloppeMap,
  libelleAdressePerimetre,
  type LigneIncompleteExport,
  type LotInfo,
  type PerimetreLigne,
  programmeParAnneeCategorie,
  extraireCodeCorpsEtat,
} from "@/lib/psp.prep.v7";

export const Route = createFileRoute("/preparation-psp")({
  head: () => ({
    meta: [
      { title: "Préparation PSP — Programmation pluriannuelle des travaux" },
      {
        name: "description",
        content:
          "V6 : préparation de la programmation pluriannuelle des travaux (2027-2031) avec brouillon persisté dans Supabase (lignes, devis, reports, décisions, commandes).",
      },
    ],
  }),
  component: PreparationPspPage,
});

function PreparationPspPage() {
  const [mode, setMode] = useState<ModeAffichage>("detail");
  const [filters, setFilters] = useState<FiltresDetail>(FILTRES_VIDES);
  const [selectedOpId, setSelectedOpId] = useState<string | null>(null);
  /** V7.5 §10 — focus sur la section Devis à l'ouverture de la fiche. */
  const [focusDevisId, setFocusDevisId] = useState<string | null>(null);
  const [ancienneOuverte, setAncienneOuverte] = useState(false);
  const [simulationOuverte, setSimulationOuverte] = useState(false);
  const [formOuvert, setFormOuvert] = useState(false);
  const [formMode, setFormMode] = useState<"ajout" | "modification">("ajout");
  const [formOperation, setFormOperation] = useState<PspOperation | null>(null);

  // ── V7.1 : filtre annuel cumulatif (répartition cliquable), enveloppes ──
  const [anneesFiltre, setAnneesFiltre] = useState<PspAnnee[]>([]);
  const [enveloppes, setEnveloppes] = useState<EnveloppeMap>({});
  /** V7.7 §7 — UN SEUL dialogue « Paramètres PSP » (CC / corps d'état / enveloppes). */
  const [settingsOuvert, setSettingsOuvert] = useState(false);
  const [settingsOnglet, setSettingsOnglet] = useState<OngletParametres>("charges");
  /** V7.6 §2 — lignes incomplètes détectées avant export (null = aucun contrôle affiché). */
  const [exportIncompletes, setExportIncompletes] = useState<LigneIncompleteExport[] | null>(null);
  const [perimetresParLigne, setPerimetresParLigne] = useState<Map<string, PerimetreLigne[]>>(
    new Map(),
  );
  const [historiqueParLigne, setHistoriqueParLigne] = useState<
    Map<string, Array<Record<string, unknown>>>
  >(new Map());
  const [lotsParId, setLotsParId] = useState<Map<string, LotInfo>>(new Map());

  // Source des opérations : brouillon Supabase (source de vérité — V7.10 §2).
  // Aucun mock au chargement : l'état initial est VIDE, le brouillon remplit la table.
  const [source, setSource] = useState<{ type: "mock" | "fichier"; fichier?: string }>({
    type: "mock",
  });
  const [operations, setOperations] = useState<PspOperation[]>([]);
  const [reference, setReference] = useState<ReferencePatrimoine | null>(null);

  // ── Persistance Supabase V6.2 : brouillon actif (jamais créé automatiquement) ──
  const [programmation, setProgrammation] = useState<{
    id: string;
    statut: string;
    version: number;
    annee_debut?: number;
  } | null>(null);
  const queryClient = useQueryClient();
  const fetchBrouillon = useServerFn(getPspBrouillon);
  const { data: brouillon, isFetching: brouillonChargement } = useQuery({
    queryKey: ["psp-brouillon-supabase"],
    queryFn: () => fetchBrouillon(),
    staleTime: 1000 * 30,
    retry: 1,
  });
  const figee = programmation?.statut === "figee";
  const aucuneProgrammation = !!brouillon && !brouillon.programmation && !brouillonChargement;

  // Au chargement : la source de vérité est le brouillon Supabase (lignes réelles).
  // Aucun brouillon → état vide explicite (pas de mock silencieux, V6.2).
  useEffect(() => {
    if (!brouillon) return;
    if (!brouillon.programmation) {
      setProgrammation(null);
      setOperations([]);
      return;
    }
    setProgrammation({
      id: brouillon.programmation.id,
      statut: brouillon.programmation.statut,
      version: brouillon.programmation.version,
      annee_debut: brouillon.programmation.annee_debut,
    });
    const env: EnveloppeMap = {};
    for (const e of brouillon.enveloppes ?? []) {
      env[`${e.annee}|${e.categorie}`] = e.montant;
    }
    setEnveloppes(env);
    const devisParLigne = new Map<string, Array<Record<string, unknown>>>();
    for (const d of brouillon.devis ?? []) {
      const id = String(d["psp_ligne_id"] ?? "");
      if (!id) continue;
      devisParLigne.set(id, [...(devisParLigne.get(id) ?? []), d]);
    }
    // Périmètres par ligne (affichage de l'adresse réelle dans le tableau).
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
    // Historique des lignes (V7.3) — pour la fiche opération.
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
    // Enrichissement patrimoine réel (tranches/lots/commandes) — jamais copié en base.
    setOperations(reference ? enrichirOperationsAvecReference(ops, reference) : ops);
  }, [brouillon, reference]);

  // Référence réelle PAT S11 (lecture seule, ~3 requêtes, aucune écriture).
  const fetchReference = useServerFn(getPspReferencePatrimoine);
  const {
    data: refBrute,
    isLoading: refChargement,
    isError: refErreur,
  } = useQuery({
    queryKey: ["psp-reference-patrimoine"],
    queryFn: () => fetchReference(),
    staleTime: 1000 * 60 * 60,
    retry: 1,
  });

  // Enrichit une seule fois la base d'opérations avec la référence réelle
  // (CC / adresse / ville / sous-secteur alignés sur les vraies données).
  useEffect(() => {
    if (!refBrute) return;
    const ref = construireReferencePatrimoine(
      refBrute.tranches,
      refBrute.lots,
      refBrute.commandes,
      refBrute.chargesClientele,
    );
    setReference(ref);
    // Index id → lot pour le libellé de périmètre (affichage — jamais copié).
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
    setOperations((prev) => enrichirOperationsAvecReference(prev, ref));
  }, [refBrute]);

  // ── Revue des reports : consomme les RÉSULTATS du moteur d'import annuel ──
  // (V4 : les VRAIS fichiers 2026 sont traités par le moteur existant —
  //  `parseTravauxWorkbook` pour le suivi, `parseProgrammationWorkbook` pour la
  //  programmation. Repli sur les mocks si les fichiers sont absents.)
  const fetchFichiers2026 = useServerFn(getPspFichiers2026);
  const { data: fichiers2026 } = useQuery({
    queryKey: ["psp-fichiers-2026"],
    queryFn: () => fetchFichiers2026(),
    staleTime: 1000 * 60 * 60,
    retry: 1,
  });

  /** Lignes du suivi de l'exercice N-1 (2026), ou mock si indisponibles. */
  const suivi = useMemo<LigneSuivi[]>(() => {
    if (fichiers2026?.disponible) {
      const lignes = [
        ...fichiers2026.suivi.commandes.map((c) =>
          ligneSuiviDepuisRaw(c as unknown as Record<string, unknown>),
        ),
        ...fichiers2026.suivi.erreurs.map((e) =>
          ligneSuiviDepuisRaw(e as unknown as Record<string, unknown>),
        ),
      ];
      if (lignes.length > 0) return lignes;
    }
    return SUIVI_2026_MOCK;
  }, [fichiers2026]);

  /** Programmation 2026 réelle (feuille « Prog 2026 »), ou mock. */
  const programmees2026 = useMemo<LigneProgrammee[]>(() => {
    if (fichiers2026?.disponible && fichiers2026.programmation.lignes.length > 0) {
      return fichiers2026.programmation.lignes
        .filter((l) => (l.programme["2026"] ?? 0) > 0)
        .map((l) => ({
          tranche: l.tranche,
          categorie: (l.categorie ?? "GT") as CategorieSuivi,
          nature_travaux: l.nature_travaux,
          montant: l.programme["2026"] ?? 0,
          annee: 2026,
          ligne_budget: l.ligne_budget,
        }));
    }
    return PSP_PROGRAMMATION_2026;
  }, [fichiers2026]);

  const suivi2026Disponible = fichiers2026?.disponible === true;

  /** V8.9.1 — Revue des ANCIENNES PROGRAMMATIONS (lecture seule) : source de
   *  vérité = psp_lignes.programme multi-années. Référence = 2027 (début de la
   *  programmation officielle). Aucune écriture. */
  const fetchRevueAnciennes = useServerFn(getPspRevueAnciennes);
  const { data: revueAnciennes } = useQuery({
    queryKey: ["psp-revue-anciennes", programmation?.annee_debut ?? 2027],
    queryFn: () =>
      fetchRevueAnciennes({ data: { anneeReference: programmation?.annee_debut ?? 2027 } }),
    staleTime: 1000 * 60 * 5,
    retry: 1,
    enabled: Boolean(programmation?.annee_debut),
  });

  /** Historique des conflits/modifications produit par le moteur d'import
   *  (lecture réelle Supabase via getTravauxDashboard ; mock en repli). */
  const fetchDashboard = useServerFn(getTravauxDashboard);
  const { data: dash } = useQuery({
    queryKey: ["psp-suivi-historique"],
    queryFn: () => fetchDashboard(),
    staleTime: 1000 * 60 * 60,
    retry: 1,
  });

  const historique = useMemo(() => {
    if (dash && dash.historique.length > 0) {
      return dash.historique
        .filter((h) => h.operation === "conflit")
        .map((h) => ({
          avant: h.avant as Record<string, unknown> | null,
          apres: h.apres as Record<string, unknown> | null,
          resolu: h.resolu,
          ligne: h.commande_id ?? "?",
        }));
    }
    return HISTORIQUE_MODIFICATIONS_MOCK as unknown as Array<{
      avant: Record<string, unknown> | null;
      apres: Record<string, unknown> | null;
      resolu: boolean;
      ligne: string;
    }>;
  }, [dash]);

  /** Alertes de modifications (ligne, ancienne/nouvelle valeur, type, date, source). */
  const modifications = useMemo<ModificationSuivi[]>(() => {
    const liste: ModificationSuivi[] = [];
    for (const h of historique) {
      const avant = h.avant ?? {};
      const apres = h.apres ?? {};
      const ligneLabel = String(avant["tranche_code"] ?? apres["tranche_code"] ?? "?");
      for (const m of detecterModificationsLigne(avant, apres, ligneLabel)) {
        liste.push({ ...m, date: null, source: "import suivi annuel" });
      }
    }
    return liste;
  }, [historique]);

  const [confirmeesLocales, setConfirmeesLocales] = useState<Set<string>>(new Set());
  /** Mémoire de confirmation = historique resolu=true + décisions locales. */
  const confirmees = useMemo(() => {
    const set = extraireConfirmationsHistorique(historique.map((h) => ({ ...h, ligne: h.ligne })));
    confirmeesLocales.forEach((cle) => set.add(cle));
    return set;
  }, [historique, confirmeesLocales]);

  /** Décisions locales de la revue des reports (brouillon courant uniquement). */
  const [decisions, setDecisions] = useState<Map<string, string>>(new Map());

  const handleReporter = async (ligne: LigneArbitrage, anneeCible: number) => {
    if (figee || !programmation?.id) {
      toast.error(figee ? "Programmation figée : report impossible." : "Brouillon non chargé.");
      return;
    }
    const remarques = `Report de ${ligne.annee_initiale} (programmation ${ligne.annee_initiale} non engagée)`;
    // V8.9 — REPORT ADDITIF : si une ligne du brouillon porte déjà la même
    // opération (TR + C + nature normalisée), on AJOUTE l'année cible à son
    // programme existant (les autres années sont préservées) — jamais un doublon.
    // Sinon, on crée la ligne cible origine='report' (comportement historique).
    const norm = (v: string | null | undefined): string =>
      (v ?? "").toUpperCase().replace(/\s+/g, " ").trim();
    const candidat = operations.find(
      (o) =>
        o.tranche === ligne.tranche &&
        o.categorie === ligne.categorie &&
        norm(o.nature_travaux) === norm(ligne.nature_travaux),
    );

    if (candidat) {
      const { programme, change } = programmerAnnee(
        candidat.programme,
        anneeCible,
        ligne.montant_programme,
      );
      if (!change) {
        toast.info(`L'opération est déjà programmée en ${anneeCible} (aucun changement).`);
        return;
      }
      setOperations((prev) =>
        prev.map((o) =>
          o.id === candidat.id
            ? { ...o, programme, budget: totalOperation({ ...o, programme }) }
            : o,
        ),
      );
      setDecisions((prev) =>
        new Map(prev).set(`${ligne.tranche}|${ligne.categorie}`, `Report ${anneeCible}`),
      );
      try {
        await updateCompleteFn({
          data: {
            id: candidat.id,
            trancheCode: candidat.tranche,
            categorie: candidat.categorie,
            corpsEtatCode: candidat.corps_etat_code || null,
            corpsEtat: candidat.corps_etat || null,
            natureTravaux: candidat.nature_travaux || null,
            programme,
            remarques: candidat.remarques ?? null,
            statut: candidat.statut ?? null,
            priorite: candidat.priorite ?? null,
            perimetres: (perimetresParLigne.get(candidat.id) ?? []).map((p) => ({
              niveau: p.niveau,
              rue: p.rue,
              numero: p.numero,
              lotId: p.lot_id,
            })),
          },
        });
        toast.success(
          `Opération reprogrammée en ${anneeCible} (ligne existante, années préservées).`,
        );
      } catch (e) {
        toast.error(`Report non persisté : ${(e as Error).message}`);
      }
      return;
    }

    const saisie: SaisieOperation = {
      tranche: ligne.tranche,
      categorie: ligne.categorie,
      charge_clientele: reference?.tranches.get(ligne.tranche)?.charge_clientele ?? "",
      charge_operation: "",
      corps_etat: "",
      adresse: reference?.tranches.get(ligne.tranche)?.adresse_reference ?? "",
      ville: reference?.tranches.get(ligne.tranche)?.ville ?? "",
      nature_travaux: ligne.nature_travaux,
      annee: anneeCible as PspAnnee,
      programme: PSP_ANNEES.map((a) => (a === anneeCible ? ligne.montant_programme : 0)),
      remarques,
    };
    const id = `report-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    setOperations((prev) => {
      const liste = ajouterOperationListe(prev, saisie, id);
      const op = liste[liste.length - 1];
      if (op) {
        op.reportee = true;
        op.ancienne_annee = ligne.annee_initiale;
        op.ancien_montant = ligne.montant_programme;
      }
      return liste;
    });
    setDecisions((prev) =>
      new Map(prev).set(`${ligne.tranche}|${ligne.categorie}`, `Report ${anneeCible}`),
    );
    // Persistance : la ligne cible est créée dans le brouillon (origine='report').
    const programme: Record<string, number> = {};
    PSP_ANNEES.forEach((a) => {
      programme[String(a)] = a === anneeCible ? ligne.montant_programme : 0;
    });
    try {
      const creee = await createLigneFn({
        data: {
          programmationId: programmation.id,
          trancheCode: ligne.tranche,
          categorie: ligne.categorie,
          corpsEtatCode: null,
          corpsEtat: null,
          natureTravaux: ligne.nature_travaux || null,
          programme,
          ligneBudget: null,
          remarques: saisie.remarques ?? null,
          origine: "report",
        },
      });
      setOperations((prev) => prev.map((o) => (o.id === id ? { ...o, id: creee.id } : o)));
      toast.success(`Opération reportée en ${anneeCible} (brouillon Supabase).`);
    } catch (e) {
      setOperations((prev) => supprimerOperationListe(prev, id));
      toast.error(`Report non persisté : ${(e as Error).message}`);
    }
  };

  const handleAnnuler = (ligne: LigneArbitrage) => {
    setDecisions((prev) => new Map(prev).set(`${ligne.tranche}|${ligne.categorie}`, "Annulée"));
    toast.info("Opération annulée dans le brouillon (aucune écriture).");
  };

  const handleConserver = (ligne: LigneArbitrage) => {
    setDecisions((prev) => new Map(prev).set(`${ligne.tranche}|${ligne.categorie}`, "Conservée"));
    toast.info("Opération conservée (décision locale).");
  };

  const handleReevaluer = (ligne: LigneArbitrage) => {
    setDecisions((prev) => new Map(prev).set(`${ligne.tranche}|${ligne.categorie}`, "À réévaluer"));
    toast.info("Opération à réévaluer (décision locale).");
  };

  const handleConfirmerModification = (modification: ModificationSuivi) => {
    setConfirmeesLocales((prev) => new Set(prev).add(cleModification(modification)));
    toast.success("Modification confirmée localement — ne sera pas redemandée.");
  };

  const selectedOp = useMemo(
    () => operations.find((o) => o.id === selectedOpId) ?? null,
    [operations, selectedOpId],
  );

  /** V7.6 §9 — sous-secteurs présents dans le fichier patrimoine (pour la console CC). */
  const sousSecteursConnus = useMemo(
    () =>
      reference
        ? [
            ...new Set(
              [...reference.tranches.values()]
                .map((t) => t.sous_secteur)
                .filter((s): s is string => Boolean(s)),
            ),
          ]
        : [],
    [reference],
  );

  // ── V7 : filtre annuel CUMULATIF (visuel uniquement — ne modifie jamais la
  // programmation ni la base). Opération visible si une année sélectionnée est programmée.
  const operationsFiltrees = useMemo(() => {
    if (anneesFiltre.length === 0) return operations;
    const set = new Set(anneesFiltre.map(String));
    return operations.filter((o) =>
      PSP_ANNEES.some((a) => set.has(String(a)) && (o.programme?.[String(a)] ?? 0) > 0),
    );
  }, [operations, anneesFiltre]);

  const toggleAnnee = (a: PspAnnee) => {
    setAnneesFiltre((prev) => (prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]));
  };

  const saveEnveloppesFn = useServerFn(savePspEnveloppes);
  const handleSaveEnveloppes = async (map: EnveloppeMap) => {
    if (!programmation?.id) {
      toast.error("Brouillon non chargé.");
      return;
    }
    const rows = Object.entries(map).map(([cle, montant]) => {
      const [annee, categorie] = cle.split("|");
      return { annee: Number(annee), categorie: categorie as "GE" | "GT" | "CP", montant };
    });
    try {
      await saveEnveloppesFn({
        data: { programmationId: programmation.id, enveloppes: rows },
      });
      setEnveloppes(map);
      // V7.9 §1 — les flux consommant psp_enveloppes sont rafraîchis (brouillon,
      // grille Paramètres) pour rester alignés sur Supabase.
      void queryClient.invalidateQueries({ queryKey: ["psp-brouillon-supabase"] });
      void queryClient.invalidateQueries({ queryKey: ["psp-enveloppes"] });
      toast.success("Enveloppes enregistrées dans Supabase.");
    } catch (e) {
      toast.error(`Enregistrement impossible : ${(e as Error).message}`);
    }
  };

  const sourceLabel =
    source.type === "fichier" && source.fichier
      ? source.fichier
      : brouillonChargement
        ? "brouillon Supabase (chargement…)"
        : aucuneProgrammation
          ? "aucune programmation PSP"
          : figee
            ? `brouillon Supabase v${programmation?.version ?? "?"} — GELÉ (figée)`
            : `brouillon Supabase v${programmation?.version ?? "?"}`;
  const referenceResume = refBrute
    ? `référence réelle : ${refBrute.tranches.length} tranches · ${refBrute.lots.length} lots · ${refBrute.commandes.length} commandes`
    : refChargement
      ? "référence réelle : chargement…"
      : refErreur
        ? "référence réelle indisponible — valeurs conservées sans enrichissement"
        : null;

  const exporter = () => {
    const enrichies = operationsAvecAdresseExport();
    // V7.6 §2 — contrôle de complétude AVANT export : les lignes incomplètes
    // bloquent l'export officiel par défaut (brouillon permissif, export strict).
    const incompletes = analyserCompletudeExport(enrichies);
    if (incompletes.length > 0) {
      setExportIncompletes(incompletes);
      return;
    }
    telechargerXlsx(enrichies);
    toast.success("Export Excel généré (données locales).");
  };

  /** V7.3 §21 + V7.7 §2 — opérations avec adresse = périmètre réellement sélectionné. */
  const operationsAvecAdresseExport = (): PspOperation[] =>
    operations.map((o) => {
      const libelle = libelleAdressePerimetre(perimetresParLigne.get(o.id) ?? [], lotsParId, {
        adresse: o.adresse,
        ville: o.ville,
      });
      return libelle && libelle !== "—" ? { ...o, adresse: libelle } : o;
    });

  /** V7.7 §1 + V7.8 §9 — export VRAI fichier Excel .xlsx (13 colonnes exactes). */
  const telechargerXlsx = (ops: PspOperation[]) => {
    const donnees = construireDonneesExportXlsx(ops, {
      // V7.8 §9 — Arl/sect = IDENTIFIANT PERSONNEL du référentiel CC
      // (tranches.sous_secteur → psp_charges_clientele.identifiant_personnel).
      // Jamais le nom du CC, jamais le sous-secteur, jamais inventé.
      secteurDeTranche: (tranche) =>
        reference?.tranches.get(tranche)?.identifiant_personnel ?? null,
    });
    const feuille = XLSX.utils.aoa_to_sheet([donnees.entetes, ...donnees.lignes]);
    feuille["!cols"] = donnees.entetes.map((e) =>
      e === "NATURE TRAVAUX" || e === "ADRESSE"
        ? { wch: 40 }
        : e === "CORPS D'ETAT"
          ? { wch: 28 }
          : { wch: 12 },
    );
    const classeur = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(classeur, feuille, "Programmation PSP");
    XLSX.writeFile(classeur, "programmation-psp-2027-2031.xlsx");
  };

  const exporterMalgreTout = () => {
    const enrichies = operationsAvecAdresseExport();
    setExportIncompletes(null);
    telechargerXlsx(enrichies);
    toast.info("Export généré malgré les lignes incomplètes (aucune donnée inventée).");
  };

  const analyser = () =>
    toast.info("Analyse — simulation V2. Le moteur d'analyse sera connecté à Supabase plus tard.");

  const ouvrirModification = (op: PspOperation) => {
    if (figee) {
      toast.error("Programmation figée : modification impossible.");
      return;
    }
    // V7.5 §10 — le stylo ouvre la FICHE UNIQUE d'édition (formulaire + devis + historique).
    setFocusDevisId(null);
    setSelectedOpId(op.id);
  };

  /** V7.5 §10 — clic « Devis » : ouvre la même fiche sur la section Devis. */
  const ouvrirDevis = (op: PspOperation) => {
    setSelectedOpId(op.id);
    setFocusDevisId(op.id);
  };

  const createLigneFn = useServerFn(createPspLigne);
  const updateLigneFn = useServerFn(updatePspLigne);
  const deleteLigneFn = useServerFn(deletePspLigne);
  const createProgFn = useServerFn(createPspProgrammation);
  const createCompleteFn = useServerFn(createPspOperationComplete);
  const updateCompleteFn = useServerFn(updatePspOperationComplete);
  const statutPrioriteFn = useServerFn(updatePspLigneStatutPriorite);
  const createDevisFn = useServerFn(createPspDevis);
  const updateDevisFn = useServerFn(updatePspDevis);
  const deleteDevisFn = useServerFn(deletePspDevis);

  /** Crée la préparation 2027-2031 (officielle, brouillon, v1) puis recharge. */
  const handleCreerPreparation = async () => {
    try {
      await createProgFn();
      await queryClient.invalidateQueries({ queryKey: ["psp-brouillon-supabase"] });
      toast.success("Préparation PSP 2027-2031 créée (brouillon v1).");
    } catch (e) {
      toast.error(`Création impossible : ${(e as Error).message}`);
    }
  };

  /** Statut / priorité : persistés dans psp_lignes (badges + sélecteurs). */
  const handleStatutPriorite = async (
    id: string,
    patch: { statut?: string; priorite?: string },
  ) => {
    if (figee) {
      toast.error("Programmation figée : modification impossible.");
      return;
    }
    setOperations((prev) => prev.map((o) => (o.id === id ? { ...o, ...patch } : o)));
    try {
      await statutPrioriteFn({ data: { id, ...patch } });
    } catch (e) {
      toast.error(`Statut / priorité non persisté : ${(e as Error).message}`);
    }
  };

  const majDevisOperation = (id: string, devis: PspOperation["devis"]) => {
    setOperations((prev) => prev.map((o) => (o.id === id ? { ...o, devis } : o)));
  };

  const handleDevisAdd = async (ligneId: string, d: DevisEdit) => {
    if (figee || !programmation?.id) return;
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
    if (figee) return;
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
    if (figee) return;
    await deleteDevisFn({ data: { id } });
    setOperations((prev) =>
      prev.map((o) => ({ ...o, devis: o.devis.filter((dv) => dv.id !== id) })),
    );
    toast.success("Devis supprimé (psp_devis).");
  };

  /** Après une saisie directe : recharger le brouillon (lignes + périmètres). */
  const handleQuickSaved = () => {
    void queryClient.invalidateQueries({ queryKey: ["psp-brouillon-supabase"] });
  };

  const handleAjouter = async (saisie: SaisieOperation) => {
    if (figee || !programmation?.id) {
      toast.error(figee ? "Programmation figée : ajout impossible." : "Brouillon non chargé.");
      return;
    }
    const id = `loc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const sousSecteur = reference?.tranches.get(saisie.tranche)?.sous_secteur ?? null;
    setOperations((prev) => {
      const liste = ajouterOperationListe(prev, saisie, id);
      const nouvelle = liste[liste.length - 1];
      if (nouvelle) nouvelle.sous_secteur = sousSecteur;
      return liste;
    });
    const programme = construireProgrammeDepuisSaisie(saisie.programme);
    try {
      const ligne = await createCompleteFn({
        data: {
          programmationId: programmation.id,
          trancheCode: saisie.tranche,
          categorie: saisie.categorie,
          corpsEtatCode: extraireCodeCorpsEtat(saisie.corps_etat),
          corpsEtat: saisie.corps_etat || null,
          natureTravaux: saisie.nature_travaux || null,
          programme,
          ligneBudget: null,
          remarques: saisie.remarques ?? null,
          statut: saisie.statut ?? null,
          priorite: saisie.priorite ?? null,
          origine: "preparation",
          perimetres: construirePerimetresDepuisSaisie(saisie.perimetres),
          devis: undefined,
        },
      });
      setOperations((prev) => prev.map((o) => (o.id === id ? { ...o, id: ligne.id } : o)));
      toast.success(`Opération persistée dans Supabase (brouillon v${programmation.version}).`);
    } catch (e) {
      setOperations((prev) => supprimerOperationListe(prev, id));
      toast.error(`Échec de la persistance : ${(e as Error).message}`);
    }
  };

  const handleModifier = async (saisie: SaisieOperation, operation?: PspOperation | null) => {
    const cible = operation ?? formOperation;
    if (!cible) return;
    if (figee) {
      toast.error("Programmation figée : modification impossible.");
      return;
    }
    const programme = construireProgrammeDepuisSaisie(saisie.programme);
    const patch: {
      tranche: string;
      categorie: string;
      charge_clientele: string;
      charge_operation: string;
      corps_etat: string;
      adresse: string;
      ville: string;
      sous_secteur: string | null;
      nature_travaux: string;
      annee: number;
      programme: Record<string, number>;
      remarques: string | null;
      statut?: string;
      priorite?: string;
    } = {
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
    setOperations((prev) =>
      modifierOperationListe(prev, cible.id, patch as Parameters<typeof modifierOperationListe>[2]),
    );
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
      setPerimetresParLigne((prev) => {
        const next = new Map(prev);
        next.set(cible.id, saisie.perimetres ?? []);
        return next;
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

  /** Notes/remarques éditables en ligne (psp_lignes.remarques). */
  const handleNotes = async (id: string, remarques: string) => {
    if (figee) {
      toast.error("Programmation figée : modification impossible.");
      return;
    }
    const op = operations.find((o) => o.id === id);
    if (!op) return;
    setOperations((prev) =>
      prev.map((o) => (o.id === id ? { ...o, remarques: remarques || null } : o)),
    );
    try {
      await updateLigneFn({
        data: {
          id,
          trancheCode: op.tranche,
          categorie: op.categorie,
          corpsEtatCode: op.corps_etat_code || null,
          corpsEtat: op.corps_etat || null,
          natureTravaux: op.nature_travaux || null,
          programme: op.programme,
          ligneBudget: null,
          remarques: remarques || null,
          statut: op.statut,
          priorite: op.priorite,
        },
      });
    } catch (e) {
      toast.error(`Notes non persistées : ${(e as Error).message}`);
    }
  };

  const handleSupprimer = async (id: string) => {
    if (figee) {
      toast.error("Programmation figée : suppression impossible.");
      return;
    }
    // V7.5 §11 — la confirmation est portée par la fiche (AlertDialog). DELETE réel + SELECT vérifié.
    setOperations((prev) => supprimerOperationListe(prev, id));
    setSelectedOpId(null);
    try {
      await deleteLigneFn({ data: { id } });
      toast.success("Opération supprimée (persistance Supabase).");
    } catch (e) {
      toast.error(`Échec de la suppression : ${(e as Error).message}`);
    }
  };

  const handleChargerEsquisse = (fichier: File) => {
    fichier
      .arrayBuffer()
      .then((buf) => {
        const resultat = parseEsquisse2027Workbook(buf, fichier.name);
        if (resultat.operations.length === 0) {
          toast.error(
            `Aucune opération lue dans « ${fichier.name} ».${
              resultat.erreurs[0] ? ` ${resultat.erreurs[0]}` : ""
            }`,
          );
          return;
        }
        setOperations(enrichirOperationsAvecReference(resultat.operations, reference));
        setSource({ type: "fichier", fichier: fichier.name });
        if (resultat.erreurs.length > 0) {
          toast.warning(
            `${resultat.erreurs.length} ligne(s) signalée(s) — ex. ${resultat.erreurs[0]}`,
          );
        }
        toast.success(`Esquisse chargée : ${resultat.operations.length} opérations (locale).`);
      })
      .catch((e) => toast.error(`Lecture du fichier impossible : ${String(e)}`));
  };

  return (
    <div className="min-h-screen bg-background pb-12 text-foreground">
      <PspHeader
        onAncienneProgrammation={() => setAncienneOuverte(true)}
        onAnalyser={analyser}
        onSimulation={() => setSimulationOuverte(true)}
        onExporter={exporter}
        onChargerEsquisse={handleChargerEsquisse}
        sourceLabel={sourceLabel}
        referenceResume={referenceResume}
      />

      <main className="mx-auto max-w-[2200px] space-y-4 px-4 pt-4 sm:px-6">
        {brouillonChargement ? (
          /* V7.10 §2 — pendant le chargement : AUCUN mock, aucun tableau vide trompeur. */
          <div className="rounded-xl border border-dashed p-10 text-center">
            <p className="text-lg font-black">Chargement de la programmation…</p>
          </div>
        ) : (
          <>
            <PspKpi
              operations={operations}
              anneesFiltre={anneesFiltre}
              onToggleAnnee={toggleAnnee}
              enveloppes={enveloppes}
              onOuvrirEnveloppes={() => {
                setSettingsOnglet("enveloppes");
                setSettingsOuvert(true);
              }}
              figee={figee}
            />

            {aucuneProgrammation ? (
              <div className="rounded-xl border border-dashed p-10 text-center">
                <p className="text-lg font-black">Aucune programmation PSP enregistrée.</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Créez la préparation pluriannuelle 2027-2031 (officielle, brouillon v1) pour
                  commencer la saisie des opérations.
                </p>
                <Button className="mt-4" onClick={() => void handleCreerPreparation()}>
                  <Plus className="size-4" />
                  Créer la préparation 2027-2031
                </Button>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <PspGroupingSelector mode={mode} onChange={setMode} />
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 text-[11px]"
                      onClick={() => {
                        setSettingsOnglet("charges");
                        setSettingsOuvert(true);
                      }}
                      title="Paramètres PSP : chargés clientèle, corps d'état, enveloppes budgétaires"
                    >
                      <Settings2 className="size-3.5" />
                      Paramètres PSP
                    </Button>
                  </div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                    Source : {sourceLabel} · {operations.length} opérations · enveloppes
                    psp_enveloppes
                  </p>
                </div>

                {mode === "reports" ? (
                  <>
                    <PspRevueAnciennes
                      entrees={revueAnciennes ?? []}
                      anneeReference={programmation?.annee_debut ?? 2027}
                    />
                    <PspRevueReports
                      programmees={programmees2026}
                      suivi={suivi}
                      exercice={2027}
                      sourceFichiers={suivi2026Disponible}
                      modifications={modifications}
                      confirmees={confirmees}
                      decisions={decisions}
                      onReporter={handleReporter}
                      onAnnuler={handleAnnuler}
                      onConserver={handleConserver}
                      onReevaluer={handleReevaluer}
                      onConfirmerModification={handleConfirmerModification}
                    />
                  </>
                ) : (
                  <PspTable
                    mode={mode}
                    operations={operationsFiltrees}
                    filters={filters}
                    onFiltersChange={setFilters}
                    onOpenOperation={(op) => setSelectedOpId(op.id)}
                    onModifier={ouvrirModification}
                    onDevis={ouvrirDevis}
                    onStatutPriorite={handleStatutPriorite}
                    onNotes={handleNotes}
                    perimetresParLigne={perimetresParLigne}
                    lotsParId={lotsParId}
                    quickAdd={
                      programmation?.id
                        ? {
                            programmationId: programmation.id,
                            reference,
                            onSaved: handleQuickSaved,
                          }
                        : null
                    }
                    figee={figee}
                    reference={reference}
                  />
                )}
              </>
            )}
          </>
        )}
      </main>

      <PspOperationDetail
        operation={selectedOp}
        perimetresLigne={perimetresParLigne.get(selectedOp?.id ?? "") ?? []}
        lotsParId={lotsParId}
        reference={reference}
        figee={figee}
        historique={historiqueParLigne.get(selectedOp?.id ?? "") ?? []}
        focusDevis={focusDevisId === selectedOp?.id}
        onClose={() => {
          setSelectedOpId(null);
          setFocusDevisId(null);
        }}
        onSave={(saisie) => void handleModifier(saisie, selectedOp)}
        onSupprimer={handleSupprimer}
        onDevisAdd={handleDevisAdd}
        onDevisUpdate={handleDevisUpdate}
        onDevisDelete={handleDevisDelete}
        onDemandeEnvoyee={async () => {
          await queryClient.invalidateQueries({ queryKey: ["psp-brouillon-supabase"] });
        }}
      />

      <PspSettingsDialog
        open={settingsOuvert}
        onClose={() => setSettingsOuvert(false)}
        ongletInitial={settingsOnglet}
        sousSecteursConnus={sousSecteursConnus}
        programmationId={programmation?.id ?? null}
        onSaveEnveloppes={handleSaveEnveloppes}
        onChangedCC={() =>
          void queryClient.invalidateQueries({ queryKey: ["psp-reference-patrimoine"] })
        }
        onChangedCorps={() =>
          void queryClient.invalidateQueries({ queryKey: ["psp-referentiel-corps-etats"] })
        }
      />

      {/* V7.6 §2 — alerte export : lignes incomplètes (champs obligatoires manquants) */}
      <Dialog
        open={exportIncompletes !== null}
        onOpenChange={(o) => !o && setExportIncompletes(null)}
      >
        <DialogContent className="w-[min(92vw,620px)]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-destructive" />
              Certaines lignes sont incomplètes et ne peuvent pas être exportées.
            </DialogTitle>
            <DialogDescription>
              Le brouillon accepte ces lignes ; l'export officiel exige les champs des colonnes
              direction. Complétez les lignes ci-dessous ou exportez malgré tout (choix explicite).
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[45vh] overflow-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="w-20 text-[10px] font-black uppercase tracking-widest">
                    TR
                  </TableHead>
                  <TableHead className="text-[10px] font-black uppercase tracking-widest">
                    Champs manquants
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(exportIncompletes ?? []).map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-mono text-xs font-bold">{l.tranche}</TableCell>
                    <TableCell className="text-xs">{l.manquants.join(", ")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setExportIncompletes(null)}>
              Retourner aux lignes à compléter
            </Button>
            <Button variant="destructive" size="sm" onClick={exporterMalgreTout}>
              Exporter malgré les lignes incomplètes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PspOperationForm
        open={formOuvert}
        mode={formMode}
        operation={formOperation}
        reference={reference}
        perimetresLigne={perimetresParLigne.get(formOperation?.id ?? "") ?? []}
        onSave={formMode === "ajout" ? handleAjouter : handleModifier}
        onClose={() => setFormOuvert(false)}
      />

      <PspAncienneProgrammation
        open={ancienneOuverte}
        operations={operations}
        onClose={() => setAncienneOuverte(false)}
      />

      <SimulationDialog
        open={simulationOuverte}
        onClose={() => setSimulationOuverte(false)}
        operations={operations}
        enveloppes={enveloppes}
      />
    </div>
  );
}

function SimulationDialog({
  open,
  onClose,
  operations,
  enveloppes,
}: {
  open: boolean;
  onClose: () => void;
  operations: PspOperation[];
  enveloppes: EnveloppeMap;
}) {
  // V7.7 §11 — la simulation utilise EXACTEMENT les mêmes fonctions que la
  // préparation : calculEnveloppe + programmeParAnneeCategorie (aucun moteur parallèle).
  const programmePar = programmeParAnneeCategorie(operations);
  const totalProgramme = PSP_ANNEES.reduce(
    (s, a) =>
      s +
      (programmePar[`${a}|GE`] ?? 0) +
      (programmePar[`${a}|GT`] ?? 0) +
      (programmePar[`${a}|CP`] ?? 0),
    0,
  );
  const categories = ["GE", "GT", "CP"] as const;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[min(94vw,640px)] sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FlaskConical className="size-4 text-muted-foreground" />
            Simulation — avancement budgétaire
          </DialogTitle>
          <DialogDescription>
            Même calcul budgétaire que la préparation PSP : pour chaque année puis par GE / GT / CP
            — enveloppe, programmé, restant, % et dépassement éventuel.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-3 overflow-auto pr-1">
          {PSP_ANNEES.map((annee) => {
            const programme =
              (programmePar[`${annee}|GE`] ?? 0) +
              (programmePar[`${annee}|GT`] ?? 0) +
              (programmePar[`${annee}|CP`] ?? 0);
            const envAnnee = categories.reduce((s, c) => s + (enveloppes[`${annee}|${c}`] ?? 0), 0);
            // V7.10 §3 — budget disponible = somme des enveloppes réelles de l'année.
            // Aucun fallback mock : si rien n'est renseigné → « — » (jamais 0 €).
            const disponible = envAnnee;
            const restant = disponible - programme;
            const taux = disponible > 0 ? Math.min(1, programme / disponible) : 0;
            return (
              <div key={annee} className="rounded-lg border bg-surface/60 p-2.5">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-mono font-black">{annee}</span>
                  <span className="text-muted-foreground">
                    Budget disponible :{" "}
                    <span className="tabnum font-bold">
                      {disponible > 0 ? money0(disponible) : "—"}
                    </span>
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2 text-xs">
                  <span className="text-muted-foreground">
                    Programmé : <span className="tabnum font-bold">{money0(programme)}</span>
                  </span>
                  <span className="text-muted-foreground">
                    Restant :{" "}
                    <span
                      className={`tabnum font-black ${restant >= 0 ? "text-emerald-600" : "text-destructive"}`}
                    >
                      {disponible > 0 ? money0(restant) : "—"}
                    </span>
                  </span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-border">
                  <div
                    className={`h-full rounded-full ${restant < 0 ? "bg-destructive" : "bg-primary/70"}`}
                    style={{ width: `${Math.max(2, taux * 100)}%` }}
                  />
                </div>

                <div className="mt-2 space-y-1.5 border-t border-dashed pt-2">
                  {categories.map((cat) => {
                    const enveloppe = enveloppes[`${annee}|${cat}`] ?? 0;
                    const prog = programmePar[`${annee}|${cat}`] ?? 0;
                    const calc = calculEnveloppe(enveloppe, prog);
                    const pct = calc.pourcentage == null ? null : Math.min(1, calc.pourcentage);
                    return (
                      <div key={cat} className="text-[11px]">
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-1.5">
                            <PspSecteurBadge categorie={cat} />
                            <span className="font-bold">{cat}</span>
                            <span className="tabnum text-muted-foreground">
                              Enveloppe : {money0(enveloppe)} · Programmé : {money0(prog)} · Restant
                              :{" "}
                              <span
                                className={
                                  calc.depassement
                                    ? "font-black text-destructive"
                                    : "font-black text-emerald-600"
                                }
                              >
                                {money0(calc.restant)}
                              </span>
                            </span>
                          </span>
                          <span
                            className={`tabnum font-black ${calc.depassement ? "text-destructive" : "text-primary"}`}
                          >
                            {calc.pourcentage == null
                              ? "—"
                              : `${Math.round(calc.pourcentage * 100)} %`}
                          </span>
                        </div>
                        <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-border">
                          <div
                            className={`h-full rounded-full ${calc.depassement ? "bg-destructive" : "bg-primary/70"}`}
                            style={{ width: `${Math.max(2, (pct ?? 0) * 100)}%` }}
                          />
                        </div>
                        {calc.depassement ? (
                          <p className="mt-0.5 flex items-center gap-0.5 text-[9px] font-bold text-destructive">
                            <AlertTriangle className="size-2.5" />
                            Dépassement {money0(-calc.restant)} par rapport à l'enveloppe {cat}{" "}
                            {annee}
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between border-t pt-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
            Programme total : {money0(totalProgramme)}
          </p>
          <Button variant="outline" size="sm" onClick={onClose}>
            Fermer
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
