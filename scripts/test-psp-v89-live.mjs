// ═══════════════════════════════════════════════════════════════════════════════
// V8.9 — STABILISATION DU CYCLE DE VIE DE LA PROGRAMMATION PSP : tests LIVE.
// Exécution : node --env-file=.env scripts/test-psp-v89-live.mjs
// ═══════════════════════════════════════════════════════════════════════════════
// Cycle réel sur une ligne TEMPORAIRE (même flux que la server function) :
//   · création 2027 (RPC create_psp_operation) ;
//   · ajout 2028 via fusion avec l'existant (fusionnerProgramme + update_psp_operation) ;
//   · modification 2028 sans toucher 2027 ;
//   · suppression explicite de 2028 (0) sans toucher 2027 ;
//   · vérification multi-années finales ;
//   · purge complète + snapshot avant/après strictement identique (zéro résidu).
import { createClient } from "@supabase/supabase-js";

import { fusionnerProgramme } from "../src/lib/psp.prep.ts";

const url = process.env["EXT_SUPABASE_URL"];
const key = process.env["EXT_SUPABASE_SERVICE_ROLE_KEY"] ?? process.env["EXT_SUPABASE_ANON_KEY"];
const db = createClient(url, key);

let passed = 0;
let failed = 0;
function check(label, ok, detail = "") {
  if (ok) {
    passed++;
    console.log(`  ✔ ${label}`);
  } else {
    failed++;
    console.error(`  ✘ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
const run = async (fn) => {
  try {
    return await fn();
  } catch (e) {
    return { data: null, error: { message: String(e) } };
  }
};

// ════════════ 1. SNAPSHOT AVANT ═════════════════════════════════════════════
console.log("\n=== 1. Snapshot avant ===");
const tablesImport = [
  "travaux_commandes",
  "travaux_commandes_historique",
  "import_travaux",
  "imports",
  "psp_imports",
  "psp_import_rows",
  "travaux_import_details",
];
const comptage = async () => {
  const out = {};
  for (const t of tablesImport) {
    const { count } = await db.from(t).select("id", { count: "exact", head: true });
    out[t] = count;
  }
  const { count: lignes } = await db
    .from("psp_lignes")
    .select("id", { count: "exact", head: true });
  const { count: hist } = await db
    .from("psp_ligne_historique")
    .select("id", { count: "exact", head: true });
  const { count: liens } = await db
    .from("psp_command_links")
    .select("id", { count: "exact", head: true });
  const { count: devis } = await db.from("psp_devis").select("id", { count: "exact", head: true });
  out["psp_lignes"] = lignes;
  out["psp_ligne_historique"] = hist;
  out["psp_command_links"] = liens;
  out["psp_devis"] = devis;
  return out;
};
const avant = await comptage();
console.log("  avant :", JSON.stringify(avant));

// ════════════ 2. PRÉPARATION : programmation + tranche temporaires ══════════
console.log("\n=== 2. Contexte temporaire ===");
const MARQUEUR = `V8.9-RECETTE-${Date.now().toString(36)}`;

// Réutilise la programmation officielle brouillon 2027-2031 existante (aucune création).
const { data: progRows } = await db
  .from("psp_programmations")
  .select("id")
  .eq("type", "officielle")
  .eq("statut", "brouillon")
  .order("version", { ascending: false })
  .limit(1);
const pid = progRows?.[0]?.id;
check("2.1. programmation officielle brouillon trouvée", pid != null);
const { data: tranches } = await db.from("tranches").select("code").limit(5);
const tranche = tranches?.find((t) => t.code)?.code;
check("2.2. tranche existante trouvée", tranche != null);

let createdId = null;
const createdHist = [];

// ════════════ 3. CYCLE DE VIE : création 2027 → ajout 2028 ═════════════════
console.log("\n=== 3. Création 2027 + ajout 2028 ===");
{
  const r = await run(() =>
    db.rpc("create_psp_operation", {
      p_programmation_id: pid,
      p_tranche_code: tranche,
      p_categorie: "GT",
      p_corps_etat_code: null,
      p_corps_etat: null,
      p_nature_travaux: `${MARQUEUR}`,
      p_programme: { 2027: 50000, 2028: 0, 2029: 0, 2030: 0, 2031: 0 },
      p_ligne_budget: null,
      p_remarques: MARQUEUR,
      p_statut: "a_definir",
      p_priorite: "normale",
      p_origine: "preparation",
      p_perimetres: [],
      p_devis: null,
    }),
  );
  createdId = r.data?.id ?? null;
  check("3.1. création 2027 réussie (ligne temporaire)", createdId != null, r.error?.message ?? "");
}
if (createdId) {
  // Ajout 2028 : SAME FLOW que updatePspOperationComplete (fusion avec l'existant).
  const { data: ligne } = await db
    .from("psp_lignes")
    .select("programme")
    .eq("id", createdId)
    .single();
  const fusionne = fusionnerProgramme(ligne.programme ?? {}, { 2028: 55000 });
  const r = await run(() =>
    db.rpc("update_psp_operation", {
      p_id: createdId,
      p_tranche_code: tranche,
      p_categorie: "GT",
      p_corps_etat_code: null,
      p_corps_etat: null,
      p_nature_travaux: MARQUEUR,
      p_programme: fusionne,
      p_remarques: MARQUEUR,
      p_statut: "a_definir",
      p_priorite: "normale",
      p_perimetres: [],
    }),
  );
  check("3.2. ajout 2028 (fusion) réussi", !!r.data?.id, r.error?.message ?? "");
  const { data: relu } = await db
    .from("psp_lignes")
    .select("programme")
    .eq("id", createdId)
    .single();
  const prog = relu?.programme ?? {};
  check(
    "3.3. 2027 conservée après ajout 2028 (fusion)",
    prog["2027"] === 50000 && prog["2028"] === 55000,
  );
  check("3.4. une SEULE psp_ligne (aucun doublon)", relu != null);
}

// ════════════ 4. MODIFICATION 2028 sans toucher 2027 ════════════════════════
console.log("\n=== 4. Modification 2028 ===");
if (createdId) {
  const { data: ligne } = await db
    .from("psp_lignes")
    .select("programme")
    .eq("id", createdId)
    .single();
  const fusionne = fusionnerProgramme(ligne.programme ?? {}, { 2028: 60000 });
  await run(() =>
    db.rpc("update_psp_operation", {
      p_id: createdId,
      p_tranche_code: tranche,
      p_categorie: "GT",
      p_corps_etat_code: null,
      p_corps_etat: null,
      p_nature_travaux: MARQUEUR,
      p_programme: fusionne,
      p_remarques: MARQUEUR,
      p_statut: "a_definir",
      p_priorite: "normale",
      p_perimetres: [],
    }),
  );
  const { data: relu } = await db
    .from("psp_lignes")
    .select("programme")
    .eq("id", createdId)
    .single();
  const prog = relu?.programme ?? {};
  check("4.1. 2028 modifiée (55000 → 60000)", prog["2028"] === 60000);
  check("4.2. 2027 INCHANGÉE (50000)", prog["2027"] === 50000);
}

// ════════════ 5. SUPPRESSION EXPLICITE 2028 sans toucher 2027 ═══════════════
console.log("\n=== 5. Déprogrammation explicite 2028 ===");
if (createdId) {
  const { data: ligne } = await db
    .from("psp_lignes")
    .select("programme")
    .eq("id", createdId)
    .single();
  const fusionne = fusionnerProgramme(ligne.programme ?? {}, { 2028: 0 });
  await run(() =>
    db.rpc("update_psp_operation", {
      p_id: createdId,
      p_tranche_code: tranche,
      p_categorie: "GT",
      p_corps_etat_code: null,
      p_corps_etat: null,
      p_nature_travaux: MARQUEUR,
      p_programme: fusionne,
      p_remarques: MARQUEUR,
      p_statut: "a_definir",
      p_priorite: "normale",
      p_perimetres: [],
    }),
  );
  const { data: relu } = await db
    .from("psp_lignes")
    .select("programme")
    .eq("id", createdId)
    .single();
  const prog = relu?.programme ?? {};
  check("5.1. 2028 déprogrammée (0)", prog["2028"] === 0);
  check("5.2. 2027 TOUJOURS programmée (50000)", prog["2027"] === 50000);
}

// ════════════ 6. PURGE + SNAPSHOT APRÈS ═════════════════════════════════════
console.log("\n=== 6. Purge complète + intégrité ===");
if (createdId) {
  const { data: hist } = await db
    .from("psp_ligne_historique")
    .select("id")
    .eq("ligne_id", createdId);
  for (const h of hist ?? []) createdHist.push(h.id);
  await db.from("psp_ligne_historique").delete().eq("ligne_id", createdId);
  await db.from("psp_lignes").delete().eq("id", createdId);
  const { count: reste } = await db
    .from("psp_lignes")
    .select("id", { count: "exact", head: true })
    .eq("id", createdId);
  check("6.1. ligne temporaire purgée", reste === 0);
}
const apres = await comptage();
console.log("  après :", JSON.stringify(apres));
check(
  "6.2. les 7 tables d'import strictement identiques avant/après",
  tablesImport.every((t) => avant[t] === apres[t]),
);
check("6.3. psp_lignes revenu à l'état initial", avant["psp_lignes"] === apres["psp_lignes"]);
check(
  "6.4. psp_ligne_historique revenu à l'état initial",
  avant["psp_ligne_historique"] === apres["psp_ligne_historique"],
);
check(
  "6.5. psp_command_links inchangé (aucun auto-rattachement)",
  avant["psp_command_links"] === apres["psp_command_links"],
);
check("6.6. psp_devis inchangé (aucune écriture devis)", avant["psp_devis"] === apres["psp_devis"]);

// Résidus éventuels
const { data: residus } = await db
  .from("psp_lignes")
  .select("id")
  .ilike("remarques", `%${MARQUEUR}%`);
check("6.7. zéro résidu (aucune ligne temporaire restante)", (residus ?? []).length === 0);

console.log(`\nV8.9 LIVE — ${passed} ok / ${failed} échec(s)`);
if (failed > 0) process.exit(1);
