// ═══════════════════════════════════════════════════════════════════════════════
// V8.12 — RÉINITIALISATION + RÉIMPORT DU FICHIER SUIVI ANNUEL ANM 2026.
// Exécution (⚠️ destructif) : node --env-file=.env scripts/reimport-anm-2026.mjs --reset
// Sans --reset : mode dry-run (affiche ce qui sera supprimé/importé, aucune écriture).
// Avant exécution : scripts/backup-db.mjs (sauvegarde complète).
// ═══════════════════════════════════════════════════════════════════════════════
// PÉRIMÈTRE SUPPRESSION (validé — « tout réinitialiser », préserve la préparation PSP) :
//  · travaux_commandes (TOUTES années), import_travaux, travaux_import_details,
//    travaux_commandes_historique, psp_command_links ;
//  · psp_lignes ANNUELLES (programmation_id IS NULL : origine 'suivi' / 'hors_psp')
//    + psp_ligne_patrimoine / psp_devis / psp_reports / psp_decisions liées ;
//  · PRÉSERVÉS : psp_programmations + psp_lignes de préparation (programmation_id NOT NULL),
//    fournisseurs, patrimoine (tranches/lots/adresses), psp_enveloppes, référentiels.
// IMPORT : fichier ANM → 50 commandes (travaux_commandes) + matérialisation des lignes
// sans commande (psp_lignes origine='suivi').
import "dotenv/config";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  parseTravauxWorkbook,
  detailIssue,
  detailCreee,
  snapshotCommande,
  TRAVAUX_FIELDS,
} from "../src/lib/travaux.ts";

const url = process.env.EXT_SUPABASE_URL;
const key = process.env.EXT_SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Variables EXT_SUPABASE_URL / EXT_SUPABASE_SERVICE_ROLE_KEY manquantes (.env).");
  process.exit(1);
}
const db = createClient(url, key);

const FICHIER =
  process.argv.find((a) => a.toLowerCase().includes(".xlsx")) ??
  "C:/Users/Hamed/Downloads/ANM_SUIVTRXSECT 2026.xlsx";
const ANNEE = 2026;
const RESET = process.argv.includes("--reset");
const NUL_UUID = "00000000-0000-0000-0000-000000000000";
const VALID_COLUMNS = [...TRAVAUX_FIELDS, "vu_dans_import_id", "actif"];

async function count(table) {
  const { count, error } = await db.from(table).select("id", { count: "exact", head: true });
  return error ? `? (${error.message})` : count;
}

async function reset() {
  console.log("\n═══ RÉINITIALISATION ═══");
  console.log("· travaux_import_details :", await count("travaux_import_details"));
  console.log("· travaux_commandes_historique :", await count("travaux_commandes_historique"));
  console.log("· travaux_commandes :", await count("travaux_commandes"));
  console.log("· import_travaux :", await count("import_travaux"));

  for (const t of ["travaux_import_details", "travaux_commandes_historique", "psp_command_links"]) {
    const { error } = await db.from(t).delete().neq("id", NUL_UUID);
    if (error) throw new Error(`reset ${t} : ${error.message}`);
    console.log(`  ✔ ${t} vidée`);
  }

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
      console.log(`  ✔ ${t} (lignes annuelles) purgées`);
    }
    const { error: r1 } = await db.from("psp_reports").delete().in("source_ligne_id", ids);
    if (r1) throw new Error(`reset psp_reports (source) : ${r1.message}`);
    const { error: r2 } = await db.from("psp_reports").delete().in("cible_ligne_id", ids);
    if (r2) throw new Error(`reset psp_reports (cible) : ${r2.message}`);
    const { error: dErr } = await db.from("psp_decisions").delete().in("psp_ligne_id", ids);
    if (dErr) throw new Error(`reset psp_decisions : ${dErr.message}`);
    const { error: pErr } = await db.from("psp_lignes").delete().in("id", ids);
    if (pErr) throw new Error(`reset psp_lignes : ${pErr.message}`);
  }
  console.log(`  ✔ ${ids.length} psp_lignes annuelles supprimées (préparation PSP préservée)`);

  for (const t of ["travaux_commandes", "import_travaux"]) {
    const { error } = await db.from(t).delete().neq("id", NUL_UUID);
    if (error) throw new Error(`reset ${t} : ${error.message}`);
    console.log(`  ✔ ${t} vidée`);
  }
}

