/**
 * V8.21 — KANBAN devis → commande → travaux : persistance (server, service role).
 * Table `kanban_commandes_passees` (migration 20260907) : une « commande passée »
 * saisie dans le Kanban SANS créer travaux_commandes, puis CONFRONTÉE à l'import
 * du suivi annuel de l'exercice (confronterKanbanCommandesPassees) : si la
 * commande réelle est retrouvée → statut='confirme' + commande_id + lien
 * psp_command_links ; sinon elle reste 'a_confirmer' (alerte).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { normaliserTexteKanban } from "./view";
import type { CommandePasseeKanban } from "./view";

const exerciceSchema = z.object({
  exercice: z.number().int().min(2000).max(2100),
});

/** Liste les commandes passées (saisies au Kanban) d'un exercice. */
export const getKanbanCommandesPassees = createServerFn({ method: "POST" })
  .validator((d: unknown) => exerciceSchema.parse(d))
  .handler(async ({ data }): Promise<CommandePasseeKanban[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    const { data: rows, error } = await db
      .from("kanban_commandes_passees")
      .select("*")
      .eq("exercice", data.exercice)
      .order("date_commande", { ascending: false });
    if (error) throw new Error(`Lecture commandes passées : ${error.message}`);
    return (rows ?? []) as CommandePasseeKanban[];
  });

const creerSchema = z.object({
  exercice: z.number().int().min(2000).max(2100),
  psp_ligne_id: z.string().uuid().nullish(),
  tranche_code: z.string().max(30).nullish(),
  adresse: z.string().max(500).nullish(),
  libelle: z.string().max(500).nullish(),
  montant_prevu: z.number().min(0).nullish(),
  entreprise: z.string().min(1).max(300),
  numero_commande: z.string().max(60).nullish(),
  date_commande: z.string().max(20).nullish(),
});

/** Enregistre une « commande passée » (entreprise + n° + date) depuis le Kanban. */
export const creerCommandePassee = createServerFn({ method: "POST" })
  .validator((d: unknown) => creerSchema.parse(d))
  .handler(async ({ data }): Promise<CommandePasseeKanban> => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    const { data: row, error } = await db
      .from("kanban_commandes_passees")
      .insert({
        exercice: data.exercice,
        psp_ligne_id: data.psp_ligne_id ?? null,
        tranche_code: data.tranche_code ?? null,
        adresse: data.adresse ?? null,
        libelle: data.libelle ?? null,
        montant_prevu: data.montant_prevu ?? null,
        entreprise: data.entreprise.trim(),
        numero_commande: data.numero_commande?.trim() || null,
        date_commande: data.date_commande ?? null,
        statut: "a_confirmer",
      })
      .select("*")
      .single();
    if (error) throw new Error(`Enregistrement commande passée : ${error.message}`);
    return row as CommandePasseeKanban;
  });

const idSchema = z.object({ id: z.string().uuid() });

/** Supprime une « commande passée » non encore confirmée (saisie erronée). */
export const supprimerCommandePassee = createServerFn({ method: "POST" })
  .validator((d: unknown) => idSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    const { error } = await db.from("kanban_commandes_passees").delete().eq("id", data.id);
    if (error) throw new Error(`Suppression commande passée : ${error.message}`);
    return { ok: true };
  });

/** Marque manuellement une commande passée comme écart (non retrouvée). */
export const marquerEcartCommandePassee = createServerFn({ method: "POST" })
  .validator((d: unknown) => idSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    const { error } = await db
      .from("kanban_commandes_passees")
      .update({ statut: "ecart" })
      .eq("id", data.id);
    if (error) throw new Error(`Mise à jour commande passée : ${error.message}`);
    return { ok: true };
  });

/**
 * CONFRONTATION À L'IMPORT — pour un exercice, essaie de retrouver la commande
 * réelle importée correspondant à chaque « commande passée » en attente
 * (statut='a_confirmer'). Correspondance par :
 *   1. n° de commande identique ; sinon
 *   2. entreprise identique (nom normalisé) ET (tranche OU montant prévu ≈ budget
 *      OU montant prévu ≈ engagé de la commande).
 * Si UNE SEULE commande correspond → statut='confirme' + commande_id + lien
 * psp_command_links (type 'rattachement_ligne'). Idempotent (relançable).
 */
