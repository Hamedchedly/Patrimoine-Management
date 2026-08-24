import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { exerciceCourant } from "@/lib/travaux";
import { extraireChargePsp } from "./psp.validation";

// Colonnes réellement présentes dans travaux_commandes (schéma de production).
// Les colonnes classification_* n'existent pas encore en base : on les exclut des
// mises à jour pour que la résolution d'une alerte ne casse pas l'UPDATE.
const COMMANDE_UPDATABLE_COLUMNS = [
  "numero_commande",
  "secteur",
  "tranche_code",
  "lot_code",
  "batiment",
  "charge_clientele",
  "adresse",
  "nature_analytique",
  "corps_etat",
  "charge_operation",
  "ligne_budget",
  "descriptif",
  "budget",
  "numero_fournisseur",
  "fournisseur",
  "etat_commande",
  "engage",
  "ecart",
  "paye",
  "solde",
  "etat_travaux",
  "date_demarrage",
  "date_fin_travaux",
  "observations",
  "support_communication",
  "date_communication",
  "annee_exercice",
] as const;

export type CommandeTravaux = {
  id: string;
  numero_commande: string;
  secteur: string | null;
  tranche_code: string | null;
  lot_code: string | null;
  batiment: string | null;
  charge_clientele: string | null;
  adresse: string | null;
  nature_analytique: string | null;
  corps_etat: string | null;
  charge_operation: string | null;
  ligne_budget: string | null;
  descriptif: string | null;
  budget: number | null;
  numero_fournisseur: string | null;
  fournisseur: string | null;
  etat_commande: string | null;
  engage: number | null;
  ecart: number | null;
  paye: number | null;
  solde: number | null;
  etat_travaux: string | null;
  date_demarrage: string | null;
  date_fin_travaux: string | null;
  observations: string | null;
  support_communication: string | null;
  date_communication: string | null;
  annee_exercice: number | null;
  classification_programmation: string | null;
  classification_secteur: string | null;
  actif: boolean;
  created_at: string;
  updated_at: string;
};

/**
 * Commande du Dashboard enrichie depuis la vue de lecture `v_travaux_commandes_enrichies`
 * (Historique CMD + analyse PSP). Les champs sont TOUJOURS optionnels : si la vue est
 * absente / indisponible, le dashboard renvoie les commandes non enrichies (aucune casse).
 * Aucun de ces champs n'est écrit en base — sources immuables.
 */
export type CommandeTravauxEnrichie = CommandeTravaux & {
  /** V8.12 — marqueur des lignes annuelles SANS commande ajoutées au tableau du Dashboard. */
  sans_commande?: boolean;
  commande_id?: string | null;
  psp_date_commande?: string | null;
  nature_historique?: string | null;
  psp_corps_etat_code?: string | null;
  psp_corps_etat_libelle?: string | null;
  psp_patrimoine?: string | null;
  psp_donnees_brutes?: Record<string, unknown> | null;
  psp_numero_commande_interne?: string | null;
  psp_charge_operation?: string | null;
  psp_fournisseur?: string | null;
  psp_montant_engage?: number | null;
  psp_montant_paye?: number | null;
  psp_montant_budget?: number | null;
  psp_adresse?: string | null;
  psp_commune?: string | null;
  psp_annee_exercice?: number | null;
  nature_suivi_annuel?: string | null;
  corps_etat_suivi_annuel?: string | null;
  lien_id?: string | null;
  lien_statut?: string | null;
  lien_methode?: string | null;
  lien_confiance?: number | null;
  analyse_id?: string | null;
  analyse_statut?: string | null;
  type_intervention?: string | null;
  cause_probable?: string | null;
  categorie_budget?: string | null;
  categorie_budget_statut?: string | null;
};

export type HistoriqueTravaux = {
  id: string;
  import_id: string;
  commande_id: string;
  operation: string;
  avant: Record<string, string | number | boolean | null> | null;
  apres: Record<string, string | number | boolean | null> | null;
  created_at: string;
  resolu: boolean;
};

export type ImportTravaux = {
  id: string;
  fichier: string;
  lignes: number;
  creees: number;
  modifiees: number;
  conflits?: number;
  reports?: number;
  doublons: number;
  erreurs: number;
  archivees: number;
  statut: string;
  demarre_at: string;
  termine_at: string | null;
  annee_exercice: number | null;
};

