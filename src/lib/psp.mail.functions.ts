/**
 * V8.16p — MODÈLES DE MAIL persistés en base (mail_modeles), partagés entre
 * l'envoi par ligne (PspDemandeDevisWorkflow) et l'envoi groupé
 * (DialogueMailGroupe). Repli sur les constantes MAIL_MODELES (foundation) tant
 * que la table est absente ou vide. Le moteur de composition (composerMail /
 * remplacerVariablesMail) reste inchangé.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { MAIL_MODELES } from "./psp.suivi.foundation";

export type ModeleMail = { id: string; libelle: string; sujet: string; corps: string };

/** Lecture des modèles : table mail_modeles si présente, sinon repli constantes. */
export const getMailModeles = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({}).parse(d))
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    try {
      const { data, error } = await db
        .from("mail_modeles")
        .select("id, libelle, sujet, corps")
        .order("id");
      if (error) throw error;
      if (data && data.length > 0) {
        return { en_base: true as const, modeles: data as ModeleMail[] };
      }
    } catch {
      // table absente ou erreur : repli silencieux sur les constantes.
    }
    return {
      en_base: false as const,
      modeles: MAIL_MODELES.map((m) => ({
        id: m.id,
        libelle: m.libelle,
        sujet: m.sujet,
        corps: m.corps,
      })),
    };
  });

/** Sauvegarde (upsert) d'un modèle de mail en base. */
export const saveMailModele = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        id: z.string().min(1),
        libelle: z.string().min(1),
        sujet: z.string().min(1),
        corps: z.string().min(1),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    const { error } = await db
      .from("mail_modeles")
      .upsert(
        { id: data.id, libelle: data.libelle, sujet: data.sujet, corps: data.corps },
        { onConflict: "id" },
      );
    if (error) throw new Error(`Sauvegarde du modèle de mail : ${error.message}`);
    return { ok: true as const };
  });