export const confronterKanbanCommandesPassees = createServerFn({ method: "POST" })
  .validator((d: unknown) => exerciceSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;

    const { data: attentes, error: errA } = await db
      .from("kanban_commandes_passees")
      .select("*")
      .eq("exercice", data.exercice)
      .eq("statut", "a_confirmer");
    if (errA) throw new Error(`Lecture commandes passées : ${errA.message}`);
    const attentesRows = (attentes ?? []) as CommandePasseeKanban[];
    if (attentesRows.length === 0) return { confirmees: 0, restantes: 0 };

    const { data: cmds, error: errC } = await db
      .from("travaux_commandes")
      .select(
        "id, numero_commande, fournisseur, numero_fournisseur, tranche_code, budget, engage, annee_exercice",
      )
      .eq("annee_exercice", data.exercice);
    if (errC) throw new Error(`Lecture commandes importées : ${errC.message}`);
    const commandes = (cmds ?? []) as Array<{
      id: string;
      numero_commande: string | null;
      fournisseur: string | null;
      numero_fournisseur: string | null;
      tranche_code: string | null;
      budget: number | null;
      engage: number | null;
    }>;

    let confirmees = 0;
    let restantes = 0;

    for (const attente of attentesRows) {
      const cible = resoudreCommandeImportee(attente, commandes);
      if (!cible) {
        restantes += 1;
        continue;
      }
      const { error: errU } = await db
        .from("kanban_commandes_passees")
        .update({ statut: "confirme", commande_id: cible.id })
        .eq("id", attente.id);
      if (errU) continue;
      if (attente.psp_ligne_id) {
        // Lien ligne PSP ↔ commande (rattachement_ligne) si absent.
        const { data: existants } = await db
          .from("psp_command_links")
          .select("id")
          .eq("psp_ligne_id", attente.psp_ligne_id)
          .eq("commande_id", cible.id)
          .limit(1);
        if ((existants ?? []).length === 0) {
          await db.from("psp_command_links").insert({
            psp_ligne_id: attente.psp_ligne_id,
            commande_id: cible.id,
            type_relation: "rattachement_ligne",
            methode: "manuel",
            statut: "valide",
            confiance: 1,
            justification: "Confirmation commande passée (Kanban) — import exercice",
          });
        }
      }
      confirmees += 1;
    }
    return { confirmees, restantes };
  });

/** Résout la commande importée correspondant à une attente (null si ambigu). */
function resoudreCommandeImportee(
  attente: CommandePasseeKanban,
  commandes: Array<{
    id: string;
    numero_commande: string | null;
    fournisseur: string | null;
    numero_fournisseur: string | null;
    tranche_code: string | null;
    budget: number | null;
    engage: number | null;
  }>,
): { id: string } | null {
  const num = attente.numero_commande?.trim();
  const entreprise = normaliserTexteKanban(attente.entreprise);
  const tranche = normaliserTexteKanban(attente.tranche_code);
  const montant = attente.montant_prevu;

  // 1. n° de commande identique → match direct.
  if (num) {
    const parNum = commandes.filter(
      (c) => normaliserTexteKanban(c.numero_commande) === normaliserTexteKanban(num),
    );
    const seul = parNum[0];
    if (parNum.length === 1 && seul) return { id: seul.id };
  }
  // 2. entreprise identique (+ tranche / montant pour lever l'ambiguïté).
  const parEnt = commandes.filter(
    (c) => normaliserTexteKanban(c.fournisseur ?? c.numero_fournisseur ?? "") === entreprise,
  );
  if (parEnt.length === 0) return null;
  const seulEnt = parEnt[0];
  if (parEnt.length === 1 && seulEnt) return { id: seulEnt.id };
  const avecTranche = parEnt.filter(
    (c) => tranche && normaliserTexteKanban(c.tranche_code) === tranche,
  );
  const seulT = avecTranche[0];
  if (avecTranche.length === 1 && seulT) return { id: seulT.id };
  const avecMontant = parEnt.filter(
    (c) =>
      montant != null &&
      ((c.budget != null && Math.abs(c.budget - montant) < 0.01) ||
        (c.engage != null && Math.abs(c.engage - montant) < 0.01)),
  );
  const seulM = avecMontant[0];
  if (avecMontant.length === 1 && seulM) return { id: seulM.id };
  return null; // ambigu → reste à confirmer (alerte utilisateur)
}

// ── V8.28 — « DÉCLARER TERMINÉE » (fin de travaux signalée, à confirmer à l'import) ───────

