// V8.16h — Liste les adresses non localisées (adresses_geo) pour correction en source.
// Usage : node --env-file=.env scripts/_diag-non-localisees.mjs
import { createClient } from "@supabase/supabase-js";

const db = createClient(process.env.EXT_SUPABASE_URL, process.env.EXT_SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data, error } = await db
  .from("adresses_geo")
  .select("cle, adresse, ville, lat, lng, statut")
  .or("lat.is.null,lng.is.null")
  .order("ville")
  .order("adresse");
if (error) throw new Error(error.message);
console.log(`Adresses non localisées : ${data?.length ?? 0}\n`);
for (const a of data ?? []) {
  console.log(`${(a.ville ?? "").padEnd(26)} ${(a.adresse ?? "").padEnd(40)} ${a.statut}`);
}