export type TrancheDetail = {
  code: string;
  libelle: string | null;
  localite: string | null;
  nb_logements: number;
  lat?: number;
  lng?: number;
};

export type TravauxDashboardData = {
  commandes: CommandeTravauxEnrichie[];
  historique: HistoriqueTravaux[];
  imports: ImportTravaux[];
  tranchesDetails: TrancheDetail[];
  /** V8.12 — lignes annuelles SANS commande (psp_lignes origine='suivi'). */
  lignesSuivi: Record<string, unknown>[];
};

export type CheckTravauxImportResult = {
  found: boolean;
  latestImport: ImportTravaux | null;
  exercice: number;
};

/**
 * Vérifie l'état réel des imports dans Supabase (lecture seule, aucune comparaison métier
 * de fichiers Excel). Retourne le dernier import selon `demarre_at` : l'identité d'un import
 * repose sur son `id`, que le frontend compare à celui actuellement affiché. L'exercice
 * courant est calculé dynamiquement (jamais codé en dur).
 */
export const checkTravauxLatestImport = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
  const db = supabaseAdmin as any;
  const { data, error } = await db
    .from("import_travaux")
    .select("*")
    .order("demarre_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  const latestImport = (data?.[0] ?? null) as ImportTravaux | null;
  return {
    found: !!latestImport,
    latestImport,
    exercice: exerciceCourant(),
  } satisfies CheckTravauxImportResult;
});

// Colonnes lues sur la vue de rapprochement v_travaux_commandes_enrichies (couche de
// lecture enrichie, unique). Récupération sécurisée : si la vue est indisponible, le
// dashboard renvoie les commandes non enrichies.
const SELECT_PASP_ENRICHIES =
  "commande_id, numero_commande, numero_commande_interne, nature_suivi_annuel, nature_historique, " +
  "corps_etat_suivi_annuel, psp_corps_etat_code, psp_corps_etat_libelle, psp_patrimoine, " +
  "psp_date_commande, psp_donnees_brutes, psp_fournisseur, psp_montant_engage, psp_montant_paye, " +
  "psp_montant_budget, psp_adresse, psp_commune, psp_annee_exercice, lien_id, lien_statut, " +
  "lien_methode, lien_confiance, analyse_id, analyse_statut, type_intervention, cause_probable, " +
  "categorie_budget, categorie_budget_statut";

/**
 * Fusion sécurisée des enrichissements Historique CMD sur chaque commande (par id).
 * Récupération PRÉFÉRENTIELLE via la vue de rapprochement unique — aucune logique de
 * rapprochement dupliquée côté frontend. Si la vue échoue, on renvoie les données brutes.
 * MÊME MODÈLE de données pour le Dashboard Travaux, la fiche commande Fournisseur et
 * /adresses (parité totale) : chaque commande garde toutes ses colonnes suivi
 * (`travaux_commandes`) complétées par l'enrichissement PSP.
 */
