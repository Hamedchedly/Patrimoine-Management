/**
 * PSP V6 — Persistance Supabase du Préparateur PSP (server functions, service_role).
 *
 * Toutes les écritures passent par le service_role (BYPASS RLS) ; le frontend
 * n'expose jamais service_role. Le gel (statut=figee) est défendu par les
 * triggers de la base — l'UI ne fait que le respecter, elle n'est pas la sécurité.
 *
 * Règles appliquées :
 *  · `getPspBrouillon` charge programmation + lignes + devis + reports +
 *    décisions + liens en quelques requêtes (aucun N+1) ;
 *  · `import_row_id` d'un lien commande est TOUJOURS résolu via psp_import_rows
 *    (numero_commande_interne ↔ travaux_commandes.numero_commande) — jamais fictif ;
 *    si introuvable → erreur métier explicite ;
 *  · `psp_decisions` : les NOT NULL réels (type_decision, cible_type, cible_id,
 *    proposition_initiale, valeur_retenue, statut) sont renseignés avec de vraies
 *    valeurs métier (cible_type='psp_ligne', cible_id=ligne.id).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  recommanderEntreprises,
  type SuiviOperationVue,
  type SuggestionEntreprise,
  type CommandeTravauxSuivi,
  construireSuiviOperation,
} from "./psp.suivi.foundation.ts";
import {
  adresseRueDepuisPerimetre,
  villeDepuisAdresse,
  construireLigneRegistreAnnuel,
  type CommandeAnnuelle,
  type LigneRegistreAnnuel,
} from "./psp.suivi.view.ts";
import {
  proposerRapprochements,
  type OperationRapprochement,
  type LienRapprochement,
  type CommandeRapprochement,
  type FournisseurRapprochement,
} from "./psp.suivi.rapprochement.ts";
import {
  categorieDepuisCorpsEtat,
  detecterRecherchePatrimoine,
  lotsDeAdresse,
  numerosDeRue,
  resumeSelectionAdresse,
  ruesDeTranche,
  type CorpsEtatReferentiel,
} from "./psp.prep.v7.ts";
import { rueDe } from "./adresses.ts";
import type { ChargesClienteleReferentiel } from "./psp.prep.data.ts";
import { fusionnerProgramme } from "./psp.prep.ts";
import { construireRevueAnciennesProgrammations } from "./psp.prep.suivi.ts";

export type PspLignePersist = {
  id: string;
  /** NULL pour une opération HORS PSP (V8.3). */
  programmation_id: string | null;
  tranche_code: string;
  categorie: string;
  corps_etat_code: string | null;
  corps_etat: string | null;
  nature_travaux: string | null;
  programme: Record<string, number>;
  ligne_budget: string | null;
  remarques: string | null;
  statut: string;
  priorite: string;
  origine: string;
  created_at: string;
  updated_at: string;
};

export type PspBrouillonComplet = {
  programmation: {
    id: string;
    annee_debut: number;
    annee_fin: number;
    version: number;
    type: string;
    statut: string;
    remarques: string | null;
  } | null;
  lignes: PspLignePersist[];
  devis: Array<Record<string, unknown>>;
  reports: Array<Record<string, unknown>>;
  decisions: Array<Record<string, unknown>>;
  links: Array<Record<string, unknown>>;
  perimetres: PspPerimetrePersist[];
  enveloppes: PspEnveloppePersist[];
  /** Historique des lignes (V7.3) — batch, pour la fiche opération. */
  historique: Array<Record<string, unknown>>;
};

export type PspPerimetrePersist = {
  id: string;
  psp_ligne_id: string;
  tranche_code: string;
  niveau: "tranche" | "rue" | "adresse" | "lot";
  rue: string | null;
  numero: string | null;
  lot_id: string | null;
};

export type PspEnveloppePersist = {
  id: string;
  programmation_id: string;
  annee: number;
  categorie: "GE" | "GT" | "CP";
  montant: number;
};

const ligneInput = z.object({
  programmationId: z.string().uuid(),
  trancheCode: z.string().min(1),
  categorie: z.enum(["GE", "GT", "CP"]),
  corpsEtatCode: z.string().nullish(),
  corpsEtat: z.string().nullish(),
  natureTravaux: z.string().nullish(),
  programme: z.record(z.string(), z.number()),
  ligneBudget: z.string().nullish(),
  remarques: z.string().nullish(),
  statut: z
    .enum(["a_definir", "attente_agence", "attente_confirmation"])
    .optional()
    .default("a_definir"),
  priorite: z.enum(["prioritaire", "normale", "non_prioritaire"]).optional().default("normale"),
  origine: z.enum(["preparation", "report", "esquisse", "suivi"]).default("preparation"),
});
type LigneInput = z.infer<typeof ligneInput>;

const patchLigne = z.object({
  id: z.string().uuid(),
  trancheCode: z.string().min(1),
  categorie: z.enum(["GE", "GT", "CP"]),
  corpsEtatCode: z.string().nullish(),
  corpsEtat: z.string().nullish(),
  natureTravaux: z.string().nullish(),
  programme: z.record(z.string(), z.number()),
  ligneBudget: z.string().nullish(),
  remarques: z.string().nullish(),
  statut: z.enum(["a_definir", "attente_agence", "attente_confirmation"]).optional(),
  priorite: z.enum(["prioritaire", "normale", "non_prioritaire"]).optional(),
});

const idSchema = z.object({ id: z.string().uuid() });

const devisInput = z.object({
  pspLigneId: z.string().uuid(),
  fournisseurId: z.string().uuid().nullish(),
  entreprise: z.string().nullish(),
  dateDevis: z.string().nullish(),
  montant: z.number().positive().nullish(),
  statut: z
    .enum([
      "a_demander",
      "demande_envoyee",
      "recu",
      "a_analyser",
      "retenu",
      "non_retenu",
      "expire",
      "annule",
    ])
    .default("a_demander"),
  commentaire: z.string().nullish(),
  documentReference: z.string().nullish(),
  /** V8.4 — date limite de réponse souhaitée (optionnelle). */
  dateLimiteReponse: z.string().nullish(),
});

const reportInput = z.object({
  sourceLigneId: z.string().uuid(),
  sourceAnnee: z.number().int().min(2000).max(2100),
  cibleLigneId: z.string().uuid(),
  cibleAnnee: z.number().int().min(2000).max(2100),
  montant: z.number().min(0),
  motif: z.string().nullish(),
});

const decisionInput = z.object({
  cleMetier: z.string().min(1),
  typeDecision: z.enum([
    "nature",
    "corps_etat",
    "perimetre_psp",
    "rapprochement",
    "report",
    "annulation",
    "conservation",
    "reevaluation",
    "conflit_categorie",
  ]),
  pspLigneId: z.string().uuid(),
  decisionUtilisateur: z.string().min(1),
  statut: z.enum(["valide", "validee", "proposition", "rejete"]).default("validee"),
  motif: z.string().nullish(),
  anneeCible: z.number().int().min(2000).max(2100).nullish(),
  montant: z.number().min(0).nullish(),
});

const commandLinkInput = z.object({
  commandeId: z.string().uuid(),
  pspLigneId: z.string().uuid(),
  justification: z.string().nullish(),
});

/** Charge le brouillon actif (2027-2031, officielle) + toutes ses relations. */
export const getPspBrouillon = createServerFn({ method: "POST" })
  .validator((d: unknown) => d as undefined)
  .handler(async ({ data: _d }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;

    const { data: prog, error } = await db
      .from("psp_programmations")
      .select("*")
      .eq("type", "officielle")
      .eq("statut", "brouillon")
      .order("version", { ascending: false })
      .limit(1);
    if (error) throw new Error(`Lecture du brouillon : ${error.message}`);
    const programmation = prog?.[0] ?? null;

    // Aucun brouillon : on NE crée PAS automatiquement (V6.2 — l'utilisateur
    // déclenche explicitement la création via createPspProgrammation).
    if (!programmation) {
      return {
        programmation: null,
        lignes: [],
        devis: [],
        reports: [],
        decisions: [],
        links: [],
        perimetres: [],
        enveloppes: [],
      };
    }

    const pid = programmation.id;
    const { data: lignes, error: eL } = await db
      .from("psp_lignes")
      .select("*")
      .eq("programmation_id", pid)
      .order("tranche_code");
    if (eL) throw new Error(`Lecture des lignes : ${eL.message}`);

    const ids = ((lignes ?? []) as Array<{ id: string }>).map((l) => l.id);
    const devis = ids.length
      ? ((await db.from("psp_devis").select("*").in("psp_ligne_id", ids)).data ?? [])
      : [];
    const reports = ids.length
      ? ((
          await db
            .from("psp_reports")
            .select("*")
            .or(`source_ligne_id.in.(${ids.join(",")}),cible_ligne_id.in.(${ids.join(",")})`)
        ).data ?? [])
      : [];
    const decisions = ids.length
      ? ((await db.from("psp_decisions").select("*").in("psp_ligne_id", ids)).data ?? [])
      : [];
    const links = ids.length
      ? ((await db.from("psp_command_links").select("*").in("psp_ligne_id", ids)).data ?? [])
      : [];
    const perimetres = ids.length
      ? ((await db.from("psp_ligne_patrimoine").select("*").in("psp_ligne_id", ids)).data ?? [])
      : [];
    const enveloppes =
      (await db.from("psp_enveloppes").select("*").eq("programmation_id", pid)).data ?? [];
    const historique = ids.length
      ? ((
          await db
            .from("psp_ligne_historique")
            .select("*")
            .in("ligne_id", ids)
            .order("created_at", { ascending: false })
        ).data ?? [])
      : [];

    return {
      programmation: {
        id: programmation.id,
        annee_debut: programmation.annee_debut,
        annee_fin: programmation.annee_fin,
        version: programmation.version,
        type: programmation.type,
        statut: programmation.statut,
        remarques: programmation.remarques ?? null,
      },
      lignes: (lignes ?? []) as PspLignePersist[],
      devis,
      reports,
      decisions,
      links,
      perimetres: (perimetres ?? []) as PspPerimetrePersist[],
      enveloppes: (enveloppes ?? []) as PspEnveloppePersist[],
      historique: historique ?? [],
    };
  });

/**
 * Crée la préparation PSP 2027-2031 (officielle, brouillon, version 1).
 * Idempotent côté UI : si un brouillon existe déjà, on le retourne.
 */
export const createPspProgrammation = createServerFn({ method: "POST" })
  .validator((d: unknown) => d as undefined)
  .handler(async ({ data: _d }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;

    const { data: prog, error } = await db
      .from("psp_programmations")
      .select("*")
      .eq("type", "officielle")
      .eq("statut", "brouillon")
      .order("version", { ascending: false })
      .limit(1);
    if (error) throw new Error(`Lecture du brouillon : ${error.message}`);
    if (prog?.[0]) return prog[0];

    const { data: created, error: e2 } = await db
      .from("psp_programmations")
      .insert({
        annee_debut: 2027,
        annee_fin: 2031,
        version: 1,
        type: "officielle",
        statut: "brouillon",
        remarques: "Préparation PSP 2027-2031",
      })
      .select("*")
      .single();
    if (e2) throw new Error(`Création de la préparation : ${e2.message}`);
    return created;
  });

/** Crée une ligne dans le brouillon (INSERT psp_lignes). */
export const createPspLigne = createServerFn({ method: "POST" })
  .validator((d: unknown) => ligneInput.parse(d))
  .handler(async ({ data }: { data: LigneInput }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    const { data: ligne, error } = await db
      .from("psp_lignes")
      .insert({
        programmation_id: data.programmationId,
        tranche_code: data.trancheCode,
        categorie: data.categorie,
        corps_etat_code: data.corpsEtatCode ?? null,
        corps_etat: data.corpsEtat ?? null,
        nature_travaux: data.natureTravaux ?? null,
        programme: data.programme,
        ligne_budget: data.ligneBudget ?? null,
        remarques: data.remarques ?? null,
        statut: data.statut,
        priorite: data.priorite,
        origine: data.origine,
      })
      .select("*")
      .single();
    if (error) throw new Error(`Création de la ligne : ${error.message}`);
    return ligne as PspLignePersist;
  });

/** Modifie une ligne du brouillon (UPDATE psp_lignes). */
export const updatePspLigne = createServerFn({ method: "POST" })
  .validator((d: unknown) => patchLigne.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    // V8.9 — CONSERVATION DES ANNÉES : l'UPDATE direct remplace le JSONB
    // programme → on fusionne d'abord avec l'existant pour ne jamais perdre
    // une année absente du payload (ex. édition ciblée d'une seule année).
    const { data: ligneActuelle } = await db
      .from("psp_lignes")
      .select("programme")
      .eq("id", data.id)
      .single();
    const programmeFusionne = fusionnerProgramme(
      (ligneActuelle?.programme ?? {}) as Record<string, number>,
      data.programme,
    );
    const { data: ligne, error } = await db
      .from("psp_lignes")
      .update({
        tranche_code: data.trancheCode,
        categorie: data.categorie,
        corps_etat_code: data.corpsEtatCode ?? null,
        corps_etat: data.corpsEtat ?? null,
        nature_travaux: data.natureTravaux ?? null,
        programme: programmeFusionne,
        ligne_budget: data.ligneBudget ?? null,
        remarques: data.remarques ?? null,
        statut: data.statut,
        priorite: data.priorite,
      })
      .eq("id", data.id)
      .select("*")
      .single();
    if (error) throw new Error(`Modification de la ligne : ${error.message}`);
    return ligne as PspLignePersist;
  });

/** Supprime une ligne du brouillon (DELETE psp_lignes — bloqué en base si figée). */
export const deletePspLigne = createServerFn({ method: "POST" })
  .validator((d: unknown) => idSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    const { error } = await db.from("psp_lignes").delete().eq("id", data.id);
    if (error) throw new Error(`Suppression de la ligne : ${error.message}`);
    return { ok: true as const };
  });

/** Crée un devis pour une ligne (1..N). */
export const createPspDevis = createServerFn({ method: "POST" })
  .validator((d: unknown) => devisInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    const { data: devis, error } = await db
      .from("psp_devis")
      .insert({
        psp_ligne_id: data.pspLigneId,
        fournisseur_id: data.fournisseurId ?? null,
        entreprise: data.entreprise ?? null,
        date_devis: data.dateDevis ?? null,
        montant: data.montant ?? null,
        statut: data.statut,
        commentaire: data.commentaire ?? null,
        document_reference: data.documentReference ?? null,
        date_limite_reponse: data.dateLimiteReponse ?? null,
      })
      .select("*")
      .single();
    if (error) throw new Error(`Création du devis : ${error.message}`);
    return devis;
  });

