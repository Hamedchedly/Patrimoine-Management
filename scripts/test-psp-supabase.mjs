// ═══════════════════════════════════════════════════════════════════════════════
// V6 — Tests Supabase du Préparateur PSP (schéma + persistance).
//
// Audit live APRÈS la migration 20260815_psp_preparation_persistance.sql :
//   · existence/colonnes des tables PSP ;
//   · FK, UNIQUE TR+C, CHECK ;
//   · triggers de gel + historique + updated_at ;
//   · RLS (lecture anon vs service_role) ;
//   · non-régression des tables existantes (comptes inchangés).
//
// Règles :
//   · aucune requête `head:true` sur une table non vérifiée (piège V5) ;
//   · toute écriture utilise des données de test marquées __V6_TEST__,
//     supprimées proprement à la fin (jamais les données métier 2026) ;
//   · à la fin : aucune donnée __V6_TEST__ restante.
//
// Exécution : node --env-file=.env scripts/test-psp-supabase.mjs
// ═══════════════════════════════════════════════════════════════════════════════
import { createClient } from "@supabase/supabase-js";

const url = process.env["EXT_SUPABASE_URL"];
const key = process.env["EXT_SUPABASE_SERVICE_ROLE_KEY"];
const pub =
  process.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ?? process.env["SUPABASE_PUBLISHABLE_KEY"] ?? null;