/** Bucket Storage public des pièces jointes (créé automatiquement par le serveur). */
export const BUCKET_CLOTURES = "kanban-clotures";

export type FichierCloture = {
  nom: string;
  chemin: string;
  taille: number;
  type: string | null;
};

export type ClotureKanban = {
  id: string;
  exercice: number;
  psp_ligne_id: string | null;
  commande_id: string | null;
  facture: boolean;
  pv_reception: boolean;
  rapport: boolean;
  note: string | null;
  fichiers: FichierCloture[];
  statut: "a_confirmer" | "confirme";
  signale_le: string | null;
  updated_at: string | null;
};

/** Liste les clôtures (signalements de fin de travaux) d'un exercice. */
export const getKanbanClotures = createServerFn({ method: "POST" })
  .validator((d: unknown) => exerciceSchema.parse(d))
  .handler(async ({ data }): Promise<ClotureKanban[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    const { data: rows, error } = await db
      .from("kanban_clotures")
      .select("*")
      .eq("exercice", data.exercice)
      .order("signale_le", { ascending: false });
    if (error) throw new Error(`Lecture des clôtures : ${error.message}`);
    return (rows ?? []).map((r: any) => ({
      ...r,
      fichiers: Array.isArray(r.fichiers) ? r.fichiers : [],
    })) as ClotureKanban[];
  });

/** Créé le bucket Storage s'il n'existe pas encore (idempotent). */
async function garantirBucketClotures() {
  const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
  const st = (supabaseAdmin as any).storage;
  const { error } = await st.createBucket(BUCKET_CLOTURES, { public: true });
  if (error && !/already exists/i.test(error.message ?? "")) {
    throw new Error(`Création du stockage des clôtures : ${error.message}`);
  }
}

const clotureInput = z
  .object({
    exercice: z.number().int().min(2000).max(2100),
    pspLigneId: z.string().uuid().nullish(),
    commandeId: z.string().uuid().nullish(),
    facture: z.boolean().optional(),
    pvReception: z.boolean().optional(),
    rapport: z.boolean().optional(),
    note: z.string().max(2000).nullish(),
  })
  .refine((d) => Boolean(d.pspLigneId) !== Boolean(d.commandeId), {
    message: "Préciser la ligne PSP OU la commande réelle (une seule).",
  });

/** Déclare (ou met à jour) une fin de travaux « signalée », en attente de l'import. */
export const declarerTerminee = createServerFn({ method: "POST" })
  .validator((d: unknown) => clotureInput.parse(d))
  .handler(async ({ data }): Promise<ClotureKanban> => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    const psp = data.pspLigneId ?? null;
    const cmd = data.commandeId ?? null;

    let requete = db.from("kanban_clotures").select("*").eq("exercice", data.exercice);
    if (psp) requete = requete.eq("psp_ligne_id", psp);
    else requete = requete.eq("commande_id", cmd);
    const { data: existants } = await requete.limit(1);
    const existant = (existants ?? [])[0] as ClotureKanban | undefined;

    const patch = {
      facture: data.facture ?? false,
      pv_reception: data.pvReception ?? false,
      rapport: data.rapport ?? false,
      note: data.note ?? null,
      updated_at: new Date().toISOString(),
    };

    if (existant) {
      const { data: row, error } = await db
        .from("kanban_clotures")
        .update({ ...patch, statut: "a_confirmer" })
        .eq("id", existant.id)
        .select("*")
        .single();
      if (error) throw new Error(`Mise à jour de la clôture : ${error.message}`);
      return { ...(row as any), fichiers: row.fichiers ?? [] } as ClotureKanban;
    }

    const { data: row, error } = await db
      .from("kanban_clotures")
      .insert({
        exercice: data.exercice,
        psp_ligne_id: psp,
        commande_id: cmd,
        ...patch,
        statut: "a_confirmer",
      })
      .select("*")
      .single();
    if (error) throw new Error(`Enregistrement de la clôture : ${error.message}`);
    return { ...(row as any), fichiers: row.fichiers ?? [] } as ClotureKanban;
  });