function fusionnerEnrichissement(
  commandes: CommandeTravaux[],
  enrichies: Record<string, unknown>[],
): CommandeTravauxEnrichie[] {
  const enrichiesParCommande = new Map<string, Record<string, unknown>>();
  for (const e of enrichies) {
    if (e && typeof e["commande_id"] === "string" && !enrichiesParCommande.has(e["commande_id"])) {
      enrichiesParCommande.set(e["commande_id"], e);
    }
  }
  return commandes.map((c) => {
    const e = enrichiesParCommande.get(c.id);
    if (!e) return c as CommandeTravauxEnrichie;
    const dn = (e["psp_donnees_brutes"] as Record<string, unknown> | null) ?? null;
    return {
      ...c,
      commande_id: c.id,
      psp_date_commande: (e["psp_date_commande"] as string | null) ?? null,
      nature_historique: (e["nature_historique"] as string | null) ?? null,
      psp_corps_etat_code: (e["psp_corps_etat_code"] as string | null) ?? null,
      psp_corps_etat_libelle: (e["psp_corps_etat_libelle"] as string | null) ?? null,
      psp_patrimoine: (e["psp_patrimoine"] as string | null) ?? null,
      psp_donnees_brutes: dn,
      psp_numero_commande_interne: (e["numero_commande_interne"] as string | null) ?? null,
      psp_charge_operation: extraireChargePsp(dn),
      psp_fournisseur: (e["psp_fournisseur"] as string | null) ?? null,
      psp_montant_engage: (e["psp_montant_engage"] as number | null) ?? null,
      psp_montant_paye: (e["psp_montant_paye"] as number | null) ?? null,
      psp_montant_budget: (e["psp_montant_budget"] as number | null) ?? null,
      psp_adresse: (e["psp_adresse"] as string | null) ?? null,
      psp_commune: (e["psp_commune"] as string | null) ?? null,
      psp_annee_exercice: (e["psp_annee_exercice"] as number | null) ?? null,
      nature_suivi_annuel: (e["nature_suivi_annuel"] as string | null) ?? null,
      corps_etat_suivi_annuel: (e["corps_etat_suivi_annuel"] as string | null) ?? null,
      lien_id: (e["lien_id"] as string | null) ?? null,
      lien_statut: (e["lien_statut"] as string | null) ?? null,
      lien_methode: (e["lien_methode"] as string | null) ?? null,
      lien_confiance: (e["lien_confiance"] as number | null) ?? null,
      analyse_id: (e["analyse_id"] as string | null) ?? null,
      analyse_statut: (e["analyse_statut"] as string | null) ?? null,
      type_intervention: (e["type_intervention"] as string | null) ?? null,
      cause_probable: (e["cause_probable"] as string | null) ?? null,
      categorie_budget: (e["categorie_budget"] as string | null) ?? null,
      categorie_budget_statut: (e["categorie_budget_statut"] as string | null) ?? null,
    } as CommandeTravauxEnrichie;
  });
}

export const getTravauxDashboard = createServerFn({ method: "GET", strict: false }).handler(
  async (): Promise<TravauxDashboardData> => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;

    // On tente de récupérer l'historique avec resolu=false, mais on replie si la colonne manque.
    // NB : les builders Supabase sont mutables (chaque .eq() s'accumule sur le même objet),
    // donc chaque tentative doit repartir d'une requête neuve pour que le repli soit réel.
    // Seules les opérations « conflit » non résolues exigent une décision utilisateur.
    const buildHistoriqueQuery = () =>
      db
        .from("travaux_commandes_historique")
        .select("*, travaux_commandes(numero_commande)")
        .eq("operation", "conflit");

    // On charge TOUTES les commandes (actives et archivées) : le Dashboard peut ainsi filtrer
    // par année d'exercice et consulter les années historiques sans dépendre de `actif = true`.
    const [commandesResult, importsResult, tranchesResult, enrichiesResult, lignesSuiviResult] =
      await Promise.all([
        db
          .from("travaux_commandes")
          .select("*")
          .order("engage", { ascending: false, nullsFirst: false }),
        // Tous les imports (tous exercices) : l'en-tête affiche la date du dernier import de
        // l'exercice courant, qui ne figurerait pas forcément dans les 5 plus récents.
        db.from("import_travaux").select("*").order("demarre_at", { ascending: false }).limit(500),
        db.from("tranches").select("code, libelle, localite, nb_logements").eq("actif", true),
        // Enrichissement Historique CMD via la vue de rapprochement (lecture seule).
        db.from("v_travaux_commandes_enrichies").select(SELECT_PASP_ENRICHIES),
        // V8.12 — lignes annuelles SANS commande (matérialisées à l'import, origine='suivi') :
        // exposées dans le tableau + KPI/barres du Dashboard.
        db.from("psp_lignes").select("*").eq("origine", "suivi"),
      ]);

    let historiqueResult;
    try {
      historiqueResult = await buildHistoriqueQuery()
        .eq("resolu", false)
        .order("created_at", { ascending: false });
      if (historiqueResult.error && historiqueResult.error.message.includes("resolu")) {
        historiqueResult = await buildHistoriqueQuery().order("created_at", { ascending: false });
      }
    } catch (e) {
      historiqueResult = await buildHistoriqueQuery().order("created_at", { ascending: false });
    }

    if (commandesResult.error)
      throw new Error(`Chargement des commandes : ${commandesResult.error.message}`);
    if (historiqueResult.error)
      throw new Error(`Chargement de l'historique : ${historiqueResult.error.message}`);
    if (importsResult.error)
      throw new Error(`Chargement des imports : ${importsResult.error.message}`);
    if (tranchesResult.error)
      throw new Error(`Chargement des tranches : ${tranchesResult.error.message}`);

    // Fusion suivi + enrichissement Historique CMD (même modèle que la fiche Fournisseur).
    const commandes = fusionnerEnrichissement(
      (commandesResult.data ?? []) as CommandeTravaux[],
      (enrichiesResult.error ? [] : (enrichiesResult.data ?? [])) as Record<string, unknown>[],
    );

    return {
      commandes,
      historique: (historiqueResult.data ?? []) as (HistoriqueTravaux & {
        travaux_commandes: { numero_commande: string };
      })[],
      imports: (importsResult.data ?? []) as ImportTravaux[],
      tranchesDetails: (tranchesResult.data ?? []) as TrancheDetail[],
      lignesSuivi: (lignesSuiviResult.data ?? []) as Record<string, unknown>[],
    } satisfies TravauxDashboardData;
  },
);

