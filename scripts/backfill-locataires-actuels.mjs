// V8.19 — BACKFILL : lots.locataire_* = OCCUPANT ACTUEL (date d'entrée max par lot).
// Source = même parseur que l'import ISIS (`parseIsisWorkbook`, corrigé V8.19).
// Ne touche QUE locataire_nom / locataire_telephone / locataire_email / date_entree.
// Usage :
//   node --env-file=.env scripts/backfill-locataires-actuels.mjs            (écriture)
//   node --env-file=.env scripts/backfill-locataires-actuels.mjs --dry-run  (prévisualisation)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { parseIsisWorkbook } from "../src/lib/isis.ts";

const DRY = process.argv.includes("--dry-run");
const fichier =
  process.argv.find((a) => a.endsWith(".xlsx")) ??
  path.join(os.homedir(), "Downloads", "20260807_HCHEDLY_export_donnees.xlsx");
if (!fs.existsSync(fichier)) {
  console.error("Fichier introuvable : " + fichier);
  process.exit(1);
}

const url = process.env.EXT_SUPABASE_URL;
const key = process.env.EXT_SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Variables EXT_SUPABASE_URL / EXT_SUPABASE_SERVICE_ROLE_KEY manquantes (.env).");
  process.exit(1);
}
const db = createClient(url, key);

const buf = fs.readFileSync(fichier);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const parsed = parseIsisWorkbook(ab);
console.log(`Fichier : ${path.basename(fichier)} — ${parsed.lots.length} lots parsés`);

const CHUNK = 1000;
const enBase = [];
{
  let from = 0;
  for (;;) {
    const { data, error } = await db
      .from("lots")
      .select("code_patrimoine, locataire_nom, locataire_telephone, locataire_email, date_entree")
      .range(from, from + CHUNK - 1)
      .order("code_patrimoine", { ascending: true });
    if (error) throw new Error(`lots : ${error.message}`);
    enBase.push(...(data ?? []));
    if ((data ?? []).length < CHUNK) break;
    from += CHUNK;
  }
}
const baseParCode = new Map(enBase.map((l) => [l.code_patrimoine, l]));

const norm = (v) => (v ?? "").trim().toLowerCase();
const aMaj = [];
for (const lot of parsed.lots) {
  const cur = baseParCode.get(lot.code_patrimoine);
  if (!cur) continue;
  if (
    norm(cur.locataire_nom) !== norm(lot.locataire_nom) ||
    norm(cur.locataire_email) !== norm(lot.locataire_email) ||
    norm(cur.locataire_telephone) !== norm(lot.locataire_telephone) ||
    norm(cur.date_entree) !== norm(lot.date_entree)
  ) {
    aMaj.push(lot);
  }
}

console.log(`À mettre à jour : ${aMaj.length} lot(s)${DRY ? " (DRY RUN)" : ""}`);
let ok = 0;
let err = 0;
for (const lot of aMaj.slice(0, DRY ? 15 : aMaj.length)) {
  if (DRY) {
    console.log(
      `  [dry] ${lot.code_patrimoine} → ${lot.locataire_nom ?? "—"} · ${lot.locataire_email ?? "—"} · ${lot.locataire_telephone ?? "—"}`,
    );
    continue;
  }
  const { error } = await db
    .from("lots")
    .update({
      locataire_nom: lot.locataire_nom,
      locataire_telephone: lot.locataire_telephone,
      locataire_email: lot.locataire_email,
      date_entree: lot.date_entree,
    })
    .eq("code_patrimoine", lot.code_patrimoine);
  if (error) {
    err++;
    console.error(`  ✗ ${lot.code_patrimoine} : ${error.message}`);
  } else {
    ok++;
  }
}
console.log(`\nTerminé : ${ok} mis à jour / ${err} erreur(s)${DRY ? " (dry-run)" : ""}.`);