/** Retire un signalement « terminée » (et supprime ses fichiers du stockage). */
export const retirerCloture = createServerFn({ method: "POST" })
  .validator((d: unknown) => idSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    const { data: rows } = await db
      .from("kanban_clotures")
      .select("fichiers")
      .eq("id", data.id)
      .limit(1);
    const fichiers = ((rows ?? [])[0]?.fichiers ?? []) as FichierCloture[];
    if (fichiers.length > 0) {
      const st = (supabaseAdmin as any).storage;
      try {
        await st.from(BUCKET_CLOTURES).remove(fichiers.map((f) => f.chemin));
      } catch {
        // best-effort : le stockage est nettoyé par la suite si besoin.
      }
    }
    const { error } = await db.from("kanban_clotures").delete().eq("id", data.id);
    if (error) throw new Error(`Suppression de la clôture : ${error.message}`);
    return { ok: true };
  });

const fichierInput = z.object({
  id: z.string().uuid(),
  nom: z.string().min(1).max(255),
  type: z.string().max(120).nullish(),
  taille: z.number().int().min(0).max(50_000_000),
  contenuB64: z.string().min(1),
});

/** Téléverse une pièce jointe dans le bucket « kanban-clotures » et l'attache. */
export const ajouterFichierCloture = createServerFn({ method: "POST" })
  .validator((d: unknown) => fichierInput.parse(d))
  .handler(async ({ data }): Promise<ClotureKanban> => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    const { data: rows } = await db
      .from("kanban_clotures")
      .select("id, exercice, fichiers")
      .eq("id", data.id)
      .limit(1);
    const ligne = (rows ?? [])[0] as
      { id: string; exercice: number; fichiers: FichierCloture[] } | undefined;
    if (!ligne) throw new Error("Clôture introuvable.");

    await garantirBucketClotures();
    const nomNettoye = data.nom.replace(/[\\/:*?"<>|]/g, "_").trim() || "fichier";
    const suffixe = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const chemin = `clotures/${ligne.exercice}/${ligne.id}/${suffixe}-${nomNettoye}`;
    const bytes = Uint8Array.from(atob(data.contenuB64), (c) => c.charCodeAt(0));
    const st = (supabaseAdmin as any).storage;
    const { error: upErr } = await st.from(BUCKET_CLOTURES).upload(chemin, bytes, {
      contentType: data.type ?? "application/octet-stream",
      upsert: true,
    });
    if (upErr) throw new Error(`Téléversement du fichier : ${upErr.message}`);

    const nouveau = { nom: nomNettoye, chemin, taille: data.taille, type: data.type ?? null };
    const fichiers = [...(ligne.fichiers ?? []), nouveau];
    const { data: row, error } = await db
      .from("kanban_clotures")
      .update({ fichiers, updated_at: new Date().toISOString() })
      .eq("id", data.id)
      .select("*")
      .single();
    if (error) throw new Error(`Attachement du fichier : ${error.message}`);
    return { ...(row as any), fichiers } as ClotureKanban;
  });

const supprFichierInput = z.object({
  id: z.string().uuid(),
  chemin: z.string().min(1),
});

/** Supprime une pièce jointe (stockage + liste). */
export const supprimerFichierCloture = createServerFn({ method: "POST" })
  .validator((d: unknown) => supprFichierInput.parse(d))
  .handler(async ({ data }): Promise<ClotureKanban> => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    const { data: rows } = await db
      .from("kanban_clotures")
      .select("fichiers")
      .eq("id", data.id)
      .limit(1);
    const anciens = ((rows ?? [])[0]?.fichiers ?? []) as FichierCloture[];
    const st = (supabaseAdmin as any).storage;
    try {
      await st.from(BUCKET_CLOTURES).remove([data.chemin]);
    } catch {
      // best-effort.
    }
    const fichiers = anciens.filter((f) => f.chemin !== data.chemin);
    const { data: row, error } = await db
      .from("kanban_clotures")
      .update({ fichiers, updated_at: new Date().toISOString() })
      .eq("id", data.id)
      .select("*")
      .single();
    if (error) throw new Error(`Suppression du fichier : ${error.message}`);
    return { ...(row as any), fichiers } as ClotureKanban;
  });

/** URL publique d'une pièce jointe (bucket public « kanban-clotures »). */
const urlFichierSchema = z.object({ chemin: z.string().min(1) });
export const getUrlFichierCloture = createServerFn({ method: "POST" })
  .validator((d: unknown) => urlFichierSchema.parse(d))
  .handler(async ({ data }) => {
    const base = process.env["EXT_SUPABASE_URL"] ?? "";
    return `${base}/storage/v1/object/public/${BUCKET_CLOTURES}/${encodeURI(data.chemin)}`;
  });
