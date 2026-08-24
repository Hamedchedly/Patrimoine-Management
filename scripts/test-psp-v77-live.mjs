// ═══════════════════════════════════════════════════════════════════════════════
// V7.7 — Test LIVE synchronisation CC (bug §5) :
//  · identifier une TR avec sous-secteur X ;
//  · vérifier CC A ;
//  · modifier le référentiel → CC B ;
//  · recharger les données → CC B affiché (enrichissement) ;
//  · restaurer la valeur d'origine (aucune donnée métier altérée).
// Exécution : node --env-file=.env scripts/test-psp-v77-live.mjs
// ═══════════════════════════════════════════════════════════════════════════════
import { createClient } from "@supabase/supabase-js";
import { construireReferencePatrimoine, enrichirOperationsAvecReference } from "../src/lib/psp.prep.data.ts";
import { creerOperation } from "../src/lib/psp.prep.ts";

const url = process.env["EXT_SUPABASE_URL"];
const key = process.env["EXT_SUPABASE_SERVICE_ROLE_KEY"];
if (!url || !key) {
  console.error("EXT_SUPABASE_URL / EXT_SUPABASE_SERVICE_ROLE_KEY manquantes — relancer avec --env-file=.env");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const PASS = [];
const FAIL = [];
function check(label, ok, detail = "") {
  if (ok) PASS.push(label);
  else FAIL.push(`${label}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  // 1. Tranche réelle avec sous-secteur.
  const { data: tranches } = await db
    .from("tranches")
    .select("code, sous_secteur")
    .eq("actif", true)
    .not("sous_secteur", "is", null)
    .limit(30);
  const tr = (tranches ?? []).find((t) => String(t.sous_secteur).trim() !== "");
  if (!tr) {
    console.error("Aucune tranche avec sous-secteur disponible.");
    process.exit(1);
  }
  const sousSecteur = String(tr.sous_secteur);

  // Snapshot de la ligne référentiel existante pour le sous-secteur.
  const { data: existante } = await db
    .from("psp_charges_clientele")
    .select("charge_clientele, identifiant_personnel, actif")
    .eq("sous_secteur", sousSecteur)
    .single();
  const ccAvant = existante?.charge_clientele ?? null;
  check(`préparatif : TR ${tr.code} → sous-secteur ${sousSecteur}`, true);
  check(`CC avant = ${ccAvant ?? "(aucun)"}`, true);

  const referentielAvant = await db.from("psp_charges_clientele").select("sous_secteur, charge_clientele, identifiant_personnel, actif");
  const refAvant = construireReferencePatrimoine(
    [{ code: tr.code, libelle: null, localite: null, sous_secteur: sousSecteur, secteur: "S11", nb_logements: null }],
    [],
    [],
    referentielAvant.data ?? [],
  );
  const ccA = refAvant.tranches.get(tr.code)?.charge_clientele ?? null;
  check(`CC A (via référentiel) = ${ccA ?? "null"}`, true);

  // 2. Modifier le référentiel → CC B.
  const ccB = "__V77_TEST_CC__";
  const { error: errB } = await db
    .from("psp_charges_clientele")
    .upsert({ sous_secteur: sousSecteur, charge_clientele: ccB, identifiant_personnel: ccB, actif: true }, { onConflict: "sous_secteur" });
  check("2. modification référentiel → CC B acceptée", !errB, errB?.message ?? "");

  // 3. Recharger les données → CC B.
  const referentielApres = await db.from("psp_charges_clientele").select("sous_secteur, charge_clientele, identifiant_personnel, actif");
  const refApres = construireReferencePatrimoine(
    [{ code: tr.code, libelle: null, localite: null, sous_secteur: sousSecteur, secteur: "S11", nb_logements: null }],
    [],
    [],
    referentielApres.data ?? [],
  );
  const ccBResolu = refApres.tranches.get(tr.code)?.charge_clientele ?? null;
  check("3. après rechargement → CC B affiché", ccBResolu === ccB, String(ccBResolu));

  // 4. Enrichissement d'une opération → le tableau affiche CC B.
  const op = creerOperation({ tranche: tr.code, categorie: "GT", charge_clientele: "", charge_operation: "", corps_etat: "(d) Espaces Ext", adresse: "", ville: "", nature_travaux: "V7.7", annee: 2027, programme: [1000, 0, 0, 0, 0] }, "op-cc-sync");
  const enrichies = enrichirOperationsAvecReference([op], refApres);
  check("4. tableau (op enrichie) → CC B", enrichies[0]?.charge_clientele === ccB, String(enrichies[0]?.charge_clientele));
  check("4. sous-secteur conservé (source)", enrichies[0]?.sous_secteur === sousSecteur, String(enrichies[0]?.sous_secteur));

  // 5. Restauration de la valeur d'origine.
  if (ccAvant != null) {
    const { error: errRestore } = await db
      .from("psp_charges_clientele")
      .update({ charge_clientele: existante.charge_clientele, identifiant_personnel: existante.identifiant_personnel, actif: existante.actif })
      .eq("sous_secteur", sousSecteur);
    check("5. restauration CC d'origine", !errRestore, errRestore?.message ?? "");
  } else {
    await db.from("psp_charges_clientele").delete().eq("sous_secteur", sousSecteur);
    check("5. ligne de test supprimée (aucune origine)", true);
  }
  const referentielFinal = await db.from("psp_charges_clientele").select("sous_secteur, charge_clientele");
  const ccFinal = referentielFinal.data?.find((r) => r.sous_secteur === sousSecteur)?.charge_clientele ?? null;
  check("6. CC final restauré", ccFinal === ccAvant, String(ccFinal));

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