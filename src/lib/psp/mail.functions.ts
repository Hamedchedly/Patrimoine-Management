/**
 * V8.16p — MODÈLES DE MAIL persistés en base (mail_modeles), partagés entre
 * l'envoi par ligne (PspDemandeDevisWorkflow) et l'envoi groupé
 * (DialogueMailGroupe). Repli sur les constantes MAIL_MODELES (foundation) tant
 * que la table est absente ou vide. Le moteur de composition (composerMail /
 * remplacerVariablesMail) reste inchangé.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { JOURS_REPONSE_DEFAUT_MAIL, MAIL_MODELES } from "./suivi.foundation";

export type ModeleMail = {
  id: string;
  libelle: string;
  sujet: string;
  corps: string;
  delai_jours: number;
};

/** Lecture des modèles : base si présente, sinon repli constantes (fusion par id). */
export const getMailModeles = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({}).parse(d))
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    let enBase = false;
    const parId = new Map<string, ModeleMail>();
    try {
      const { data, error } = await db
        .from("mail_modeles")
        .select("id, libelle, sujet, corps, delai_jours")
        .order("id");
      if (error) throw error;
      if (data && data.length > 0) {
        enBase = true;
        for (const m of data as Array<{
          id: string;
          libelle: string;
          sujet: string;
          corps: string;
          delai_jours: number | null;
        }>) {
          parId.set(m.id, {
            id: m.id,
            libelle: m.libelle,
            sujet: m.sujet,
            corps: m.corps,
            delai_jours: m.delai_jours ?? JOURS_REPONSE_DEFAUT_MAIL,
          });
        }
      }
    } catch {
      // table absente, colonne delai_jours absente ou erreur : repli constantes.
    }
    // V8.16r — fusion : chaque modèle déclaré dans MAIL_MODELES reste disponible
    // (même si la base n'a pas encore été re-seedée), avec le délai par défaut.
    for (const m of MAIL_MODELES) {
      if (parId.has(m.id)) continue;
      parId.set(m.id, {
        id: m.id,
        libelle: m.libelle,
        sujet: m.sujet,
        corps: m.corps,
        delai_jours: m.delai_jours ?? JOURS_REPONSE_DEFAUT_MAIL,
      });
    }
    return { en_base: enBase, modeles: [...parId.values()] };
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
        delai_jours: z.number().int().min(1).max(365).default(7),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    const { error } = await db.from("mail_modeles").upsert(
      {
        id: data.id,
        libelle: data.libelle,
        sujet: data.sujet,
        corps: data.corps,
        delai_jours: data.delai_jours,
      },
      { onConflict: "id" },
    );
    if (error) throw new Error(`Sauvegarde du modèle de mail : ${error.message}`);
    return { ok: true as const };
  });
