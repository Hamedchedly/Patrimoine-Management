// ═══════════════════════════════════════════════════════════════════════════════
// V7.9 — Tests LIVE :
//  A. enveloppes réelles lues (psp_enveloppes) → valeurs présentes (aucun 0), persistance,
//     modification d'une cellule sans écraser les autres ;
//  B. devis : création (psp_devis) → relecture → modification → relecture → suppression ;
//  C. CC : ID CC en MAJUSCULES dans le référentiel réel + insert de test nettoyé.
// Exécution : node --env-file=.env scripts/test-psp-v79-live.mjs
// ═══════════════════════════════════════════════════════════════════════════════
import { createClient } from "@supabase/supabase-js";

const url = process.env["EXT_SUPABASE_URL"];
const key = process.env["EXT_SUPABASE_SERVICE_ROLE_KEY"];
if (!url || !key) {
  console.error("EXT_SUPABASE_URL / EXT_SUPABASE_SERVICE_ROLE_KEY manquantes — relancer avec --env-file=.env");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const MARQUEUR = `__V79_TEST__${Date.now()}`;
const PASS = [];
const FAIL = [];
function check(label, ok, detail = "") {
  if (ok) PASS.push(label);
  else FAIL.push(`${label}${detail ? ` — ${detail}` : ""}`);
}
async function run(fn) {
  try {
    const { data, error } = await fn();
    return { data, error, msg: error?.message ?? "" };
  } catch (e) {
    return { data: null, error: e, msg: String(e?.message ?? e) };
  }
}

async function main() {
  const created = { lignes: [], devis: [], programmations: [], cc: [] };

  // ── A. ENVELOPPES RÉELLES (programmation officielle chargée) ──
  console.log("\n=== A. ENVELOPPES ===");
  const { data: prog } = await db
    .from("psp_programmations")
    .select("id")
    .eq("type", "officielle")
    .eq("statut", "brouillon")
    .order("version", { ascending: false })
    .limit(1);
  const progId = prog?.[0]?.id;
  check("A. programmation officielle brouillon présente", !!progId);
  const envReelles = await run(() =>
    db.from("psp_enveloppes").select("annee,categorie,montant").eq("programmation_id", progId).order("annee").order("categorie"),
  );
  check("A. enveloppes réelles lues (≥ 1)", (envReelles.data ?? []).length >= 1, envReelles.msg);
  const ge2027 = envReelles.data?.find((r) => r.annee === 2027 && r.categorie === "GE")?.montant;
  check("A. aucune enveloppe existante transformée en 0", ge2027 !== 0 && ge2027 !== undefined, `GE 2027 = ${String(ge2027)}`);

  // Test d'écrasement sur une programmation TEMPORAIRE.
  const rP = await run(() =>
    db.from("psp_programmations").insert({ annee_debut: 2095, annee_fin: 2099, version: 1, remarques: MARQUEUR }).select("id"),
  );
  const P1 = rP.data?.[0];
  if (P1?.id) created.programmations.push(P1.id);
  const envIns = await run(() =>
    db.from("psp_enveloppes").upsert([
      { programmation_id: P1.id, annee: 2095, categorie: "GE", montant: 100000 },
      { programmation_id: P1.id, annee: 2095, categorie: "GT", montant: 200000 },
      { programmation_id: P1.id, annee: 2095, categorie: "CP", montant: 50000 },
    ], { onConflict: "programmation_id,annee,categorie" }),
  );
  check("A. enveloppes temporaires renseignées", !envIns.error, envIns.msg);
  const relu1 = await run(() => db.from("psp_enveloppes").select("categorie,montant").eq("programmation_id", P1.id).eq("annee", 2095));
  check("A. réouverture → GE 100000 / GT 200000 / CP 50000", relu1.data?.length === 3 && relu1.data?.find((r) => r.categorie === "GT")?.montant === 200000, relu1.msg);
  const mod = await run(() =>
    db.from("psp_enveloppes").upsert({ programmation_id: P1.id, annee: 2095, categorie: "GT", montant: 250000 }, { onConflict: "programmation_id,annee,categorie" }),
  );
  check("A. modification d'une cellule (GT → 250000)", !mod.error, mod.msg);
  const relu2 = await run(() => db.from("psp_enveloppes").select("categorie,montant").eq("programmation_id", P1.id).eq("annee", 2095));
  check("A. GT = 250000 après modification", relu2.data?.find((r) => r.categorie === "GT")?.montant === 250000);
  check("A. GE inchangée (100000)", relu2.data?.find((r) => r.categorie === "GE")?.montant === 100000);
  check("A. CP inchangée (50000)", relu2.data?.find((r) => r.categorie === "CP")?.montant === 50000);

  // ── B. DEVIS : CRÉATION → RELECTURE → MODIFICATION → SUPPRESSION ──
  console.log("\n=== B. DEVIS ===");
  const { data: tranches } = await db.from("tranches").select("code").eq("actif", true).order("code").limit(10);
  const trancheA = tranches?.[0]?.code;
  const ligne = await run(() =>
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
  const ligneId = ligne.data?.id;
  if (ligneId) created.lignes.push(ligneId);
  check("B. ligne créée", !!ligneId, ligne.msg);
  const { data: fournisseurs } = await db.from("fournisseurs").select("id, nom").limit(1);
  const fournisseur = fournisseurs?.[0];
  const devisIns = await run(() =>
    db.from("psp_devis").insert({
      psp_ligne_id: ligneId,
      fournisseur_id: fournisseur?.id ?? null,
      entreprise: fournisseur?.nom ?? "ENTREPRISE V79",
      date_devis: "2026-07-01",
      montant: 40000,
      statut: "recu",
      document_reference: "DEV-7901",
      commentaire: MARQUEUR,
    }).select("id, montant, document_reference, fournisseur_id"),
  );
  const devisId = devisIns.data?.[0]?.id;
  if (devisId) created.devis.push(devisId);
  check("B. devis créé (psp_devis)", !devisIns.error && !!devisId, devisIns.msg);
  check("B. N° devis conservé", devisIns.data?.[0]?.document_reference === "DEV-7901");
  const modDevis = await run(() =>
    db.from("psp_devis").update({ montant: 45000, document_reference: "DEV-7902" }).eq("id", devisId).select("montant, document_reference"),
  );
  check("B. devis modifié (updatePspDevis)", modDevis.data?.[0]?.montant === 45000 && modDevis.data?.[0]?.document_reference === "DEV-7902", modDevis.msg);
  const reluDevis = await run(() => db.from("psp_devis").select("montant, document_reference").eq("id", devisId));
  check("B. relecture après modification (45000 / DEV-7902)", reluDevis.data?.[0]?.montant === 45000 && reluDevis.data?.[0]?.document_reference === "DEV-7902");
  const delDevis = await run(() => db.from("psp_devis").delete().eq("id", devisId).select("id"));
  check("B. suppression devis", (delDevis.data ?? []).length === 1, delDevis.msg);

  // ── C. CC : ID MAJUSCULES ──
  console.log("\n=== C. CC ===");
  const ccReel = await run(() => db.from("psp_charges_clientele").select("sous_secteur, identifiant_personnel"));
  const ids = (ccReel.data ?? []).map((r) => r.identifiant_personnel).filter((v) => v != null);
  check("C. tous les ID CC stockés en MAJUSCULES", ids.length > 0 && ids.every((id) => id === String(id).toUpperCase()), ids.join(","));
  const ccIns = await run(() =>
    db.from("psp_charges_clientele").upsert({ sous_secteur: "98", charge_clientele: "CMICHEL", identifiant_personnel: "cmichel", actif: true }, { onConflict: "sous_secteur" }).select("identifiant_personnel"),
  );
  created.cc.push("98");
  // Note : la normalisation uppercase est appliquée par savePspChargeClientele (serveur) —
  // vérifiée par le test pur. Ici on vérifie la cohérence lecture du modèle (2 colonnes).
  check("C. ligne de test créée (nettoyée ensuite)", !ccIns.error, ccIns.msg);

  // ── PURGE ──
  console.log("\n=== PURGE ===");
  await db.from("psp_lignes").delete().in("id", created.lignes);
  await db.from("psp_enveloppes").delete().eq("programmation_id", P1.id);
  await db.from("psp_programmations").delete().in("id", created.programmations);
  await db.from("psp_charges_clientele").delete().in("sous_secteur", created.cc);
  const residu = await run(() => db.from("psp_lignes").select("id").eq("remarques", MARQUEUR));
  check("purge : aucune ligne de test résiduelle", (residu.data ?? []).length === 0);

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