/** Met à jour un devis (statut, montant, commentaire…). */
export const updatePspDevis = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        fournisseurId: z.string().uuid().nullish(),
        entreprise: z.string().nullish(),
        dateDevis: z.string().nullish(),
        montant: z.number().positive().nullish(),
        statut: z
          .enum([
            "a_demander",
            "demande_envoyee",
            "recu",
            "a_analyser",
            "retenu",
            "non_retenu",
            "expire",
            "annule",
          ])
          .optional(),
        commentaire: z.string().nullish(),
        documentReference: z.string().nullish(),
        /** V8.4 — date limite de réponse souhaitée (optionnelle). */
        dateLimiteReponse: z.string().nullish(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    const patch: Record<string, unknown> = {};
    if (data.fournisseurId !== undefined) patch["fournisseur_id"] = data.fournisseurId ?? null;
    if (data.entreprise !== undefined) patch["entreprise"] = data.entreprise ?? null;
    if (data.dateDevis !== undefined) patch["date_devis"] = data.dateDevis ?? null;
    if (data.montant !== undefined) patch["montant"] = data.montant ?? null;
    if (data.statut !== undefined) patch["statut"] = data.statut;
    if (data.commentaire !== undefined) patch["commentaire"] = data.commentaire ?? null;
    if (data.documentReference !== undefined)
      patch["document_reference"] = data.documentReference ?? null;
    if (data.dateLimiteReponse !== undefined)
      patch["date_limite_reponse"] = data.dateLimiteReponse ?? null;
    const { data: devis, error } = await db
      .from("psp_devis")
      .update(patch)
      .eq("id", data.id)
      .select("*")
      .single();
    if (error) throw new Error(`Modification du devis : ${error.message}`);
    return devis;
  });

/** Supprime un devis. */
export const deletePspDevis = createServerFn({ method: "POST" })
  .validator((d: unknown) => idSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    const { error } = await db.from("psp_devis").delete().eq("id", data.id);
    if (error) throw new Error(`Suppression du devis : ${error.message}`);
    return { ok: true as const };
  });

/**
 * V8.4 §8/§10 — ENREGISTRE LA RELANCE d'un devis (action « Marquer comme envoyée »).
 *
 * PAT S11 ne prétend JAMAIS avoir envoyé le mail : cette fonction est appelée
 * explicitement par l'utilisateur après ouverture de mailto:. Elle :
 *   1. met à jour `psp_devis.derniere_relance_at` (distinct de created_at) ;
 *   2. écrit une entrée `psp_ligne_historique` (operation='relance', delta JSONB)
 *      — réutilise la table d'historique EXISTANTE (aucune table parallèle).
 * Ne modifie PAS la date de première demande (created_at) ni le statut du devis.
 */
export const enregistrerRelanceDevis = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        motif: z.string().max(400).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    const { data: devis } = await db.from("psp_devis").select("*").eq("id", data.id).single();
    if (!devis) throw new Error("Devis introuvable.");

    const maintenant = new Date().toISOString();
    const { data: maj, error: upErr } = await db
      .from("psp_devis")
      .update({ derniere_relance_at: maintenant })
      .eq("id", data.id)
      .select("*")
      .single();
    if (upErr) throw new Error(`Enregistrement de la relance : ${upErr.message}`);

    const { error: histErr } = await db.from("psp_ligne_historique").insert({
      ligne_id: devis.psp_ligne_id,
      operation: "relance",
      avant: {
        type: "devis",
        devis_id: devis.id,
        entreprise: devis.entreprise,
        derniere_relance_at: devis.derniere_relance_at ?? null,
      },
      apres: {
        type: "devis",
        devis_id: devis.id,
        entreprise: devis.entreprise,
        derniere_relance_at: maintenant,
      },
      resolu: false,
      motif: data.motif ?? "Relance de demande de devis",
    });
    if (histErr) throw new Error(`Historisation de la relance : ${histErr.message}`);

    return maj;
  });

// ═══════════════════════════════════════════════════════════════════════════════
// V7 — PÉRIMÈTRE PATRIMOINE, ENVELOPPES, STATUT/PRIORITÉ, RECHERCHE
// ═══════════════════════════════════════════════════════════════════════════════

const perimetresInput = z.object({
  pspLigneId: z.string().uuid(),
  trancheCode: z.string().min(1),
  perimetres: z
    .array(
      z.object({
        niveau: z.enum(["tranche", "rue", "adresse", "lot"]),
        rue: z.string().nullish(),
        numero: z.string().nullish(),
        lotId: z.string().uuid().nullish(),
      }),
    )
    .min(1),
});

const enveloppesInput = z.object({
  programmationId: z.string().uuid(),
  enveloppes: z
    .array(
      z.object({
        annee: z.number().int().min(2000).max(2100),
        categorie: z.enum(["GE", "GT", "CP"]),
        montant: z.number().min(0),
      }),
    )
    .min(1),
});

const statutPrioriteInput = z.object({
  id: z.string().uuid(),
  statut: z.enum(["a_definir", "attente_agence", "attente_confirmation"]).optional(),
  priorite: z.enum(["prioritaire", "normale", "non_prioritaire"]).optional(),
});

const rechercheTranchesInput = z.object({ q: z.string().max(20).default("") });

/**
 * Remplace le périmètre patrimonial d'une ligne (suppression des lignes
 * existantes puis insertion du nouvel ensemble — multi-lots autorisés, tous dans
 * la même tranche). Le gel (programmation figée) bloque la suppression en base.
 */
export const createPspPerimetres = createServerFn({ method: "POST" })
  .validator((d: unknown) => perimetresInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    const del = await db.from("psp_ligne_patrimoine").delete().eq("psp_ligne_id", data.pspLigneId);
    if (del.error) throw new Error(`Mise à jour du périmètre : ${del.error.message}`);
    const rows = data.perimetres.map((p) => ({
      psp_ligne_id: data.pspLigneId,
      tranche_code: data.trancheCode,
      niveau: p.niveau,
      rue: p.rue ?? null,
      numero: p.numero ?? null,
      lot_id: p.lotId ?? null,
    }));
    const { data: inserted, error } = await db
      .from("psp_ligne_patrimoine")
      .insert(rows)
      .select("*");
    if (error) throw new Error(`Enregistrement du périmètre : ${error.message}`);
    return (inserted ?? []) as PspPerimetrePersist[];
  });

/** Lit le périmètre patrimonial d'une ligne. */
export const getPspPerimetres = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ pspLigneId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    const { data: rows, error } = await db
      .from("psp_ligne_patrimoine")
      .select("*")
      .eq("psp_ligne_id", data.pspLigneId);
    if (error) throw new Error(`Lecture du périmètre : ${error.message}`);
    return (rows ?? []) as PspPerimetrePersist[];
  });

/** Enveloppes GE/GT/CP d'une programmation. */
export const getPspEnveloppes = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ programmationId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    const { data: rows, error } = await db
      .from("psp_enveloppes")
      .select("*")
      .eq("programmation_id", data.programmationId)
      .order("annee")
      .order("categorie");
    if (error) throw new Error(`Lecture des enveloppes : ${error.message}`);
    return (rows ?? []) as PspEnveloppePersist[];
  });

/** Enregistre les enveloppes (upsert sur UNIQUE(programmation_id, annee, categorie)). */
export const savePspEnveloppes = createServerFn({ method: "POST" })
  .validator((d: unknown) => enveloppesInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    const rows = data.enveloppes.map((e) => ({
      programmation_id: data.programmationId,
      annee: e.annee,
      categorie: e.categorie,
      montant: e.montant,
    }));
    const { data: saved, error } = await db
      .from("psp_enveloppes")
      .upsert(rows, { onConflict: "programmation_id,annee,categorie" })
      .select("*");
    if (error) throw new Error(`Enregistrement des enveloppes : ${error.message}`);
    return (saved ?? []) as PspEnveloppePersist[];
  });

/** Met à jour statut et/ou priorité d'une ligne (check contraintes en base). */
export const updatePspLigneStatutPriorite = createServerFn({ method: "POST" })
  .validator((d: unknown) => statutPrioriteInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    const patch: Record<string, string> = {};
    if (data.statut) patch["statut"] = data.statut;
    if (data.priorite) patch["priorite"] = data.priorite;
    const { data: ligne, error } = await db
      .from("psp_lignes")
      .update(patch)
      .eq("id", data.id)
      .select("id, statut, priorite")
      .single();
    if (error) throw new Error(`Mise à jour statut/priorité : ${error.message}`);
    return ligne;
  });

/** Validateur du statut de pilotage manuel (V8.8 §9) — valeurs BORNÉES, aucun
 *  état inventé. Le statut de pilotage reste DISTINCT de l'état réel dérivé. */
const etatPilotageInput = z.object({
  id: z.string().uuid(),
  etatPilotage: z
    .enum([
      "a_traiter",
      "devis_a_demander",
      "devis_demande",
      "devis_recu",
      "commande_a_passer",
      "en_cours",
      "bloquee",
      "prioritaire",
      "a_cloturer",
    ])
    .nullable(),
});

/** Libellés du statut de pilotage manuel (affichage UI — aucun état stocké ici). */
export const ETAT_PILOTAGE_LABELS: Record<string, string> = {
  a_traiter: "À traiter",
  devis_a_demander: "Devis à demander",
  devis_demande: "Devis demandé",
  devis_recu: "Devis reçu",
  commande_a_passer: "Commande à passer",
  en_cours: "En cours",
  bloquee: "Bloquée",
  prioritaire: "Prioritaire",
  a_cloturer: "À clôturer",
};

/**
 * V8.8 §9 — STATUT DE PILOTAGE MANUEL.
 *  · persisté dans `psp_lignes.etat_pilotage` (migration additive à valider) ;
 *  · historisé dans `psp_ligne_historique` (operation='modification', delta) ;
 *  · ne touche JAMAIS travaux_commandes ni les tables d'import ;
 *  · ne remplace jamais l'état réel dérivé (payé/engagé).
 */
export const updatePspLigneEtatPilotage = createServerFn({ method: "POST" })
  .validator((d: unknown) => etatPilotageInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;

    const { data: ligne, error: upErr } = await db
      .from("psp_lignes")
      .update({ etat_pilotage: data.etatPilotage })
      .eq("id", data.id)
      .select("id, etat_pilotage")
      .single();
    if (upErr) {
      if (String(upErr.message).toLowerCase().includes("does not exist")) {
        throw new Error(
          "Colonne etat_pilotage absente — exécuter la migration V8.8 (SQL fourni) avant d'utiliser le statut de pilotage.",
        );
      }
      throw new Error(`Mise à jour du statut de pilotage : ${upErr.message}`);
    }

    // Historisation dans psp_ligne_historique (table EXISTANTE, opération
    // 'modification' autorisée par le CHECK — même pattern delta que les autres).
    await db.from("psp_ligne_historique").insert({
      ligne_id: data.id,
      operation: "modification",
      motif: data.etatPilotage
        ? `Changement de l'état de pilotage → ${data.etatPilotage}`
        : "Retrait de l'état de pilotage",
      avant: { etat_pilotage: null },
      apres: { etat_pilotage: data.etatPilotage },
    });

    return ligne;
  });

/** Recherche progressive de tranches (code/libellé/localité) — réutilisée par l'UI. */
export const rechercherTranches = createServerFn({ method: "POST" })
  .validator((d: unknown) => rechercheTranchesInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    // « TR1976 » → « 1976 » : le préfixe TR n'est pas stocké dans tranches.code.
    const brut = data.q.trim();
    const q = brut.replace(/^TR\s*/i, "");
    let query = db
      .from("tranches")
      .select("code, libelle, localite, sous_secteur, nb_logements")
      .eq("actif", true);
    if (q) {
      query = query.or(`code.ilike.${q}%,libelle.ilike.%${q}%,localite.ilike.%${q}%`);
    }
    const { data: rows, error } = await query.order("code").limit(20);
    if (error) throw new Error(`Recherche de tranches : ${error.message}`);
    return rows ?? [];
  });

/**
 * Recherche patrimoine GLOBALE (V7.3) : tranches (code / libellé / localité)
 * ET lots (ER / locataire / adresse) en parallèle, regroupés et étiquetés.
 * Le type est décidé par `detecterRecherchePatrimoine` :
 *  · numérique / « TR… » → tranches uniquement ;
 *  · « ER… »            → lots uniquement ;
 *  · texte libre        → les deux (ville/libellé ↔ locataire/adresse).
 */
export const rechercherPatrimoineGlobal = createServerFn({ method: "POST" })
  .validator((d: unknown) => rechercheTranchesInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    const brut = data.q.trim();
    const type = detecterRecherchePatrimoine(brut);
    const q = brut.replace(/^TR\s*/i, "");
    const result: {
      tranches: Array<{
        code: string;
        libelle: string | null;
        localite: string | null;
        sous_secteur: string | null;
        nb_logements: number | null;
      }>;
      lots: Array<{
        id: string;
        code_patrimoine: string;
        tranche_code: string;
        adresse: string | null;
        ville: string | null;
        locataire_nom: string | null;
      }>;
    } = { tranches: [], lots: [] };

    const chercheTranches = type === "tranche" || type === "mixte";
    // V8.2.1 — une entrée NUMÉRIQUE (ex. « 33334 » pour ER.33334) cherche aussi
    // les lots : le format réel des ER est « ER.33334 » (dots), jamais deviné.
    const chercheLots =
      type === "lot" || type === "mixte" || (type === "tranche" && /^\d/.test(brut));

    if (chercheTranches) {
      let query = db
        .from("tranches")
        .select("code, libelle, localite, sous_secteur, nb_logements")
        .eq("actif", true);
      if (q) {
        query = query.or(`code.ilike.${q}%,libelle.ilike.%${q}%,localite.ilike.%${q}%`);
      }
      const { data: rows, error } = await query.order("code").limit(20);
      if (!error) result.tranches = rows ?? [];
    }

    if (chercheLots) {
      let query = db
        .from("lots")
        .select("id, code_patrimoine, tranche_code, adresse, ville, locataire_nom, type_lot")
        .eq("actif", true);
      if (brut) {
        const num = brut.replace(/\D/g, "");
        const filtres = [
          `code_patrimoine.ilike.%${brut}%`,
          `adresse.ilike.%${brut}%`,
          `locataire_nom.ilike.%${brut}%`,
        ];
        // V8.2.1 — ER numérique (ex. « 33334 » pour ER.33334) : la forme sans
        // séparateur doit aussi matcher le code réel (points / espaces).
        if (num && num !== brut) filtres.push(`code_patrimoine.ilike.%${num}%`);
        query = query.or(filtres.join(","));
      }
      const { data: rows, error } = await query.order("code_patrimoine").limit(25);
      if (!error) result.lots = rows ?? [];
    }

    return result;
  });

/**
 * Corps d'état disponibles — RÉFÉRENTIEL `psp_corps_etats` (V7.6 §12-13).
 *  · `tout=true`  → toutes les lignes (référentiel, y compris inactifs) — pour
 *    la console « Référentiel corps d'état » ;
 *  · `tout=false` → uniquement les corps ACTIFS + les valeurs déjà saisies dans
 *    `psp_lignes` (continuité des brouillons — jamais un second référentiel).
 * L'historique des commandes ne sert qu'au seed initial de la migration.
 */
