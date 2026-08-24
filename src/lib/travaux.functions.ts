import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  TRAVAUX_FIELDS,
  commandesAAArchiver,
  decisionImportCommande,
  detailArchivee,
  detailConflit,
  detailCreee,
  detailIgnoree,
  detailInchangee,
  detailIssue,
  detailReport,
  travauxComparable,
  travauxIdentiques,
} from "./travaux";

const nullableText = z.string().nullable().optional();
const nullableNumber = z.number().nullable().optional();
const issueSchema = z.object({
  line: z.number(),
  message: z.string(),
  numero_commande: z.string().nullable().optional(),
  // V8.6.2 — données métier d'une ligne annuelle sans commande (matérialisation
  // dans psp_lignes : TR, corps d'état, nature, budget, ligne budgétaire…).
  tranche_code: z.string().nullable().optional(),
  nature_analytique: z.string().nullable().optional(),
  ligne_budget: z.string().nullable().optional(),
  descriptif: z.string().nullable().optional(),
  corps_etat: z.string().nullable().optional(),
  budget: z.number().nullable().optional(),
  adresse: z.string().nullable().optional(),
  charge_clientele: z.string().nullable().optional(),
  // V8.16 — engage/payé réels d'une ligne annuelle sans commande (totaux du dashboard).
  engage: z.number().nullable().optional(),
  paye: z.number().nullable().optional(),
});
const commandeSchema = z.object({
  numero_commande: z.string().min(1),
  secteur: nullableText,
  tranche_code: nullableText,
  lot_code: nullableText,
  batiment: nullableText,
  charge_clientele: nullableText,
  adresse: nullableText,
  nature_analytique: nullableText,
  corps_etat: nullableText,
  charge_operation: nullableText,
  ligne_budget: nullableText,
  descriptif: nullableText,
  budget: nullableNumber,
  numero_fournisseur: nullableText,
  fournisseur: nullableText,
  etat_commande: nullableText,
  engage: nullableNumber,
  ecart: nullableNumber,
  paye: nullableNumber,
  solde: nullableNumber,
  etat_travaux: nullableText,
  date_demarrage: nullableText,
  date_fin_travaux: nullableText,
  observations: nullableText,
  support_communication: nullableText,
  date_communication: nullableText,
  classification_programmation: nullableText,
  classification_secteur: nullableText,
  ligne: z.number().optional(),
});
const importIdSchema = z.object({ importId: z.string().uuid() });
const finalizeSchema = z.object({
  importId: z.string().uuid(),
  creees: z.number().optional(),
  modifiees: z.number().optional(),
  inchangees: z.number().optional(),
  ignorees: z.number().optional(),
  conflits: z.number().optional(),
  reports: z.number().optional(),
});
const batchSchema = z.object({
  importId: z.string().uuid(),
  annee_exercice: z.number().optional(),
  commandes: z.array(commandeSchema),
});

/**
 * V8.6.2 — MATÉRIALISATION d'une ligne annuelle SANS commande dans `psp_lignes`.
 *
 * Le fichier annuel peut contenir une ligne métier sans numéro de commande. Elle
 * est une vraie opération à suivre : on la matérialise dans `psp_lignes` avec
 * `origine='suivi'` et les données RÉELLES disponibles (TR, corps d'état, nature,
 * budget annuel dans `programme[annee]`, ligne budgétaire, trace adresse).
 *
 * RÈGLES :
 *  · aucune modification des tables d'import (travaux_commandes intacte) ;
 *  · aucune copie de commande dans psp_lignes ;
 *  · ANTI-DOUBLON : même TR + corps d'état + nature déjà présents → l'opération
 *    existe déjà, on ne crée rien (le rapprochement V8.5 retrouvera cette ligne) ;
 *  · données insuffisantes (pas de TR, ni corps ni nature) → ligne NON créée,
 *    le comportement d'erreur existant reste (travaux_import_details) ;
 *  · la matérialisation ne bloque jamais l'import annuel.
 */
