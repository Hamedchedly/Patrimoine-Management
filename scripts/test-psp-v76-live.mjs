// ═══════════════════════════════════════════════════════════════════════════════
// V7.6 — Tests LIVE (Supabase, service_role) :
//  1. brouillon TR seule (zéro montant, sans corps) → ACCEPTÉ + persistance ;
//  2. fermeture/réouverture → ligne toujours présente ;
//  3. complétion (corps + montant + nature) → modification acceptée ;
//  4. référentiel CC : ajout CMICHEL / LALLIANC, modification, désactivation ;
//  5. référentiel corps d'état : ajout, rattachement GE/GT/CP, désactivation.
// Nettoyage total (marqueur __V76_TEST__, aucune donnée métier touchée).
// Exécution : node --env-file=.env scripts/test-psp-v76-live.mjs
// ═══════════════════════════════════════════════════════════════════════════════
import { createClient } from "@supabase/supabase-js";

const url = process.env["EXT_SUPABASE_URL"];
const key = process.env["EXT_SUPABASE_SERVICE_ROLE_KEY"];
if (!url || !key) {
  console.error("EXT_SUPABASE_URL / EXT_SUPABASE_SERVICE_ROLE_KEY manquantes — relancer avec --env-file=.env");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const MARQUEUR = `__V76_TEST__${Date.now()}`;
const PASS = [];
const FAIL = [];
function check(label, ok, detail = "") {
  if (ok) PASS.push(label);
  else FAIL.push(`${label}${detail ? ` — ${detail}` : ""}`);
}
async function run(fn) {
  try {
    const { data, error } = await fn();
    return { data, error, code: error?.code ?? null, msg: error?.message ?? "" };
  } catch (e) {
    return { data: null, error: e, code: e?.code ?? null, msg: String(e?.message ?? e) };
  }
}

const created = { lignes: [], programmations: [], cc: [], corps: [] };

async function main() {
  // Préparatifs : une tranche réelle pour le brouillon.
  const { data: tranches } = await db.from("tranches").select("code").eq("actif", true).order("code").limit(20);
  const trancheA = tranches?.[0]?.code;
  if (!trancheA) {
    console.error("Aucune tranche disponible.");
    process.exit(1);
  }

  // Programmation de test (années hautes pour éviter toute collision).
  const rP = await run(() =>
    db.from("psp_programmations").insert({ annee_debut: 2095, annee_fin: 2099, version: 1, remarques: MARQUEUR }).select("id"),
  );
  const P1 = rP.data?.[0];
  if (P1?.id) created.programmations.push(P1.id);
  check("préparatif : programmation", !!P1?.id, rP.msg);

  // ── 1. BROUILLON TR SEULE → ACCEPTÉ ──
  console.log("\n=== 1. BROUILLON TR SEULE ===");
  const brouillon = await run(() =>
    db.rpc("create_psp_operation", {
      p_programmation_id: P1.id,
      p_tranche_code: trancheA,
      p_categorie: "GT",
      p_corps_etat_code: null,
      p_corps_etat: null,
      p_nature_travaux: null,
      p_programme: { 2027: 0, 2028: 0, 2029: 0, 2030: 0, 2031: 0 },
      p_ligne_budget: null,
      p_remarques: MARQUEUR,
      p_statut: "a_definir",
      p_priorite: "normale",
      p_origine: "preparation",
      p_perimetres: [{ niveau: "tranche", rue: null, numero: null, lot_id: null }],
      p_devis: null,
    }),
  );
  check("1. TR seule (montant vide, corps vide) → ACCEPTÉ", !brouillon.error, brouillon.msg);
  const ligneId = brouillon.data?.id;
  if (ligneId) created.lignes.push(ligneId);

  // ── 2. FERMETURE / RÉOUVERTURE → LIGNE PRÉSENTE ──
  console.log("\n=== 2. PERSISTANCE ===");
  const relecture = await run(() =>
    db.from("psp_lignes").select("id, programme, corps_etat, nature_travaux").eq("id", ligneId),
  );
  const relu = relecture.data?.[0];
  check("2. ligne présente après relecture", Boolean(relu?.id), relecture.msg);
  check("2. programme vide conservé", relu?.programme && Object.values(relu.programme).every((v) => Number(v) === 0));
  check("2. corps d'état vide", (relu?.corps_etat ?? null) === null);

  // ── 3. COMPLÉTION (corps + montant + nature) → ACCEPTÉE ──
  console.log("\n=== 3. COMPLÉTION DU BROUILLON ===");
  const complet = await run(() =>
    db.rpc("update_psp_operation", {
      p_id: ligneId,
      p_tranche_code: trancheA,
      p_categorie: "GT",
      p_corps_etat_code: "d",
      p_corps_etat: "(d) Espaces Ext",
      p_nature_travaux: "Réfection des espaces extérieurs",
      p_programme: { 2027: 25000, 2028: 0, 2029: 0, 2030: 0, 2031: 0 },
      p_remarques: MARQUEUR,
      p_statut: "a_definir",
      p_priorite: "normale",
      p_perimetres: [{ niveau: "rue", rue: "RUE DE PARIS", numero: null, lot_id: null }],
    }),
  );
  check("3. complétion acceptée", !complet.error, complet.msg);
  const relu2 = await run(() =>
    db.from("psp_lignes").select("corps_etat, programme, nature_travaux").eq("id", ligneId),
  );
  check("3. corps persisté", relu2.data?.[0]?.corps_etat === "(d) Espaces Ext");
  check("3. montant persisté", Number(relu2.data?.[0]?.programme?.["2027"]) === 25000);

  // ── 4. RÉFÉRENTIEL CC : AJOUT CMICHEL / LALLIANC + MODIFICATION + DÉSACTIVATION ──
  console.log("\n=== 4. RÉFÉRENTIEL CC ===");
  const ccCm = await run(() =>
    db.from("psp_charges_clientele").upsert({ sous_secteur: "90", charge_clientele: "CMICHEL", identifiant_personnel: "CMICHEL", actif: true }, { onConflict: "sous_secteur" }).select("sous_secteur"),
  );
  check("4. ajout CMICHEL (sous-secteur 90)", !ccCm.error, ccCm.msg);
  const ccLl = await run(() =>
    db.from("psp_charges_clientele").upsert({ sous_secteur: "91", charge_clientele: "LALLIANC", identifiant_personnel: "LALLIANC", actif: true }, { onConflict: "sous_secteur" }).select("sous_secteur"),
  );
  check("4. ajout LALLIANC (sous-secteur 91)", !ccLl.error, ccLl.msg);
  const ccMod = await run(() =>
    db.from("psp_charges_clientele").update({ charge_clientele: "CMICHEL", identifiant_personnel: "CMICHEL" }).eq("sous_secteur", "90").select("charge_clientele"),
  );
  check("4. modification CMICHEL", ccMod.data?.[0]?.charge_clientele === "CMICHEL", ccMod.msg);
  const ccDes = await run(() =>
    db.from("psp_charges_clientele").update({ actif: false }).eq("sous_secteur", "91").select("actif"),
  );
  check("4. désactivation LALLIANC", ccDes.data?.[0]?.actif === false, ccDes.msg);
  created.cc.push("90", "91");
  // ── 5. RÉFÉRENTIEL CORPS D'ÉTAT : AJOUT + RATTACHEMENT + DÉSACTIVATION ──
  console.log("\n=== 5. RÉFÉRENTIEL CORPS D'ÉTAT ===");
  const cE = await run(() =>
    db.from("psp_corps_etats").upsert({ code: "t9", libelle: "(t9) Test V7.6", categorie: "GT", actif: true }, { onConflict: "libelle" }).select("id, categorie"),
  );
  check("5. ajout corps (t9) Test V7.6 → GT", !cE.error && cE.data?.[0]?.categorie === "GT", cE.msg);
  const corpsId = cE.data?.[0]?.id;
  if (corpsId) created.corps.push(corpsId);
  const cEMod = await run(() =>
    db.from("psp_corps_etats").update({ categorie: "CP" }).eq("libelle", "(t9) Test V7.6").select("categorie"),
  );
  check("5. rattachement CP accepté", cEMod.data?.[0]?.categorie === "CP", cEMod.msg);
  const cEDes = await run(() =>
    db.from("psp_corps_etats").update({ actif: false }).eq("libelle", "(t9) Test V7.6").select("actif"),
  );
  check("5. désactivation acceptée", cEDes.data?.[0]?.actif === false, cEDes.msg);

  // ── PURGE TOTALE (aucune donnée métier touchée) ──
  console.log("\n=== PURGE ===");
  await db.from("psp_lignes").delete().in("id", created.lignes);
  await db.from("psp_programmations").delete().in("id", created.programmations);
  await db.from("psp_charges_clientele").delete().in("sous_secteur", created.cc);
  await db.from("psp_corps_etats").delete().in("id", created.corps);

  const residu = await run(() => db.from("psp_lignes").select("id").eq("remarques", MARQUEUR));
  check("purge : 0 ligne PSP de test résiduelle", (residu.data ?? []).length === 0);
  const residuCc = await run(() => db.from("psp_charges_clientele").select("sous_secteur").in("sous_secteur", created.cc));
  check("purge : référentiel CC nettoyé", (residuCc.data ?? []).length === 0);
  const residuCorps = await run(() => db.from("psp_corps_etats").select("id").in("id", created.corps));
  check("purge : référentiel corps nettoyé", (residuCorps.data ?? []).length === 0);

  console.log(`\nRésultat : ${PASS.length} ok, ${FAIL.length} échec(s)`);
  if (FAIL.length > 0) {
    for (const f of FAIL) console.error(`  ✘ ${f}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Échec inattendu :", e);
  process.exit(1);
});