export const getCorpsEtats = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({ q: z.string().max(40).default(""), tout: z.boolean().optional().default(false) })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    const resultat: CorpsEtatReferentiel[] = [];

    // 1. Référentiel réel (psp_corps_etats) — autorité.
    let referentielQuery = db
      .from("psp_corps_etats")
      .select("id, code, libelle, categorie, actif")
      .order("libelle", { ascending: true });
    if (!data.tout) referentielQuery = referentielQuery.eq("actif", true);
    const { data: lignesReferentiel, error: errRef } = await referentielQuery;
    if (errRef) throw new Error(`Lecture du référentiel corps d'état : ${errRef.message}`);
    resultat.push(
      ...(lignesReferentiel ?? []).map((r: Record<string, unknown>) => ({
        id: String(r["id"] ?? ""),
        code: (r["code"] as string | null) ?? null,
        libelle: String(r["libelle"] ?? ""),
        categorie: (String(r["categorie"] ?? "GT") === "GE"
          ? "GE"
          : String(r["categorie"] ?? "GT") === "CP"
            ? "CP"
            : "GT") as CorpsEtatReferentiel["categorie"],
        actif: Boolean(r["actif"]),
      })),
    );

    // 2. Union : corps déjà saisis dans les brouillons (psp_lignes) non encore
    //    présents dans le référentiel — les brouillons existants restent éditables.
    const { data: lignesPsp, error: errLignes } = await db
      .from("psp_lignes")
      .select("corps_etat")
      .not("corps_etat", "is", null);
    if (errLignes) throw new Error(`Lecture des corps d'état : ${errLignes.message}`);
    const connus = new Set(resultat.map((r) => r.libelle));
    for (const l of (lignesPsp ?? []) as Array<Record<string, unknown>>) {
      const v = String(l["corps_etat"] ?? "").trim();
      if (!v || connus.has(v)) continue;
      connus.add(v);
      resultat.push({
        code: null,
        libelle: v,
        categorie: categorieDepuisCorpsEtat(v),
        actif: true,
      });
    }

    const q = data.q.trim().toLowerCase();
    const filtree = q
      ? resultat.filter((r) => r.libelle.toLowerCase().includes(q)).slice(0, 20)
      : resultat.slice(0, 40);
    return filtree;
  });

/**
 * V7.6 §12-13 — Écriture du référentiel corps d'état (service_role) :
 * modifier / ajouter / désactiver une ligne, rattacher le corps à GE / GT / CP.
 * L'historique des commandes n'est JAMAIS écrit — il ne sert qu'au seed initial.
 */
export const savePspCorpsEtat = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        id: z.string().uuid().nullish(),
        code: z.string().trim().nullish(),
        libelle: z.string().trim().min(1),
        categorie: z.enum(["GE", "GT", "CP"]),
        actif: z.boolean().optional().default(true),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    const valeurs = {
      code: data.code ?? null,
      libelle: data.libelle,
      categorie: data.categorie,
      actif: data.actif ?? true,
      updated_at: new Date().toISOString(),
    };
    let resultat;
    if (data.id) {
      const { data: ligne, error } = await db
        .from("psp_corps_etats")
        .update(valeurs)
        .eq("id", data.id)
        .select("id, code, libelle, categorie, actif")
        .single();
      if (error) throw new Error(`Modification du référentiel corps d'état : ${error.message}`);
      resultat = ligne;
    } else {
      const { data: ligne, error } = await db
        .from("psp_corps_etats")
        .upsert(valeurs, { onConflict: "libelle" })
        .select("id, code, libelle, categorie, actif")
        .single();
      if (error) throw new Error(`Ajout au référentiel corps d'état : ${error.message}`);
      resultat = ligne;
    }
    return (resultat ?? null) as CorpsEtatReferentiel | null;
  });

/**
 * V7.6 §9-11 — Écriture du référentiel chargé clientèle (service_role) :
 * modifier / ajouter / désactiver une ligne. La clé reste le code sous-secteur
 * du fichier patrimoine (jamais modifié) ; un même CC gère plusieurs sous-secteurs.
 */
export const savePspChargeClientele = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        sousSecteur: z.string().min(1),
        chargeClientele: z.string().trim().min(1),
        // V7.9 §5 — l'ID CC est normalisé en MAJUSCULES côté serveur (la règle
        // ne dépend jamais uniquement de l'UI).
        identifiantPersonnel: z.string().trim().toUpperCase().nullish(),
        actif: z.boolean().optional().default(true),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    const { data: ligne, error } = await db
      .from("psp_charges_clientele")
      .upsert(
        {
          sous_secteur: data.sousSecteur,
          charge_clientele: data.chargeClientele,
          identifiant_personnel: data.identifiantPersonnel ?? null,
          actif: data.actif ?? true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "sous_secteur" },
      )
      .select("sous_secteur, charge_clientele, identifiant_personnel, actif")
      .single();
    if (error) throw new Error(`Enregistrement du référentiel CC : ${error.message}`);
    return (ligne ?? null) as ChargesClienteleReferentiel | null;
  });

/** Recherche progressive de lots (ER / locataire / adresse) — réutilise le moteur ciblé. */
export const rechercherLotsV7 = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ q: z.string().max(40).default(""), tranche: z.string().optional() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    let query = db
      .from("lots")
      .select("id, code_patrimoine, tranche_code, adresse, ville, locataire_nom, type_lot")
      .eq("actif", true);
    const q = data.q.trim();
    if (q) {
      const num = q.replace(/\D/g, "");
      const filtres = [
        `code_patrimoine.ilike.%${q}%`,
        `adresse.ilike.%${q}%`,
        `locataire_nom.ilike.%${q}%`,
      ];
      // V8.2.1 — ER numérique : matcher aussi le code réel sans séparateur.
      if (num && num !== q) filtres.push(`code_patrimoine.ilike.%${num}%`);
      query = query.or(filtres.join(","));
    }
    if (data.tranche) query = query.eq("tranche_code", data.tranche);
    const { data: rows, error } = await query.order("code_patrimoine").limit(25);
    if (error) throw new Error(`Recherche de lots : ${error.message}`);
    return rows ?? [];
  });

/** Rues distinctes d'une tranche (réutilise `rueDe` — hiérarchie TR → rues → numéros). */
export const rechercherRuesTranche = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ tranche: z.string().min(1), q: z.string().max(40).default("") }).parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    const { data: rows, error } = await db
      .from("lots")
      .select("adresse, ville")
      .eq("tranche_code", data.tranche)
      .eq("actif", true)
      .limit(600);
    if (error) throw new Error(`Lecture des rues : ${error.message}`);
    return ruesDeTranche(
      (rows ?? []) as Array<{ adresse: string | null; ville: string | null }>,
      data.q,
    );
  });

/** Numéros/entrées disponibles d'une rue dans une tranche. */
export const rechercherNumerosRue = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ tranche: z.string().min(1), rue: z.string().min(1) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    const { data: rows, error } = await db
      .from("lots")
      .select("adresse, ville")
      .eq("tranche_code", data.tranche)
      .eq("actif", true)
      .limit(600);
    if (error) throw new Error(`Lecture des numéros : ${error.message}`);
    return numerosDeRue(
      (rows ?? []) as Array<{ adresse: string | null; ville: string | null }>,
      data.rue,
    );
  });

/** Lots d'une entrée précise (« 12 RUE CORNILLIOT ») dans une tranche — multi-sélection. */
export const rechercherLotsAdresse = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ tranche: z.string().min(1), adresse: z.string().min(1) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    const { data: rows, error } = await db
      .from("lots")
      .select("id, code_patrimoine, tranche_code, adresse, ville, locataire_nom, type_lot")
      .eq("tranche_code", data.tranche)
      .eq("actif", true)
      .limit(600);
    if (error) throw new Error(`Lecture des lots de l'adresse : ${error.message}`);
    return lotsDeAdresse(
      (rows ?? []) as Array<{ id: string; code_patrimoine: string; adresse: string | null }>,
      data.adresse,
    );
  });

/**
 * LEGACY — ne pas utiliser pour le suivi opérationnel actuel.
 * V8.6.3 : gel de `psp_reports` (0 ligne ; la revue des reports V3/V4 est
 * masquée du parcours utilisateur). Comportement inchangé.
 *
 * Crée un report source → cible (la ligne cible porte origine='report').
 */
export const createPspReport = createServerFn({ method: "POST" })
  .validator((d: unknown) => reportInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    const { data: report, error } = await db
      .from("psp_reports")
      .insert({
        source_ligne_id: data.sourceLigneId,
        source_annee: data.sourceAnnee,
        cible_ligne_id: data.cibleLigneId,
        cible_annee: data.cibleAnnee,
        montant: data.montant,
        motif: data.motif ?? null,
      })
      .select("*")
      .single();
    if (error) throw new Error(`Création du report : ${error.message}`);
    return report;
  });

/**
 * Enregistre une décision PSP (généralisation de savePspDecision) dans
 * psp_decisions. Les NOT NULL réels sont renseignés : cible_type='psp_ligne',
 * cible_id=ligne.id, proposition_initiale/valeur_retenue = état du programme.
 */
export const saveDecisionPsp = createServerFn({ method: "POST" })
  .validator((d: unknown) => decisionInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    const now = new Date().toISOString();
    const { data: ligne } = await db
      .from("psp_lignes")
      .select("programme")
      .eq("id", data.pspLigneId)
      .single();
    const programme = (ligne?.programme ?? {}) as Record<string, number>;
    const payload = {
      cle_metier: data.cleMetier,
      type_decision: data.typeDecision,
      cible_type: "psp_ligne",
      cible_id: data.pspLigneId,
      proposition_initiale: programme,
      valeur_retenue: data.anneeCible
        ? { [String(data.anneeCible)]: data.montant ?? 0 }
        : programme,
      decision_utilisateur: data.decisionUtilisateur,
      statut: data.statut,
      motif: data.motif ?? null,
      psp_ligne_id: data.pspLigneId,
      annee_cible: data.anneeCible ?? null,
      montant: data.montant ?? null,
      created_at: now,
      updated_at: now,
    };
    const { data: inserted, error } = await db
      .from("psp_decisions")
      .insert(payload)
      .select("*")
      .single();
    if (error) throw new Error(`Enregistrement de la décision : ${error.message}`);
    return inserted;
  });

/**
 * Rattache une commande existante à une ligne PSP via psp_command_links.
 * import_row_id est TOUJOURS résolu réellement (psp_import_rows.numero_commande_interne
 * ↔ travaux_commandes.numero_commande). Si introuvable → erreur métier, aucune
 * liaison créée.
 */
export const createPspCommandLink = createServerFn({ method: "POST" })
  .validator((d: unknown) => commandLinkInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;

    // V8.5.3 — anti-doublon : une commande ne doit jamais être liée deux fois.
    const { data: liensExistants } = await db
      .from("psp_command_links")
      .select("id, psp_ligne_id, methode, statut")
      .eq("commande_id", data.commandeId);
    if ((liensExistants ?? []).length > 0) {
      const lien = liensExistants[0];
      if (lien.psp_ligne_id === data.pspLigneId) {
        throw new Error("Cette commande est déjà rattachée à cette opération.");
      }
      throw new Error("Cette commande est déjà rattachée à une autre opération.");
    }

    const { data: commande } = await db
      .from("travaux_commandes")
      .select("numero_commande")
      .eq("id", data.commandeId)
      .single();
    if (!commande?.numero_commande) {
      throw new Error(
        "Impossible de rattacher la commande à la ligne PSP : import d'origine introuvable.",
      );
    }
    const numero = String(commande.numero_commande).trim();
    const { data: importRows } = await db
      .from("psp_import_rows")
      .select("id")
      .eq("numero_commande_interne", numero)
      .limit(1);
    const importRow = importRows?.[0];
    if (!importRow?.id) {
      throw new Error(
        "Impossible de rattacher la commande à la ligne PSP : import d'origine introuvable.",
      );
    }

    const { data: link, error } = await db
      .from("psp_command_links")
      .insert({
        commande_id: data.commandeId,
        import_row_id: importRow.id,
        psp_ligne_id: data.pspLigneId,
        type_relation: "rattachement_ligne",
        methode: "manuel",
        confiance: 1,
        statut: "valide",
        justification: data.justification ?? "Rattachement manuel ligne PSP ↔ commande",
      })
      .select("*")
      .single();
    if (error) throw new Error(`Rattachement de la commande : ${error.message}`);

    // V8.5.3 — historisation dans psp_ligne_historique (table EXISTANTE, opération
    // 'modification' autorisée par le CHECK ; motif explicite).
    await db.from("psp_ligne_historique").insert({
      ligne_id: data.pspLigneId,
      operation: "modification",
      avant: { type: "rattachement", commande_id: data.commandeId, avant: null },
      apres: { type: "rattachement", commande_id: data.commandeId, lien_id: (link as any).id },
      resolu: false,
      motif: `Rattachement manuel commande ${numero}`,
    });

    return link;
  });

/**
 * V8.5.3 — RETIRE UN RATTACHEMENT (correction humaine).
 *
 * Supprime UNIQUEMENT le lien `psp_command_links`. La commande importée
 * (travaux_commandes), les imports et psp_import_rows restent INTACTS.
 * Confirmation requise côté UI avant appel.
 */
export const deletePspCommandLink = createServerFn({ method: "POST" })
  .validator((d: unknown) => idSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    const { data: lien } = await db
      .from("psp_command_links")
      .select("id, commande_id, psp_ligne_id, methode, statut")
      .eq("id", data.id)
      .single();
    if (!lien) throw new Error("Rattachement introuvable.");

    // V8.6 — le numéro de commande est lu en LECTURE SEULE (travaux_commandes intact).
    let numeroCommande: string | null = null;
    if (lien.commande_id) {
      const { data: cmd } = await db
        .from("travaux_commandes")
        .select("numero_commande")
        .eq("id", lien.commande_id)
        .single();
      numeroCommande = cmd?.numero_commande ?? null;
    }

    const { error } = await db.from("psp_command_links").delete().eq("id", data.id);
    if (error) throw new Error(`Retrait du rattachement : ${error.message}`);

    // V8.6 §12 — historisation du retrait dans psp_ligne_historique (table EXISTANTE,
    // operation 'modification' — même pattern delta JSONB que createPspCommandLink).
    if (lien.psp_ligne_id) {
      await db.from("psp_ligne_historique").insert({
        ligne_id: lien.psp_ligne_id,
        operation: "modification",
        avant: { type: "rattachement", commande_id: lien.commande_id, lien_id: data.id },
        apres: { type: "rattachement", commande_id: lien.commande_id, retrait: true },
        resolu: false,
        motif: `Retrait du rattachement commande ${numeroCommande ?? lien.commande_id}`,
      });
    }

    return { ok: true as const, pspLigneId: lien.psp_ligne_id };
  });
// ── V7.3 — fournisseurs, opérations ATOMIQUES, historique ──────────────────────

/**
 * Recherche progressive des fournisseurs pour le devis : NOM / code (alias) /
 * n° réel / CORPS D'ÉTAT, dans une SEULE case. V8.16p — inclut aussi les refs
 * SANS fiche (numéros présents dans les commandes passées) pour qu'elles soient
 * trouvables sans « créer la fiche fournisseur » (id:null → entrée virtuelle).
 * Retourne `corps` (libellés distincts) pour l'affichage.
 */
