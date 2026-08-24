/**
 * PSP — Server functions de l'écran de validation des classifications.
 *
 * Module ISOLÉ : ne lit que les tables psp_* (psp_imports, psp_import_rows,
 * psp_feedback) en LECTURE SEULE pour l'aperçu / le détail. Aucune écriture
 * ici : les décisions humaines passent par `savePspFeedback` (psp.functions.ts).
 *
 * Les propositions de classification sont calculées DE MANIÈRE DÉTERMINISTE à
 * partir des lignes importées via le module pur `psp.classification.ts`
 * (aucun stockage, aucune duplication). NAAC_CODE n'est jamais modifié.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { classifierCommande, construireGroupesValidation } from "./psp.classification.ts";
import {
  CHARGES_OPERATION_EXCLUS_PAR_DEFAUT,
  calculerScorePriorite,
  construireGroupeApercu,
  detecterCorrectionsRecurrentes,
  resoudrePerimetrePsp,
  type PspCommandeValidation,
  type PspGroupeApercu,
} from "./psp.validation.ts";

const detailSchema = z.object({ comn: z.string().min(1) });

const apercuSchema = z
  .object({
    /** Chargés d'opération exclus du PSP (décision humaine configurable). */
    charges_operation_exclus: z.array(z.string()).optional(),
    /** Overrides manuels : COMN_NUM réintégrés exceptionnellement dans le PSP. */
    overrides_eligible: z.array(z.string()).optional(),
  })
  .default({});

/**
 * Aperçu de la validation : dernier import + commandes (source + classification
 * + score + périmètre PSP) + groupes de validation + statistiques + suggestions
 * de règles récurrentes (lecture seule).
 */
