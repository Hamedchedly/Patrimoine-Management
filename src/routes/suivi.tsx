/**
 * V8.6.1 §4-§8 — SUIVI OPÉRATIONNEL ANNUEL (route /suivi).
 *
 * /suivi est le REGISTRE OPÉRATIONNEL ANNUEL : sélecteur d'année (défaut 2026),
 * état par défaut « Sans commande » (« ce qui doit encore être commandé »), puis
 * En cours / Terminées / À vérifier / Toutes. Alimenté par les données RÉELLES
 * (commandes de l'exercice + opérations de la préparation programmées sur
 * l'année ou hors PSP). Aucun MOCK, Dashboard inchangé.
 */
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, FileSearch, Loader2, Mail, Workflow } from "lucide-react";

import PspCommandesARapprocherPanel from "@/components/suivi/PspCommandesARapprocherPanel";
import PspCorrespondanceCommandeDialog from "@/components/suivi/PspCorrespondanceCommandeDialog";
import SuiviOperationFiche from "@/components/suivi/SuiviOperationFiche";
import TableauDemandesDevis from "@/components/suivi/TableauDemandesDevis";
import ModeleMailEditor from "@/components/preparation-psp/ModeleMailEditor";
import { useEtiquettesTranches } from "@/lib/tranches/etiquettes.hooks";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { money0 } from "@/lib/formats";
import {
  getLotsParRefsEr,
  getPspSuiviAnnuel,
  getPspSuiviOperations,
} from "@/lib/psp/prep.supabase.functions";
import { extraireErTexte } from "@/lib/commande/rattachement.lots";
import {
  appliquerErAdresse,
  indexerLotsParCode,
  kpiRegistreAnnuel,
  ligneDemandeDevisDepuisOperation,
  ligneDemandeDevisDepuisRegistre,
  operationSurAnnee,
  type LigneDemandeDevis,
  type LigneRegistreAnnuel,
  type LotErLeger,
} from "@/lib/psp/suivi.view";
import type { SuiviOperationVue } from "@/lib/psp/suivi.foundation";

export const Route = createFileRoute("/suivi")({
  head: () => ({
    meta: [
      { title: "Opérations — Suivi annuel PSP" },
      {
        name: "description",
        content:
          "Registre opérationnel annuel : opérations de l'année, commandes, engagements, paiements et travaux.",
      },
    ],
  }),
  component: SuiviPage,
});

// V8.10 — /suivi en DEUX ONGLETS : « Suivi annuel 2026 » (opérations sans
// commande → demandes de devis, mises à jour à chaque import du fichier
// annuel) et « PSP 2027 » (opérations programmées 2027). Années figées par
// onglet — le sélecteur d'année est supprimé.
const ANNEE_SUIVI = 2026;
const ANNEE_PSP = 2027;

/** V8.16l — données des KPI du haut de /suivi (dynamiques selon l'onglet actif). */
type KpiVue = {
  totalOperations: number;
  budgetProgramme: number;
  engage: number;
  paye: number;
  travauxEnCours: number;
  terminees: number;
  devisSans: number;
  devisAttente: number;
  devisRecus: number;
};