/**
 * Enrichissement Historique CMD des commandes d'un périmètre patrimoine (route /adresses).
 * Lecture seule de la vue de rapprochement, filtrée par ids de commandes. Retourne [] si
 * la vue est indisponible — les fiches travaux restent fonctionnelles sans enrichissement.
 */
export const getPspEnrichissementCommandes = createServerFn({ method: "POST", strict: false })
  .validator((d: unknown) =>
    z.object({ commandeIds: z.array(z.string().uuid()).max(1000) }).parse(d),
  )
  .handler(async ({ data }): Promise<CommandeTravauxEnrichie[]> => {
    if (data.commandeIds.length === 0) return [];
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    // MÊME MODÈLE que le Dashboard : colonnes suivi (travaux_commandes) + enrichissement
    // Historique CMD (vue de rapprochement), fusionnés. Lecture seule.
    const [commandesResult, enrichiesResult] = await Promise.all([
      db
        .from("travaux_commandes")
        .select("*")
        .in("id", data.commandeIds)
        .order("engage", { ascending: false, nullsFirst: false }),
      db
        .from("v_travaux_commandes_enrichies")
        .select(SELECT_PASP_ENRICHIES)
        .in("commande_id", data.commandeIds),
    ]);
    if (commandesResult.error) return [];
    return fusionnerEnrichissement(
      (commandesResult.data ?? []) as CommandeTravaux[],
      (enrichiesResult.error ? [] : (enrichiesResult.data ?? [])) as Record<string, unknown>[],
    );
  });

export const updateCommandeTravaux = createServerFn({ method: "POST" })
  .validator((d: unknown) => {
    return z
      .object({
        id: z.string().uuid(),
        data: z.record(z.any()),
      })
      .parse(d);
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;

    // Liste des colonnes autorisées pour l'update
    const VALID_COLUMNS = [
      "numero_commande",
      "secteur",
      "tranche_code",
      "lot_code",
      "batiment",
      "charge_clientele",
      "adresse",
      "nature_analytique",
      "corps_etat",
      "charge_operation",
      "ligne_budget",
      "descriptif",
      "budget",
      "numero_fournisseur",
      "fournisseur",
      "etat_commande",
      "engage",
      "ecart",
      "paye",
      "solde",
      "etat_travaux",
      "date_demarrage",
      "date_fin_travaux",
      "observations",
      "support_communication",
      "date_communication",
      "annee_exercice",
    ];

    const filteredData = Object.fromEntries(
      Object.entries(data.data).filter(([key]) => VALID_COLUMNS.includes(key)),
    );

    const { data: updated, error } = await db
      .from("travaux_commandes")
      .update(filteredData)
      .eq("id", data.id)
      .select("*")
      .single();
    if (error) throw new Error(`Mise à jour échouée : ${error.message}`);
    return updated;
  });

export const getCommandeHistorique = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ commandeId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    // Toutes les opérations (creation, modification, archivage, conflit, resolution),
    // ordonnées chronologiquement pour reconstruire la timeline de la commande.
    const { data: rows, error } = await db
      .from("travaux_commandes_historique")
      .select("id, import_id, commande_id, operation, avant, apres, created_at, resolu")
      .eq("commande_id", data.commandeId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(`Chargement de l'historique : ${error.message}`);
    return (rows ?? []) as HistoriqueTravaux[];
  });