export const getPspValidationApercu = createServerFn({ method: "POST" })
  .validator((d: unknown) => apercuSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("../integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;

    const chargesExclus = data.charges_operation_exclus ?? CHARGES_OPERATION_EXCLUS_PAR_DEFAUT;
    const overrides = data.overrides_eligible ?? [];

    const { data: imps, error: errImports } = await db
      .from("psp_imports")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1);
    if (errImports) throw new Error(`Lecture des imports PSP : ${errImports.message}`);
    const imp = imps?.[0];
    if (!imp) throw new Error("Aucun import PSP trouvé.");

    const { data: rows, error: errRows } = await db
      .from("psp_import_rows")
      .select(
        "numero_commande_interne, numero_commande, patrimoine, adresse, commune, nature_analytique, corps_etat_libelle, montant_budget, montant_engage, fournisseur, date_commande, er_reference, donnees_brutes",
      )
      .eq("import_id", imp.id);
    if (errRows) throw new Error(`Lecture des lignes PSP : ${errRows.message}`);

    // Chargé d'opération (UTIC_CODE) depuis donnees_brutes si capturé
    // (absent de l'import actuel — la dimension reste disponible en futur).
    const extraireCharge = (db_: Record<string, unknown> | null | undefined): string | null => {
      const d = db_ ?? {};
      const v = d["charge_operation"] ?? d["utic_code"] ?? d["utic"] ?? d["UTIC_CODE"] ?? null;
      return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
    };

    // Classification + score + périmètre (déterministe, en mémoire)
    const commandes: PspCommandeValidation[] = (rows ?? []).map((r: Record<string, unknown>) => {
      const cls = classifierCommande({
        comn: String(r["numero_commande_interne"] ?? ""),
        comc: (r["numero_commande"] as string | null) ?? null,
        naac: (r["nature_analytique"] as string | null) ?? null,
        wnature: String(r["corps_etat_libelle"] ?? ""),
        patrimoine: (r["patrimoine"] as string | null) ?? null,
        montant_engage: (r["montant_engage"] as number | null) ?? null,
      });
      const charge = extraireCharge(
        r["donnees_brutes"] as Record<string, unknown> | null | undefined,
      );
      const perim = resoudrePerimetrePsp({
        naac: (r["nature_analytique"] as string | null) ?? null,
        wnature: String(r["corps_etat_libelle"] ?? ""),
        charge_operation: charge,
        charges_operation_exclus: chargesExclus,
        override_eligible: overrides.includes(String(r["numero_commande_interne"] ?? "")),
      });
      const score = calculerScorePriorite({
        montant_engage: (r["montant_engage"] as number | null) ?? null,
        confiance: cls.confiance,
        exceptionnelle: cls.nature_exceptionnelle !== "aucune",
        multi_domaine: cls.domaine_technique === "multi_domaine",
        domaine_technique: cls.domaine_technique,
        type_intervention: cls.type_intervention,
      });
      const motifValidation: string[] = [];
      if (cls.besoin_validation_humaine) {
        if (cls.domaine_technique === "multi_domaine") motifValidation.push("multi-domaines");
        if (cls.type_intervention === "indetermine" || cls.domaine_technique === "indetermine")
          motifValidation.push("indéterminé");
        if (cls.nature_exceptionnelle !== "aucune") motifValidation.push("exceptionnel");
        if (cls.projet_relais_chelles) motifValidation.push("projet global");
        if (cls.confiance < 0.6) motifValidation.push(`confiance ${cls.confiance.toFixed(2)}`);
      }
      return {
        comn: cls.comn,
        comc: (r["numero_commande"] as string | null) ?? null,
        naac: cls.naac_source,
        patrimoine: (r["patrimoine"] as string | null) ?? null,
        adresse: (r["adresse"] as string | null) ?? null,
        commune: (r["commune"] as string | null) ?? null,
        wnature: String(r["corps_etat_libelle"] ?? ""),
        montant_budget: (r["montant_budget"] as number | null) ?? null,
        montant_engage: (r["montant_engage"] as number | null) ?? null,
        fournisseur: (r["fournisseur"] as string | null) ?? null,
        date_commande: (r["date_commande"] as string | null) ?? null,
        er_reference: (r["er_reference"] as string | null) ?? null,
        type_intervention: cls.type_intervention,
        domaine_technique: cls.domaine_technique,
        domaines_detectes: cls.domaines_detectes,
        famille_psp: cls.famille_psp,
        element_patrimonial: cls.element_patrimonial,
        nature_exceptionnelle: cls.nature_exceptionnelle,
        confiance: cls.confiance,
        besoin_validation_humaine: cls.besoin_validation_humaine,
        regle_appliquee: cls.regle_appliquee,
        justification: cls.justification,
        projet_relais_chelles: cls.projet_relais_chelles,
        libelle_normalise: cls.libelle_normalise,
        motif_validation: motifValidation,
        score_priorite: score.score,
        niveau_priorite: score.niveau,
        raisons_priorite: score.raisons,
        charge_operation: charge,
        perimetre_psp: perim.perimetre_psp,
        motif_exclusion: perim.motif_exclusion,
        categorie_psp: perim.categorie_psp,
        est_pmr: perim.est_pmr,
      };
    });

    // Groupes de validation (uniquement les commandes à valider, clé stricte)
    const classifications = commandes.map((c) =>
      classifierCommande({
        comn: c.comn,
        comc: c.comc,
        naac: c.naac,
        wnature: c.wnature,
        patrimoine: c.patrimoine,
        montant_engage: c.montant_engage,
      }),
    );
    const groupesBruts = construireGroupesValidation(classifications);
    const groupes: PspGroupeApercu[] = groupesBruts.map((g) => {
      const membres = commandes.filter((c) => g.comn_liste.includes(c.comn));
      return construireGroupeApercu(g, membres);
    });

    // Suggestions de règles récurrentes (lecture seule de psp_feedback)
    const { data: feedbacks, error: errFb } = await db
      .from("psp_feedback")
      .select("cible_id, proposition_initiale, decision_utilisateur, correction")
      .order("created_at", { ascending: true });
    if (errFb) throw new Error(`Lecture des feedbacks PSP : ${errFb.message}`);
    const suggestions = detecterCorrectionsRecurrentes(feedbacks ?? []);

    const aValider = commandes.filter((c) => c.besoin_validation_humaine);
    const eligible = commandes.filter((c) => c.perimetre_psp === "eligible");
    const horsPsp = commandes.filter((c) => c.perimetre_psp === "hors_psp");
    const aExaminer = commandes.filter((c) => c.perimetre_psp === "a_examiner");
    const chargesDistinctes = [
      ...new Set(commandes.map((c) => c.charge_operation ?? "").filter((x) => x !== "")),
    ];
    const stats = {
      a_valider: aValider.length,
      groupes: groupes.length,
      haute_priorite: commandes.filter((c) => c.niveau_priorite === "elevee").length,
      multi_domaines: commandes.filter((c) => c.domaine_technique === "multi_domaine").length,
      exceptionnelles: commandes.filter((c) => c.nature_exceptionnelle !== "aucune").length,
      faible_confiance: commandes.filter((c) => c.confiance < 0.6).length,
      // Périmètre PSP
      eligible: eligible.length,
      hors_psp: horsPsp.length,
      a_examiner: aExaminer.length,
      pmr: commandes.filter((c) => c.est_pmr).length,
      charges: chargesDistinctes,
      // Montant total PSP = UNIQUEMENT les commandes éligibles.
      montant_psp: eligible.reduce((s, c) => s + (c.montant_engage ?? 0), 0),
      // Montant concerné (toutes les commandes à valider) — contexte.
      montant_total: aValider.reduce((s, c) => s + (c.montant_engage ?? 0), 0),
    };

    return {
      import: {
        id: imp.id,
        fichier_nom: imp.fichier_nom ?? null,
        exercice: imp.exercice ?? null,
        statut: imp.statut ?? null,
        created_at: imp.created_at ?? null,
      },
      stats,
      groupes,
      commandes,
      suggestions,
      configuration: { charges_operation_exclus: chargesExclus },
    };
  });

