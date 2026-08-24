// V8.16h — Diagnostic de l'adresse Allée Stephen Hawking (BUSSY-SAINT-GEORGES) en source.
// Usage : node --env-file=.env scripts/_diag-hawking.mjs
import { createClient } from "@supabase/supabase-js";

const db = createClient(process.env.EXT_SUPABASE_URL, process.env.EXT_SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: lots, error } = await db
  .from("lots")
  .select("code_patrimoine, tranche_code, adresse, ville, code_postal")
  .ilike("adresse", "%HAWKING%")
  .limit(20);
if (error) throw new Error(error.message);
console.log(`lots contenant HAWKING : ${lots?.length ?? 0}`);
for (const l of lots ?? []) {
  console.log(`${l.code_patrimoine} | tranche ${l.tranche_code} | ${l.adresse} | ${l.ville} | ${l.code_postal}`);
}
