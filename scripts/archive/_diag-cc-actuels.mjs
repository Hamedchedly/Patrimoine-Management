import { createClient } from "@supabase/supabase-js";
const url = process.env["EXT_SUPABASE_URL"];
const key = process.env["EXT_SUPABASE_SERVICE_ROLE_KEY"];
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: mx } = await db
  .from("travaux_commandes")
  .select("annee_exercice")
  .order("annee_exercice", { ascending: false })
  .limit(1);
const anneeMax = mx?.[0]?.annee_exercice;
console.log("ANNEE MAX:", anneeMax);

const { data: cmd } = await db
  .from("travaux_commandes")
  .select("tranche_code, charge_clientele")
  .eq("annee_exercice", anneeMax)
  .not("charge_clientele", "is", null);
const freq = new Map();
for (const c of cmd ?? []) {
  const cc = String(c.charge_clientele ?? "").trim();
  if (!cc) continue;
  const k = `${c.tranche_code}::${cc}`;
  freq.set(k, (freq.get(k) ?? 0) + 1);
}
console.log("COUPLES (tranche -> CC -> freq):");
for (const [k, n] of [...freq.entries()].sort()) console.log("  ", k, "x" + n);

const { data: tr } = await db.from("tranches").select("code, sous_secteur").eq("actif", true);
const ss = new Map((tr ?? []).map((t) => [t.code, t.sous_secteur]));
const parSS = new Map();
for (const [k, n] of freq.entries()) {
  const [tranche, cc] = k.split("::");
  const s = ss.get(tranche) ?? "(sans ss)";
  if (!parSS.has(s)) parSS.set(s, new Map());
  const m = parSS.get(s);
  m.set(cc, (m.get(cc) ?? 0) + n);
}
console.log("\nCC PAR SOUS-SECTEUR (mode):");
for (const [s, m] of [...parSS.entries()].sort()) {
  const e = [...m.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`  ss ${s}: ${e.map(([cc, n]) => `${cc} (x${n})`).join(", ")} -> MODE ${e[0][0]}`);
}
console.log("\nREFERENTIEL psp_charges_clientele:");
const { data: ccTable } = await db
  .from("psp_charges_clientele")
  .select("sous_secteur, charge_clientele, identifiant_personnel, actif")
  .order("sous_secteur");
console.log(JSON.stringify(ccTable, null, 1));