/**
 * Détail complet d'une commande (toutes les données source, y compris
 * donnees_brutes) + classification + score. Lecture seule.
 */
export const getPspValidationDetail = createServerFn({ method: "POST" })
  .validator((d: unknown) => detailSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("../integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    const { data: row, error } = await db
      .from("psp_import_rows")
      .select("*")
      .eq("numero_commande_interne", data.comn)
      .maybeSingle();
    if (error) throw new Error(`Lecture de la commande ${data.comn} : ${error.message}`);
    if (!row) throw new Error(`Commande ${data.comn} introuvable.`);

    const cls = classifierCommande({
      comn: row.numero_commande_interne,
      comc: row.numero_commande,
      naac: row.nature_analytique,
      wnature: row.corps_etat_libelle ?? "",
      patrimoine: row.patrimoine,
      montant_engage: row.montant_engage,
      descriptif: row.donnees_brutes?.descriptif,
      observations: row.donnees_brutes?.observations,
    });
    const score = calculerScorePriorite({
      montant_engage: row.montant_engage,
      confiance: cls.confiance,
      exceptionnelle: cls.nature_exceptionnelle !== "aucune",
      multi_domaine: cls.domaine_technique === "multi_domaine",
      domaine_technique: cls.domaine_technique,
      type_intervention: cls.type_intervention,
    });
    const perim = resoudrePerimetrePsp({
      naac: row.nature_analytique,
      wnature: row.corps_etat_libelle ?? "",
      charge_operation: null,
      charges_operation_exclus: [],
    });
    return { row, classification: cls, score, perimetre: perim };
  });

// ── Décisions humaines (psp_decisions) — couche métier séparée ─────────────────
// Les décisions ne modifient JAMAIS les sources (psp_import_rows, travaux_commandes,
// Excel) : elles constituent uniquement une couche de décision métier réutilisée
// à chaque import tant que statut = 'valide'.
// Colonnes utilisées (conformes au schéma réel déjà en base) : id, cle_metier,
// type_decision, decision_utilisateur, statut, motif, created_at, updated_at.
// Aucune migration, aucune modification de schéma.

const decisionKeySchema = z.object({
  cleMetier: z.string().min(1),
  typeDecision: z.enum(["nature", "corps_etat", "perimetre_psp", "rapprochement"]),
});

const saveDecisionSchema = z.object({
  cleMetier: z.string().min(1),
  typeDecision: z.enum(["nature", "corps_etat", "perimetre_psp", "rapprochement"]),
  decisionUtilisateur: z.string().min(1),
  statut: z.enum(["valide", "proposition", "rejete"]),
  motif: z.string().nullish(),
});