export const getTravauxImportDetails = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        importId: z.string().uuid(),
        type: z.enum([
          "creee",
          "conflit",
          "inchangee",
          "archivee",
          "doublon",
          "ignoree",
          "erreur",
          "sans_commande",
          "report",
        ]),
        page: z.number().int().min(1).optional(),
        pageSize: z.number().int().min(1).max(200).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    const page = data.page ?? 1;
    const pageSize = data.pageSize ?? 50;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    // Import inexistant ou type sans détail → total 0 et liste vide.
    const { count, error: countError } = await db
      .from("travaux_import_details")
      .select("id", { count: "exact", head: true })
      .eq("import_id", data.importId)
      .eq("type", data.type);
    if (countError) return { rows: [], total: 0 };

    const { data: rows, error } = await db
      .from("travaux_import_details")
      .select("*")
      .eq("import_id", data.importId)
      .eq("type", data.type)
      .order("ligne", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true })
      .order("numero_commande", { ascending: true })
      .range(from, to);
    if (error) throw new Error(`Lecture des détails : ${error.message}`);
    return { rows: (rows ?? []) as any[], total: count ?? 0 };
  });

export const getTravauxStats = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
  const db = supabaseAdmin as any;

  // Agrégation par ville, secteur, programmation, etc.
  // Note: Comme on ne peut pas modifier le schéma, on fait l'agrégation sur les données brutes
  // mais on pourrait utiliser des fonctions RPC Supabase pour plus d'efficacité si besoin.
  const { data, error } = await db
    .from("travaux_commandes")
    .select(
      "engage, budget, paye, ligne_budget, corps_etat, secteur, adresse, date_demarrage, date_fin_travaux, date_communication, annee_exercice",
    )
    .eq("actif", true);
  if (error) throw new Error(error.message);
  return data;
});

export const resolveHistoriqueTravaux = createServerFn({ method: "POST" })
  .validator((d: unknown) => {
    return z
      .object({
        id: z.string().uuid(),
        keepVersion: z.enum(["A", "B"]),
        commandeId: z.string().uuid(),
        data: z.record(z.any()),
      })
      .parse(d);
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;

    // 1. Chargement de la ligne de conflit pour lier la résolution à l'import d'origine.
    const { data: conflitRow, error: conflitError } = await db
      .from("travaux_commandes_historique")
      .select("*")
      .eq("id", data.id)
      .single();
    if (conflitError) throw new Error(`Lecture du conflit : ${conflitError.message}`);
    const importId = conflitRow?.import_id as string | undefined;

    // 2. Si l'utilisateur a choisi une version, on applique la version choisie sur la commande.
    //    On filtre sur les colonnes réellement existantes pour éviter qu'une colonne
    //    absente du schéma ne fasse échouer toute la résolution.
    const filteredData = Object.fromEntries(
      Object.entries(data.data ?? {}).filter(([key]) =>
        (COMMANDE_UPDATABLE_COLUMNS as readonly string[]).includes(key),
      ),
    );
    if (Object.keys(filteredData).length > 0) {
      const { error: updateError } = await db
        .from("travaux_commandes")
        .update(filteredData)
        .eq("id", data.commandeId);
      if (updateError) throw new Error(`Mise à jour commande : ${updateError.message}`);
    }

    // 3. On marque le conflit comme résolu
    const { data: updated, error } = await db
      .from("travaux_commandes_historique")
      .update({ resolu: true })
      .eq("id", data.id)
      .select("*")
      .single();
    if (error) throw new Error(`Résolution historique échouée : ${error.message}`);

    // 4. Trace de la résolution dans l'historique (timeline) : la version écartée reste
    //    consultable via `avant` de la ligne de conflit, la version conservée via `apres`.
    if (importId) {
      const apres = data.data ?? {};
      const trace = {
        import_id: importId,
        commande_id: data.commandeId,
        operation: "resolution",
        avant: conflitRow?.avant ?? null,
        apres: { ...apres, version_conservee: data.keepVersion === "A" ? "ancienne" : "nouvelle" },
        resolu: true,
      };
      const { error: traceError } = await db.from("travaux_commandes_historique").insert(trace);
      if (traceError) throw new Error(`Trace de résolution : ${traceError.message}`);
    }

    return updated;
  });