export const rechercherFournisseursDevis = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ q: z.string().max(40).default("") }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;

    // Référentiel fournisseurs (fiches).
    const { data: fournisseurs, error } = await db
      .from("fournisseurs")
      .select("id, nom, ville")
      .order("nom", { ascending: true });
    if (error) throw new Error(`Lecture des fournisseurs : ${error.message}`);

    // Alias (identifiants sources : numéros travaux_commandes / psp_import_rows…).
    const { data: aliasesData, error: eA } = await db
      .from("fournisseur_aliases")
      .select("fournisseur_id, source, identifiant_source");
    if (eA) throw new Error(`Lecture des alias fournisseurs : ${eA.message}`);

    // V8.16p — corps d'état par numéro (commandes réelles) + activités validées par fiche.
    const { data: commandesCorps, error: eC } = await db
      .from("travaux_commandes")
      .select("numero_fournisseur, corps_etat")
      .eq("actif", true)
      .not("numero_fournisseur", "is", null);
    if (eC) throw new Error(`Lecture des corps d'état : ${eC.message}`);
    const corpsParNumero = new Map<string, Set<string>>();
    for (const c of (commandesCorps ?? []) as Array<{
      numero_fournisseur: string;
      corps_etat: string | null;
    }>) {
      const num = String(c.numero_fournisseur ?? "").trim();
      const corps = (c.corps_etat ?? "").trim();
      if (!num || !corps) continue;
      const set = corpsParNumero.get(num) ?? new Set<string>();
      set.add(corps);
      corpsParNumero.set(num, set);
    }
    const { data: activitesData, error: eAct } = await db
      .from("fournisseur_activites")
      .select("fournisseur_id, corps_etat_libelle");
    if (eAct) throw new Error(`Lecture des activités fournisseurs : ${eAct.message}`);
    const activitesParFournisseur = new Map<string, Set<string>>();
    for (const a of (activitesData ?? []) as Array<{
      fournisseur_id: string;
      corps_etat_libelle: string | null;
    }>) {
      const lib = (a.corps_etat_libelle ?? "").trim();
      if (!a.fournisseur_id || !lib) continue;
      const set = activitesParFournisseur.get(a.fournisseur_id) ?? new Set<string>();
      set.add(lib);
      activitesParFournisseur.set(a.fournisseur_id, set);
    }

    const aliasesPar = new Map<string, Array<{ source: string; identifiant_source: string }>>();
    const numerosCouverts = new Set<string>();
    for (const a of aliasesData ?? []) {
      const id = String(a["fournisseur_id"] ?? "");
      if (!id) continue;
      aliasesPar.set(id, [
        ...(aliasesPar.get(id) ?? []),
        {
          source: String(a["source"] ?? ""),
          identifiant_source: String(a["identifiant_source"] ?? ""),
        },
      ]);
      numerosCouverts.add(String(a["identifiant_source"] ?? "").trim());
    }

    type EntreeRecherche = {
      id: string | null;
      nom: string;
      ville: string | null;
      codes: string[];
      corps: string[];
    };
    const entrees: EntreeRecherche[] = [];
    for (const f of (fournisseurs ?? []) as Array<{
      id: string;
      nom: string;
      ville: string | null;
    }>) {
      const codes = (aliasesPar.get(f.id) ?? []).map((a) => a.identifiant_source);
      const corps = new Set<string>();
      for (const c of codes) for (const x of corpsParNumero.get(c.trim()) ?? []) corps.add(x);
      for (const x of activitesParFournisseur.get(f.id) ?? []) corps.add(x);
      entrees.push({ id: f.id, nom: f.nom, ville: f.ville, codes, corps: [...corps] });
    }
    // V8.16p — refs SANS fiche (commandes passées) → entrée virtuelle (jamais créée en base).
    for (const num of corpsParNumero.keys()) {
      if (numerosCouverts.has(num)) continue;
      entrees.push({
        id: null,
        nom: "",
        ville: null,
        codes: [num],
        corps: [...(corpsParNumero.get(num) ?? [])],
      });
    }

    const q = data.q.trim().toLowerCase();
    const trouves = entrees
      .filter((f) => {
        if (!q) return true;
        if (f.nom.toLowerCase().includes(q)) return true;
        if (f.codes.some((c) => c.toLowerCase().includes(q))) return true;
        if (f.corps.some((c) => c.toLowerCase().includes(q))) return true;
        return false;
      })
      .sort((a, b) => {
        const na = (a.nom || "").toLowerCase();
        const nb = (b.nom || "").toLowerCase();
        if (na && !nb) return -1;
        if (!na && nb) return 1;
        if (na !== nb) return na.localeCompare(nb, "fr");
        return (a.codes[0] ?? "").localeCompare(b.codes[0] ?? "");
      })
      .slice(0, 20);
    return trouves.map((f) => ({
      id: f.id,
      nom: f.nom,
      ville: f.ville,
      codes: f.codes,
      corps: f.corps.slice(0, 3),
    }));
  });

/** Périmètre jsonb pour les RPC atomiques (niveau/rue/numero/lotId). */
const perimetreInput = z.array(
  z.object({
    niveau: z.enum(["tranche", "rue", "adresse", "lot"]),
    rue: z.string().nullish(),
    numero: z.string().nullish(),
    lotId: z.string().uuid().nullish(),
  }),
);

/** Devis jsonb pour les RPC atomiques. */
const devisRpcInput = z
  .array(
    z.object({
      fournisseurId: z.string().uuid().nullish(),
      entreprise: z.string().nullish(),
      dateDevis: z.string().nullish(),
      montant: z.number().nullish(),
      statut: z.string().nullish(),
      commentaire: z.string().nullish(),
      documentReference: z.string().nullish(),
    }),
  )
  .nullish();

/**
 * Création ATOMIQUE (V7.3) : ligne + périmètre + devis via le RPC
 * public.create_psp_operation. Échec → aucun résidu (rollback plpgsql).
 */
export const createPspOperationComplete = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        programmationId: z.string().uuid(),
        trancheCode: z.string().min(1),
        categorie: z.enum(["GE", "GT", "CP"]),
        corpsEtatCode: z.string().nullish(),
        corpsEtat: z.string().nullish(),
        natureTravaux: z.string().nullish(),
        programme: z.record(z.string(), z.number()),
        ligneBudget: z.string().nullish(),
        remarques: z.string().nullish(),
        statut: z.string().nullish(),
        priorite: z.string().nullish(),
        origine: z.string().nullish(),
        perimetres: perimetreInput.default([]),
        devis: devisRpcInput,
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    const perimetres = (data.perimetres ?? []).map((p) => ({
      niveau: p.niveau,
      rue: p.rue ?? null,
      numero: p.numero ?? null,
      lot_id: p.lotId ?? null,
    }));
    const devis = (data.devis ?? []).map((d) => ({
      fournisseur_id: d.fournisseurId ?? null,
      entreprise: d.entreprise ?? null,
      date_devis: d.dateDevis ?? null,
      montant: d.montant ?? null,
      statut: d.statut ?? "recu",
      commentaire: d.commentaire ?? null,
      document_reference: d.documentReference ?? null,
    }));
    const { data: ligne, error } = await db.rpc("create_psp_operation", {
      p_programmation_id: data.programmationId,
      p_tranche_code: data.trancheCode,
      p_categorie: data.categorie,
      p_corps_etat_code: data.corpsEtatCode ?? null,
      p_corps_etat: data.corpsEtat ?? null,
      p_nature_travaux: data.natureTravaux ?? null,
      p_programme: data.programme,
      p_ligne_budget: data.ligneBudget ?? null,
      p_remarques: data.remarques ?? null,
      p_statut: data.statut ?? null,
      p_priorite: data.priorite ?? null,
      p_origine: data.origine ?? "preparation",
      p_perimetres: perimetres,
      p_devis: devis.length > 0 ? devis : null,
    });
    if (error) throw new Error(`Création de l'opération : ${error.message}`);
    return ligne as PspLignePersist;
  });

// ── V8.3 — OPÉRATION HORS PSP (registre Opérations) ──────────────────────────

/**
 * Création d'une opération HORS PSP depuis le registre « Opérations ».
 *
 * PSP et hors PSP = UNE SEULE entité opérationnelle (psp_lignes) : aucune table
 * parallèle. Une opération hors PSP :
 *   · n'a aucune programmation / année / ligne budgétaire / enveloppe / montant
 *     obligatoire (programmation_id = NULL, programme = {}, origine = 'hors_psp') ;
 *   · peut avoir TR, sous-secteur/CC (dérivés du patrimoine), adresse/périmètre,
 *     corps d'état, catégorie, nature, priorité, statut, notes, devis, entreprises
 *     consultées (mêmes tables PSP que les opérations PSP).
 *
 * Une opération vide sans information métier exploitable est REFUSÉE (§21) :
 * la TR seule ne suffit pas — au moins un corps d'état OU une nature des travaux.
 */
export const createPspOperationHorsPsp = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        trancheCode: z.string().min(1),
        categorie: z.enum(["GE", "GT", "CP"]),
        corpsEtatCode: z.string().nullish(),
        corpsEtat: z.string().nullish(),
        natureTravaux: z.string().nullish(),
        remarques: z.string().nullish(),
        statut: z
          .enum(["a_definir", "attente_agence", "attente_confirmation"])
          .optional()
          .default("a_definir"),
        priorite: z
          .enum(["prioritaire", "normale", "non_prioritaire"])
          .optional()
          .default("normale"),
        perimetres: perimetreInput.default([]),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;

    const corps = (data.corpsEtat ?? "").trim();
    const nature = (data.natureTravaux ?? "").trim();
    if (!corps && !nature) {
      throw new Error(
        "Opération refusée : renseignez au moins un corps d'état ou une nature des travaux.",
      );
    }

    // V8.6.1.1 §6 — GARDE ANTI-DOUBLON : si une opération existe déjà avec la même
    // TR ET le même corps d'état ET la même nature, on refuse la création (utilisez
    // l'opération existante — jamais de deuxième copie). Une TR peut porter
    // plusieurs opérations de natures différentes (cas légitimes conservés).
    const { data: existantes } = await db
      .from("psp_lignes")
      .select("id, tranche_code, corps_etat, nature_travaux, origine")
      .eq("tranche_code", data.trancheCode);
    const doublon = (existantes ?? []).find(
      (l: any) =>
        (l.corps_etat ?? "").trim().toLowerCase() === corps.toLowerCase() &&
        (l.nature_travaux ?? "").trim().toLowerCase() === nature.toLowerCase(),
    );
    if (corps && nature && doublon) {
      throw new Error(
        `Opération refusée : une opération existe déjà sur la TR ${data.trancheCode} avec le même corps d'état et la même nature (${doublon.origine === "hors_psp" ? "hors PSP" : "préparation PSP"}). Utilisez l'opération existante ou modifiez la nature.`,
      );
    }

    const { data: ligne, error } = await db
      .from("psp_lignes")
      .insert({
        programmation_id: null,
        tranche_code: data.trancheCode,
        categorie: data.categorie,
        corps_etat_code: data.corpsEtatCode ?? null,
        corps_etat: corps || null,
        nature_travaux: nature || null,
        programme: {},
        ligne_budget: null,
        remarques: data.remarques ?? null,
        statut: data.statut,
        priorite: data.priorite,
        origine: "hors_psp",
      })
      .select("*")
      .single();
    if (error) throw new Error(`Création de l'opération hors PSP : ${error.message}`);

    const perimetres = (data.perimetres ?? []).map((p) => ({
      psp_ligne_id: (ligne as any).id,
      tranche_code: data.trancheCode,
      niveau: p.niveau,
      rue: p.rue ?? null,
      numero: p.numero ?? null,
      lot_id: p.lotId ?? null,
    }));
    if (perimetres.length > 0) {
      const { error: perErr } = await db.from("psp_ligne_patrimoine").insert(perimetres);
      if (perErr) throw new Error(`Enregistrement du périmètre : ${perErr.message}`);
    }

    return ligne as PspLignePersist;
  });
// ── V8.1 — SOCLE SUIVI : lecture agrégée + recommandation d'entreprises ──────

/**
 * getPspSuiviOperation — vue métier agrégée d'une opération PSP
 * (programmation + consultation + commandes liées + exécution).
 *
 * Lecture seule, batch (aucun N+1) : ligne, périmètre, devis, liens, commandes,
 * décisions et patrimoine sont chargés en quelques requêtes.
 * Aucune écriture, aucune valeur copiée dans psp_lignes.
 */
export const getPspSuiviOperation = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ pspLigneId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;

    const { data: ligne, error } = await db
      .from("psp_lignes")
      .select("*")
      .eq("id", data.pspLigneId)
      .single();
    if (error) throw new Error(`Lecture de l'opération : ${error.message}`);

    const id = data.pspLigneId;
    const [perimetresR, devisR, liensR, progR, decisionsR] = await Promise.all([
      db.from("psp_ligne_patrimoine").select("*").eq("psp_ligne_id", id),
      db.from("psp_devis").select("*").eq("psp_ligne_id", id),
      db.from("psp_command_links").select("*").eq("psp_ligne_id", id),
      db.from("psp_programmations").select("statut").eq("id", ligne.programmation_id).maybeSingle(),
      db.from("psp_decisions").select("*").eq("psp_ligne_id", id),
    ]);
    if (perimetresR.error) throw new Error(`Lecture du périmètre : ${perimetresR.error.message}`);
    if (devisR.error) throw new Error(`Lecture des devis : ${devisR.error.message}`);
    if (liensR.error) throw new Error(`Lecture des liens : ${liensR.error.message}`);
    if (decisionsR.error) throw new Error(`Lecture des décisions : ${decisionsR.error.message}`);

    const perimetres = (perimetresR.data ?? []) as any[];
    const devis = (devisR.data ?? []) as any[];
    const liens = (liensR.data ?? []) as any[];
    const decisions = (decisionsR.data ?? []) as any[];

    // Commandes liées — batch (une seule requête pour toutes).
    const commandeIds: string[] = liens
      .map((l: { commande_id: string | null }) => l.commande_id)
      .filter((v: string | null): v is string => Boolean(v));
    let commandes: Array<Record<string, unknown>> = [];
    if (commandeIds.length > 0) {
      const { data: cmd, error: eC } = await db
        .from("travaux_commandes")
        .select(
          "id, numero_commande, tranche_code, fournisseur, numero_fournisseur, descriptif, corps_etat, etat_commande, etat_travaux, budget, engage, paye, solde, created_at, date_demarrage, date_fin_travaux, annee_exercice",
        )
        .in("id", commandeIds);
      if (eC) throw new Error(`Lecture des commandes liées : ${eC.message}`);
      commandes = (cmd ?? []).map((c: any) => ({
        id: c.id,
        numero_commande: c.numero_commande,
        tranche_code: c.tranche_code,
        fournisseur: c.fournisseur,
        descriptif: c.descriptif,
        corps_etat: c.corps_etat,
        etat_commande: c.etat_commande,
        etat_travaux: c.etat_travaux,
        budget: c.budget,
        engage: c.engage,
        paye: c.paye,
        solde: c.solde,
        date_import: c.created_at,
        date_demarrage: c.date_demarrage,
        date_fin_travaux: c.date_fin_travaux,
        annee_exercice: c.annee_exercice,
      }));
    }

    // Patrimoine : TR → adresse (libellé + localité) et CC via
    // tranches.sous_secteur → psp_charges_clientele (JAMAIS depuis travaux_commandes).
    let adresse: string | null = null;
    let cc: string | null = null;
    let sousSecteur: string | null = null;
    if (ligne.tranche_code) {
      const { data: tranche } = await db
        .from("tranches")
        .select("code, libelle, localite, sous_secteur")
        .eq("code", ligne.tranche_code)
        .maybeSingle();
      if (tranche) {
        adresse = [tranche.libelle, tranche.localite].filter(Boolean).join(" – ") || null;
        sousSecteur = tranche.sous_secteur ?? null;
        if (tranche.sous_secteur) {
          const { data: ccRow } = await db
            .from("psp_charges_clientele")
            .select("identifiant_personnel")
            .eq("sous_secteur", tranche.sous_secteur)
            .eq("actif", true)
            .maybeSingle();
          cc = ccRow?.identifiant_personnel ?? null;
        }
      }
    }

    return construireSuiviOperation({
      ligne: {
        id: ligne.id,
        programmation_id: ligne.programmation_id,
        tranche_code: ligne.tranche_code,
        categorie: ligne.categorie,
        corps_etat_code: ligne.corps_etat_code,
        corps_etat: ligne.corps_etat,
        nature_travaux: ligne.nature_travaux,
        programme: ligne.programme ?? {},
        ligne_budget: ligne.ligne_budget,
        remarques: ligne.remarques,
        origine: ligne.origine,
        statut: ligne.statut,
        priorite: ligne.priorite,
        created_at: ligne.created_at,
        updated_at: ligne.updated_at,
      },
      perimetres,
      devis,
      liens,
      commandes: commandes as unknown as CommandeTravauxSuivi[],
      decisions,
      patrimoine: { adresse, cc, sous_secteur: sousSecteur },
      programmationStatut: progR.data?.statut ?? null,
    }) as SuiviOperationVue;
  });

