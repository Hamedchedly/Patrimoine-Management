import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { geocode, type GeoPoint } from "./geo";

/** Coordinates already cached in the database. */
export const getAdressesGeo = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
  const { data, error } = await supabaseAdmin
    .from("adresses_geo")
    .select("cle, adresse, ville, lat, lng, statut")
    .limit(5000);
  if (error) throw new Error(error.message);
  return data ?? [];
});

export type VilleGeo = { ville: string; lat: number; lng: number; n: number };

/**
 * Référentiel des villes du Dashboard Travaux (centres communaux).
 * Lecture de `villes_geo` uniquement — indépendant du cache d'adresses `adresses_geo`,
 * qui reste réservé au module /adresses (getAdressesGeo / geocodeAdresses).
 */
export const getVillesGeo = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
  const { data, error } = await supabaseAdmin
    .from("villes_geo")
    .select("ville, lat, lng")
    .limit(500);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    ville: row.ville,
    lat: row.lat,
    lng: row.lng,
    n: 1,
  }));
});

const inputSchema = z.object({
  items: z.array(z.object({ cle: z.string(), adresse: z.string(), ville: z.string() })).max(25),
});

/** Délai entre deux requêtes Photon (usage raisonnable du service public). */
const GEOCODER_DELAY_MS = 200;

type GeoRow = { cle: string; adresse: string; ville: string } & GeoPoint;

/** Geocode a small batch of addresses and update the database cache. */
export const geocodeAdresses = createServerFn({ method: "POST" })
  .validator((d: unknown) => inputSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const rows: GeoRow[] = [];

    for (const item of data.items) {
      const point = await geocode(item);
      rows.push({ cle: item.cle, adresse: item.adresse, ville: item.ville, ...point });
      // Usage raisonnable du service public Photon.
      await new Promise((r) => setTimeout(r, GEOCODER_DELAY_MS));
    }

    if (rows.length) {
      const { error } = await supabaseAdmin
        .from("adresses_geo")
        .upsert(rows, { onConflict: "cle" });
      if (error) throw new Error(error.message);
    }

    return rows;
  });