if (!url || !key) {
  console.error(
    "EXT_SUPABASE_URL / EXT_SUPABASE_SERVICE_ROLE_KEY manquantes — relancer avec --env-file=.env",
  );
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const anon = pub
  ? createClient(url, pub, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

const MARQUEUR = `__V6_TEST__${Date.now()}`;
const PASS = [];
const FAIL = [];
const SKIP = [];
function check(label, ok, detail = "") {
  if (ok) PASS.push(label);
  else FAIL.push(`${label}${detail ? ` — ${detail}` : ""}`);
}
function skip(label, detail) {
  SKIP.push(`${label} — ${detail}`);
}

const created = {
  programmations: [],
  lignes: [],
  devis: [],
  reports: [],
  links: [],
  decisions: [],
  historiques: [],
};

async function run(fn) {
  try {
    const { data, error } = await fn();
    return { data, error, code: error?.code ?? null, msg: error?.message ?? "" };
  } catch (e) {
    return { data: null, error: e, code: e?.code ?? null, msg: String(e?.message ?? e) };
  }
}

const tbl = {
  programmations: "psp_programmations",
  lignes: "psp_lignes",
  historique: "psp_ligne_historique",
  reports: "psp_reports",
  devis: "psp_devis",
  links: "psp_command_links",
  decisions: "psp_decisions",
  rules: "psp_rules",
};

// ── 0. Comptes initiaux (non-régression des tables existantes) ────────────────
console.log("\n=== ÉTAPE 0 — SNAPSHOT DES TABLES EXISTANTES ===");
const comptesInitiaux = {};
for (const t of [
  "tranches",
  "lots",
  "travaux_commandes",
  "travaux_commandes_historique",
  "fournisseurs",
  "psp_import_rows",
]) {
  const { count } = await db.from(t).select("id", { count: "exact", head: true });
  comptesInitiaux[t] = count ?? -1;
}
console.log("Comptes initiaux :", JSON.stringify(comptesInitiaux));

// ── 1. Existence + colonnes (OpenAPI / REST fiable, sans head sur l'inexistant) ─
console.log("\n=== ÉTAPE 1 — TABLES ET COLONNES ===");
const spec = await (
  await fetch(`${url}/rest/v1/`, { headers: { apikey: key, Accept: "application/json" } })
).json();
const defs = spec.definitions ?? {};
const COLONNES_ATTENDUES = {
  psp_programmations: [
    "id",
    "annee_debut",
    "annee_fin",
    "version",
    "type",
    "statut",
    "parent_id",
    "auteur",
    "remarques",
    "created_at",
    "updated_at",
    "validated_at",
    "validated_by",
    "frozen_at",
    "frozen_by",
  ],
  psp_lignes: [
    "id",
    "programmation_id",
    "tranche_code",
    "categorie",
    "corps_etat_code",
    "corps_etat",
    "nature_travaux",
    "programme",
    "ligne_budget",
    "remarques",
    "origine",
    "created_at",
    "updated_at",
  ],
  psp_ligne_historique: [
    "id",
    "ligne_id",
    "operation",
    "avant",
    "apres",
    "resolu",
    "motif",
    "utilisateur",
    "created_at",
  ],
  psp_reports: [
    "id",
    "source_ligne_id",
    "source_annee",
    "cible_ligne_id",
    "cible_annee",
    "montant",
    "motif",
    "created_by",
    "created_at",
  ],
  psp_devis: [
    "id",
    "psp_ligne_id",
    "fournisseur_id",
    "entreprise",
    "date_devis",
    "montant",
    "statut",
    "commentaire",
    "document_reference",
    "created_at",
    "updated_at",
  ],
};
for (const [t, cols] of Object.entries(COLONNES_ATTENDUES)) {
  const { error } = await db.from(t).select("*").limit(1);
  check(`table ${t} existe (probe fiable)`, !error, error?.message);
  const props = Object.keys(defs[t]?.properties ?? {});
  for (const c of cols) check(`  colonne ${t}.${c}`, props.includes(c));
  for (const extra of ["psp_ligne_id", "annee_cible", "montant"]) {
    if (
      (t === "psp_command_links" || t === "psp_decisions") &&
      extra === "psp_ligne_id" &&
      t === "psp_command_links"
    ) {
      check(
        "  psp_command_links.psp_ligne_id ajoutée",
        Object.keys(defs[t]?.properties ?? {}).includes(extra),
      );
    }
  }
}
// Généralisations
const propsLinks = Object.keys(defs.psp_command_links?.properties ?? {});
check("psp_command_links.psp_ligne_id (généralisation)", propsLinks.includes("psp_ligne_id"));
const propsDec = Object.keys(defs.psp_decisions?.properties ?? {});
check(
  "psp_decisions.psp_ligne_id / annee_cible / montant (généralisation)",
  ["psp_ligne_id", "annee_cible", "montant"].every((c) => propsDec.includes(c)),
);
check("psp_rules conservée", !!defs.psp_rules);
check("psp_programmations présente (était absente en V5.1)", !!defs.psp_programmations);
check(
  "aucune table concurrente (psp_arbitrages/psp_ligne_commandes/psp_versions)",
  !defs.psp_arbitrages && !defs.psp_ligne_commandes && !defs.psp_versions,
);

// ── Références réelles (lecture seule) ─────────────────────────────────────────
const { data: trancheRef } = await db.from("tranches").select("code").limit(1);
const trancheTest = trancheRef?.[0]?.code;
const { data: commandeRef } = await db
  .from("travaux_commandes")
  .select("id, numero_commande")
  .limit(1);
const commandeTestId = commandeRef?.[0]?.id;
check("référence tranche récupérée", !!trancheTest);
check("référence commande récupérée", !!commandeTestId);

// ── 2. CRUD programmation (brouillon) ──────────────────────────────────────────
console.log("\n=== ÉTAPE 2 — CRUD PROGRAMMATION / LIGNE ===");
let P1 = null;
{
  const r = await run(() =>
    db
      .from(tbl.programmations)
      .insert({
        annee_debut: 2090,
        annee_fin: 2091,
        version: 1,
        type: "officielle",
        statut: "brouillon",
        remarques: MARQUEUR,
      })
      .select("*"),
  );
  check("2. création programmation (brouillon)", !r.error, r.msg);
  P1 = r.data?.[0] ?? null;
  if (P1?.id) created.programmations.push(P1.id);
  check("2. id uuid auto-généré", !!P1?.id);
}
{
  const { data, error } = await db
    .from(tbl.programmations)
    .select("*")
    .eq("id", P1?.id ?? "00000000-0000-0000-0000-000000000000")
    .maybeSingle();
  check("2. lecture programmation après création", !error && data?.id === P1?.id, error?.message);
}
{
  // UNIQUE(annee_debut, version)
  const r = await run(() =>
    db
      .from(tbl.programmations)
      .insert({ annee_debut: 2090, annee_fin: 2091, version: 1, remarques: MARQUEUR })
      .select("id"),
  );
  check(
    "2. UNIQUE(annee_debut, version) bloque le doublon",
    r.code === "23505",
    `${r.code} ${r.msg}`,
  );
}
{
  // CHECK statut invalide
  const r = await run(() =>
    db
      .from(tbl.programmations)
      .insert({
        annee_debut: 2090,
        annee_fin: 2091,
        version: 3,
        statut: "invalide",
        remarques: MARQUEUR,
      })
      .select("id"),
  );
  check("2. CHECK statut invalide bloqué", r.code === "23514", `${r.code} ${r.msg}`);
}
{
  // CHECK type invalide
  const r = await run(() =>
    db
      .from(tbl.programmations)
      .insert({
        annee_debut: 2090,
        annee_fin: 2091,
        version: 3,
        type: "invalide",
        remarques: MARQUEUR,
      })
      .select("id"),
  );
  check("2. CHECK type invalide bloqué", r.code === "23514", `${r.code} ${r.msg}`);
}

// ── 3. CRUD ligne + UNIQUE TR+C + FK ───────────────────────────────────────────
let L1 = null;
let L2 = null;
{
  const r = await run(() =>
    db
      .from(tbl.lignes)
      .insert({
        programmation_id: P1?.id,
        tranche_code: trancheTest,
        categorie: "GE",
        programme: { 2090: 35000, 2091: 0 },
        remarques: MARQUEUR,
      })
      .select("*"),
  );
  check("3. création ligne", !r.error, r.msg);
  L1 = r.data?.[0] ?? null;
  if (L1?.id) created.lignes.push(L1.id);
  check(
    "3. ligne : programme jsonb préservé",
    L1?.programme?.[2090] === 35000 || L1?.programme?.["2090"] === 35000,
    JSON.stringify(L1?.programme),
  );
  check("3. ligne : origine défaut 'preparation'", L1?.origine === "preparation");
}
{
  const { data, error } = await db
    .from(tbl.lignes)
    .select("*")
    .eq("id", L1?.id ?? "00000000-0000-0000-0000-000000000000")
    .maybeSingle();
  check("3. lecture ligne", !error && data?.id === L1?.id, error?.message);
}
{
  // V7.3 — PLUSIEURS opérations par tranche et par catégorie sont AUTORISÉES
  // (la contrainte UNIQUE (programmation_id, tranche_code, categorie) a été
  // supprimée par la migration 20260818_psp_operation_multi_tranche_atomique).
  const r = await run(() =>
    db
      .from(tbl.lignes)
      .insert({
        programmation_id: P1?.id,
        tranche_code: trancheTest,
        categorie: "GE",
        remarques: MARQUEUR,
      })
      .select("id"),
  );
  check(
    "3. deux lignes même TR + même catégorie → OK (V7.3)",
    !r.error && !!r.data?.[0]?.id,
    `${r.code} ${r.msg}`,
  );
  if (r.data?.[0]?.id) created.lignes.push(r.data[0].id);
}
{
  // TR+C identique autorisé dans une AUTRE programmation
  const rP2 = await run(() =>
    db
      .from(tbl.programmations)
      .insert({ annee_debut: 2090, annee_fin: 2091, version: 4, remarques: MARQUEUR })
      .select("id"),
  );
  const P2 = rP2.data?.[0];
  if (P2?.id) created.programmations.push(P2.id);
  const r = await run(() =>
    db
      .from(tbl.lignes)
      .insert({
        programmation_id: P2?.id,
        tranche_code: trancheTest,
        categorie: "GE",
        remarques: MARQUEUR,
      })
      .select("id"),
  );
  check("3. TR+C identique AUTORISÉ dans une autre programmation", !r.error, r.msg);
  L2 = r.data?.[0] ?? null;
  if (L2?.id) created.lignes.push(L2.id);
}
{
  // FK programmation_id invalide
  const r = await run(() =>
    db
      .from(tbl.lignes)
      .insert({
        programmation_id: "00000000-0000-0000-0000-000000000000",
        tranche_code: trancheTest,
        categorie: "GT",
        remarques: MARQUEUR,
      })
      .select("id"),
  );
  check(
    "3. FK programmation_id → psp_programmations.id (violation bloquée)",
    r.code === "23503",
    `${r.code} ${r.msg}`,
  );
}
{
  // FK tranche_code invalide
  const r = await run(() =>
    db
      .from(tbl.lignes)
      .insert({
        programmation_id: P1?.id,
        tranche_code: "__INEXISTANT__",
        categorie: "GT",
        remarques: MARQUEUR,
      })
      .select("id"),
  );
  check(
    "3. FK tranche_code → tranches.code (violation bloquée)",
    r.code === "23503",
    `${r.code} ${r.msg}`,
  );
}
{
  // CHECK categorie invalide
  const r = await run(() =>
    db
      .from(tbl.lignes)
      .insert({
        programmation_id: P1?.id,
        tranche_code: trancheTest,
        categorie: "ZZ",
        remarques: MARQUEUR,
      })
      .select("id"),
  );
  check("3. CHECK categorie invalide bloqué", r.code === "23514", `${r.code} ${r.msg}`);
}
{
  // Modifier une ligne du brouillon
  const r = await run(() =>
    db
      .from(tbl.lignes)
      .update({ remarques: `${MARQUEUR}-mod` })
      .eq("id", L1?.id)
      .select("remarques, updated_at"),
  );
  check(
    "3. modification ligne (brouillon)",
    !r.error && r.data?.[0]?.remarques?.includes("mod"),
    r.msg,
  );
}
{
  // Supprimer une ligne du brouillon → vérifier la suppression RÉELLE (V6.1 §7)
  const r = await run(() => db.from(tbl.lignes).delete().eq("id", L2?.id).select("id"));
  check("3. suppression ligne (brouillon)", !r.error, r.msg);
  const { data: apresSuppr } = await db.from(tbl.lignes).select("id").eq("id", L2?.id);
  check("3. ligne réellement supprimée (SELECT = 0)", (apresSuppr ?? []).length === 0);
  const rec = await run(() =>
    db
      .from(tbl.lignes)
      .insert({
        programmation_id: P1?.id,
        tranche_code: trancheTest,
        categorie: "CP",
        programme: { 2090: 12000 },
        remarques: MARQUEUR,
      })
      .select("id"),
  );
  L2 = rec.data?.[0] ?? null;
  if (L2?.id) created.lignes.push(L2.id);
}

// ── 4. Reports ─────────────────────────────────────────────────────────────────
console.log("\n=== ÉTAPE 4 — REPORTS ===");
{
  const r = await run(() =>
    db
      .from(tbl.reports)
      .insert({
        source_ligne_id: L1?.id,
        source_annee: 2090,
        cible_ligne_id: L2?.id,
        cible_annee: 2091,
        montant: 35000,
        motif: MARQUEUR,
      })
      .select("*"),
  );
  check("4. création report (source → cible)", !r.error, r.msg);
  if (r.data?.[0]?.id) created.reports.push(r.data[0].id);
  check(
    "4. report conserve source/cible",
    r.data?.[0]?.source_ligne_id === L1?.id && r.data?.[0]?.cible_ligne_id === L2?.id,
  );
}
{
  const r = await run(() =>
    db
      .from(tbl.reports)
      .insert({
        source_ligne_id: L1?.id,
        source_annee: 2090,
        cible_ligne_id: L2?.id,
        cible_annee: 2091,
        montant: -1,
        motif: MARQUEUR,
      })
      .select("id"),
  );
  check("4. CHECK montant >= 0 (report négatif bloqué)", r.code === "23514", `${r.code} ${r.msg}`);
}
{
  // FK report : ligne source inexistante
  const r = await run(() =>
    db
      .from(tbl.reports)
      .insert({
        source_ligne_id: "00000000-0000-0000-0000-000000000000",
        source_annee: 2090,
        cible_ligne_id: L2?.id,
        cible_annee: 2091,
        montant: 1000,
        motif: MARQUEUR,
      })
      .select("id"),
  );
  check(
    "4. FK report.source_ligne_id → psp_lignes.id (bloquée)",
    r.code === "23503",
    `${r.code} ${r.msg}`,
  );
}

// ── 5. Devis (1..N par ligne) ──────────────────────────────────────────────────
console.log("\n=== ÉTAPE 5 — DEVIS ===");
{
  const r = await run(() =>
    db
      .from(tbl.devis)
      .insert({
        psp_ligne_id: L1?.id,
        entreprise: "ENTREPRISE TEST V6",
        date_devis: "2090-06-01",
        montant: 38000,
        statut: "recu",
        commentaire: MARQUEUR,
      })
      .select("*"),
  );
  check("5. création devis", !r.error, r.msg);
  if (r.data?.[0]?.id) created.devis.push(r.data[0].id);
}
{
  const r = await run(() =>
    db
      .from(tbl.devis)
      .insert({
        psp_ligne_id: L1?.id,
        entreprise: "ENTREPRISE TEST V6 B",
        date_devis: "2090-06-15",
        montant: 39500,
        statut: "a_analyser",
        commentaire: MARQUEUR,
      })
      .select("*"),
  );
  check("5. deuxième devis sur la même ligne (1..N)", !r.error, r.msg);
  if (r.data?.[0]?.id) created.devis.push(r.data[0].id);
}
{
  const r = await run(() =>
    db
      .from(tbl.devis)
      .insert({
        psp_ligne_id: L1?.id,
        entreprise: "X",
        montant: 1000,
        statut: "statut_invalide",
        commentaire: MARQUEUR,
      })
      .select("id"),
  );
  check("5. CHECK statut devis invalide bloqué", r.code === "23514", `${r.code} ${r.msg}`);
}
{
  // FK devis → ligne inexistante
  const r = await run(() =>
    db
      .from(tbl.devis)
      .insert({
        psp_ligne_id: "00000000-0000-0000-0000-000000000000",
        montant: 1000,
        statut: "recu",
        commentaire: MARQUEUR,
      })
      .select("id"),
  );
  check(
    "5. FK devis.psp_ligne_id → psp_lignes.id (bloquée)",
    r.code === "23503",
    `${r.code} ${r.msg}`,
  );
}
{
  // Modification d'un devis (statut retenu)
  const r = await run(() =>
    db
      .from(tbl.devis)
      .update({ statut: "retenu" })
      .eq("entreprise", "ENTREPRISE TEST V6")
      .select("statut"),
  );
  check("5. modification devis", !r.error && r.data?.some((d) => d.statut === "retenu"), r.msg);
}

// ── 6. Command links (rattachement commandes existantes) ───────────────────────
console.log("\n=== ÉTAPE 6 — COMMAND LINKS ===");
// Résolution réelle : une commande travaux_commandes appariée à son import_row
// via psp_import_rows.numero_commande_interne (COMN_NUM) ↔ travaux_commandes.numero_commande.
// import_row_id réel, jamais fictif. Si aucun match, SKIP.
{
  const { data: importRows } = await db
    .from("psp_import_rows")
    .select("id, numero_commande_interne")
    .not("numero_commande_interne", "is", null)
    .limit(500);
  const mapInterne = new Map(
    (importRows ?? [])
      .filter((r) => r.numero_commande_interne)
      .map((r) => [String(r.numero_commande_interne).trim(), r]),
  );
  const { data: commandes } = await db
    .from("travaux_commandes")
    .select("id, numero_commande")
    .limit(200);
  const apparies = (commandes ?? [])
    .map((c) => {
      const ir = mapInterne.get(String(c.numero_commande).trim());
      return ir ? { commande: c, importRow: ir } : null;
    })
    .filter(Boolean);
  const cmdTest = apparies[0] ?? null;
  const cmd2Pair = apparies[1] ?? null;
  if (cmdTest) {
    const r = await run(() =>
      db
        .from(tbl.links)
        .insert({
          commande_id: cmdTest.commande.id,
          import_row_id: cmdTest.importRow.id,
          psp_ligne_id: L1?.id,
          type_relation: "rattachement_ligne",
          methode: "manuel",
          confiance: 1,
          statut: "valide",
          justification: MARQUEUR,
        })
        .select("*"),
    );
    check("6. création lien commande → ligne PSP (import_row_id réel)", !r.error, r.msg);
    if (r.data?.[0]?.id) created.links.push(r.data[0].id);
    check(
      "6. type_relation élargi accepté (rattachement_ligne)",
      r.data?.[0]?.type_relation === "rattachement_ligne",
    );
    check("6. statut 'valide' accepté par le CHECK existant", r.data?.[0]?.statut === "valide");
    if (cmd2Pair) {
      const r2 = await run(() =>
        db
          .from(tbl.links)
          .insert({
            commande_id: cmd2Pair.commande.id,
            import_row_id: cmd2Pair.importRow.id,
            psp_ligne_id: L1?.id,
            type_relation: "rattachement_ligne",
            methode: "manuel",
            confiance: 1,
            statut: "valide",
            justification: MARQUEUR,
          })
          .select("id"),
      );
      check("6. plusieurs commandes sur une même ligne", !r2.error, r2.msg);
      if (r2.data?.[0]?.id) created.links.push(r2.data[0].id);
    } else {
      skip("6. plusieurs commandes sur une même ligne", "pas de 2e commande appariée");
    }
  } else {
    skip("6. liaison commande → ligne", "aucune commande appariée à un import_row");
  }
  // FK commande inexistante (avec import_row_id valide pour isoler la FK commande)
  if (cmdTest) {
    const r = await run(() =>
      db
        .from(tbl.links)
        .insert({
          commande_id: "00000000-0000-0000-0000-000000000000",
          import_row_id: cmdTest.importRow.id,
          psp_ligne_id: L1?.id,
          type_relation: "rattachement_ligne",
          methode: "manuel",
          statut: "valide",
          justification: MARQUEUR,
        })
        .select("id"),
    );
    check(
      "6. FK link.commande_id → travaux_commandes.id (bloquée)",
      r.code === "23503",
      `${r.code} ${r.msg}`,
    );
  }
}

// ── 7. Décisions / arbitrages (conflit de catégorie) ───────────────────────────
console.log("\n=== ÉTAPE 7 — DÉCISIONS ===");
{
  const r = await run(() =>
    db
      .from(tbl.decisions)
      .insert({
        cle_metier: MARQUEUR,
        type_decision: "conflit_categorie",
        cible_type: "psp_ligne",
        cible_id: L1?.id,
        proposition_initiale: { 2090: 35000 },
        valeur_retenue: { 2091: 35000 },
        decision_utilisateur: "GT",
        statut: "validee",
        motif: MARQUEUR,
        psp_ligne_id: L1?.id,
        annee_cible: 2090,
        montant: 35000,
      })
      .select("*"),
  );
  check("7. décision conflit de catégorie", !r.error, r.msg);
  if (r.data?.[0]?.id) created.decisions.push(r.data[0].id);
  check(
    "7. type_decision élargi accepté (conflit_categorie)",
    r.data?.[0]?.type_decision === "conflit_categorie",
  );
  check(
    "7. colonnes généralisées persistées (psp_ligne_id/annee_cible/montant)",
    r.data?.[0]?.psp_ligne_id === L1?.id &&
      r.data?.[0]?.annee_cible === 2090 &&
      Number(r.data?.[0]?.montant) === 35000,
  );
}
{
  // annee_cible hors domaine
  const r = await run(() =>
    db
      .from(tbl.decisions)
      .insert({
        cle_metier: MARQUEUR,
        type_decision: "report",
        cible_type: "psp_ligne",
        cible_id: L1?.id,
        proposition_initiale: {},
        valeur_retenue: {},
        decision_utilisateur: "ok",
        statut: "validee",
        psp_ligne_id: L1?.id,
        annee_cible: 1999,
        montant: 1000,
      })
      .select("id"),
  );
  check("7. CHECK annee_cible (1999 bloqué)", r.code === "23514", `${r.code} ${r.msg}`);
}

// ── 8. GEL — programmation figée ───────────────────────────────────────────────
console.log("\n=== ÉTAPE 8 — GEL (PROGRAMMATION FIGÉE) ===");
{
  // figer P1
  const r = await run(() =>
    db
      .from(tbl.programmations)
      .update({ statut: "figee", frozen_at: new Date().toISOString(), frozen_by: null })
      .eq("id", P1?.id)
      .select("statut"),
  );
  check(
    "8. passage brouillon → figee (transition autorisée)",
    !r.error && r.data?.[0]?.statut === "figee",
    r.msg,
  );
}
{
  // modifier une ligne de la programmation figée → bloqué par trigger
  const r = await run(() =>
    db
      .from(tbl.lignes)
      .update({ remarques: `${MARQUEUR}-figee` })
      .eq("id", L1?.id)
      .select("id"),
  );
  check(
    "8. UPDATE ligne d'une programmation figée → BLOQUÉ (trigger)",
    !!r.error,
    `${r.code} ${r.msg}`,
  );
  check(
    "8. message de gel explicite",
    (r.msg || "").includes("figée") || (r.msg || "").includes("figee"),
    r.msg,
  );
}
{
  // supprimer une ligne d'une programmation figée → bloqué
  const r = await run(() => db.from(tbl.lignes).delete().eq("id", L1?.id).select("id"));
  check(
    "8. DELETE ligne d'une programmation figée → BLOQUÉ (trigger)",
    !!r.error,
    `${r.code} ${r.msg}`,
  );
}
{
  // ajouter une ligne à une programmation figée → bloqué
  const r = await run(() =>
    db
      .from(tbl.lignes)
      .insert({
        programmation_id: P1?.id,
        tranche_code: trancheTest,
        categorie: "GT",
        remarques: MARQUEUR,
      })
      .select("id"),
  );
  check(
    "8. INSERT ligne dans une programmation figée → BLOQUÉ (trigger)",
    !!r.error,
    `${r.code} ${r.msg}`,
  );
}
{
  // modifier la programmation figée (autre champ que statut) → bloqué
  const r = await run(() =>
    db
      .from(tbl.programmations)
      .update({ remarques: `${MARQUEUR}-racine` })
      .eq("id", P1?.id)
      .select("id"),
  );
  check(
    "8. UPDATE programmation figée (hors statut) → BLOQUÉ (trigger)",
    !!r.error,
    `${r.code} ${r.msg}`,
  );
}
{
  // devis sur une ligne d'une programmation figée → bloqué
  const r = await run(() =>
    db
      .from(tbl.devis)
      .insert({
        psp_ligne_id: L1?.id,
        entreprise: "X",
        montant: 100,
        statut: "recu",
        commentaire: MARQUEUR,
      })
      .select("id"),
  );
  check("8. INSERT devis sur ligne figée → BLOQUÉ (trigger)", !!r.error, `${r.code} ${r.msg}`);
}
{
  // report impliquant une ligne figée → bloqué
  const r = await run(() =>
    db
      .from(tbl.reports)
      .insert({
        source_ligne_id: L1?.id,
        source_annee: 2090,
        cible_ligne_id: L2?.id,
        cible_annee: 2091,
        montant: 1000,
        motif: MARQUEUR,
      })
      .select("id"),
  );
  check(
    "8. INSERT report impliquant une ligne figée → BLOQUÉ (trigger)",
    !!r.error,
    `${r.code} ${r.msg}`,
  );
}
{
  // suppression de la programmation figée → bloqué
  const r = await run(() => db.from(tbl.programmations).delete().eq("id", P1?.id).select("id"));
  check("8. DELETE programmation figée → BLOQUÉ (trigger)", !!r.error, `${r.code} ${r.msg}`);
}
{
  // transition figee → brouillon autorisée (dégel contrôlé)
  const r = await run(() =>
    db.from(tbl.programmations).update({ statut: "brouillon" }).eq("id", P1?.id).select("statut"),
  );
  check(
    "8. transition figee → brouillon autorisée (dégel)",
    !r.error && r.data?.[0]?.statut === "brouillon",
    r.msg,
  );
}

// ── 9. Historique automatique (delta jsonb) + updated_at ───────────────────────
console.log("\n=== ÉTAPE 9 — HISTORIQUE + UPDATED_AT ===");
{
  const { data: hist } = await db
    .from(tbl.historique)
    .select("*")
    .eq("ligne_id", L1?.id)
    .order("created_at", { ascending: true });
  const opCre = (hist ?? []).filter((h) => h.operation === "creation");
  const opMod = (hist ?? []).filter((h) => h.operation === "modification");
  check("9. historique création auto (trigger)", opCre.length >= 1);
  check("9. historique modification auto (trigger)", opMod.length >= 1);
  check(
    "9. delta jsonb avant/apres préservé",
    opMod.some((h) => h.avant && h.apres),
  );
  check(
    "9. resolu=false par défaut",
    (hist ?? []).every((h) => h.resolu === false),
  );
}
{
  // updated_at automatique : modifier la ligne et vérifier updated_at > created_at
  const av = (await db.from(tbl.lignes).select("updated_at, created_at").eq("id", L1?.id).single())
    .data;
  const r = await run(() =>
    db
      .from(tbl.lignes)
      .update({ remarques: `${MARQUEUR}-hist2` })
      .eq("id", L1?.id)
      .select("updated_at, created_at"),
  );
  const ap = r.data?.[0];
  check(
    "9. updated_at mis à jour automatiquement (trigger)",
    !!ap && !!av && new Date(ap.updated_at) > new Date(av.updated_at),
    JSON.stringify({ av, ap }),
  );
  check("9. created_at inchangé", ap?.created_at === av?.created_at);
}

// ── 10. Persistance après « rechargement » (ré-lecture) ────────────────────────
console.log("\n=== ÉTAPE 10 — PERSISTANCE APRÈS RECHARGEMENT ===");
{
  const { data: prog } = await db
    .from(tbl.programmations)
    .select("*")
    .eq("id", P1?.id)
    .maybeSingle();
  const { data: lignes } = await db.from(tbl.lignes).select("*").eq("programmation_id", P1?.id);
  const { data: devis } = await db.from(tbl.devis).select("*").eq("psp_ligne_id", L1?.id);
  const { data: reports } = await db.from(tbl.reports).select("*").eq("source_ligne_id", L1?.id);
  const { data: links } = await db.from(tbl.links).select("*").eq("psp_ligne_id", L1?.id);
  const { data: decisions } = await db.from(tbl.decisions).select("*").eq("psp_ligne_id", L1?.id);
  check("10. programmation relue après rechargement", prog?.id === P1?.id);
  check("10. lignes relues", (lignes ?? []).length >= 2);
  check("10. devis relus", (devis ?? []).length >= 2);
  check("10. reports relus", (reports ?? []).length >= 1);
  check("10. liens commandes relus", (links ?? []).length >= 1);
  check("10. décisions relues", (decisions ?? []).length >= 1);
}

// ── 11. RLS : lecture anon vs service_role ─────────────────────────────────────
console.log("\n=== ÉTAPE 11 — RLS ===");
if (anon) {
  const { data: anonData, error: anonErr } = await anon
    .from(tbl.programmations)
    .select("id")
    .eq("id", P1?.id);
  const { data: adminData } = await db.from(tbl.programmations).select("id").eq("id", P1?.id);
  check(
    "11. RLS active : anon ne voit PAS les lignes (aucune policy anon)",
    !anonErr && (anonData ?? []).length === 0,
    anonErr?.message,
  );
  check("11. service_role voit les lignes (BYPASS RLS)", (adminData ?? []).length === 1);
} else {
  skip("11. RLS anon", "aucune clé publishable dans .env");
}

// ── 12. Non-régression des tables existantes ───────────────────────────────────
console.log("\n=== ÉTAPE 12 — NON-RÉGRESSION DES TABLES EXISTANTES ===");
{
  for (const t of Object.keys(comptesInitiaux)) {
    const { count } = await db.from(t).select("id", { count: "exact", head: true });
    check(
      `12. ${t} : comptes inchangés (${comptesInitiaux[t]} → ${count})`,
      count === comptesInitiaux[t],
    );
  }
}

// ── 13. Nettoyage complet des données de test ──────────────────────────────────
console.log("\n=== ÉTAPE 13 — NETTOYAGE DES DONNÉES DE TEST ===");
{
  const MARQUEURS = ["__V6_TEST__", "__HOTFIX_PROBE__", "__CASCADE_TEST__", "__ORPHAN_TEST__"];
  const purger = async (table, colonne) => {
    for (const m of MARQUEURS) {
      await db.from(table).delete().ilike(colonne, `%${m}%`);
    }
  };
  // 1) décisions / liens / reports / devis créés (ids suivis + purge par marqueur)
  for (const id of created.decisions) await db.from(tbl.decisions).delete().eq("id", id);
  for (const id of created.links) await db.from(tbl.links).delete().eq("id", id);
  for (const id of created.reports) await db.from(tbl.reports).delete().eq("id", id);
  for (const id of created.devis) await db.from(tbl.devis).delete().eq("id", id);
  await purger(tbl.decisions, "cle_metier");
  await purger(tbl.links, "justification");
  await purger(tbl.devis, "commentaire");
  // 2) dégeler puis supprimer les programmations de test (cascade lignes/historique)
  for (const id of created.programmations) {
    await db.from(tbl.programmations).update({ statut: "brouillon" }).eq("id", id);
    await db.from(tbl.programmations).delete().eq("id", id);
  }
  await purger(tbl.programmations, "remarques");
  // 3) lignes orphelines résiduelles (issues de runs avant hotfix) — supprimer
  //    uniquement les lignes dont le marqueur de test est identifié
  await purger(tbl.lignes, "remarques");
  // 4) contrôle final : aucune trace des marqueurs
  const restProg = await db
    .from(tbl.programmations)
    .select("id")
    .or(MARQUEURS.map((m) => `remarques.ilike.%${m}%`).join(","));
  const restLignes = await db
    .from(tbl.lignes)
    .select("id")
    .or(MARQUEURS.map((m) => `remarques.ilike.%${m}%`).join(","));
  const restDecisions = await db
    .from(tbl.decisions)
    .select("id")
    .or(MARQUEURS.map((m) => `cle_metier.ilike.%${m}%`).join(","));
  const restLinks = await db
    .from(tbl.links)
    .select("id")
    .or(MARQUEURS.map((m) => `justification.ilike.%${m}%`).join(","));
  const restDevis = await db
    .from(tbl.devis)
    .select("id")
    .or(MARQUEURS.map((m) => `commentaire.ilike.%${m}%`).join(","));
  check("13. aucune programmation de test restante", (restProg.data ?? []).length === 0);
  check("13. aucune ligne de test restante", (restLignes.data ?? []).length === 0);
  check("13. aucune décision de test restante", (restDecisions.data ?? []).length === 0);
  check("13. aucun lien de test restant", (restLinks.data ?? []).length === 0);
  check("13. aucun devis de test restant", (restDevis.data ?? []).length === 0);
  // Historiques : cascade avec les lignes → aucun marqueur dans avant/apres.
  const restHist = await db
    .from(tbl.historique)
    .select("id")
    .or(
      MARQUEURS.map((m) => `avant->>remarques.ilike.%${m}%,apres->>remarques.ilike.%${m}%`).join(
        ",",
      ),
    );
  check("13. aucun historique de test restant", (restHist.data ?? []).length === 0);
  // Orphelins : toute ligne restante doit référencer une programmation existante.
  const { data: lignesRestantes } = await db.from(tbl.lignes).select("programmation_id");
  const { data: progsExistantes } = await db.from(tbl.programmations).select("id");
  const idsProgs = new Set((progsExistantes ?? []).map((p) => p.id));
  const orphelines = (lignesRestantes ?? []).filter((l) => !idsProgs.has(l.programmation_id));
  check("13. ZÉRO ligne PSP orpheline", orphelines.length === 0);
}

// ── Bilan ──────────────────────────────────────────────────────────────────────
console.log("\n=== BILAN ===");
console.log(`  PASS : ${PASS.length}`);
console.log(`  FAIL : ${FAIL.length}`);
console.log(`  SKIP : ${SKIP.length}`);
if (SKIP.length > 0) {
  console.log("\nIGNORÉS :");
  for (const s of SKIP) console.log(`  ⚠ ${s}`);
}
if (FAIL.length > 0) {
  console.log("\nÉCHECS :");
  for (const f of FAIL) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log("\nTous les tests Supabase PSP V6 passent — données de test nettoyées.");
