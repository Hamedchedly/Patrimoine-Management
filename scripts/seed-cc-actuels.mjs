// Seed « CC actuels » = mode de la DERNIÈRE année de suivi (2026) par sous-secteur.
// Décision user V8.16w : « les CC en cours, on se base sur la dernière année de suivi annuel ».
import { createClient } from "@supabase/supabase-js";
const url = process.env["EXT_SUPABASE_URL"];
const key = process.env["EXT_SUPABASE_SERVICE_ROLE_KEY"];
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: mx } = await db
  .from("travaux_commandes")
  .select("annee_exercice")
  .order("annee_exercice", { ascending: false })
  .limit(1);
const annee = mx?.[0]?.annee_exercice;

const { data: cmd } = await db
  .from("travaux_commandes")
  .select("tranche_code, charge_clientele")
  .eq("annee_exercice", annee)
  .not("charge_clientele", "is", null);
const { data: tr } = await db.from("tranches").select("code, sous_secteur").eq("actif", true);
const ssParTranche = new Map((tr ?? []).map((t) => [t.code, t.sous_secteur]));

const freq = new Map(); // ss -> Map<CC,count>
for (const c of cmd ?? []) {
  const cc = String(c.charge_clientele ?? "").trim();
  const s = ssParTranche.get(c.tranche_code);
  if (!cc || !s) continue;
  if (!freq.has(s)) freq.set(s, new Map());
  const m = freq.get(s);
  m.set(cc, (m.get(cc) ?? 0) + 1);
}

let n = 0;
for (const [ss, m] of [...freq.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))) {
  const e = [...m.entries()].sort((a, b) => b[1] - a[1]);
  const id = e[0][0].toUpperCase();
  const { error } = await db
    .from("psp_charges_clientele")
    .upsert(
      { sous_secteur: ss, charge_clientele: id, identifiant_personnel: id, actif: true },
      { onConflict: "sous_secteur" },
    );
  if (error) {
    console.error("ERR ss", ss, error.message);
    process.exit(1);
  }
  console.log(`ss ${ss} -> ${id}`);
  n++;
}
console.log(`OK : ${n} lignes (annee ${annee})`);