function SuiviPage() {
  const fetchRegistre = useServerFn(getPspSuiviAnnuel);
  const fetchOperations = useServerFn(getPspSuiviOperations);
  const queryClient = useQueryClient();
  // V8.18 — étiquettes des tranches (badges sous le TR du tableau devis).
  const etiquettes = useEtiquettesTranches();
  const etiquettesParTranche = etiquettes.etiquettesParTranche;

  const { data: registre, isLoading } = useQuery({
    queryKey: ["psp-suivi-annuel", ANNEE_SUIVI],
    queryFn: () => fetchRegistre({ data: { annee: ANNEE_SUIVI } }),
    staleTime: 1000 * 30,
    retry: 1,
  });
  // Opérations complètes (fiches) — chargées en parallèle, jamais modifiées ici.
  const { data: operationsData } = useQuery({
    queryKey: ["psp-suivi-operations"],
    queryFn: () => fetchOperations(),
    staleTime: 1000 * 60,
    retry: 1,
  });
  const operations = useMemo(
    () => (operationsData?.operations ?? []) as SuiviOperationVue[],
    [operationsData],
  );
  const parPspLigneId = useMemo(
    () => new Map(operations.map((o) => [o.identite.id, o])),
    [operations],
  );

  const lignes = useMemo(() => (registre?.lignes ?? []) as LigneRegistreAnnuel[], [registre]);
  const lignesSansCommandeImport = (registre?.lignesSansCommandeImport ?? 0) as number;
  const lignesSuiviMaterialisees = (registre?.lignesSuiviMaterialisees ?? 0) as number;

  // V8.18 — Adresse ER : on collecte les ER présents dans les lignes (adresse/nature), on
  // charge les lots correspondants et on surcharge l'adresse affichée avec celle du/des lots.
  const refsErLignes = useMemo<string[]>(() => {
    const refs = new Set<string>();
    const collecte = (texte?: string | null) => {
      for (const r of extraireErTexte(texte)) refs.add(r);
    };
    for (const l of lignes) {
      collecte(l.adresse);
      collecte(l.adresse_rue);
      collecte(l.nature);
    }
    for (const o of operations) {
      collecte(o.programmation.adresse);
      collecte(o.programmation.adresse_rue);
      collecte(o.programmation.nature);
    }
    return [...refs];
  }, [lignes, operations]);
  const fetchLotsEr = useServerFn(getLotsParRefsEr);
  const { data: lotsErData } = useQuery({
    queryKey: ["psp-lots-er", refsErLignes.join("|")],
    queryFn: () => fetchLotsEr({ data: { refs: refsErLignes } }),
    enabled: refsErLignes.length > 0,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
  const lotsParCodeEr = useMemo(
    () => indexerLotsParCode((lotsErData as LotErLeger[] | undefined) ?? []),
    [lotsErData],
  );

  const [selection, setSelection] = useState<SuiviOperationVue | null>(null);
  const [commandeSelection, setCommandeSelection] = useState<string | null>(null);
  const [aRapprocher, setARapprocher] = useState(false);
  // V8.16l — onglet actif (les KPI du haut sont dynamiques selon l'onglet).
  const [onglet, setOnglet] = useState<"suivi-annuel" | "psp-2027">("suivi-annuel");
  // V8.16p — éditeur des modèles de mail (persistés en base).
  const [modeleMailOuvert, setModeleMailOuvert] = useState(false);

  /** V8.3/V8.6.1 — recharge le registre après création/enregistrement. */
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["psp-suivi-annuel", ANNEE_SUIVI] });
    await queryClient.invalidateQueries({ queryKey: ["psp-suivi-operations"] });
    const d = await queryClient.fetchQuery({
      queryKey: ["psp-suivi-annuel", ANNEE_SUIVI],
      queryFn: () => fetchRegistre({ data: { annee: ANNEE_SUIVI } }),
    });
    if (selection) {
      const vue = parPspLigneId.get(selection.identite.id);
      if (vue) setSelection(vue);
    }
    void d;
  };

  // V8.10 — KPI du registre annuel (conventions V8.6.1 §12 / V8.16 : engagé-payé par ligne,
  // enveloppe par LB distinctes). Les KPI du haut (KpiSuivi) sont dérivés de kpi2026/kpi2027.
  const kpi = useMemo(() => kpiRegistreAnnuel(lignes), [lignes]);

  // V8.10 — lignes des deux onglets (même tableau partagé LigneDemandeDevis).
  //  · Onglet « Suivi annuel » : opérations 2026 SANS commande (données réelles
  //    du registre annuel V8.8.3) — but : demandes de devis.
  const lignesSuiviAnnuel = useMemo<LigneDemandeDevis[]>(
    () =>
      lignes
        .filter((l) => l.type === "operation" && l.etat_annuel === "sans_commande")
        .map(ligneDemandeDevisDepuisRegistre)
        .map((l) => appliquerErAdresse(l, lotsParCodeEr)),
    [lignes, lotsParCodeEr],
  );
  //  · Onglet « PSP 2027 » : opérations programmées sur 2027 (préparation PSP).
  const lignesPsp2027 = useMemo<LigneDemandeDevis[]>(
    () =>
      operations
        .filter((o) => operationSurAnnee(o, ANNEE_PSP))
        .map((o) => ligneDemandeDevisDepuisOperation(o, ANNEE_PSP))
        .map((l) => appliquerErAdresse(l, lotsParCodeEr)),
    [operations, lotsParCodeEr],
  );

  // V8.16l — KPI du haut DYNAMIQUES selon l'onglet actif.
  //  · « Suivi annuel » : registre 2026 — conventions V8.16 identiques au dashboard
  //    (engagé/payé au niveau LIGNE, enveloppe = LB distinctes).
  //  · « PSP 2027 » : opérations programmées 2027 (engagé/payé/travaux = 0 tant que
  //    non commandé ; devis = avancement réel des consultations).
  const kpi2026 = useMemo<KpiVue>(() => {
    const k = kpi;
    return {
      totalOperations: k.operations,
      budgetProgramme: k.budgetProgramme,
      engage: k.budgetEngage,
      paye: k.budgetPaye,
      travauxEnCours: k.travauxEnCours,
      terminees: k.terminees,
      devisSans: lignesSuiviAnnuel.filter((l) => l.avancement === "sans_devis").length,
      devisAttente: lignesSuiviAnnuel.filter((l) => l.avancement === "attente_devis").length,
      devisRecus: lignesSuiviAnnuel.filter((l) => l.avancement === "devis_recus").length,
    };
  }, [kpi, lignesSuiviAnnuel]);

  const kpi2027 = useMemo<KpiVue>(
    () => ({
      totalOperations: lignesPsp2027.length,
      budgetProgramme: lignesPsp2027.reduce((s, l) => s + (l.montant ?? 0), 0),
      engage: 0,
      paye: 0,
      travauxEnCours: 0,
      terminees: 0,
      devisSans: lignesPsp2027.filter((l) => l.avancement === "sans_devis").length,
      devisAttente: lignesPsp2027.filter((l) => l.avancement === "attente_devis").length,
      devisRecus: lignesPsp2027.filter((l) => l.avancement === "devis_recus").length,
    }),
    [lignesPsp2027],
  );

  const kpiVue = onglet === "suivi-annuel" ? kpi2026 : kpi2027;

  /** Ouvre la fiche opération depuis une ligne des onglets (demandes de devis). */
  const ouvrirDemande = (l: LigneDemandeDevis) => {
    if (!l.pspLigneId) return;
    const vue =
      parPspLigneId.get(l.pspLigneId) ?? operations.find((o) => o.identite.id === l.pspLigneId);
    if (vue) setSelection(vue);
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-4 sm:px-6">
          <div className="mr-auto">
            <h1 className="flex items-center gap-2 text-lg font-semibold leading-tight">
              <Workflow className="size-5 text-primary" /> Opérations
            </h1>
            <p className="text-sm text-muted-foreground">
              Registre opérationnel annuel — données réelles du fichier annuel + commandes.
            </p>
          </div>
          {/* V8.10 — sélecteur d'année supprimé : années figées par onglet
              (Suivi annuel 2026 / PSP 2027). */}
          {/* V8.6.2 — plus de création manuelle générique depuis /suivi : une
              opération annuelle vient de la PRÉPARATION PSP ou du FICHIER ANNUEL
              (matérialisée par l'import, origine='suivi'). */}
          {/* V8.5.4 — vue globale « Commandes à rapprocher » */}
          <Button size="sm" variant="outline" onClick={() => setARapprocher(true)}>
            <FileSearch className="size-3.5" /> Commandes à rapprocher
          </Button>
          {/* V8.16p — modèles de mail personnalisables (persistés en base) */}
          <Button size="sm" variant="outline" onClick={() => setModeleMailOuvert(true)}>
            <Mail className="size-3.5" /> Modèles de mail
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/preparation-psp">
              <ArrowLeft className="size-3.5" /> Préparation PSP
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link
              to="/dashboard-travaux"
              search={{ commande: undefined, de: undefined, a: undefined }}
            >
              Dashboard travaux
            </Link>
          </Button>
        </div>
      </header>

      {/* V8.6.2/3 — lignes annuelles SANS commande vues dans les imports : le
          bandeau distingue les lignes DÉTECTÉES des lignes MATÉRIALISÉES en
          opérations (les marqueurs travaux_import_details restent conservés). */}
      {lignesSansCommandeImport > 0 && (
        <div className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-[11px] text-amber-800">
          {lignesSansCommandeImport} ligne(s) sans commande détectées dans les imports du fichier
          annuel · {lignesSuiviMaterialisees} matérialisée(s) en opérations. Les marqueurs d'import
          restent conservés (traçabilité) ; seules les lignes fiables (TR + corps d'état ou nature)
          deviennent des opérations « Sans commande » dans le registre.
        </div>
      )}

      <main className="mx-auto max-w-7xl space-y-4 px-4 py-6 sm:px-6">
        {/* V8.16l — KPI + barres empilées, DYNAMIQUES selon l'onglet actif. */}
        {!isLoading && <KpiSuivi kpi={kpiVue} />}

        {isLoading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Chargement du suivi annuel…
          </p>
        ) : (
          <Tabs value={onglet} onValueChange={(v) => setOnglet(v as "suivi-annuel" | "psp-2027")}>
            <TabsList>
              <TabsTrigger value="suivi-annuel">Suivi annuel {ANNEE_SUIVI}</TabsTrigger>
              <TabsTrigger value="psp-2027">PSP {ANNEE_PSP}</TabsTrigger>
            </TabsList>
            <TabsContent value="suivi-annuel" className="pt-3">
              <TableauDemandesDevis
                titre={`Suivi annuel ${ANNEE_SUIVI} — sans commande`}
                sousTitre="Opérations de l'exercice sans commande : à demander en devis. Mises à jour à chaque import du fichier annuel."
                lignes={lignesSuiviAnnuel}
                onOpen={ouvrirDemande}
                onEnvoye={refresh}
                etiquettesParTranche={etiquettesParTranche}
              />
            </TabsContent>
            <TabsContent value="psp-2027" className="pt-3">
              <TableauDemandesDevis
                titre={`PSP ${ANNEE_PSP} — programmées`}
                sousTitre="Opérations de la préparation PSP programmées sur 2027."
                lignes={lignesPsp2027}
                onOpen={ouvrirDemande}
                onEnvoye={refresh}
                etiquettesParTranche={etiquettesParTranche}
              />
            </TabsContent>
          </Tabs>
        )}
      </main>

      {selection && (
        <SuiviOperationFiche
          operation={selection}
          onClose={() => setSelection(null)}
          onRefresh={refresh}
        />
      )}
      {commandeSelection && (
        <PspCorrespondanceCommandeDialog
          commandeId={commandeSelection}
          open={!!commandeSelection}
          onClose={() => setCommandeSelection(null)}
          onRattache={refresh}
        />
      )}
      {aRapprocher && (
        <PspCommandesARapprocherPanel
          open={aRapprocher}
          onClose={() => setARapprocher(false)}
          onExaminer={(pspLigneId) => {
            const op = operations.find((o) => o.identite.id === pspLigneId);
            if (op) {
              setARapprocher(false);
              setSelection(op);
            }
          }}
        />
      )}
      {/* V8.16p — éditeur des modèles de mail (base) */}
      <ModeleMailEditor ouvert={modeleMailOuvert} onFermer={() => setModeleMailOuvert(false)} />
    </div>
  );
}