/** Retourne la décision VALIDÉE existante pour une clé métier (ou null). */
export const getPspDecision = createServerFn({ method: "POST" })
  .validator((d: unknown) => decisionKeySchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("../integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    const { data: rows, error } = await db
      .from("psp_decisions")
      .select("*")
      .eq("cle_metier", data.cleMetier)
      .eq("type_decision", data.typeDecision)
      .eq("statut", "valide")
      .order("updated_at", { ascending: false })
      .limit(1);
    if (error) throw new Error(`Lecture de la décision : ${error.message}`);
    return rows?.[0] ?? null;
  });

/** Enregistre (insert ou mise à jour sans UNIQUE présumé) une décision humaine. */
export const savePspDecision = createServerFn({ method: "POST" })
  .validator((d: unknown) => saveDecisionSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("../integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    const now = new Date().toISOString();
    const payload = {
      cle_metier: data.cleMetier,
      type_decision: data.typeDecision,
      decision_utilisateur: data.decisionUtilisateur,
      statut: data.statut,
      motif: data.motif ?? null,
      updated_at: now,
    };

    const { data: existing, error: errRead } = await db
      .from("psp_decisions")
      .select("id")
      .eq("cle_metier", data.cleMetier)
      .eq("type_decision", data.typeDecision)
      .limit(1);
    if (errRead) throw new Error(`Lecture de la décision : ${errRead.message}`);

    if (existing && existing.length > 0) {
      const { data: updated, error } = await db
        .from("psp_decisions")
        .update(payload)
        .eq("id", existing[0].id)
        .select("*")
        .single();
      if (error) throw new Error(`Mise à jour de la décision : ${error.message}`);
      return updated;
    }

    const { data: inserted, error: errInsert } = await db
      .from("psp_decisions")
      .insert({ ...payload, created_at: now })
      .select("*")
      .single();
    if (errInsert) throw new Error(`Enregistrement de la décision : ${errInsert.message}`);
    return inserted;
  });

/**
 * Résout la décision à appliquer, dans l'ordre :
 *  1. décision humaine valide (psp_decisions) ;
 *  2. règle générale active (psp_rules) — jamais créée automatiquement ici ;
 *  3. sinon retourne null → l'affichage montre la source + l'incohérence à trancher.
 */
export const resoudreDecisionPsp = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        cleMetier: z.string().min(1),
        typeDecision: z.enum(["nature", "corps_etat", "perimetre_psp", "rapprochement"]),
        numeroCommande: z.string().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("../integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;

    // 1. Décision humaine validée (réutilisée automatiquement aux prochains imports).
    const { data: decisions, error: errDec } = await db
      .from("psp_decisions")
      .select("*")
      .eq("cle_metier", data.cleMetier)
      .eq("type_decision", data.typeDecision)
      .eq("statut", "valide")
      .order("updated_at", { ascending: false })
      .limit(1);
    if (errDec) throw new Error(`Lecture de la décision : ${errDec.message}`);
    if (decisions && decisions.length > 0) {
      return {
        valeur: decisions[0].decision_utilisateur ?? null,
        source: "decision",
        decision: decisions[0],
      };
    }

    // 2. Règle générale active (psp_rules) — lecture seule, ne crée jamais de règle.
    try {
      const { data: regles, error: errRules } = await db
        .from("psp_rules")
        .select("*")
        .in("statut", ["valide", "active"])
        .order("priorite", { ascending: true });
      if (!errRules && regles && regles.length > 0 && data.numeroCommande) {
        const numero = data.numeroCommande.trim();
        const hit = regles.find((r: Record<string, unknown>) => {
          const c = String(r["condition"] ?? "");
          return c.includes(numero) || c.includes(data.typeDecision) || c.includes(data.cleMetier);
        });
        if (hit && hit["resultat"] !== null && hit["resultat"] !== undefined) {
          return { valeur: String(hit["resultat"]), source: "regle", decision: null };
        }
      }
    } catch {
      // La lecture des règles ne doit jamais faire échouer la résolution.
    }

    return { valeur: null, source: null, decision: null };
  });
