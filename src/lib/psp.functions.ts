/**
 * PSP — Server functions (écritures Supabase du module PSP Analytics).
 *
 * Module ISOLÉ : il n'écrit que dans les tables `psp_*` et ne touche à aucune
 * table existante de PAT S11 (travaux_commandes, tranches, lots, import_travaux…).
 *
 * Pattern repris des server functions existantes de PAT S11 :
 *   createServerFn + zod + supabaseAdmin (service role, serveur uniquement).
 * La clé service_role n'est JAMAIS exposée au navigateur : elle n'existe que
 * dans `src/integrations/supabase-ext/client.server.ts` (variables EXT_*).
 *
 * Schéma des tables psp_* : aligné sur le schéma réel vérifié dans Supabase DEV
 * (projet zpkfwsczrtadrhcounof). Ce module n'utilise que les colonnes existantes ;
 * aucune modification de schéma / migration n'est effectuée ici.
 *
 * Tables autorisées en écriture : psp_imports, psp_import_rows,
 * psp_command_analysis, psp_patrimoine_context, psp_feedback.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getCategorieBudget } from "./psp.ts";

// ── Schémas Zod (exportés pour tests de validation pure) ────────────────────

const exerciceSchema = z.number().int().min(2000).max(2100);

const niveauRattachementSchema = z.enum([
  "tranche",
  "batiment",
  "entree",
  "lot",
  "unknown",
  "ambiguous",
]);

/** Anomalie explicite d'une ligne (alignée sur PspParseIssue de src/lib/psp.ts). */
export const pspParseIssueSchema = z.object({
  code: z.string(),
  message: z.string(),
  ligne: z.number().int().nullable(),
  numero_commande: z.string().nullable(),
  champ: z.string().nullable(),
  valeur: z.string().nullable(),
});

/**
 * Ligne de commande transportée (alignée sur PspParsedRow de src/lib/psp.ts).
 * `numero_commande` est l'identifiant métier UNIQUE ; il peut être "" pour une
 * ligne en erreur (numéro absent) — jamais remplacé par un UUID.
 */
export const pspRowSchema = z.object({
  ligne: z.number().int(),
  numero_commande: z.string(),
  numero_commande_interne: z.string().nullable(),
  secteur: z.string().nullable(),
  tranche_code: z.string().nullable(),
  batiment: z.string().nullable(),
  lot_code: z.string().nullable(),
  entree: z.string().nullable(),
  nature_analytique: z.string().nullable(),
  corps_etat: z.string().nullable(),
  descriptif: z.string().nullable(),
  observations: z.string().nullable(),
  patrimoine: z.string().nullable(),
  etat: z.string().nullable(),
  date_commande: z.string().nullable(),
  fournisseur: z.string().nullable(),
  adresse: z.string().nullable(),
  commune: z.string().nullable(),
  budget: z.number().nullable(),
  engage: z.number().nullable(),
  paye: z.number().nullable(),
  ecart: z.number().nullable(),
  er_reference: z.string().nullable(),
  tranche_er: z.string().nullable(),
  batiment_er: z.string().nullable(),
  entree_er: z.string().nullable(),
  lot_er: z.string().nullable(),
  er_references: z.array(z.string()),
  er_ambigue: z.boolean(),
  niveau_rattachement: niveauRattachementSchema,
  corps_etat_code: z.string().nullable(),
  corps_etat_libelle: z.string().nullable(),
  montant_financier_valide: z.boolean(),
  statut: z.enum(["valide", "a_controler", "erreur"]),
  erreurs_psp: z.array(pspParseIssueSchema),
});

export const createPspImportSchema = z.object({
  fichier_nom: z.string().min(1),
  exercice: exerciceSchema,
  lignes_total: z.number().int().nonnegative(),
  lignes_valides: z.number().int().nonnegative(),
  lignes_erreur: z.number().int().nonnegative(),
  doublons: z.number().int().nonnegative(),
  structure_detectee: z.record(z.string(), z.unknown()).nullable().default({}),
  erreurs_detail: z.array(pspParseIssueSchema).default([]),
});