export const materialiserLignesSansCommande = async (
  db: any,
  issues: Array<{
    line: number;
    message: string;
    tranche_code?: string | null | undefined;
    nature_analytique?: string | null | undefined;
    ligne_budget?: string | null | undefined;
    descriptif?: string | null | undefined;
    corps_etat?: string | null | undefined;
    budget?: number | null | undefined;
    adresse?: string | null | undefined;
    // V8.16 — engage/payé réels de la ligne (STSN_ENGAGE / STSN_PAYE), totaux dashboard.
    engage?: number | null | undefined;
    paye?: number | null | undefined;
  }>,
  annee: number,
  fichier: string,
): Promise<{ matérialisées: number; existantes: number; insuffisantes: number }> => {
  const cibles = (issues ?? []).filter(
    (i) =>
      i.message === "Numéro de commande manquant" &&
      typeof i.tranche_code === "string" &&
      i.tranche_code.trim() !== "" &&
      ((i.corps_etat ?? "").trim() !== "" || (i.descriptif ?? "").trim() !== ""),
  );
  let matérialisées = 0;
  let existantes = 0;
  const insuffisantes =
    (issues ?? []).filter((i) => i.message === "Numéro de commande manquant").length -
    cibles.length;

  for (const issue of cibles) {
    const tranche = String(issue.tranche_code).trim();
    const corps = (issue.corps_etat ?? "").trim() || null;
    const nature = (issue.descriptif ?? "").trim() || null;
    const budget =
      typeof issue.budget === "number" && Number.isFinite(issue.budget) && issue.budget > 0
        ? issue.budget
        : null;
    const cat = ["GE", "GT", "CP"].includes((issue.nature_analytique ?? "").trim().toUpperCase())
      ? (issue.nature_analytique ?? "GT").trim().toUpperCase()
      : "GT";

    // Anti-doublon : même TR + corps d'état + nature → opération déjà existante.
    const { data: existantesRows } = await db
      .from("psp_lignes")
      .select("id, corps_etat, nature_travaux")
      .eq("tranche_code", tranche);
    const doublon = (existantesRows ?? []).some(
      (l: any) =>
        (l.corps_etat ?? "").trim().toLowerCase() === (corps ?? "").toLowerCase() &&
        (l.nature_travaux ?? "").trim().toLowerCase() === (nature ?? "").toLowerCase(),
    );
    if (doublon) {
      existantes += 1;
      continue;
    }

    const { error } = await db.from("psp_lignes").insert({
      programmation_id: null,
      tranche_code: tranche,
      categorie: cat,
      corps_etat_code: null,
      corps_etat: corps,
      nature_travaux: nature,
      programme: budget != null ? { [String(annee)]: budget } : {},
      // V8.16 — exercice + engagé/payé réels (colonnes ajoutées par migration V8.16).
      annee_exercice: annee,
      montant_engage:
        typeof issue.engage === "number" && Number.isFinite(issue.engage) ? issue.engage : null,
      montant_paye:
        typeof issue.paye === "number" && Number.isFinite(issue.paye) ? issue.paye : null,
      ligne_budget: (issue.ligne_budget ?? "").trim() || null,
      remarques: [
        `Matérialisée depuis l'import annuel ${annee} (${fichier}, ligne ${issue.line}) — sans commande`,
        issue.adresse ? `Adresse : ${issue.adresse}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      statut: "a_definir",
      priorite: "normale",
      origine: "suivi",
    });
    if (error) {
      // Ligne non créée : le marqueur d'erreur reste dans travaux_import_details.
      continue;
    }
    matérialisées += 1;
  }

  return { matérialisées, existantes, insuffisantes };
};

export const createTravauxImport = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        fichier: z.string().min(1),
        lignes: z.number(),
        doublons: z.number(),
        erreurs: z.number(),
        annee_exercice: z.number(),
        doublonsDetails: z.array(issueSchema).default([]),
        erreursDetails: z.array(issueSchema).default([]),
        sansCommandeDetails: z.array(issueSchema).default([]),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    // annee_exercice est écrit directement : la colonne existe en production (migration appliquée).
    // En cas de colonne manquante, l'import s'arrête explicitement au lieu de dégrader l'année.
    const insertData: any = {
      fichier: data.fichier,
      lignes: data.lignes,
      doublons: data.doublons,
      erreurs: data.erreurs,
      annee_exercice: data.annee_exercice,
    };

    const { data: execution, error } = await db
      .from("import_travaux")
      .insert(insertData)
      .select("id")
      .single();
    if (error) throw new Error(`Création de l'import : ${error.message}`);

    // Persistance immédiate des détails connus dès l'analyse du fichier (doublons, erreurs,
    // lignes sans n° de commande). V8.13 : les lignes SANS commande sont un type de détail
    // DÉDIÉ (« sans_commande ») — jamais comptées comme des erreurs.
    const detailsRows: Record<string, unknown>[] = [
      ...data.doublonsDetails.map((issue) => detailIssue(execution.id, "doublon", issue)),
      ...data.erreursDetails.map((issue) => detailIssue(execution.id, "erreur", issue)),
      ...data.sansCommandeDetails.map((issue) => detailIssue(execution.id, "sans_commande", issue)),
    ];
    if (detailsRows.length) {
      const { error: detailsError } = await db.from("travaux_import_details").insert(detailsRows);
      if (detailsError) throw new Error(`Détails de l'import : ${detailsError.message}`);
    }

    // V8.6.2/V8.13 — MATÉRIALISATION des lignes annuelles SANS commande dans `psp_lignes`
    // (origine='suivi', données réelles du fichier). Ne touche PAS aux tables
    // d'import ; anti-doublon TR + corps d'état + nature. Ne bloque jamais l'import.
    try {
      await materialiserLignesSansCommande(
        db,
        data.sansCommandeDetails,
        data.annee_exercice,
        data.fichier,
      );
    } catch (e) {
      console.error("[import] matérialisation lignes sans commande :", e);
    }

    return { id: execution.id, annee_exercice: data.annee_exercice } as {
      id: string;
      annee_exercice: number;
    };
  });

export const importTravauxBatch = createServerFn({ method: "POST" })
  .validator((d: unknown) => batchSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    const numbers = data.commandes.map((row) => row.numero_commande);
    // V8.16b — identité d'une commande = (numero_commande, annee_exercice) : une même
    // commande peut exister sur plusieurs exercices (report). L'existant est recherché sur
    // le couple (numéro, année d'import) pour créer la ligne de l'exercice courant.
    const cleIdentite = (row: Record<string, unknown>) =>
      `${String(row["numero_commande"] ?? "")}::${String(row["annee_exercice"] ?? "")}`;
    const { data: existingRows, error: existingError } = await db
      .from("travaux_commandes")
      .select("*")
      .in("numero_commande", numbers);
    if (existingError) throw new Error(`Lecture des commandes : ${existingError.message}`);
    const existingParCle = new Map(
      (existingRows ?? []).map((row: Record<string, unknown>) => [cleIdentite(row), row]),
    );
    const trancheCodes = [
      ...new Set(data.commandes.map((row) => row.tranche_code).filter(Boolean)),
    ];
    const { data: tranches, error: trancheError } = trancheCodes.length
      ? await db.from("tranches").select("code").in("code", trancheCodes)
      : { data: [], error: null };
    if (trancheError) throw new Error(`Validation des tranches : ${trancheError.message}`);
    const validTranches = new Set((tranches ?? []).map((row: { code: string }) => row.code));
    let creees = 0;
    let conflits = 0;
    let reports = 0;
    let inchangees = 0;
    let ignorees = 0;
    // Colonnes réellement présentes dans travaux_commandes (schéma de production).
    // Les colonnes classification_* n'existent pas en base : on ne les écrit jamais.
    const VALID_COLUMNS: string[] = [...TRAVAUX_FIELDS, "vu_dans_import_id", "actif"];

    for (const source of data.commandes) {
      const ligne = typeof source["ligne"] === "number" ? source["ligne"] : null;
      const fullRow: Record<string, unknown> = {
        ...source,
        tranche_code:
          source.tranche_code && validTranches.has(source.tranche_code)
            ? source.tranche_code
            : null,
        vu_dans_import_id: data.importId,
        annee_exercice: data.annee_exercice,
        actif: true,
      };

      // Filtrage strict pour ne garder que les colonnes valides
      const row = Object.fromEntries(
        Object.entries(fullRow).filter(([key]) => VALID_COLUMNS.includes(key)),
      );

      // Rattachement patrimoine impossible : on l'enregistre sans bloquer la commande.
      if (source.tranche_code && !validTranches.has(source.tranche_code)) {
        ignorees += 1;
        const ignoredDetail = await db
          .from("travaux_import_details")
          .insert(detailIgnoree(data.importId, source as Record<string, unknown>, ligne));
        if (ignoredDetail.error)
          throw new Error(
            `Détail ignoree ${source.numero_commande} : ${ignoredDetail.error.message}`,
          );
      }
      const before = existingParCle.get(
        `${String(source.numero_commande)}::${String(data.annee_exercice)}`,
      ) as Record<string, unknown> | undefined;

      // Décision métier (V8.16b) : une commande = un n° + un exercice. Un même n° sur un
      // AUTRE exercice n'existe pas encore → création de la ligne de l'exercice courant
      // (inchangee / report / conflit ne concernent que le MÊME couple n°+année).
      const decision = decisionImportCommande({ source: row, before });
      // La décision « creee » n'existe que si before est absent ; pour les autres cas
      // (inchangee / report / conflit), la commande existante est garantie.
      const existingCmd = before as Record<string, unknown>;

      if (decision === "creee") {
        // Aucune commande existante : création pure.
        // Garde défensive : une commande sans numero_commande ne doit jamais atteindre
        // l'INSERT (colonne NOT NULL). Erreur métier explicite, pas d'erreur PostgreSQL.
        if (!row["numero_commande"]) {
          throw new Error("Impossible de créer la commande : numero_commande manquant.");
        }
        const result = await db.from("travaux_commandes").insert(row).select("*").single();
        if (result.error)
          throw new Error(`Écriture ${source.numero_commande} : ${result.error.message}`);
        const commande = result.data as Record<string, unknown>;
        const creationHistory = await db.from("travaux_commandes_historique").insert({
          import_id: data.importId,
          commande_id: commande["id"],
          operation: "creation",
          avant: null,
          apres: travauxComparable(commande),
        });
        if (creationHistory.error)
          throw new Error(
            `Historique création ${source.numero_commande} : ${creationHistory.error.message}`,
          );
        const creeeDetail = await db
          .from("travaux_import_details")
          .insert({ ...detailCreee(data.importId, commande, ligne), commande_id: commande["id"] });
        if (creeeDetail.error)
          throw new Error(`Détail creee ${source.numero_commande} : ${creeeDetail.error.message}`);
        creees += 1;
        continue;
      }

      if (decision === "inchangee") {
        // Commande identique : on la marque vue/active, aucune donnée modifiée.
        const seen = await db
          .from("travaux_commandes")
          .update({ vu_dans_import_id: data.importId, actif: true })
          .eq("id", existingCmd["id"]);
        if (seen.error)
          throw new Error(`Inchangée ${source.numero_commande} : ${seen.error.message}`);
        const inchangeeDetail = await db
          .from("travaux_import_details")
          .insert(detailInchangee(data.importId, existingCmd, ligne));
        if (inchangeeDetail.error)
          throw new Error(
            `Détail inchangee ${source.numero_commande} : ${inchangeeDetail.error.message}`,
          );
        inchangees += 1;
        continue;
      }

      if (decision === "report") {
        // REPORT D'EXERCICE : seule l'année change → UPDATE de la MÊME ligne
        // (numero_commande reste l'identité unique ; aucune seconde ligne créée).
        reports += 1;
        const reported = await db
          .from("travaux_commandes")
          .update({
            annee_exercice: row["annee_exercice"],
            vu_dans_import_id: data.importId,
            actif: true,
          })
          .eq("id", existingCmd["id"])
          .select("*")
          .single();
        if (reported.error)
          throw new Error(`Report ${source.numero_commande} : ${reported.error.message}`);
        const reportHistory = await db.from("travaux_commandes_historique").insert({
          import_id: data.importId,
          commande_id: existingCmd["id"],
          operation: "report",
          avant: travauxComparable(existingCmd),
          apres: travauxComparable(row),
        });
        if (reportHistory.error)
          throw new Error(
            `Historique report ${source.numero_commande} : ${reportHistory.error.message}`,
          );
        const reportDetail = await db
          .from("travaux_import_details")
          .insert(
            detailReport(
              data.importId,
              existingCmd,
              travauxComparable(existingCmd),
              travauxComparable(row),
              ligne,
            ),
          );
        if (reportDetail.error)
          throw new Error(
            `Détail report ${source.numero_commande} : ${reportDetail.error.message}`,
          );
        continue;
      }

      // CONFLIT : version différente (année + au moins un autre champ).
      // La commande active existante n'est PAS écrasée ; la nouvelle version est conservée
      // comme proposition (operation = 'conflit', resolu = false) jusqu'à la décision.
      conflits += 1;
      await db
        .from("travaux_commandes")
        .update({ vu_dans_import_id: data.importId })
        .eq("id", existingCmd["id"]);
      const conflitHistory = await db.from("travaux_commandes_historique").insert({
        import_id: data.importId,
        commande_id: existingCmd["id"],
        operation: "conflit",
        avant: travauxComparable(existingCmd),
        apres: travauxComparable(row),
      });
      if (conflitHistory.error)
        throw new Error(
          `Historique conflit ${source.numero_commande} : ${conflitHistory.error.message}`,
        );
      const conflitDetail = await db
        .from("travaux_import_details")
        .insert(
          detailConflit(
            data.importId,
            existingCmd,
            travauxComparable(existingCmd),
            travauxComparable(row),
            ligne,
          ),
        );
      if (conflitDetail.error)
        throw new Error(
          `Détail conflit ${source.numero_commande} : ${conflitDetail.error.message}`,
        );
    }
    return { creees, modifiees: 0, conflits, reports, inchangees, ignorees };
  });

export const failTravauxImport = createServerFn({ method: "POST" })
  .validator((d: unknown) => importIdSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    const { data: execution, error } = await db
      .from("import_travaux")
      .update({ statut: "erreur", termine_at: new Date().toISOString() })
      .eq("id", data.importId)
      .select("*")
      .single();
    if (error) throw new Error(`Échec de l'import : ${error.message}`);
    return execution;
  });

export const finalizeTravauxImport = createServerFn({ method: "POST" })
  .validator((d: unknown) => finalizeSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;

    // L'archivage est limité à l'ANNÉE D'EXERCICE de l'import : une commande 2023 ne doit
    // jamais être archivée parce qu'elle est absente d'un fichier 2024.
    const { data: execution, error: executionError } = await db
      .from("import_travaux")
      .select("*")
      .eq("id", data.importId)
      .single();
    if (executionError) throw new Error(executionError.message);
    const annee = (execution?.annee_exercice as number | null) ?? null;

    // Commandes actives de la même année que l'import.
    let active: Record<string, unknown>[] = [];
    if (annee != null) {
      const result = await db
        .from("travaux_commandes")
        .select("*")
        .eq("actif", true)
        .eq("annee_exercice", annee);
      if (result.error)
        throw new Error(`Recherche des commandes absentes : ${result.error.message}`);
      active = (result.data ?? []) as Record<string, unknown>[];
    }

    const { data: seen, error: seenError } = await db
      .from("travaux_commandes")
      .select("id")
      .eq("vu_dans_import_id", data.importId);
    if (seenError) throw new Error(seenError.message);
    const seenIds = new Set<string>((seen ?? []).map((row: { id: string }) => row.id));
    const missing = commandesAAArchiver(
      active as { id: string; annee_exercice?: number | null }[],
      annee,
      seenIds,
    );

    for (const row of missing) {
      const archived = await db
        .from("travaux_commandes")
        .update({ actif: false })
        .eq("id", row.id)
        .select("*")
        .single();
      if (archived.error) throw new Error(`Archivage ${row.id} : ${archived.error.message}`);
      // Snapshot complet de la commande avant/après archivage (timeline exploitable).
      const snapshot = travauxComparable(archived.data);
      const avant = { ...snapshot, actif: true };
      const apres = { ...snapshot, actif: false };
      const history = await db.from("travaux_commandes_historique").insert({
        import_id: data.importId,
        commande_id: row.id,
        operation: "archivage",
        avant,
        apres,
      });
      if (history.error) throw new Error(history.error.message);
      // Détail d'import : snapshot immuable + motif d'archivage.
      await db
        .from("travaux_import_details")
        .insert(detailArchivee(data.importId, archived.data as Record<string, unknown>));
    }

    // Persistance des compteurs du rapport dans le journal d'import.
    const updated = await db
      .from("import_travaux")
      .update({
        statut: "termine",
        creees: data.creees ?? 0,
        modifiees: data.modifiees ?? 0,
        inchangees: data.inchangees ?? 0,
        ignorees: data.ignorees ?? 0,
        conflits: data.conflits ?? 0,
        reports: data.reports ?? 0,
        archivees: missing.length,
        termine_at: new Date().toISOString(),
      })
      .eq("id", data.importId)
      .select("*")
      .single();
    if (updated.error) throw new Error(updated.error.message);
    return { ...execution, ...updated.data, archivees: missing.length };
  });
