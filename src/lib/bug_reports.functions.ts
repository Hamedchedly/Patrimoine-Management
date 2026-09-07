/**
 * V8.20 — SIGNALEMENTS de bugs : persistance (bug_reports) en lecture/écriture.
 * Server functions service_role. La table est créée par la migration
 * `20260907_bug_reports.sql` (à appliquer par l'utilisateur).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** Contexte sérialisable joint au signalement (URL, clics, navigateur…). */
export type BugReportContexte = {
  url?: string | null;
  date?: string | null;
  page?: string | null;
  navigateur?: string | null;
  clics?: Array<{ h: string; cible: string }>;
};

export type BugReport = {
  id: string;
  cree_le: string | null;
  description: string;
  categorie: string | null;
  url: string | null;
  page_titre: string | null;
  contexte: BugReportContexte | null;
  capture: string | null;
  statut: "ouvert" | "resolu";
  resolu_le: string | null;
};

const bugReportInsertSchema = z.object({
  description: z.string().min(3).max(4000),
  categorie: z.string().max(60).optional().nullable(),
  url: z.string().max(2000).optional().nullable(),
  page_titre: z.string().max(300).optional().nullable(),
  contexte: z
    .object({
      url: z.string().max(2000).nullable().optional(),
      date: z.string().max(60).nullable().optional(),
      page: z.string().max(300).nullable().optional(),
      navigateur: z.string().max(400).nullable().optional(),
      clics: z
        .array(z.object({ h: z.string().max(20), cible: z.string().max(200) }))
        .max(20)
        .optional(),
    })
    .optional()
    .nullable(),
  capture: z.string().max(4_000_000).optional().nullable(),
});

/** Crée un signalement (bouton flottant « Signaler un bug »). */
export const creerBugReport = createServerFn({ method: "POST" })
  .validator((d: unknown) => bugReportInsertSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    const { data: row, error } = await db
      .from("bug_reports")
      .insert({
        description: data.description,
        categorie: data.categorie ?? null,
        url: data.url ?? null,
        page_titre: data.page_titre ?? null,
        contexte: data.contexte ?? null,
        capture: data.capture ?? null,
      })
      .select("*")
      .single();
    if (error) throw new Error(`Création signalement : ${error.message}`);
    return row as BugReport;
  });

/** Liste les signalements (les plus récents d'abord). */
export const getBugReports = createServerFn({ method: "GET", strict: false }).handler(
  async (): Promise<BugReport[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    const { data, error } = await db
      .from("bug_reports")
      .select("*")
      .order("cree_le", { ascending: false })
      .limit(500);
    if (error) throw new Error(`Lecture signalements : ${error.message}`);
    return (data ?? []) as BugReport[];
  },
);

/** Marque un signalement comme résolu (après correction + push). */
export const resoudreBugReport = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    const { data: row, error } = await db
      .from("bug_reports")
      .update({ statut: "resolu", resolu_le: new Date().toISOString() })
      .eq("id", data.id)
      .select("*")
      .single();
    if (error) throw new Error(`Résolution signalement : ${error.message}`);
    return row as BugReport;
  });

/** Supprime un signalement. */
export const supprimerBugReport = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    const { error } = await db.from("bug_reports").delete().eq("id", data.id);
    if (error) throw new Error(`Suppression signalement : ${error.message}`);
    return { ok: true };
  });