export const pspBatchSchema = z.object({
  import_id: z.string().uuid(),
  annee_exercice: exerciceSchema.nullable().optional(),
  rows: z.array(pspRowSchema).min(1),
});

export const failPspImportSchema = z.object({
  import_id: z.string().uuid(),
  erreur_message: z.string().min(1),
});

export const finalizePspImportSchema = z.object({
  import_id: z.string().uuid(),
  statut: z.enum(["termine", "a_controler", "erreur"]),
});

export const savePspCommandAnalysisSchema = z.object({
  /** COMN_NUM — identifiant source stable ; clé d'upsert de l'analyse courante. */
  numero_commande_interne: z.string().nullable().optional(),
  /** COMC_NOLIG — numéro de commande lisible (nullable, non unique). */
  numero_commande: z.string().nullable().optional(),
  /** Lien direct vers la ligne source psp_import_rows (recommandé). */
  import_row_id: z.string().uuid().nullable().optional(),
  source_import_id: z.string().uuid().nullable().optional(),
  modele: z.string().nullable(),
  prompt_version: z.string().nullable(),
  type_intervention: z.string().nullable(),
  cause_probable: z.string().nullable(),
  phase_patrimoniale: z.string().nullable(),
  composant: z.string().nullable(),
  niveau_rattachement: niveauRattachementSchema.nullable().default("unknown"),
  er_reference: z.string().nullable(),
  utilisable_cycle: z.boolean(),
  confiance: z.number().min(0).max(1).nullable(),
  justification: z.string().nullable(),
  /** Catégorie budgétaire = NAAC_CODE (GE/GT/CP/AC/HO…). */
  categorie_budget: z.string().nullable().optional(),
  /** Statut de la catégorie : "valide" (GE/GT/CP) ou "a_confirmer" (AC/HO/autre). */
  categorie_budget_statut: z.enum(["valide", "a_confirmer"]).nullable().optional(),
  analyse_json: z.record(z.string(), z.unknown()).nullable().default({}),
  statut: z.string().nullable().default("propose"),
  analyzed_at: z.string().nullable().optional(),
});

export const savePspPatrimoineContextSchema = z.object({
  er_id: z.string().min(1),
  niveau: z.enum(["tranche", "batiment", "entree", "lot"]),
  type_patrimoine: z.string().nullable(),
  date_reference_gestion: z.string().nullable(),
  source_date_reference: z.string().nullable(),
  perimetre_psp: z.boolean().nullable(),
  parent_er_id: z.string().nullable(),
  exception: z.boolean().default(false),
  justification: z.string().nullable(),
  donnees_contextuelles: z.record(z.string(), z.unknown()).nullable().default({}),
});

export const savePspFeedbackSchema = z.object({
  cible_type: z.enum(["commande", "import", "patrimoine", "autre"]),
  cible_id: z.string().min(1),
  proposition_initiale: z.record(z.string(), z.unknown()).nullish(),
  decision_utilisateur: z.string().nullish(),
  correction: z.record(z.string(), z.unknown()).nullish(),
  motif: z.string().nullish(),
});

// ── Helpers purs (exportés pour tests) ───────────────────────────────────────

/**
 * Champs héritables d'un contexte patrimonial (défaut : héritage du niveau
 * supérieur, sauf exception définie au niveau inférieur).
 */
export type PspContexteHeritable = {
  type_patrimoine: string | null;
  date_reference_gestion: string | null;
  source_date_reference: string | null;
  perimetre_psp: boolean | null;
};

/**
 * Résout l'héritage d'un contexte : les champs non renseignés (null) du niveau
 * courant sont complétés par les valeurs du contexte parent. Un contexte
 * d'exception (`exception: true`) n'est pas concerné — il est enregistré tel
 * quel (l'appelant ne passe pas par cette résolution).
 */
export const resoudreContexteHerite = (
  contexte: PspContexteHeritable,
  parent: PspContexteHeritable | null | undefined,
): PspContexteHeritable => {
  if (!parent) return { ...contexte };
  return {
    type_patrimoine: contexte.type_patrimoine ?? parent.type_patrimoine,
    date_reference_gestion: contexte.date_reference_gestion ?? parent.date_reference_gestion,
    source_date_reference: contexte.source_date_reference ?? parent.source_date_reference,
    perimetre_psp: contexte.perimetre_psp ?? parent.perimetre_psp,
  };
};

