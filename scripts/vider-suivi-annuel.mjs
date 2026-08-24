// Vider complètement les tables du suivi annuel / dashboard travaux.
// ⚠️ Destructif. Faire scripts/backup-db.mjs avant.
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const db = createClient(process.env.EXT_SUPABASE_URL, process.env.EXT_SUPABASE_SERVICE_ROLE_KEY);
const NUL_UUID = "00000000-0000-0000-0000-000000000000";

async function count(t) {
  const { count, error } = await db.from(t).select("id", { count: "exact", head: true });
  return error ? `? (${error.message})` : count;
}

(async () => {
  const SUIVI = [
    "travaux_import_details",
    "travaux_commandes_historique",
    "psp_command_links",
    "psp_lignes",
    "travaux_commandes",
    "import_travaux",
  ];
  console.log("AVANT :");
  for (const t of SUIVI) console.log(" -", t, ":", await count(t));

  // 1. Enfants directs
  for (const t of ["travaux_import_details", "travaux_commandes_historique", "psp_command_links"]) {
    const { error } = await db.from(t).delete().neq("id", NUL_UUID);
    if (error) throw new Error(`reset ${t} : ${error.message}`);
    console.log(`  ✔ ${t} vidée`);
  }

  // 2. psp_lignes annuelles + dépendances (préparation PSP préservée)
  const { data: lignes, error: lErr } = await db
    .from("psp_lignes")
    .select("id")
    .is("programmation_id", null);
  if (lErr) throw new Error(`sélection psp_lignes annuelles : ${lErr.message}`);
  const ids = (lignes ?? []).map((l) => l.id);
  if (ids.length > 0) {
    for (const t of ["psp_devis", "psp_ligne_patrimoine"]) {
      const { error } = await db.from(t).delete().in("psp_ligne_id", ids);
      if (error) throw new Error(`reset ${t} : ${error.message}`);
    }
    const { error: r1 } = await db.from("psp_reports").delete().in("source_ligne_id", ids);
    if (r1) throw new Error(`psp_reports source : ${r1.message}`);
    const { error: r2 } = await db.from("psp_reports").delete().in("cible_ligne_id", ids);
    if (r2) throw new Error(`psp_reports cible : ${r2.message}`);
    const { error: dErr } = await db.from("psp_decisions").delete().in("psp_ligne_id", ids);
    if (dErr) throw new Error(`psp_decisions : ${dErr.message}`);
    const { error: pErr } = await db.from("psp_lignes").delete().in("id", ids);
    if (pErr) throw new Error(`psp_lignes : ${pErr.message}`);
    console.log(`  ✔ ${ids.length} psp_lignes annuelles supprimées (préparation préservée)`);
  }

  // 3. Commandes puis imports
  for (const t of ["travaux_commandes", "import_travaux"]) {
    const { error } = await db.from(t).delete().neq("id", NUL_UUID);
    if (error) throw new Error(`reset ${t} : ${error.message}`);
    console.log(`  ✔ ${t} vidée`);
  }

  console.log("APRÈS :");
  for (const t of SUIVI) console.log(" -", t, ":", await count(t));
})();
