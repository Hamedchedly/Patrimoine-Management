// V8.16h — Contrôle post re-géocodage : coordonnées des adresses d'une ville (diagnostic).
// Usage : node --env-file=.env scripts/_diag-ville.mjs CHESSY
import { createClient } from "@supabase/supabase-js";

const ville = process.argv[2];
if (!ville) throw new Error("Ville manquante (ex. CHESSY)");
const db = createClient(process.env.EXT_SUPABASE_URL, process.env.EXT_SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data, error } = await db
  .from("adresses_geo")
  .select("cle, adresse, ville, lat, lng, statut")
  .eq("ville", ville)
  .order("adresse");
if (error) throw new Error(error.message);
for (const a of data ?? []) {
  const coord = a.lat != null ? `(${a.lat.toFixed(4)}, ${a.lng.toFixed(4)})` : "—";
  console.log(`${(a.adresse ?? "").padEnd(38)} ${coord.padEnd(22)} ${a.statut}`);
}
console.log(`total ${ville}: ${data?.length ?? 0}`);