/** V8.16l — petite barre empilée (KPI /suivi) : segments proportionnels au total. */
function MiniBarre({
  segments,
  legende,
}: {
  segments: { label: string; value: number; color: string }[];
  legende: string;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  return (
    <div className="rounded-lg border bg-card p-2">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
        {segments.map((s) =>
          s.value > 0 ? (
            <div
              key={s.label}
              className="h-full"
              style={{ width: `${(s.value / total) * 100}%`, backgroundColor: s.color }}
              title={`${s.label} : ${money0(s.value)}`}
            />
          ) : null,
        )}
      </div>
      <p className="mt-1.5 text-[9px] font-black uppercase tracking-wide text-slate-400">
        {legende}
      </p>
    </div>
  );
}

/** V8.16l — bloc KPI du haut de /suivi : 3 barres empilées compactes (sans chiffres). */
function KpiSuivi({ kpi }: { kpi: KpiVue }) {
  const reste = Math.max(0, kpi.budgetProgramme - kpi.engage);
  const autresTravaux = Math.max(0, kpi.totalOperations - kpi.travauxEnCours - kpi.terminees);
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      <MiniBarre
        segments={[
          { label: "Engagé", value: kpi.engage, color: "#2563eb" },
          { label: "Reste", value: reste, color: "#e2e8f0" },
        ]}
        legende={`Engagé ${money0(kpi.engage)} · Payé ${money0(kpi.paye)} · Reste ${money0(reste)}`}
      />
      <MiniBarre
        segments={[
          { label: "En cours", value: kpi.travauxEnCours, color: "#2563eb" },
          { label: "Terminées", value: kpi.terminees, color: "#16a34a" },
          { label: "Autres", value: autresTravaux, color: "#e2e8f0" },
        ]}
        legende={`En cours ${kpi.travauxEnCours} · Terminées ${kpi.terminees} · Total ${kpi.totalOperations}`}
      />
      <MiniBarre
        segments={[
          { label: "Sans devis", value: kpi.devisSans, color: "#f87171" },
          { label: "Demande faite", value: kpi.devisAttente, color: "#f59e0b" },
          { label: "Devis reçus", value: kpi.devisRecus, color: "#22c55e" },
        ]}
        legende={`Sans devis ${kpi.devisSans} · Demande faite ${kpi.devisAttente} · Devis reçus ${kpi.devisRecus}`}
      />
    </div>
  );
}