async function importer() {
  console.log("\n═══ IMPORT DU FICHIER ANM ═══");
  const parsed = parseTravauxWorkbook(readFileSync(FICHIER));
  const sansCmd = parsed.sansCommande;
  console.log(
    `· ${basename(FICHIER)} → ${parsed.commandes.length} commandes, ${sansCmd.length} lignes sans commande`,
  );

  const { data: importRow, error: impErr } = await db
    .from("import_travaux")
    .insert({
      fichier: basename(FICHIER),
      lignes: parsed.lignes,
      doublons: parsed.doublons,
      erreurs: parsed.erreurs.length,
      annee_exercice: ANNEE,
    })
    .select("id")
    .single();
  if (impErr) throw new Error(`import_travaux : ${impErr.message}`);
  const importId = importRow.id;

  const codes = [
    ...new Set(
      parsed.commandes
        .map((c) => c.tranche_code)
        .concat(sansCmd.map((e) => e.tranche_code))
        .filter(Boolean),
    ),
  ];
  const { data: tranches, error: trErr } = codes.length
    ? await db.from("tranches").select("code").in("code", codes)
    : { data: [], error: null };
  if (trErr) throw new Error(`tranches : ${trErr.message}`);
  const valid = new Set((tranches ?? []).map((t) => t.code));

  let creees = 0;
  let ignorees = 0;
  const details = [];
  for (const c of parsed.commandes) {
    const trancheOk = c.tranche_code && valid.has(c.tranche_code);
    const full = {
      ...c,
      tranche_code: trancheOk ? c.tranche_code : null,
      vu_dans_import_id: importId,
      annee_exercice: ANNEE,
      actif: true,
    };
    if (c.tranche_code && !trancheOk) {
      ignorees += 1;
      continue;
    }
    const row = Object.fromEntries(Object.entries(full).filter(([k]) => VALID_COLUMNS.includes(k)));
    const { data: ins, error } = await db
      .from("travaux_commandes")
      .insert(row)
      .select("*")
      .single();
    if (error) throw new Error(`insert ${c.numero_commande} : ${error.message}`);
    creees += 1;
    const hist = await db.from("travaux_commandes_historique").insert({
      import_id: importId,
      commande_id: ins.id,
      operation: "creation",
      avant: null,
      apres: snapshotCommande(ins),
    });
    if (hist.error) throw new Error(`historique ${c.numero_commande} : ${hist.error.message}`);
    details.push(detailCreee(importId, ins, c.ligne));
  }
  for (const e of sansCmd) details.push(detailIssue(importId, "sans_commande", e));
  if (details.length > 0) {
    const { error } = await db.from("travaux_import_details").insert(details);
    if (error) throw new Error(`détails import : ${error.message}`);
  }
  console.log(`· ${creees} commandes créées (${ignorees} ignorées TR inconnu)`);

  // Matérialisation des lignes sans commande (origine='suivi'), même logique que
  // materialiserLignesSansCommande (anti-doublon TR + corps + nature).
  let mat = 0;
  let exist = 0;
  let insuff = 0;
  for (const e of sansCmd) {
    if (
      typeof e.tranche_code !== "string" ||
      !e.tranche_code.trim() ||
      (!(e.corps_etat ?? "").trim() && !(e.descriptif ?? "").trim())
    ) {
      insuff += 1;
      continue;
    }
    const tranche = e.tranche_code.trim();
    const corps = (e.corps_etat ?? "").trim() || null;
    const nature = (e.descriptif ?? "").trim() || null;
    const budget =
      typeof e.budget === "number" && Number.isFinite(e.budget) && e.budget > 0 ? e.budget : null;
    const cat = ["GE", "GT", "CP"].includes((e.nature_analytique ?? "").trim().toUpperCase())
      ? (e.nature_analytique ?? "GT").trim().toUpperCase()
      : "GT";
    const { data: existing } = await db
      .from("psp_lignes")
      .select("id, corps_etat, nature_travaux")
      .eq("tranche_code", tranche);
    const doublon = (existing ?? []).some(
      (l) =>
        (l.corps_etat ?? "").trim().toLowerCase() === (corps ?? "").toLowerCase() &&
        (l.nature_travaux ?? "").trim().toLowerCase() === (nature ?? "").toLowerCase(),
    );
    if (doublon) {
      exist += 1;
      continue;
    }
    const { error } = await db.from("psp_lignes").insert({
      programmation_id: null,
      tranche_code: tranche,
      categorie: cat,
      corps_etat_code: null,
      corps_etat: corps,
      nature_travaux: nature,
      programme: budget != null ? { [String(ANNEE)]: budget } : {},
      ligne_budget: (e.ligne_budget ?? "").trim() || null,
      remarques: [
        `Matérialisée depuis l'import annuel ${ANNEE} (${basename(FICHIER)}, ligne ${e.line}) — sans commande`,
        e.adresse ? `Adresse : ${e.adresse}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      statut: "a_definir",
      priorite: "normale",
      origine: "suivi",
    });
    if (error) continue;
    mat += 1;
  }
  console.log(`· ${mat} lignes suivi matérialisées (${exist} existantes, ${insuff} insuffisantes)`);

  const { error: upErr } = await db
    .from("import_travaux")
    .update({
      statut: "termine",
      creees,
      modifiees: 0,
      inchangees: 0,
      ignorees,
      conflits: parsed.conflits.length,
      reports: 0,
      archivees: 0,
      termine_at: new Date().toISOString(),
    })
    .eq("id", importId);
  if (upErr) throw new Error(`finalisation import : ${upErr.message}`);
  console.log("· import finalisé (statut 'termine')");
}

async function main() {
  if (!RESET) {
    console.log("⚠️  MODE DRY-RUN (aucune écriture) — relancez avec --reset pour appliquer.");
  }
  if (RESET) await reset();
  if (RESET) {
    await importer();
    console.log(
      "\n✅ Réinitialisation + réimport terminés. Vérifiez /dashboard-travaux et /suivi.",
    );
  } else {
    const parsed = parseTravauxWorkbook(readFileSync(FICHIER));
    const sansCmd = parsed.sansCommande;
    console.log(
      `· fichier : ${parsed.commandes.length} commandes, ${sansCmd.length} lignes sans commande`,
    );
    console.log(
      "· tables à purger : travaux_import_details, travaux_commandes_historique, psp_command_links, psp_lignes annuelles (+dépendances), travaux_commandes, import_travaux.",
    );
  }
}

main().catch((e) => {
  console.error("ÉCHEC :", e.message);
  process.exit(1);
});
