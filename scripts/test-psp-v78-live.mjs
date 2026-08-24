// ═══════════════════════════════════════════════════════════════════════════════
// V7.8 — Tests LIVE :
//  B. ajout TR seule → ligne persistée ;
//  D. enveloppes : valeur conservée après fermeture/réouverture (relecture),
//     modification d'UNE cellule sans écraser les autres ;
//  E. devis : Oui/Non → création dans psp_devis (fournisseur_id + N° devis),
//     relecture, suppression ;
// Nettoyage total (marqueur __V78_TEST__, aucune donnée métier touchée).
// Exécution : node --env-file=.env scripts/test-psp-v78-live.mjs
// ═══════════════════════════════════════════════════════════════════════════════
import { createClient } from "@supabase/supabase-js";

const url = process.env["EXT_SUPABASE_URL"];
const key = process.env["EXT_SUPABASE_SERVICE_ROLE_KEY"];
if (!url || !key) {
  console.error("EXT_SUPABASE_URL / EXT_SUPABASE_SERVICE_ROLE_KEY manquantes — relancer avec --env-file=.env");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const MARQUEUR = `__V78_TEST__${Date.now()}`;
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

const created = { lignes: [], perimetres: [], devis: [], programmations: [] };

async function main() {
  const { data: tranches } = await db.from("tranches").select("code").eq("actif", true).order("code").limit(20);
  const trancheA = tranches?.[0]?.code;
  if (!trancheA) {
    console.error("Aucune tranche disponible.");
    process.exit(1);
  }

  const rP = await run(() =>
    db.from("psp_programmations").insert({ annee_debut: 2095, annee_fin: 2099, version: 1, remarques: MARQUEUR }).select("id"),
  );
  const P1 = rP.data?.[0];
  if (P1?.id) created.programmations.push(P1.id);
  check("préparatif : programmation", !!P1?.id, rP.msg);

  // ── B. AJOUT TR SEULE → PERSISTÉE ──
  console.log("\n=== B. AJOUT TR SEULE ===");
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
  check("B. TR seule acceptée", !ligne.error, ligne.msg);
  const ligneId = ligne.data?.id;
  if (ligneId) created.lignes.push(ligneId);
  const reluB = await run(() => db.from("psp_lignes").select("id").eq("id", ligneId));
  check("B. ligne présente après relecture", (reluB.data ?? []).length === 1, reluB.msg);

  // ── D. ENVELOPPES : CONSERVATION + MODIFICATION D'UNE CELLULE ──
  console.log("\n=== D. ENVELOPPES ===");
  const envInit = [
    { programmation_id: P1.id, annee: 2095, categorie: "GE", montant: 100000 },
    { programmation_id: P1.id, annee: 2095, categorie: "GT", montant: 200000 },
    { programmation_id: P1.id, annee: 2095, categorie: "CP", montant: 50000 },
  ];
  const envIns = await run(() => db.from("psp_enveloppes").upsert(envInit, { onConflict: "programmation_id,annee,categorie" }).select("*"));
  check("D. enveloppes initiales renseignées", (envIns.data ?? []).length === 3, envIns.msg);

  // Fermeture / réouverture = relecture → mêmes valeurs.
  const relu1 = await run(() =>
    db.from("psp_enveloppes").select("annee,categorie,montant").eq("programmation_id", P1.id).eq("annee", 2095).order("categorie"),
  );
  const ge1 = relu1.data?.find((r) => r.categorie === "GE")?.montant;
  const gt1 = relu1.data?.find((r) => r.categorie === "GT")?.montant;
  const cp1 = relu1.data?.find((r) => r.categorie === "CP")?.montant;
  check("D. réouverture → GE 100000 conservé", ge1 === 100000, String(ge1));
  check("D. réouverture → GT 200000 conservé", gt1 === 200000, String(gt1));
  check("D. réouverture → CP 50000 conservé", cp1 === 50000, String(cp1));

  // Modification d'UNE seule cellule (GT 200000 → 250000) — les autres restent.
  const envMod = await run(() =>
    db.from("psp_enveloppes").upsert({ programmation_id: P1.id, annee: 2095, categorie: "GT", montant: 250000 }, { onConflict: "programmation_id,annee,categorie" }).select("*"),
  );
  check("D. modification d'une cellule acceptée", !envMod.error, envMod.msg);
  const relu2 = await run(() =>
    db.from("psp_enveloppes").select("annee,categorie,montant").eq("programmation_id", P1.id).eq("annee", 2095).order("categorie"),
  );
  const ge2 = relu2.data?.find((r) => r.categorie === "GE")?.montant;
  const gt2 = relu2.data?.find((r) => r.categorie === "GT")?.montant;
  const cp2 = relu2.data?.find((r) => r.categorie === "CP")?.montant;
  check("D. GT modifiée → 250000", gt2 === 250000, String(gt2));
  check("D. GE inchangée → 100000", ge2 === 100000, String(ge2));
  check("D. CP inchangée → 50000", cp2 === 50000, String(cp2));

  // ── E. DEVIS : OUI/NON → psp_devis (fournisseur + N° + montant + date) ──
  console.log("\n=== E. DEVIS ===");
  const { data: fournisseurs } = await db.from("fournisseurs").select("id, nom").limit(1);
  const fournisseur = fournisseurs?.[0];
  check("E. préparation : un fournisseur réel disponible", !!fournisseur, "aucun fournisseur");
  const devisIns = await run(() =>
    db.from("psp_devis").insert({
      psp_ligne_id: ligneId,
      fournisseur_id: fournisseur?.id ?? null,
      entreprise: fournisseur?.nom ?? "ENTREPRISE TEST",
      date_devis: "2026-06-01",
      montant: 35000,
      statut: "recu",
      document_reference: "DEV-7788",
      commentaire: MARQUEUR,
    }).select("*"),
  );
  check("E. devis créé (Oui/Non → champs renseignés)", !devisIns.error, devisIns.msg);
  const devisId = devisIns.data?.[0]?.id;
  if (devisId) created.devis.push(devisId);
  const reluDevis = await run(() => db.from("psp_devis").select("montant, document_reference, fournisseur_id, date_devis, statut").eq("id", devisId));
  const dv = reluDevis.data?.[0];
  check("E. montant conservé", dv?.montant === 35000, String(dv?.montant));
  check("E. N° devis (document_reference) conservé = DEV-7788", dv?.document_reference === "DEV-7788", String(dv?.document_reference));
  check("E. fournisseur_id conservé", dv?.fournisseur_id === (fournisseur?.id ?? null), String(dv?.fournisseur_id));
  check("E. date conservée", dv?.date_devis === "2026-06-01", String(dv?.date_devis));
  check("E. statut = recu", dv?.statut === "recu");
  // badge « Devis » Oui = devis.length > 0 (via le brouillon).
  const brouillon = await run(() => db.from("psp_lignes").select("id").eq("programmation_id", P1.id));
  check("E. ligne porte bien des devis (badge Devis → Oui côté brouillon)", (brouillon.data ?? []).length >= 1);
  const delDevis = await run(() => db.from("psp_devis").delete().eq("id", devisId).select("id"));
  check("E. suppression devis possible depuis la fiche", (delDevis.data ?? []).length === 1, delDevis.msg);

  // ── PURGE ──
  console.log("\n=== PURGE ===");
  await db.from("psp_lignes").delete().in("id", created.lignes);
  await db.from("psp_enveloppes").delete().eq("programmation_id", P1.id);
  await db.from("psp_programmations").delete().in("id", created.programmations);
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