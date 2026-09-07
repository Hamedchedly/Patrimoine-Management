// DIAGNOSTIC (lecture seule) — cohérence « locataire » d'un lot : lots.locataire_* vs occupants.
// Usage : node --env-file=.env scripts/_diag-locataire.mjs ER.26603
import { createClient } from "@supabase/supabase-js";

const url = process.env.EXT_SUPABASE_URL;
const key = process.env.EXT_SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Variables EXT_SUPABASE_URL / EXT_SUPABASE_SERVICE_ROLE_KEY manquantes (.env).");
  process.exit(1);
}
const db = createClient(url, key);
const code = process.argv[2] ?? "ER.26603";

const { data: lot } = await db
  .from("lots")
  .select(
    "code_patrimoine, tranche_code, batiment, etage, porte, adresse, code_postal, ville, locataire_nom, locataire_telephone, locataire_email, date_entree, updated_at, vu_le",
  )
  .eq("code_patrimoine", code)
  .maybeSingle();

console.log("=== LOTS (instantané) ===");
console.log(JSON.stringify(lot ?? null, null, 2));

const { data: occ } = await db
  .from("occupants")
  .select("id, lot_code, nom, prenom, date_naissance, date_entree, created_at")
  .eq("lot_code", code)
  .order("date_entree", { ascending: false });
console.log("\n=== OCCUPANTS (historique) ===");
console.log(JSON.stringify(occ ?? [], null, 2));