/**
 * getPspEntreprisesSuggestions — entreprises pertinentes pour une opération.
 *
 * Données RÉELLES uniquement : historique des commandes (travaux_commandes →
 * profil d'activité via fournisseurs.analyse) + activités validées manuellement
 * (fournisseur_activites). Aucune activité inventée.
 */
export const getPspEntreprisesSuggestions = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        pspLigneId: z.string().uuid(),
        corpsEtat: z.string().nullish(),
        limite: z.number().int().min(1).max(50).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;

    // Corps d'état de l'opération (si non fourni explicitement).
    let corpsEtat = data.corpsEtat ?? null;
    if (!corpsEtat) {
      const { data: ligne } = await db
        .from("psp_lignes")
        .select("corps_etat")
        .eq("id", data.pspLigneId)
        .maybeSingle();
      corpsEtat = ligne?.corps_etat ?? null;
    }

    const [fournisseursR, activitesR, aliasesR, commandesR, contactsR] = await Promise.all([
      db.from("fournisseurs").select("id, nom"),
      db
        .from("fournisseur_activites")
        .select("fournisseur_id, corps_etat_code, corps_etat_libelle, niveau"),
      db.from("fournisseur_aliases").select("fournisseur_id, source, identifiant_source"),
      db
        .from("travaux_commandes")
        .select("id, numero_fournisseur, corps_etat, budget, annee_exercice")
        .not("numero_fournisseur", "is", null),
      db.from("fournisseurs_contacts").select("fournisseur_id, email").not("email", "is", null),
    ]);
    if (fournisseursR.error)
      throw new Error(`Lecture des fournisseurs : ${fournisseursR.error.message}`);
    if (activitesR.error) throw new Error(`Lecture des activités : ${activitesR.error.message}`);
    if (aliasesR.error) throw new Error(`Lecture des alias : ${aliasesR.error.message}`);
    if (commandesR.error) throw new Error(`Lecture des commandes : ${commandesR.error.message}`);

    // Alias travaux_commandes : numero_fournisseur → fournisseur_id (réel).
    const parNumero = new Map<string, string>();
    for (const a of aliasesR.data ?? []) {
      if (a.source === "travaux_commandes" && a.identifiant_source != null) {
        parNumero.set(String(a.identifiant_source).trim(), a.fournisseur_id);
      }
    }
    // Numéro réel par fournisseur (libellé robuste « Fournisseur n°XXXX » si nom absent).
    const numeroParFournisseur = new Map<string, string>();
    for (const a of aliasesR.data ?? []) {
      if (a.identifiant_source == null) continue;
      const id = String(a.fournisseur_id ?? "");
      const numero = String(a.identifiant_source).trim();
      if (!id || !numero) continue;
      const precedent = numeroParFournisseur.get(id);
      if (!precedent || a.source === "travaux_commandes") numeroParFournisseur.set(id, numero);
    }
    const historique = (commandesR.data ?? [])
      .map((c: any) => ({
        fournisseur_id: parNumero.get(String(c.numero_fournisseur ?? "").trim()),
        corps_etat: c.corps_etat as string | null,
        montant: c.budget as number | null,
        annee: c.annee_exercice as number | null,
      }))
      .filter((h: any) => h.fournisseur_id != null);

    const activites = (activitesR.data ?? []).map((a: any) => ({
      fournisseur_id: a.fournisseur_id as string,
      corps_etat_code: a.corps_etat_code as string,
      corps_etat_libelle: a.corps_etat_libelle as string,
      niveau: a.niveau as "principal" | "secondaire" | "occasionnel",
    }));

    const emailParFournisseur = new Map<string, string>();
    for (const c of contactsR.data ?? []) {
      const email = String(c.email ?? "").trim();
      if (!email) continue;
      if (!emailParFournisseur.has(c.fournisseur_id)) {
        emailParFournisseur.set(c.fournisseur_id, email);
      }
    }

    const suggestions = recommanderEntreprises({
      fournisseurs: (fournisseursR.data ?? []).map((f: any) => ({
        id: f.id as string,
        nom: f.nom as string,
        numero: numeroParFournisseur.get(f.id as string) ?? null,
      })),
      historique,
      activites,
      corps_etat_operation: corpsEtat,
      limite: data.limite ?? 20,
    }) as SuggestionEntreprise[];
    return suggestions.map((s) => ({
      ...s,
      email: emailParFournisseur.get(s.fournisseur_id) ?? null,
    }));
  });

// ── V8.2 — SUIVI OPÉRATION : liste agrégée (batch, aucun N+1) ─────────────────

/**
 * getPspSuiviOperations — tableau du Suivi : toutes les opérations de la
 * dernière programmation officielle, agrégées (programmation + consultation +
 * commandes + exécution) en quelques requêtes batch.
 * Aucune écriture, aucun MOCK, aucune copie de commande dans psp_lignes.
 */
export const getPspSuiviOperations = createServerFn({ method: "POST" })
  .validator((d: unknown) => d as undefined)
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;

    const { data: prog } = await db
      .from("psp_programmations")
      .select("*")
      .eq("type", "officielle")
      .order("version", { ascending: false })
      .limit(1);
    const programmation = prog?.[0] ?? null;

    // V8.3 — le registre « Opérations » charge : les lignes de la dernière
    // programmation officielle (PSP) ET les lignes HORS PSP (programmation_id NULL).
    const { data: lignesProg } = programmation
      ? await db
          .from("psp_lignes")
          .select("*")
          .eq("programmation_id", programmation.id)
          .order("tranche_code")
      : { data: [] as any[] };
    const { data: lignesHorsPsp } = await db
      .from("psp_lignes")
      .select("*")
      .is("programmation_id", null)
      .order("created_at");
    const lignes = [...(lignesProg ?? []), ...(lignesHorsPsp ?? [])];
    const ids: string[] = [...new Set((lignes ?? []).map((l: { id: string }) => l.id))];

    const [perimetresR, devisR, liensR, decisionsR, enveloppesR] = await Promise.all([
      ids.length
        ? db.from("psp_ligne_patrimoine").select("*").in("psp_ligne_id", ids)
        : Promise.resolve({ data: [], error: null }),
      ids.length
        ? db.from("psp_devis").select("*").in("psp_ligne_id", ids)
        : Promise.resolve({ data: [], error: null }),
      ids.length
        ? db.from("psp_command_links").select("*").in("psp_ligne_id", ids)
        : Promise.resolve({ data: [], error: null }),
      ids.length
        ? db.from("psp_decisions").select("*").in("psp_ligne_id", ids)
        : Promise.resolve({ data: [], error: null }),
      programmation
        ? db
            .from("psp_enveloppes")
            .select("annee, categorie, montant")
            .eq("programmation_id", programmation.id)
        : Promise.resolve({ data: [], error: null }),
    ]);
    const perimetres = (perimetresR.data ?? []) as any[];
    const devis = (devisR.data ?? []) as any[];
    const liens = (liensR.data ?? []) as any[];
    const decisions = (decisionsR.data ?? []) as any[];

    // Commandes liées — batch unique.
    const commandeIds: string[] = [
      ...new Set(liens.map((l: any) => l.commande_id).filter(Boolean)),
    ] as string[];
    let commandes: Array<Record<string, unknown>> = [];
    if (commandeIds.length > 0) {
      const { data: cmd } = await db
        .from("travaux_commandes")
        .select(
          "id, numero_commande, tranche_code, fournisseur, numero_fournisseur, descriptif, corps_etat, etat_commande, etat_travaux, budget, engage, paye, solde, created_at, date_demarrage, date_fin_travaux, annee_exercice",
        )
        .in("id", commandeIds);
      commandes = (cmd ?? []).map((c: any) => ({
        id: c.id,
        numero_commande: c.numero_commande,
        tranche_code: c.tranche_code,
        fournisseur: c.fournisseur,
        numero_fournisseur: c.numero_fournisseur,
        descriptif: c.descriptif,
        corps_etat: c.corps_etat,
        etat_commande: c.etat_commande,
        etat_travaux: c.etat_travaux,
        budget: c.budget,
        engage: c.engage,
        paye: c.paye,
        solde: c.solde,
        date_import: c.created_at,
        date_demarrage: c.date_demarrage,
        date_fin_travaux: c.date_fin_travaux,
        annee_exercice: c.annee_exercice,
      }));
    }

    // Patrimoine : tranches + CC (batch) — règle §1A.
    const codes: string[] = [
      ...new Set((lignes ?? []).map((l: { tranche_code: string }) => l.tranche_code)),
    ] as string[];
    const tranches = codes.length
      ? ((
          await db
            .from("tranches")
            .select("code, libelle, localite, sous_secteur")
            .in("code", codes)
        ).data ?? [])
      : [];
    const sousSecteurs: string[] = [
      ...new Set(tranches.map((t: any) => t.sous_secteur).filter(Boolean)),
    ] as string[];
    const ccRows = sousSecteurs.length
      ? ((
          await db
            .from("psp_charges_clientele")
            .select("sous_secteur, identifiant_personnel")
            .in("sous_secteur", sousSecteurs)
            .eq("actif", true)
        ).data ?? [])
      : [];
    const ccPar: Map<string, string | null> = new Map<string, string | null>(
      ccRows.map((r: any) => [r.sous_secteur, r.identifiant_personnel]),
    );
    const tranchePar: Map<string, any> = new Map(tranches.map((t: any) => [t.code, t]));

    const operations = (lignes ?? []).map((ligne: any) => {
      const tranche: any = tranchePar.get(ligne.tranche_code);
      return construireSuiviOperation({
        ligne: {
          id: ligne.id,
          programmation_id: ligne.programmation_id,
          tranche_code: ligne.tranche_code,
          categorie: ligne.categorie,
          corps_etat_code: ligne.corps_etat_code,
          corps_etat: ligne.corps_etat,
          nature_travaux: ligne.nature_travaux,
          programme: ligne.programme ?? {},
          ligne_budget: ligne.ligne_budget,
          remarques: ligne.remarques,
          origine: ligne.origine,
          statut: ligne.statut,
          priorite: ligne.priorite,
          created_at: ligne.created_at,
          updated_at: ligne.updated_at,
        },
        perimetres: perimetres.filter((p: any) => p.psp_ligne_id === ligne.id),
        devis: devis.filter((d: any) => d.psp_ligne_id === ligne.id),
        liens: liens.filter((l: any) => l.psp_ligne_id === ligne.id),
        commandes: commandes as unknown as CommandeTravauxSuivi[],
        decisions: decisions.filter((d: any) => d.psp_ligne_id === ligne.id),
        patrimoine: {
          adresse: tranche
            ? [tranche.libelle, tranche.localite].filter(Boolean).join(" – ") || null
            : null,
          cc: tranche?.sous_secteur ? (ccPar.get(tranche.sous_secteur) ?? null) : null,
          sous_secteur: tranche?.sous_secteur ?? null,
        },
        programmationStatut: programmation?.statut ?? null,
      });
    });

    return {
      programmation: programmation
        ? {
            id: programmation.id,
            annee_debut: programmation.annee_debut,
            annee_fin: programmation.annee_fin,
            version: programmation.version,
            statut: programmation.statut,
          }
        : null,
      enveloppes: enveloppesR.data ?? [],
      operations,
    };
  });

/**
 * V8.8.3 — EXERCICE DE MATÉRIALISATION d'une ligne 'suivi' (fichier annuel N).
 * Projection stricte : une ligne annuelle sans commande est suivie UNIQUEMENT sur
 * l'exercice N du fichier qui l'a matérialisée. Dérivation sans état stocké :
 *  · clé de `programme` dont le montant est > 0 (cas normal : programme[N]=budget) ;
 *  · sinon parse de la remarque « import annuel NNNN » écrite par la matérialisation ;
 *  · sinon aucun (ligne orpheline → invisible des années futures).
 */
export const exerciceLigneSuivi = (ligne: {
  origine?: string | null;
  programme?: Record<string, number> | null;
  remarques?: string | null;
}): number | null => {
  if (ligne.origine !== "suivi") return null;
  const prog = ligne.programme ?? {};
  const annees = Object.keys(prog)
    .map(Number)
    .filter((a) => Number.isFinite(a) && (prog[String(a)] ?? 0) > 0);
  if (annees.length > 0) return Math.max(...annees);
  const m = /import annuel\s+(\d{4})/i.exec(ligne.remarques ?? "");
  return m ? Number(m[1]) : null;
};

/**
 * V8.6.1 §4-§8 — REGISTRE OPÉRATIONNEL ANNUEL.
 *
 * Pour une année N, construit les lignes du registre à partir des données
 * RÉELLES : commandes de l'exercice (travaux_commandes, lecture seule) + les
 * opérations de la préparation programmées sur l'année ou hors PSP (psp_lignes).
 * Aucune écriture, aucun MOCK, aucune représentation parallèle :
 *   · une commande liée à une opération → UNE seule ligne (type 'operation') ;
 *   · une commande non liée → ligne 'commande' (origine dérivée de la ligne
 *     budgétaire du fichier annuel : ligne budgétaire = PSP, sinon Hors PSP) ;
 *   · une opération programmée/hors PSP sans commande → ligne 'operation'
 *     (état 'sans_commande').
 */