/**
 * Construit le payload d'insertion d'une ligne dans `psp_import_rows`,
 * aligné sur le schéma réel (donnees_brutes, erreurs, colonnes dérivées ER et
 * corps d'état, montants, colonnes sources ISIS).
 *
 * Mapping ISIS :
 *  numero_commande_interne ← COMN_NUM ; numero_commande ← COMC_NOLIG ;
 *  patrimoine ← WPATRIMOINE ; secteur ← PERC_SECTEUR ;
 *  batiment_num ← BAIN_NUM ; entree_num ← ENTN_NUM ;
 *  date_commande ← COMD_DATE ; etat ← COMC_ETAT ;
 *  montant_budget ← COMN_MT_DEVIS ; montant_engage ← W_MT_RAPPRO ;
 *  montant_paye ← (pas de colonne source ISIS directe) ; montant_ecart ← W_MT_ECART ;
 *  fournisseur ← FRAN_NUM ; adresse ← WADRESSE ; commune ← WCOMMUNE ;
 *  corps_etat_libelle ← WNATURE ; nature_analytique ← NAAC_CODE.
 *
 * Clé technique d'import : `import_id` + `ligne_numero` (upsert).
 * `numero_commande` reste le n° lisible (nullable, non unique) ; jamais un UUID.
 * `donnees_brutes` conserve l'intégralité de la ligne source.
 */
export const buildPspImportRowInsert = (
  import_id: string,
  annee_exercice: number | null | undefined,
  row: z.infer<typeof pspRowSchema>,
) => ({
  import_id,
  ligne_numero: row.ligne,
  numero_commande: row.numero_commande === "" ? null : row.numero_commande,
  numero_commande_interne: row.numero_commande_interne,
  patrimoine: row.patrimoine,
  secteur: row.secteur,
  batiment_num: row.batiment,
  entree_num: row.entree,
  er_reference: row.er_reference,
  tranche_er: row.tranche_er,
  batiment_er: row.batiment_er,
  entree_er: row.entree_er,
  lot_er: row.lot_er,
  corps_etat_code: row.corps_etat_code,
  corps_etat_libelle: row.corps_etat_libelle ?? row.corps_etat,
  nature_analytique: row.nature_analytique,
  date_commande: row.date_commande,
  etat: row.etat,
  montant_budget: row.budget,
  montant_engage: row.engage,
  montant_paye: row.paye,
  montant_ecart: row.ecart,
  fournisseur: row.fournisseur,
  adresse: row.adresse,
  commune: row.commune,
  annee_exercice: annee_exercice ?? null,
  donnees_brutes: row,
  erreurs: row.erreurs_psp,
  statut: row.statut,
});

// ── Server functions ─────────────────────────────────────────────────────────

/**
 * Crée la trace d'un import PSP dans `psp_imports`.
 * Retourne { id } — l'id sera utilisé par importPspBatch / finalize / fail.
 */
export const createPspImport = createServerFn({ method: "POST" })
  .validator((d: unknown) => createPspImportSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("../integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    const { data: execution, error } = await db
      .from("psp_imports")
      .insert({
        fichier_nom: data.fichier_nom,
        exercice: data.exercice,
        lignes_total: data.lignes_total,
        lignes_valides: data.lignes_valides,
        lignes_erreur: data.lignes_erreur,
        doublons: data.doublons,
        structure_detectee: data.structure_detectee,
        erreurs_detail: data.erreurs_detail,
        statut: "analyse",
      })
      .select("id")
      .single();
    if (error) throw new Error(`Création de l'import PSP : ${error.message}`);
    return { id: execution.id } as { id: string };
  });

/**
 * Insère un lot de lignes dans `psp_import_rows` (upsert sur la clé technique
 * `import_id` + `ligne_numero`). Le découpage en lots est fait côté client,
 * comme pour les imports existants.
 */
