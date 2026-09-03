import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { LotDevisInfos } from "@/lib/psp.devis.lots.view";

/**
 * V8.16z — Récupération LECTURE SEULE des informations complètes de lots pour
 * les demandes de devis (fiche « Informations du lot »).
 *
 * Aucune écriture : le référentiel patrimoine (lots/tranches) n'est JAMAIS
 * modifié. Ne lit que les colonnes nécessaires + la localité de la tranche.
 */
export const getLotsPourDevis = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ lotIds: z.array(z.string().uuid()).max(20) }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    if (data.lotIds.length === 0) return [] as LotDevisInfos[];

    const { data: lots, error } = await db
      .from("lots")
      .select(
        "id, code_patrimoine, tranche_code, type_lot, batiment, etage, porte, surface_utile, dpe, adresse, code_postal, ville, locataire_nom, locataire_telephone, locataire_email, date_entree",
      )
      .in("id", data.lotIds)
      .eq("actif", true);
    if (error) throw new Error(`Lecture des lots : ${error.message}`);
    const rows = (lots ?? []) as any[];

    // Localité (ville) de la tranche — une seule requête pour toutes les tranches.
    const trancheCodes = [...new Set(rows.map((r) => r.tranche_code).filter(Boolean))] as string[];
    const localites = new Map<string, string>();
    if (trancheCodes.length > 0) {
      const { data: tranches, error: errT } = await db
        .from("tranches")
        .select("code, localite")
        .in("code", trancheCodes);
      if (errT) throw new Error(`Lecture des tranches : ${errT.message}`);
      for (const t of (tranches ?? []) as any[]) if (t?.code) localites.set(t.code, t.localite);
    }

    return rows.map((r) => ({
      id: r.id,
      code_patrimoine: r.code_patrimoine,
      tranche_code: r.tranche_code,
      type_lot: r.type_lot ?? null,
      batiment: r.batiment ?? null,
      etage: r.etage ?? null,
      porte: r.porte ?? null,
      surface_utile: r.surface_utile ?? null,
      dpe: r.dpe ?? null,
      adresse: r.adresse ?? null,
      code_postal: r.code_postal ?? null,
      ville: r.ville ?? null,
      locataire_nom: r.locataire_nom ?? null,
      locataire_telephone: r.locataire_telephone ?? null,
      locataire_email: r.locataire_email ?? null,
      date_entree: r.date_entree ?? null,
      localite_tranche: localites.get(r.tranche_code) ?? null,
    })) as LotDevisInfos[];
  });
