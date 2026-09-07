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

import { normaliserTexteKanban } from "./kanban.view";
import type { CommandePasseeKanban } from "./kanban.view";

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