export const importPspBatch = createServerFn({ method: "POST" })
  .validator((d: unknown) => pspBatchSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("../integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    const inserts = data.rows.map((row) =>
      buildPspImportRowInsert(data.import_id, data.annee_exercice, row),
    );
    const { error } = await db
      .from("psp_import_rows")
      .upsert(inserts, { onConflict: "import_id,ligne_numero" });
    if (error) throw new Error(`Écriture des lignes PSP : ${error.message}`);
    return { inseres: inserts.length };
  });

/** Marque un import PSP comme échoué ; l'erreur est conservée dans erreurs_detail (JSONB). */
export const failPspImport = createServerFn({ method: "POST" })
  .validator((d: unknown) => failPspImportSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("../integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;

    // La colonne erreur_message n'existe pas : on complète erreurs_detail (JSONB)
    // en s'appuyant sur la valeur existante.
    const { data: courant, error: lectureError } = await db
      .from("psp_imports")
      .select("erreurs_detail")
      .eq("id", data.import_id)
      .single();
    if (lectureError) throw new Error(`Lecture de l'import PSP : ${lectureError.message}`);

    const existants = Array.isArray(courant?.erreurs_detail)
      ? (courant.erreurs_detail as unknown[])
      : [];
    const erreursDetail = [
      ...existants,
      {
        code: "import_failed",
        message: data.erreur_message,
        ligne: null,
        numero_commande: null,
        champ: null,
        valeur: null,
      },
    ];

    const { data: execution, error } = await db
      .from("psp_imports")
      .update({
        statut: "erreur",
        completed_at: new Date().toISOString(),
        erreurs_detail: erreursDetail,
      })
      .eq("id", data.import_id)
      .select("*")
      .single();
    if (error) throw new Error(`Échec de l'import PSP : ${error.message}`);
    return execution;
  });

/** Finalise un import PSP : statut termine / a_controler / erreur + completed_at. */
export const finalizePspImport = createServerFn({ method: "POST" })
  .validator((d: unknown) => finalizePspImportSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("../integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    const { data: execution, error } = await db
      .from("psp_imports")
      .update({ statut: data.statut, completed_at: new Date().toISOString() })
      .eq("id", data.import_id)
      .select("*")
      .single();
    if (error) throw new Error(`Finalisation de l'import PSP : ${error.message}`);
    return execution;
  });

/**
 * LEGACY — ne pas utiliser pour le suivi opérationnel actuel.
 * V8.6.3 : gel de `psp_command_analysis` (0 ligne, API sans usage UI).
 * Comportement inchangé (conservé pour compatibilité / tests historiques).
 *
 * Enregistre ou met à jour l'analyse courante d'une commande dans
 * `psp_command_analysis`. Clé d'upsert : `numero_commande_interne` (= COMN_NUM).
 * `numero_commande` (= COMC_NOLIG) est conservé comme attribut (nullable, non unique).
 * La catégorie budgétaire est dérivée de NAAC_CODE via getCategorieBudget.
 */
export const savePspCommandAnalysis = createServerFn({ method: "POST" })
  .validator((d: unknown) => savePspCommandAnalysisSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("../integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;

    // Source de vérité : NAAC_CODE. Statut dérivé si non fourni.
    const cat = data.categorie_budget
      ? getCategorieBudget(data.categorie_budget)
      : { categorie: null, statut: "a_confirmer" as const };

    const { data: saved, error } = await db
      .from("psp_command_analysis")
      .upsert(
        {
          numero_commande_interne: data.numero_commande_interne ?? null,
          numero_commande: data.numero_commande ?? null,
          import_row_id: data.import_row_id ?? null,
          source_import_id: data.source_import_id ?? null,
          modele: data.modele,
          prompt_version: data.prompt_version,
          type_intervention: data.type_intervention,
          cause_probable: data.cause_probable,
          phase_patrimoniale: data.phase_patrimoniale,
          composant: data.composant,
          niveau_rattachement: data.niveau_rattachement,
          er_reference: data.er_reference,
          utilisable_cycle: data.utilisable_cycle,
          confiance: data.confiance,
          justification: data.justification,
          categorie_budget: data.categorie_budget ?? cat.categorie,
          categorie_budget_statut: data.categorie_budget_statut ?? cat.statut,
          analyse_json: data.analyse_json,
          statut: data.statut,
          analyzed_at: data.analyzed_at ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "numero_commande_interne" },
      )
      .select("*")
      .single();
    if (error)
      throw new Error(
        `Enregistrement de l'analyse ${data.numero_commande_interne ?? data.numero_commande ?? "inconnue"} : ${error.message}`,
      );
    return saved;
  });

