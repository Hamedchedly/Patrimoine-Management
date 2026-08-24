// ═══════════════════════════════════════════════════════════════════════════════
// V7 — Tests live du Préparateur PSP (périmètre patrimoine + enveloppes +
// statut/priorité) APRÈS 20260817_psp_ligne_patrimoine_enveloppes.sql.
//
// Règles :
//   · aucune donnée métier touchée ; toute écriture porte le marqueur __V7_TEST__
//     et est purgée à la fin ;
//   · les tests de cohérence (lot d'une autre tranche, période enveloppe, gel)
//     vérifient que les triggers REJETTENT bien les mutations interdites ;
//   · à la fin : aucune donnée __V7_TEST__ restante, zéro orphelin.
//
// Exécution : node --env-file=.env scripts/test-psp-v7-live.mjs
// ═══════════════════════════════════════════════════════════════════════════════
import { createClient } from "@supabase/supabase-js";

const url = process.env["EXT_SUPABASE_URL"];
const key = process.env["EXT_SUPABASE_SERVICE_ROLE_KEY"];
if (!url || !key) {
  console.error("EXT_SUPABASE_URL / EXT_SUPABASE_SERVICE_ROLE_KEY manquantes — relancer avec --env-file=.env");
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const MARQUEUR = `__V7_TEST__${Date.now()}`;
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
const rows = (r) => r.data ?? [];

async function main() {
  // ── Préparatifs : tranches + lots réels (lecture seule) ──
  const { data: tranches } = await db.from("tranches").select("code").eq("actif", true).order("code").limit(3);
  const { data: lots } = await db.from("lots").select("id, tranche_code, code_patrimoine").eq("actif", true).order("code_patrimoine").limit(60);
  if ((tranches ?? []).length < 1 || (lots ?? []).length < 2) {
    console.error("Données patrimoniales insuffisantes pour le test V7 (besoin de 1 tranche + 2 lots).");
    process.exit(1);
  }
  const trancheA = tranches[0].code;
  const lotsA = lots.filter((l) => l.tranche_code === trancheA);
  let trancheB = null;
  let lotB = null;
  for (const l of lots) {
    if (l.tranche_code !== trancheA) {
      trancheB = l.tranche_code;
      lotB = l;
      break;
    }
  }
  if (lotsA.length < 2) {
    console.error(`La tranche ${trancheA} n'a pas 2 lots — choisir une autre tranche manuellement.`);
    process.exit(1);
  }
  const lotA1 = lotsA[0];
  const lotA2 = lotsA[1];

  // ── A. Schéma (ré-assertion V7) ──
  const { data: perCols, error: perErr } = await db.from("psp_ligne_patrimoine").select("*").limit(1);
  check("A1. psp_ligne_patrimoine lisible", !perErr, perErr?.message ?? "");
  const { data: envCols, error: envErr } = await db.from("psp_enveloppes").select("*").limit(1);
  check("A2. psp_enveloppes lisible", !envErr, envErr?.message ?? "");
  const { data: ligneCols, error: ligneErr } = await db.from("psp_lignes").select("id, statut, priorite").limit(1);
  check("A3. psp_lignes.statut/priorite accessibles", !ligneErr && Array.isArray(ligneCols), ligneErr?.message ?? "");

  // ── B. Création d'un brouillon de test (marqueur) ──
  const prog = await run(() =>
    db.from("psp_programmations").insert({
      annee_debut: 2027,
      annee_fin: 2031,
      version: 90,
      type: "officielle",
      statut: "brouillon",
      remarques: MARQUEUR,
    }).select("id").single(),
  );
  check("B1. création programmation test", !!prog.data, prog.msg);
  if (!prog.data) {
    console.error("Abandon : programmation de test non créée.");
    console.error(prog.msg);
    process.exit(1);
  }
  const pid = prog.data.id;
  const ligne = await run(() =>
    db.from("psp_lignes").insert({
      programmation_id: pid,
      tranche_code: trancheA,
      categorie: "GT",
      programme: { "2027": 100000 },
      origine: "preparation",
      remarques: MARQUEUR,
    }).select("id, tranche_code").single(),
  );
  check("B2. création ligne test", !!ligne.data, ligne.msg);
  const lid = ligne.data?.id;

  // ── C. Péri-mètre patrimonial ──
  const perTranche = await run(() =>
    db.from("psp_ligne_patrimoine").insert({ psp_ligne_id: lid, tranche_code: trancheA, niveau: "tranche" }).select("id").single(),
  );
  check("C1. périmètre niveau=tranche", !!perTranche.data, perTranche.msg);

  const delPer = await run(() => db.from("psp_ligne_patrimoine").delete().eq("psp_ligne_id", lid));
  check("C2. remplacement (delete) périmètre", !delPer.error, delPer.msg);
  const multi = await run(() =>
    db.from("psp_ligne_patrimoine").insert([
      { psp_ligne_id: lid, tranche_code: trancheA, niveau: "lot", lot_id: lotA1.id },
      { psp_ligne_id: lid, tranche_code: trancheA, niveau: "lot", lot_id: lotA2.id },
    ]).select("id, lot_id"),
  );
  check("C3. multi-lots même tranche", !multi.error && (multi.data ?? []).length === 2, multi.msg);

  const incoherent = await run(() =>
    db.from("psp_ligne_patrimoine").insert({ psp_ligne_id: lid, tranche_code: trancheB, niveau: "lot", lot_id: lotA1.id }),
  );
  check("C4. lot d'une autre tranche REJETÉ", !!incoherent.error, incoherent.msg);

  const ligneAutre = trancheB
    ? await run(() =>
        db.from("psp_lignes").insert({
          programmation_id: pid,
          tranche_code: trancheB,
          categorie: "GE",
          programme: { "2027": 50000 },
          origine: "preparation",
          remarques: MARQUEUR,
        }).select("id").single(),
      )
    : null;
  const incoherentLigne = await run(() =>
    db.from("psp_ligne_patrimoine").insert({
      psp_ligne_id: ligneAutre?.data?.id ?? lid,
      tranche_code: trancheA,
      niveau: "tranche",
    }),
  );
  check("C5. tranche ≠ ligne REJETÉE", !!incoherentLigne.error, incoherentLigne.msg);

  const sansLot = await run(() =>
    db.from("psp_ligne_patrimoine").insert({ psp_ligne_id: lid, tranche_code: trancheA, niveau: "lot" }),
  );
  check("C6. lot sans lot_id REJETÉ (CHECK)", !!sansLot.error, sansLot.msg);

  // ── D. Enveloppes ──
  const env = await run(() =>
    db.from("psp_enveloppes").insert({ programmation_id: pid, annee: 2027, categorie: "GE", montant: 500000 }).select("id").single(),
  );
  check("D1. enveloppe (2027, GE)", !!env.data, env.msg);

  const envDup = await run(() =>
    db.from("psp_enveloppes").insert({ programmation_id: pid, annee: 2027, categorie: "GE", montant: 1 }),
  );
  check("D2. doublon (2027, GE) REJETÉ (UNIQUE)", !!envDup.error, envDup.msg);

  const envUp = await run(() =>
    db.from("psp_enveloppes").upsert(
      { programmation_id: pid, annee: 2027, categorie: "GE", montant: 600000 },
      { onConflict: "programmation_id,annee,categorie" },
    ).select("montant").single(),
  );
  check("D3. upsert (2027, GE) = 600000", Number(envUp.data?.montant ?? 0) === 600000, envUp.msg);

  const envHorsPeriode = await run(() =>
    db.from("psp_enveloppes").insert({ programmation_id: pid, annee: 2032, categorie: "GT", montant: 1000 }),
  );
  check("D4. annee 2032 hors période REJETÉE (trigger)", !!envHorsPeriode.error, envHorsPeriode.msg);

  const envNeg = await run(() =>
    db.from("psp_enveloppes").insert({ programmation_id: pid, annee: 2028, categorie: "GT", montant: -5 }),
  );
  check("D5. montant négatif REJETÉ (CHECK)", !!envNeg.error, envNeg.msg);

  const envCat = await run(() =>
    db.from("psp_enveloppes").insert({ programmation_id: pid, annee: 2028, categorie: "XX", montant: 5 }),
  );
  check("D6. catégorie invalide REJETÉE (CHECK)", !!envCat.error, envCat.msg);

  // ── E. Statut / priorité ──
  const sp = await run(() =>
    db.from("psp_lignes").update({ statut: "attente_agence", priorite: "prioritaire" }).eq("id", lid).select("statut, priorite").single(),
  );
  check("E1. statut/priorité mis à jour", sp.data?.statut === "attente_agence" && sp.data?.priorite === "prioritaire", sp.msg);

  const spBad = await run(() => db.from("psp_lignes").update({ statut: "bogus" }).eq("id", lid));
  check("E2. statut invalide REJETÉ (CHECK)", !!spBad.error, spBad.msg);

  const spBadP = await run(() => db.from("psp_lignes").update({ priorite: "urgent" }).eq("id", lid));
  check("E3. priorité invalide REJETÉE (CHECK)", !!spBadP.error, spBadP.msg);
  // ── F. GEL (programmation figée) ──
  await db.from("psp_programmations").update({ statut: "figee" }).eq("id", pid);
  const gelPer = await run(() =>
    db.from("psp_ligne_patrimoine").insert({ psp_ligne_id: lid, tranche_code: trancheA, niveau: "rue", rue: "RUE TEST" }),
  );
  check("F1. INSERT périmètre sur figée REJETÉ (gel)", !!gelPer.error, gelPer.msg);
  const gelDel = await run(() => db.from("psp_ligne_patrimoine").delete().eq("psp_ligne_id", lid));
  check("F2. DELETE périmètre sur figée REJETÉ (gel)", !!gelDel.error, gelDel.msg);
  const gelEnv = await run(() =>
    db.from("psp_enveloppes").insert({ programmation_id: pid, annee: 2029, categorie: "CP", montant: 1000 }),
  );
  check("F3. INSERT enveloppe sur figée REJETÉ (gel)", !!gelEnv.error, gelEnv.msg);
  const gelSp = await run(() => db.from("psp_lignes").update({ statut: "a_definir" }).eq("id", lid));
  check("F4. UPDATE ligne sur figée REJETÉ (gel)", !!gelSp.error, gelSp.msg);
  await db.from("psp_programmations").update({ statut: "brouillon" }).eq("id", pid);
  const degel = await run(() =>
    db.from("psp_ligne_patrimoine").insert({ psp_ligne_id: lid, tranche_code: trancheA, niveau: "rue", rue: "RUE TEST" }),
  );
  check("F5. dégel → INSERT périmètre OK", !degel.error, degel.msg);

  // ── G. Cascade ──
  const { error: delLigne } = await db.from("psp_lignes").delete().eq("id", lid);
  const restPer = rows(await db.from("psp_ligne_patrimoine").select("id").eq("psp_ligne_id", lid));
  check("G1. delete ligne → cascade périmètre", !delLigne && restPer.length === 0, `restants=${restPer.length}`);

  // ── H. Nettoyage ──
  await db.from("psp_programmations").update({ statut: "brouillon" }).eq("id", pid);
  await db.from("psp_programmations").delete().eq("id", pid);
  const restProg = rows(await db.from("psp_programmations").select("id").ilike("remarques", `%${MARQUEUR}%`));
  const restLignes = rows(await db.from("psp_lignes").select("id").ilike("remarques", `%${MARQUEUR}%`));
  const { data: lignesRestantes } = await db.from("psp_lignes").select("programmation_id");
  const { data: progsExistantes } = await db.from("psp_programmations").select("id");
  const idsProgs = new Set((progsExistantes ?? []).map((p) => p.id));
  const orphelines = (lignesRestantes ?? []).filter((l) => !idsProgs.has(l.programmation_id));
  check("H1. aucune programmation de test restante", restProg.length === 0);
  check("H2. aucune ligne de test restante", restLignes.length === 0);
  check("H3. ZÉRO ligne PSP orpheline", orphelines.length === 0);

  // ── Bilan ──
  console.log("\n=== BILAN V7 LIVE ===");
  console.log(`  PASS : ${PASS.length}`);
  console.log(`  FAIL : ${FAIL.length}`);
  if (FAIL.length > 0) {
    console.log("\nÉCHECS :");
    for (const f of FAIL) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log("\nTous les tests live V7 passent — données de test nettoyées.");
}

main().catch((e) => {
  console.error("Erreur fatale du test V7 :", e);
  process.exit(1);
});