export const getPspSuiviAnnuel = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ annee: z.number().int().min(2000).max(2100) }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    const annee = data.annee;

    // Années disponibles : exercices réels des commandes + années de préparation.
    const [
      anneesCmdR,
      commandesR,
      progR,
      lignesR,
      perimR,
      devisR,
      liensR,
      importsExerciceR,
      lotsR,
      aliasesR,
    ] = await Promise.all([
      db.from("travaux_commandes").select("annee_exercice"),
      db
        .from("travaux_commandes")
        .select(
          "id, numero_commande, tranche_code, adresse, nature_analytique, corps_etat, charge_clientele, ligne_budget, descriptif, budget, fournisseur, numero_fournisseur, etat_commande, engage, paye, solde, etat_travaux, date_demarrage, date_fin_travaux, annee_exercice",
        )
        .eq("annee_exercice", annee)
        .eq("actif", true),
      db
        .from("psp_programmations")
        .select("annee_debut, annee_fin, statut")
        .eq("type", "officielle")
        .order("version", { ascending: false })
        .limit(1),
      db.from("psp_lignes").select("*"),
      db.from("psp_ligne_patrimoine").select("*"),
      db.from("psp_devis").select("*"),
      db.from("psp_command_links").select("*"),
      // V8.8 §4 / V8.13 — dernier import de l'exercice demandé (pour compter les
      // lignes annuelles SANS commande de l'état COURANT du fichier, pas le cumul
      // des imports successifs du même fichier : chaque réimport du même export
      // ne doit pas doubler le compteur).
      db
        .from("import_travaux")
        .select("id")
        .eq("annee_exercice", annee)
        .order("demarre_at", { ascending: false })
        .limit(1),
      // V8.16n/p — adresse + ville de référence des tranches (mode des lots ACTIFS, comme la
      // page patrimoine) en secours du périmètre pour les colonnes « Adresse » et « Ville ».
      db.from("lots").select("tranche_code, adresse, ville").eq("actif", true),
      // V8.16o — numéro fournisseur réel (alias travaux_commandes) : affiché en
      // secours quand le NOM d'entreprise d'une demande n'est pas renseigné.
      db.from("fournisseur_aliases").select("fournisseur_id, source, identifiant_source"),
    ]);
    if (commandesR.error) throw new Error(`Lecture du registre : ${commandesR.error.message}`);

    // V8.16o — numéro fournisseur par fournisseur (libellé robuste « Fournisseur n°XXXX »
    // si le nom est absent). Même bloc que getPspEntreprisesSuggestions.
    const numeroParFournisseur = new Map<string, string>();
    for (const a of aliasesR.data ?? []) {
      if (a.identifiant_source == null) continue;
      const id = String(a.fournisseur_id ?? "");
      const numero = String(a.identifiant_source).trim();
      if (!id || !numero) continue;
      const precedent = numeroParFournisseur.get(id);
      if (!precedent || a.source === "travaux_commandes") numeroParFournisseur.set(id, numero);
    }

    // V8.16n/p — adresse + ville de référence par tranche (mode des adresses RÉELLES des lots
    // actifs, avec le n° de voie — même source que la page patrimoine). En secours du périmètre
    // quand une opération n'en a pas. Le bruit (vides, « Adresse inconnue », nombres purs comme
    // « 0 », valeurs sans lettre) est ignoré. En dernier recours, les adresses des commandes de
    // l'exercice complètent le mode (sans jamais créer de données).
    const adresseParTranche = new Map<string, string>();
    const villeParTranche = new Map<string, string>();
    {
      const comptesAdr = new Map<string, Map<string, number>>();
      const comptesVille = new Map<string, Map<string, number>>();
      const ingerer = (
        tranche: string | null | undefined,
        adresse: string | null | undefined,
        ville: string | null | undefined,
      ) => {
        if (!tranche) return;
        const a = (adresse ?? "").replace(/\s+/g, " ").trim();
        if (a && a !== "Adresse inconnue" && !/^\d+$/.test(a) && /[A-Za-zÀ-ÿ]/.test(a)) {
          const m = comptesAdr.get(tranche) ?? new Map<string, number>();
          m.set(a, (m.get(a) ?? 0) + 1);
          comptesAdr.set(tranche, m);
        }
        const v = (ville ?? "").replace(/\s+/g, " ").trim();
        if (v && /[A-Za-zÀ-ÿ]/.test(v)) {
          const m = comptesVille.get(tranche) ?? new Map<string, number>();
          m.set(v, (m.get(v) ?? 0) + 1);
          comptesVille.set(tranche, m);
        }
      };
      for (const lot of (lotsR.data ?? []) as Array<{
        tranche_code: string | null;
        adresse: string | null;
        ville: string | null;
      }>) {
        ingerer(lot.tranche_code, lot.adresse, lot.ville);
      }
      // Repli : adresses des commandes de l'exercice (tranches sans lots exploitables).
      for (const c of (commandesR.data ?? []) as Array<{
        tranche_code: string | null;
        adresse: string | null;
      }>) {
        ingerer(c.tranche_code, c.adresse, null);
      }
      const meilleure = (m: Map<string, number>): string => {
        let meilleur = "";
        let meilleurCompte = 0;
        for (const [k, c] of m)
          if (c > meilleurCompte) {
            meilleur = k;
            meilleurCompte = c;
          }
        return meilleur;
      };
      for (const [t, m] of comptesAdr) {
        const v = meilleure(m);
        if (v) adresseParTranche.set(t, v);
      }
      for (const [t, m] of comptesVille) {
        const v = meilleure(m);
        if (v) villeParTranche.set(t, v);
      }
    }

    // V8.8 §4 / V8.13 — nombre de lignes annuelles SANS commande détectées dans le
    // DERNIER import de l'exercice demandé (travaux_import_details, lecture seule — INTANGIBLE).
    const dernierImportExercice = (importsExerciceR.data ?? [])[0]?.id ?? null;
    let sansCmdImportR: { count: number | null } = { count: null };
    if (dernierImportExercice) {
      const r = await db
        .from("travaux_import_details")
        .select("id", { count: "exact", head: true })
        .eq("type", "sans_commande")
        .eq("message", "Numéro de commande manquant")
        .eq("import_id", dernierImportExercice);
      sansCmdImportR = { count: r.count ?? 0 };
    }

    const anneesDisponibles = [
      ...new Set([
        ...(anneesCmdR.data ?? [])
          .map((c: any) => c.annee_exercice)
          .filter((a: any) => typeof a === "number"),
        ...(progR.data?.[0]?.annee_debut != null
          ? Array.from(
              {
                length:
                  (progR.data[0].annee_fin ?? progR.data[0].annee_debut) -
                  progR.data[0].annee_debut +
                  1,
              },
              (_, i) => progR.data[0].annee_debut + i,
            )
          : []),
      ]),
    ].sort() as number[];

    const commandes = (commandesR.data ?? []) as any[];
    const lignes = (lignesR.data ?? []) as any[];
    const perim = (perimR.data ?? []) as any[];
    const devis = (devisR.data ?? []) as any[];
    const liens = (liensR.data ?? []) as any[];

    // Patrimoine : tranches → sous-secteur → CC (règle §1A).
    const codes = [
      ...new Set(
        commandes
          .map((c) => c.tranche_code)
          .concat(lignes.map((l) => l.tranche_code))
          .filter(Boolean),
      ),
    ] as string[];
    const tranches = codes.length
      ? ((
          await db
            .from("tranches")
            .select("code, libelle, localite, sous_secteur")
            .in("code", codes)
        ).data ?? [])
      : [];
    const sousSecteurs = [
      ...new Set(tranches.map((t: any) => t.sous_secteur).filter(Boolean)),
    ] as string[];
    const ccRows = sousSecteurs.length
      ? ((
          await db
            .from("psp_charges_clientele")
            .select("sous_secteur, identifiant_personnel")
            .in("sous_secteur", sousSecteurs)
            .eq("actif", true)
        ).data ?? [])
      : [];
    const ccPar = new Map<string, string | null>(
      ccRows.map((r: any) => [r.sous_secteur, r.identifiant_personnel]),
    );
    const tranchePar = new Map(tranches.map((t: any) => [t.code, t]));

    // ── Construction des lignes du registre (aucune écriture) ──
    const commandesAnnuelle: CommandeAnnuelle[] = commandes.map((c: any) => ({
      id: c.id,
      numero_commande: c.numero_commande,
      tranche_code: c.tranche_code,
      adresse: c.adresse,
      corps_etat: c.corps_etat,
      nature_analytique: c.nature_analytique,
      charge_clientele: c.charge_clientele,
      ligne_budget: c.ligne_budget,
      descriptif: c.descriptif,
      budget: c.budget,
      fournisseur: c.fournisseur,
      etat_commande: c.etat_commande,
      engage: c.engage,
      paye: c.paye,
      solde: c.solde,
      etat_travaux: c.etat_travaux,
      date_demarrage: c.date_demarrage,
      date_fin_travaux: c.date_fin_travaux,
      annee_exercice: c.annee_exercice,
    }));

    const commandesParId = new Map(commandesAnnuelle.map((c) => [c.id, c]));
    const commandeIdParLigne = new Map(
      liens.filter((l: any) => l.psp_ligne_id).map((l: any) => [l.psp_ligne_id, l.commande_id]),
    );
    const commandesLieesId = new Set(liens.map((l: any) => l.commande_id));
    const lignesRegistre: LigneRegistreAnnuel[] = [];
    const perimPar: Record<string, unknown[]> = {};
    for (const p of perim) (perimPar[p.psp_ligne_id] ??= []).push(p);

    // A. Opérations PAT S11 : programmées sur l'année, hors PSP, liées à une
    //    commande de l'exercice, ou matérialisées par l'import (origine='suivi',
    //    V8.6.2 — une seule ligne, jamais de doublon).
    for (const ligne of lignes) {
      const progAnnee = Number((ligne.programme ?? {})[String(annee)] ?? 0) || 0;
      const horsPsp = ligne.origine === "hors_psp";
      // V8.6.2 — une ligne annuelle matérialisée ('suivi') est suivie sur SON
      // exercice uniquement (année de matérialisation dérivée du programme ou
      // de la remarque « import annuel N »). Elle ne doit JAMAIS apparaître dans
      // les années futures (projection stricte, V8.8.3).
      const origineSuivi = ligne.origine === "suivi";
      const commandeIdLiee = commandeIdParLigne.get(ligne.id);
      const commandeLiee = commandeIdLiee ? commandesParId.get(commandeIdLiee) : undefined;

      // V8.8.3 — projection annuelle STRICTE :
      //  · une ligne 'preparation' n'apparaît sur l'année N que si programme[N]>0
      //    (ou si une commande RÉELLE de l'exercice lui est liée) ;
      //  · une ligne 'suivi' matérialisée depuis le fichier annuel N n'apparaît
      //    que sur son exercice de matérialisation (jamais sur les années futures) ;
      //  · un devis (psp_devis) ne détermine JAMAIS l'année de suivi.
      let visibleAnnee = progAnnee > 0 || horsPsp || Boolean(commandeLiee) || origineSuivi;
      if (visibleAnnee) {
        if (
          origineSuivi &&
          progAnnee <= 0 &&
          !commandeLiee &&
          annee !== exerciceLigneSuivi(ligne)
        ) {
          visibleAnnee = false;
        }
        if (!origineSuivi && !horsPsp && progAnnee <= 0 && !commandeLiee) {
          visibleAnnee = false;
        }
      }
      if (!visibleAnnee) continue;

      const tranche: any = tranchePar.get(ligne.tranche_code);
      const vue = construireSuiviOperation({
        ligne: {
          id: ligne.id,
          programmation_id: ligne.programmation_id,
          tranche_code: ligne.tranche_code,
          categorie: ligne.categorie,
          corps_etat_code: ligne.corps_etat_code,
          corps_etat: ligne.corps_etat,
          nature_travaux: ligne.nature_travaux,
          programme: ligne.programme ?? {},
          ligne_budget: ligne.ligne_budget,
          remarques: ligne.remarques,
          origine: ligne.origine,
          statut: ligne.statut,
          priorite: ligne.priorite,
          created_at: ligne.created_at,
          updated_at: ligne.updated_at,
        },
        perimetres: (perimPar[ligne.id] ?? []) as never,
        devis: devis.filter((d: any) => d.psp_ligne_id === ligne.id) as never,
        liens: liens.filter((l: any) => l.psp_ligne_id === ligne.id) as never,
        commandes: (commandeLiee ? [commandeLiee] : []) as never,
        patrimoine: {
          adresse: tranche
            ? [tranche.libelle, tranche.localite].filter(Boolean).join(" – ") || null
            : null,
          cc: tranche?.sous_secteur ? (ccPar.get(tranche.sous_secteur) ?? null) : null,
          sous_secteur: tranche?.sous_secteur ?? null,
        },
        exercice: annee,
      });

      lignesRegistre.push(
        construireLigneRegistreAnnuel({
          type: "operation",
          id: ligne.id,
          pspLigneId: ligne.id,
          // V8.6.2 — une ligne 'suivi' : origine affichée dérivée de la ligne
          // budgétaire (présente = opération issue du PSP annuel, absente = hors
          // PSP annuel). Jamais transformée en préparation PSP.
          origine: horsPsp
            ? "hors_psp"
            : origineSuivi
              ? (ligne.ligne_budget ?? "").trim()
                ? "psp"
                : "hors_psp"
              : "psp",
          tranche: ligne.tranche_code,
          sousSecteur: tranche?.sous_secteur ?? null,
          cc: tranche?.sous_secteur ? (ccPar.get(tranche.sous_secteur) ?? null) : null,
          corpsEtat: ligne.corps_etat,
          nature: ligne.nature_travaux,
          adresse: vue.programmation.adresse,
          adresseRue:
            adresseRueDepuisPerimetre(
              (perimPar[ligne.id] ?? []) as Array<{
                rue?: string | null;
                numero?: string | null;
              }>,
            ) ??
            adresseParTranche.get(ligne.tranche_code) ??
            null,
          ville:
            tranche?.localite ??
            villeParTranche.get(ligne.tranche_code) ??
            villeDepuisAdresse(vue.programmation.adresse),
          entreprises: devis
            .filter((d: any) => d.psp_ligne_id === ligne.id)
            .map((d: any) => {
              const nom = (d.entreprise ?? "").trim();
              // V8.16o — si le nom n'est pas renseigné, afficher le numéro fournisseur.
              if (nom) return nom;
              return d.fournisseur_id ? (numeroParFournisseur.get(d.fournisseur_id) ?? nom) : nom;
            })
            .filter(Boolean),
          ligneBudget: ligne.ligne_budget,
          budget: commandeLiee?.budget ?? null,
          programmeAnnee: progAnnee || null,
          commande: (commandeLiee ?? null) as CommandeAnnuelle | null,
          // V8.16 — engagé/payé de la ligne suivi sans commande (colonnes migration V8.16).
          engage: ligne.montant_engage ?? null,
          paye: ligne.montant_paye ?? null,
          consultation: {
            nb_demandes: vue.consultation.nb_demandes,
            nb_devis_recus: vue.consultation.nb_devis_recus,
            statut: vue.consultation.statut,
            statut_label: vue.consultation.statut_label,
          },
        }),
      );
    }

    // B. Commandes annuelles NON liées à une opération → ligne 'commande'
    //    (données réelles du fichier annuel importé ; origine dérivée de la
    //    ligne budgétaire : présente = PSP, absente = Hors PSP).
    for (const c of commandesAnnuelle) {
      if (commandesLieesId.has(c.id)) continue;
      const tranche: any = tranchePar.get(c.tranche_code);
      const lb = (c.ligne_budget ?? "").trim();
      lignesRegistre.push(
        construireLigneRegistreAnnuel({
          type: "commande",
          id: c.id,
          pspLigneId: null,
          origine: lb ? "psp" : "hors_psp",
          tranche: c.tranche_code ?? "—",
          sousSecteur: tranche?.sous_secteur ?? null,
          cc: tranche?.sous_secteur ? (ccPar.get(tranche.sous_secteur) ?? null) : null,
          corpsEtat: c.corps_etat,
          nature: c.descriptif,
          adresse: c.adresse,
          ville:
            tranche?.localite ??
            villeParTranche.get(c.tranche_code ?? "") ??
            villeDepuisAdresse(c.adresse),
          ligneBudget: c.ligne_budget,
          budget: c.budget,
          commande: c,
          // V8.16 — engagé/payé de la commande (KPI annuels niveau ligne).
          engage: c.engage ?? null,
          paye: c.paye ?? null,
        }),
      );
    }

    return {
      annee,
      anneesDisponibles,
      lignes: lignesRegistre,
      // Nombre de lignes annuelles SANS commande vues dans les imports (données
      // non persistées — marqueurs travaux_import_details, lecture seule).
      lignesSansCommandeImport: sansCmdImportR?.count ?? 0,
      // V8.6.3 — lignes 'suivi' déjà matérialisées en opérations (origine='suivi').
      lignesSuiviMaterialisees: lignes.filter((l: any) => l.origine === "suivi").length,
    };
  });