/**
 * LEGACY — ne pas utiliser pour le suivi opérationnel actuel.
 * V8.6.3 : gel de `psp_patrimoine_context` (0 ligne, API sans usage UI).
 * Comportement inchangé (conservé pour compatibilité / tests historiques).
 *
 * Enregistre ou met à jour le contexte patrimonial dans `psp_patrimoine_context`.
 * Clé métier : `er_id` (upsert). Le contexte est hérité du niveau supérieur par
 * défaut ; une exception (exception: true) s'applique au niveau inférieur.
 */
export const savePspPatrimoineContext = createServerFn({ method: "POST" })
  .validator((d: unknown) => savePspPatrimoineContextSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("../integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;

    // Héritage par défaut depuis le parent (sauf exception explicite).
    let aEnregistrer = data;
    if (!data.exception && data.parent_er_id) {
      const { data: parent, error } = await db
        .from("psp_patrimoine_context")
        .select("*")
        .eq("er_id", data.parent_er_id)
        .maybeSingle();
      if (error) throw new Error(`Lecture du contexte parent : ${error.message}`);
      const parentCtx = parent
        ? {
            type_patrimoine: (parent.type_patrimoine as string | null) ?? null,
            date_reference_gestion: (parent.date_reference_gestion as string | null) ?? null,
            source_date_reference: (parent.source_date_reference as string | null) ?? null,
            perimetre_psp: (parent.perimetre_psp as boolean | null) ?? null,
          }
        : null;
      aEnregistrer = { ...data, ...resoudreContexteHerite(data, parentCtx) };
    }

    const { data: saved, error: saveError } = await db
      .from("psp_patrimoine_context")
      .upsert(
        {
          er_id: aEnregistrer.er_id,
          niveau: aEnregistrer.niveau,
          type_patrimoine: aEnregistrer.type_patrimoine,
          date_reference_gestion: aEnregistrer.date_reference_gestion,
          source_date_reference: aEnregistrer.source_date_reference,
          perimetre_psp: aEnregistrer.perimetre_psp,
          parent_er_id: aEnregistrer.parent_er_id,
          exception: aEnregistrer.exception,
          justification: aEnregistrer.justification,
          donnees_contextuelles: aEnregistrer.donnees_contextuelles,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "er_id" },
      )
      .select("*")
      .single();
    if (saveError)
      throw new Error(`Enregistrement du contexte ${aEnregistrer.er_id} : ${saveError.message}`);
    return saved;
  });

/**
 * Enregistre une correction/décision utilisateur dans `psp_feedback`
 * (colonnes réelles : cible_type, cible_id, proposition_initiale,
 * decision_utilisateur, correction, motif). Le feedback est stocké tel quel :
 * il n'est PAS transformé immédiatement en règle globale (exploitation décidée
 * par le futur moteur d'analyse).
 */
export const savePspFeedback = createServerFn({ method: "POST" })
  .validator((d: unknown) => savePspFeedbackSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("../integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    const { data: saved, error } = await db
      .from("psp_feedback")
      .insert({
        cible_type: data.cible_type,
        cible_id: data.cible_id,
        proposition_initiale: data.proposition_initiale,
        decision_utilisateur: data.decision_utilisateur,
        correction: data.correction,
        motif: data.motif,
      })
      .select("*")
      .single();
    if (error)
      throw new Error(
        `Enregistrement du feedback (${data.cible_type} ${data.cible_id}) : ${error.message}`,
      );
    return saved;
  });