export const updatePspOperationComplete = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        trancheCode: z.string().min(1),
        categorie: z.enum(["GE", "GT", "CP"]),
        corpsEtatCode: z.string().nullish(),
        corpsEtat: z.string().nullish(),
        natureTravaux: z.string().nullish(),
        programme: z.record(z.string(), z.number()),
        remarques: z.string().nullish(),
        statut: z.string().nullish(),
        priorite: z.string().nullish(),
        perimetres: perimetreInput.default([]),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    // V8.9 — CONSERVATION DES ANNÉES : une modification ciblée (ex. année 2028)
    // ne doit JAMAIS détruire les autres années programmées (2027/2029/2030/…).
    // Le RPC update_psp_operation REPLACE le JSONB programme → on fusionne
    // d'abord avec l'existant, puis on envoie le programme complet fusionné.
    const { data: ligneActuelle } = await db
      .from("psp_lignes")
      .select("programme")
      .eq("id", data.id)
      .single();
    const programmeFusionne = fusionnerProgramme(
      (ligneActuelle?.programme ?? {}) as Record<string, number>,
      data.programme,
    );
    const perimetres = (data.perimetres ?? []).map((p) => ({
      niveau: p.niveau,
      rue: p.rue ?? null,
      numero: p.numero ?? null,
      lot_id: p.lotId ?? null,
    }));
    const { data: ligne, error } = await db.rpc("update_psp_operation", {
      p_id: data.id,
      p_tranche_code: data.trancheCode,
      p_categorie: data.categorie,
      p_corps_etat_code: data.corpsEtatCode ?? null,
      p_corps_etat: data.corpsEtat ?? null,
      p_nature_travaux: data.natureTravaux ?? null,
      p_programme: programmeFusionne,
      p_remarques: data.remarques ?? null,
      p_statut: data.statut ?? null,
      p_priorite: data.priorite ?? null,
      p_perimetres: perimetres,
    });
    if (error) throw new Error(`Modification de l'opération : ${error.message}`);
    return ligne as PspLignePersist;
  });

/** Historique des modifications des lignes (psp_ligne_historique, batch). */
export const getPspLignesHistorique = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ ids: z.array(z.string().uuid()) }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    if (data.ids.length === 0) return [];
    const { data: rows, error } = await db
      .from("psp_ligne_historique")
      .select("*")
      .in("ligne_id", data.ids)
      .order("created_at", { ascending: false });
    if (error) throw new Error(`Lecture de l'historique : ${error.message}`);
    return rows ?? [];
  });

/**
 * V8.5.2 — REVUE DES CORRESPONDANCES COMMANDES (lecture seule, batch).
 *
 * Charge en quelques requêtes : opérations (lignes + périmètres + devis +
 * entreprises consultées), commandes importées, liens existants, référentiels
 * (fournisseurs/alias, lots ER) puis exécute le moteur PUR V8.5.1
 * (`proposerRapprochements`) pour chaque opération.
 *
 * AUCUNE écriture : psp_command_links, psp_lignes, travaux_commandes et tables
 * d'import restent intangibles. La validation/rattachement = V8.5.3.
 */
export const getPspCorrespondances = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ pspLigneId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;

    // Batch : toutes les opérations + dépendances en quelques requêtes.
    const [lignesR, perimetresR, devisR, commandesR, liensR, fournisseursR, aliasesR, lotsR] =
      await Promise.all([
        db.from("psp_lignes").select("*"),
        db.from("psp_ligne_patrimoine").select("*"),
        db.from("psp_devis").select("psp_ligne_id, fournisseur_id, entreprise"),
        db
          .from("travaux_commandes")
          .select(
            "id, numero_commande, tranche_code, adresse, corps_etat, descriptif, fournisseur, numero_fournisseur, budget, annee_exercice, nature_analytique",
          ),
        db
          .from("psp_command_links")
          .select("id, commande_id, psp_ligne_id, methode, confiance, statut"),
        db.from("fournisseurs").select("id, nom"),
        db.from("fournisseur_aliases").select("fournisseur_id, source, identifiant_source"),
        db.from("lots").select("id, code_patrimoine"),
      ]);
    if (lignesR.error) throw new Error(`Lecture des opérations : ${lignesR.error.message}`);
    if (commandesR.error) throw new Error(`Lecture des commandes : ${commandesR.error.message}`);

    const lignes = (lignesR.data ?? []) as any[];
    const perimetres = (perimetresR.data ?? []) as any[];
    const devis = (devisR.data ?? []) as any[];
    const commandes = (commandesR.data ?? []) as any[];
    const liens = (liensR.data ?? []) as any[];
    const fournisseurs = (fournisseursR.data ?? []) as any[];
    const aliases = (aliasesR.data ?? []) as any[];
    const lots = (lotsR.data ?? []) as any[];

    const lotCodes: Record<string, string[]> = {};
    for (const lot of lots) lotCodes[lot.id] = [lot.code_patrimoine];
    const fournisseurRef = fournisseurs.map((f: any) => ({
      id: f.id,
      nom: f.nom,
      aliases: aliases
        .filter((a: any) => a.fournisseur_id === f.id)
        .map((a: any) => a.identifiant_source),
    })) as FournisseurRapprochement[];

    const perimPar: Record<string, unknown[]> = {};
    for (const p of perimetres) (perimPar[p.psp_ligne_id] ??= []).push(p);
    const entrPar: Record<string, unknown[]> = {};
    for (const d of devis) {
      (entrPar[d.psp_ligne_id] ??= []).push({
        fournisseur_id: d.fournisseur_id,
        entreprise: d.entreprise,
      });
    }

    const ligneCible = lignes.find((l: any) => l.id === data.pspLigneId);
    if (!ligneCible) throw new Error("Opération introuvable.");

    const operation: OperationRapprochement = {
      id: ligneCible.id,
      tranche_code: ligneCible.tranche_code,
      categorie: ligneCible.categorie,
      corps_etat: ligneCible.corps_etat,
      nature_travaux: ligneCible.nature_travaux,
      ligne_budget: ligneCible.ligne_budget,
      origine: ligneCible.origine,
      montant_total:
        Object.values(ligneCible.programme ?? {}).reduce(
          (s: number, v: unknown) => s + (Number(v) || 0),
          0,
        ) || null,
      perimetres: (perimPar[ligneCible.id] ?? []) as OperationRapprochement["perimetres"],
      entreprises_consultees: (entrPar[ligneCible.id] ??
        []) as OperationRapprochement["entreprises_consultees"],
    };
    const anneesProgrammation = Object.keys(ligneCible.programme ?? {})
      .map(Number)
      .filter((a) => Number.isFinite(a));

    const propositions = proposerRapprochements({
      operation,
      commandes: commandes as CommandeRapprochement[],
      liens: liens as LienRapprochement[],
      fournisseurs: fournisseurRef,
      lotCodesParTranche: lotCodes,
    });

    return {
      operationId: ligneCible.id,
      tranche_code: ligneCible.tranche_code,
      annees_programmation: anneesProgrammation,
      propositions: propositions.map((p: any) => {
        const commande = commandes.find((c: any) => c.id === p.commandeId);
        const lien = liens.find((l: any) => l.commande_id === p.commandeId);
        return {
          ...p,
          lienId: lien?.id ?? null,
          commande: commande
            ? {
                id: commande.id,
                numero_commande: commande.numero_commande,
                tranche_code: commande.tranche_code,
                adresse: commande.adresse,
                corps_etat: commande.corps_etat,
                descriptif: commande.descriptif,
                fournisseur: commande.fournisseur,
                numero_fournisseur: commande.numero_fournisseur,
                budget: commande.budget,
                annee_exercice: commande.annee_exercice,
              }
            : null,
        };
      }),
    };
  });

/**
 * V8.5.4 — RECHERCHE MANUELLE D'UNE COMMANDE (côté serveur, ciblée).
 *
 * Recherche dans travaux_commandes (lecture seule) par : n° commande, entreprise /
 * ID fournisseur, TR, adresse ou descriptif. Retourne les commandes correspondantes
 * (limite 20) avec leur statut de rapprochement. Aucune écriture.
 */
export const rechercherCommandes = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        q: z.string().min(1).max(80),
        limite: z.number().int().min(1).max(50).default(20),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    const q = data.q.trim();
    const estNumerique = /^\d+$/.test(q);

    const { data: commandes, error } = await db
      .from("travaux_commandes")
      .select(
        "id, numero_commande, tranche_code, adresse, corps_etat, descriptif, fournisseur, numero_fournisseur, budget, engage, paye, annee_exercice, date_demarrage, etat_commande, etat_travaux",
      )
      .or(
        estNumerique
          ? `numero_commande.ilike.%${q}%,numero_fournisseur.ilike.%${q}%`
          : `fournisseur.ilike.%${q}%,tranche_code.ilike.%${q}%,adresse.ilike.%${q}%,descriptif.ilike.%${q}%,numero_commande.ilike.%${q}%`,
      )
      .limit(data.limite);
    if (error) throw new Error(`Recherche des commandes : ${error.message}`);

    const ids = (commandes ?? []).map((c: any) => c.id);
    const liens = ids.length
      ? ((
          await db
            .from("psp_command_links")
            .select("id, commande_id, psp_ligne_id, methode, statut")
            .in("commande_id", ids)
        ).data ?? [])
      : [];

    return (commandes ?? []).map((c: any) => {
      const lien = liens.find((l: any) => l.commande_id === c.id) ?? null;
      return {
        ...c,
        rapprochement: lien
          ? {
              dejaLie: true,
              lienId: lien.id,
              pspLigneId: lien.psp_ligne_id,
              methode: lien.methode,
              statut: lien.statut,
            }
          : { dejaLie: false },
      };
    });
  });

/**
 * V8.5.4 — RECHERCHE INVERSÉE : opérations candidates pour une commande.
 *
 * Réutilise `suggererOperationsPourCommande` (moteur V8.5.1 — aucune logique
 * parallèle). Retourne les opérations pertinentes (AUTO/A_CONFIRMER/MANUEL)
 * triées par score. Aucune écriture. L'utilisateur garde l'autorité métier.
 */
export const rechercherOperationsPourCommande = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ commandeId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;

    const [cmdR, lignesR, perimR, devisR, liensR, fsR, aliasesR, lotsR] = await Promise.all([
      db.from("travaux_commandes").select("*").eq("id", data.commandeId).single(),
      db.from("psp_lignes").select("*"),
      db.from("psp_ligne_patrimoine").select("*"),
      db.from("psp_devis").select("psp_ligne_id, fournisseur_id, entreprise"),
      db.from("psp_command_links").select("*"),
      db.from("fournisseurs").select("id, nom"),
      db.from("fournisseur_aliases").select("fournisseur_id, identifiant_source"),
      db.from("lots").select("id, code_patrimoine"),
    ]);
    if (cmdR.error) throw new Error(`Commande introuvable : ${cmdR.error.message}`);

    const commande = cmdR.data as any;
    const lignes = (lignesR.data ?? []) as any[];
    const perim = (perimR.data ?? []) as any[];
    const devis = (devisR.data ?? []) as any[];
    const liens = (liensR.data ?? []) as any[];
    const fournisseurs = (fsR.data ?? []) as any[];
    const aliases = (aliasesR.data ?? []) as any[];
    const lots = (lotsR.data ?? []) as any[];

    const lotCodes: Record<string, string[]> = {};
    for (const lot of lots) lotCodes[lot.id] = [lot.code_patrimoine];
    const fournisseurRef = fournisseurs.map((f: any) => ({
      id: f.id,
      nom: f.nom,
      aliases: aliases
        .filter((a: any) => a.fournisseur_id === f.id)
        .map((a: any) => a.identifiant_source),
    }));
    const perimPar: Record<string, unknown[]> = {};
    for (const p of perim) (perimPar[p.psp_ligne_id] ??= []).push(p);
    // V8.6 — premier périmètre (adresse) pour l'affichage « Cette commande semble
    // correspondre à une opération existante » (jamais une écriture).
    const adressePar: Record<string, string | null> = {};
    for (const p of perim) {
      if (adressePar[p.psp_ligne_id] === undefined && (p as any).rue) {
        adressePar[p.psp_ligne_id] =
          `${(p as any).numero ? `${(p as any).numero} ` : ""}${(p as any).rue}`;
      }
    }
    const entrPar: Record<string, unknown[]> = {};
    for (const d of devis) {
      (entrPar[d.psp_ligne_id] ??= []).push({
        fournisseur_id: d.fournisseur_id,
        entreprise: d.entreprise,
      });
    }
    const operations = lignes.map((l: any) => ({
      id: l.id,
      tranche_code: l.tranche_code,
      categorie: l.categorie,
      corps_etat: l.corps_etat,
      nature_travaux: l.nature_travaux,
      ligne_budget: l.ligne_budget,
      origine: l.origine,
      montant_total:
        Object.values(l.programme ?? {}).reduce(
          (s: number, v: unknown) => s + (Number(v) || 0),
          0,
        ) || null,
      perimetres: perimPar[l.id] ?? [],
      entreprises_consultees: entrPar[l.id] ?? [],
    }));

    const { suggererOperationsPourCommande } = await import("@/lib/psp.suivi.rapprochement");
    const propositions = suggererOperationsPourCommande(
      commande as never,
      operations as never,
      liens as never,
      fournisseurRef as never,
      lotCodes,
    );

    const parId = new Map(lignes.map((l: any) => [l.id, l]));
    const anneesPar = new Map(
      lignes.map((l: any) => [
        l.id,
        Object.keys(l.programme ?? {})
          .map(Number)
          .filter((a) => Number.isFinite(a)),
      ]),
    );
    return {
      commande: {
        id: commande.id,
        numero_commande: commande.numero_commande,
        tranche_code: commande.tranche_code,
        adresse: commande.adresse,
        corps_etat: commande.corps_etat,
        descriptif: commande.descriptif,
        fournisseur: commande.fournisseur,
        numero_fournisseur: commande.numero_fournisseur,
        budget: commande.budget,
        annee_exercice: commande.annee_exercice,
      },
      propositions: propositions.map((p: any) => {
        const ligne = parId.get(p.operationId);
        return {
          ...p,
          annees_programmation: anneesPar.get(p.operationId) ?? [],
          operation: ligne
            ? {
                id: ligne.id,
                tranche_code: ligne.tranche_code,
                corps_etat: ligne.corps_etat,
                nature_travaux: ligne.nature_travaux,
                origine: ligne.origine,
                // V8.6 — détails demandés par le §4 (montant programmé + adresse
                // du premier périmètre). Jamais une copie de commande.
                montant_total:
                  Object.values(ligne.programme ?? {}).reduce(
                    (s: number, v: unknown) => s + (Number(v) || 0),
                    0,
                  ) || null,
                adresse: adressePar[ligne.id] ?? null,
              }
            : null,
        };
      }),
    };
  });

/**
 * V8.5.4 — VUE GLOBALE « COMMANDES À RAPPROCHER ».
 *
 * Un seul batch (pas de N+1). Pour chaque commande non liée, le moteur
 * V8.5.1 (`suggererOperationsPourCommande`) est utilisé pour proposer des
 * opérations — jamais de liaison automatique. La relation de période
 * (`determinerRelationPeriode`) est ajoutée comme critère d'appui.
 *
 * Retourne les décomptes (total, fortes, à confirmer, faibles, sans
 * correspondance, déjà rattachées) et la liste compacte pour le panneau.
 */
export const getPspCommandesARapprocher = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({}).parse(d ?? {}))
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;

    const [lignesR, perimetresR, devisR, commandesR, liensR, fournisseursR, aliasesR, lotsR] =
      await Promise.all([
        db.from("psp_lignes").select("*"),
        db.from("psp_ligne_patrimoine").select("*"),
        db.from("psp_devis").select("psp_ligne_id, fournisseur_id, entreprise"),
        db
          .from("travaux_commandes")
          .select(
            "id, numero_commande, tranche_code, adresse, corps_etat, descriptif, fournisseur, numero_fournisseur, budget, engage, paye, annee_exercice, date_demarrage, etat_commande, etat_travaux",
          ),
        db.from("psp_command_links").select("id, commande_id, psp_ligne_id, methode, statut"),
        db.from("fournisseurs").select("id, nom"),
        db.from("fournisseur_aliases").select("fournisseur_id, source, identifiant_source"),
        db.from("lots").select("id, code_patrimoine"),
      ]);
    if (commandesR.error) throw new Error(`Lecture des commandes : ${commandesR.error.message}`);
    if (lignesR.error) throw new Error(`Lecture des opérations : ${lignesR.error.message}`);

    const lignes = (lignesR.data ?? []) as any[];
    const perimetres = (perimetresR.data ?? []) as any[];
    const devis = (devisR.data ?? []) as any[];
    const commandes = (commandesR.data ?? []) as any[];
    const liens = (liensR.data ?? []) as any[];
    const fournisseurs = (fournisseursR.data ?? []) as any[];
    const aliases = (aliasesR.data ?? []) as any[];
    const lots = (lotsR.data ?? []) as any[];

    const lotCodes: Record<string, string[]> = {};
    for (const lot of lots) lotCodes[lot.id] = [lot.code_patrimoine];
    const fournisseurRef = fournisseurs.map((f: any) => ({
      id: f.id,
      nom: f.nom,
      aliases: aliases
        .filter((a: any) => a.fournisseur_id === f.id)
        .map((a: any) => a.identifiant_source),
    })) as unknown as FournisseurRapprochement[];
    const perimPar: Record<string, unknown[]> = {};
    for (const p of perimetres) (perimPar[p.psp_ligne_id] ??= []).push(p);
    const entrPar: Record<string, unknown[]> = {};
    for (const d of devis) {
      (entrPar[d.psp_ligne_id] ??= []).push({
        fournisseur_id: d.fournisseur_id,
        entreprise: d.entreprise,
      });
    }
    const operations: OperationRapprochement[] = lignes.map((l: any) => ({
      id: l.id,
      tranche_code: l.tranche_code,
      categorie: l.categorie,
      corps_etat: l.corps_etat,
      nature_travaux: l.nature_travaux,
      ligne_budget: l.ligne_budget,
      origine: l.origine,
      montant_total:
        Object.values(l.programme ?? {}).reduce(
          (s: number, v: unknown) => s + (Number(v) || 0),
          0,
        ) || null,
      perimetres: (perimPar[l.id] ?? []) as OperationRapprochement["perimetres"],
      entreprises_consultees: (entrPar[l.id] ??
        []) as OperationRapprochement["entreprises_consultees"],
    }));

    const { suggererOperationsPourCommande, determinerRelationPeriode } =
      await import("@/lib/psp.suivi.rapprochement");
    const ligneParId = new Map(lignes.map((l: any) => [l.id, l]));
    const anneesPar = new Map(
      lignes.map((l: any) => [
        l.id,
        Object.keys(l.programme ?? {})
          .map(Number)
          .filter((a) => Number.isFinite(a)),
      ]),
    );
    const lienParCommande = new Map(liens.map((l: any) => [l.commande_id, l]));

    type EtatCommande =
      "deja_rattachee" | "proposition_forte" | "a_confirmer" | "faible" | "sans_correspondance";

    const lignesCompacts: Array<{
      commande: any;
      etat: EtatCommande;
      meilleure_proposition: any | null;
      operation_liee: any | null;
      periode: { type: string; libelle: string; exercice: number | null } | null;
    }> = [];

    for (const commande of commandes) {
      const lien = lienParCommande.get(commande.id);
      if (lien) {
        const ligne = ligneParId.get(lien.psp_ligne_id);
        lignesCompacts.push({
          commande,
          etat: "deja_rattachee",
          meilleure_proposition: null,
          operation_liee: ligne
            ? {
                id: ligne.id,
                tranche_code: ligne.tranche_code,
                adresse: ligne.adresse,
                corps_etat: ligne.corps_etat,
                nature_travaux: ligne.nature_travaux,
                methode: lien.methode,
                statut: lien.statut,
              }
            : null,
          periode: null,
        });
        continue;
      }
      const propositions = suggererOperationsPourCommande(
        commande as unknown as CommandeRapprochement,
        operations,
        liens as unknown as LienRapprochement[],
        fournisseurRef,
        lotCodes,
      );
      const meilleure = propositions[0] ?? null;
      const etat: EtatCommande = meilleure
        ? meilleure.niveau === "AUTO"
          ? "proposition_forte"
          : meilleure.niveau === "A_CONFIRMER"
            ? "a_confirmer"
            : "faible"
        : "sans_correspondance";
      const ligne = meilleure ? ligneParId.get(meilleure.operationId) : null;
      const annees = ligne ? (anneesPar.get(ligne.id) ?? []) : [];
      lignesCompacts.push({
        commande,
        etat,
        meilleure_proposition: meilleure
          ? {
              ...meilleure,
              operation: ligne
                ? {
                    id: ligne.id,
                    tranche_code: ligne.tranche_code,
                    adresse: ligne.adresse,
                    corps_etat: ligne.corps_etat,
                    nature_travaux: ligne.nature_travaux,
                  }
                : null,
            }
          : null,
        operation_liee: null,
        periode: ligne
          ? determinerRelationPeriode(
              annees,
              commande.annee_exercice ?? null,
              commande.date_demarrage ?? null,
            )
          : null,
      });
    }

    const compter = (e: EtatCommande) => lignesCompacts.filter((c) => c.etat === e).length;
    const tri: Record<EtatCommande, number> = {
      deja_rattachee: 0,
      proposition_forte: 1,
      a_confirmer: 2,
      faible: 3,
      sans_correspondance: 4,
    };
    lignesCompacts.sort(
      (a, b) =>
        tri[a.etat] - tri[b.etat] ||
        (b.meilleure_proposition?.score ?? 0) - (a.meilleure_proposition?.score ?? 0),
    );

    return {
      total: commandes.length,
      propositions_fortes: compter("proposition_forte"),
      propositions_a_confirmer: compter("a_confirmer"),
      correspondances_faibles: compter("faible"),
      sans_correspondance: compter("sans_correspondance"),
      deja_rattachees: compter("deja_rattachee"),
      commandes: lignesCompacts,
    };
  });

// ── V8.9.1 — REVUE DES ANCIENNES PROGRAMMATIONS (lecture seule) ──────────────

/**
 * V8.9.1 — CHARGE LA REVUE DES ANCIENNES PROGRAMMATIONS depuis la source de
 * vérité réelle `psp_lignes.programme` (multi-années).
 *
 * Aucune écriture, aucun mock, aucune donnée inventée :
 *  · toutes les lignes psp_lignes (preparation / report / suivi / hors_psp) ;
 *  · périmètre patrimonial → adresse de référence (si disponible) ;
 *  · devis réels (consultation) ;
 *  · liens psp_command_links → commande liée (états réels travaux/commande).
 *
 * La construction des entrées (une par année < référence réellement
 * programmée) est la fonction PURE `construireRevueAnciennesProgrammations`
 * (psp.prep.suivi.ts) — aucun moteur parallèle.
 */
export const getPspRevueAnciennes = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({ anneeReference: z.number().int().min(2000).max(2100) })
      .parse(d ?? { anneeReference: new Date().getFullYear() }),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;

    const [lignesR, perimetresR, devisR, liensR] = await Promise.all([
      db.from("psp_lignes").select("*"),
      db
        .from("psp_ligne_patrimoine")
        .select("psp_ligne_id, tranche_code, niveau, rue, numero, lot_id"),
      db.from("psp_devis").select("psp_ligne_id, statut, montant, entreprise"),
      db.from("psp_command_links").select("id, psp_ligne_id, commande_id, statut"),
    ]);
    if (lignesR.error) throw new Error(`Lecture des lignes : ${lignesR.error.message}`);

    const lignes = (lignesR.data ?? []) as any[];
    const perimetres = (perimetresR.data ?? []) as any[];
    const devis = (devisR.data ?? []) as any[];
    const liens = (liensR.data ?? []) as any[];

    // Adresse de référence RÉELLE depuis psp_ligne_patrimoine (jamais recopiée en
    // base). Pour un périmètre « lot », le code / l'adresse du lot réel (table
    // lots) est utilisé ; le libellé est formaté via `resumeSelectionAdresse`
    // (helper existant — même rendu que la fiche opération).
    const lotIds: string[] = [
      ...new Set(perimetres.filter((p: any) => p.lot_id).map((p: any) => p.lot_id)),
    ];
    let lotsReferenced = new Map<
      string,
      { code_patrimoine: string | null; adresse: string | null }
    >();
    if (lotIds.length > 0) {
      const { data: lotsR } = await db
        .from("lots")
        .select("id, code_patrimoine, adresse")
        .in("id", lotIds);
      lotsReferenced = new Map((lotsR ?? []).map((l: any) => [l.id, l]));
    }
    const selectionParLigne = new Map<
      string,
      { rue: string | null; adresses: string[]; lots: string[] }
    >();
    for (const p of perimetres) {
      if (!p.psp_ligne_id) continue;
      const s = selectionParLigne.get(p.psp_ligne_id) ?? { rue: null, adresses: [], lots: [] };
      if (p.rue && !s.rue) s.rue = p.rue;
      if (p.niveau === "adresse" && p.rue && p.numero) {
        const entree = `${p.numero} ${p.rue}`.trim();
        if (entree && !s.adresses.includes(entree)) s.adresses.push(entree);
      }
      if (p.niveau === "lot" && p.lot_id) {
        const lot = lotsReferenced.get(p.lot_id);
        if (lot?.code_patrimoine) {
          if (!s.lots.includes(lot.code_patrimoine)) s.lots.push(lot.code_patrimoine);
        } else if (lot?.adresse && !s.adresses.includes(lot.adresse)) {
          s.adresses.push(lot.adresse);
        }
        if (!s.rue && lot?.adresse) {
          const r = rueDe(lot.adresse);
          if (r && r !== "Adresse inconnue") s.rue = r;
        }
      }
      selectionParLigne.set(p.psp_ligne_id, s);
    }
    const adressePar = new Map<string, string>();
    for (const [id, s] of selectionParLigne) {
      const libelle = resumeSelectionAdresse({
        rue: s.rue,
        adresses: s.adresses,
        lots: s.lots.map((code) => ({ code_patrimoine: code })),
      });
      if (libelle) adressePar.set(id, libelle);
    }

    // Commandes liées (psp_command_links → travaux_commandes, READ-ONLY).
    const commandeIds: string[] = [
      ...new Set(liens.map((l: any) => l.commande_id).filter(Boolean)),
    ] as string[];
    let commandesParId = new Map<string, any>();
    if (commandeIds.length > 0) {
      const { data: cmd } = await db
        .from("travaux_commandes")
        .select("id, numero_commande, etat_commande, etat_travaux")
        .in("id", commandeIds);
      commandesParId = new Map((cmd ?? []).map((c: any) => [c.id, c]));
    }
    const commandeIdParLigne = new Map(
      liens
        .filter((l: any) => l.psp_ligne_id)
        .map((l: any) => [l.psp_ligne_id, commandesParId.get(l.commande_id) ?? null]),
    );

    // Devis par ligne (consultation réelle).
    const devisParLigne = new Map<
      string,
      Array<{ statut: string; montant: number | null; entreprise: string | null }>
    >();
    for (const d of devis) {
      if (!d.psp_ligne_id) continue;
      const liste = devisParLigne.get(d.psp_ligne_id) ?? [];
      liste.push({
        statut: d.statut ?? "a_demander",
        montant: d.montant != null ? Number(d.montant) : null,
        entreprise: d.entreprise ?? null,
      });
      devisParLigne.set(d.psp_ligne_id, liste);
    }

    const brutes = (lignes ?? []).map((l: any) => ({
      id: l.id,
      tranche: l.tranche_code,
      categorie: l.categorie ?? "GT",
      corps_etat: l.corps_etat ?? null,
      nature_travaux: l.nature_travaux ?? null,
      programme: (l.programme ?? {}) as Record<string, number>,
      origine: l.origine ?? "preparation",
      remarques: l.remarques ?? null,
      ligne_budget: l.ligne_budget ?? null,
      adresse: adressePar.get(l.id) ?? null,
      commande_liee: (commandeIdParLigne.get(l.id) as any) ?? null,
      devis: devisParLigne.get(l.id) ?? [],
    }));

    return construireRevueAnciennesProgrammations(brutes, data.anneeReference);
  });
