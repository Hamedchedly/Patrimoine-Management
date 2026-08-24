// ═══════════════════════════════════════════════════════════════════════════════
// V7.10 — Tests LIVE :
//  C. enveloppes persistantes après fermeture/réouverture (relecture) ;
//  D. modification d'une enveloppe ne remet pas les autres à 0 ;
//  J. date de DEMANDE persistée (psp_devis.created_at) ;
//  L. fournisseur persisté (fournisseur_id) ; M. N° devis persisté.
// Exécution : node --env-file=.env scripts/test-psp-v710-live.mjs
// ═══════════════════════════════════════════════════════════════════════════════
import { createClient } from "@supabase/supabase-js";

const url = process.env["EXT_SUPABASE_URL"];
const key = process.env["EXT_SUPABASE_SERVICE_ROLE_KEY"];
if (!url || !key) {
  console.error("EXT_SUPABASE_URL / EXT_SUPABASE_SERVICE_ROLE_KEY manquantes — relancer avec --env-file=.env");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const MARQUEUR = `__V710_TEST__${Date.now()}`;
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
  const created = { lignes: [], devis: [], programmations: [] };

  // Préparatifs.
  const { data: tranches } = await db.from("tranches").select("code").eq("actif", true).order("code").limit(10);
  const trancheA = tranches?.[0]?.code;
  const rP = await run(() =>
    db.from("psp_programmations").insert({ annee_debut: 2095, annee_fin: 2099, version: 1, remarques: MARQUEUR }).select("id"),
  );
  const P1 = rP.data?.[0];
  if (P1?.id) created.programmations.push(P1.id);
  check("préparatif : programmation", !!P1?.id, rP.msg);

  // ── C/D. ENVELOPPES : PERSISTANCE + MODIFICATION D'UNE CELLULE ──
  console.log("\n=== C/D. ENVELOPPES ===");
  const envInit = [
    { programmation_id: P1.id, annee: 2095, categorie: "GE", montant: 150000 },
    { programmation_id: P1.id, annee: 2095, categorie: "GT", montant: 200000 },
    { programmation_id: P1.id, annee: 2095, categorie: "CP", montant: 90000 },
  ];
  const ins = await run(() => db.from("psp_enveloppes").upsert(envInit, { onConflict: "programmation_id,annee,categorie" }));
  check("C. enveloppes renseignées", !ins.error, ins.msg);
  // « fermeture/réouverture » = relecture depuis Supabase.
  const relu1 = await run(() => db.from("psp_enveloppes").select("categorie,montant").eq("programmation_id", P1.id).eq("annee", 2095));
  check("C. réouverture → GE 150000 / GT 200000 / CP 90000", relu1.data?.length === 3 && relu1.data?.find((r) => r.categorie === "GT")?.montant === 200000, relu1.msg);
  const mod = await run(() =>
    db.from("psp_enveloppes").upsert({ programmation_id: P1.id, annee: 2095, categorie: "GT", montant: 250000 }, { onConflict: "programmation_id,annee,categorie" }),
  );
  check("D. modification GT → 250000", !mod.error, mod.msg);
  const relu2 = await run(() => db.from("psp_enveloppes").select("categorie,montant").eq("programmation_id", P1.id).eq("annee", 2095));
  check("D. GT = 250000", relu2.data?.find((r) => r.categorie === "GT")?.montant === 250000);
  check("D. GE inchangée 150000 (pas remise à 0)", relu2.data?.find((r) => r.categorie === "GE")?.montant === 150000);
  check("D. CP inchangée 90000 (pas remise à 0)", relu2.data?.find((r) => r.categorie === "CP")?.montant === 90000);

  // ── J/L/M. DEVIS : DATES, FOURNISSEUR, N° ──
  console.log("\n=== J/L/M. DEVIS ===");
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
  check("J. ligne créée", !!ligneId, ligne.msg);
  const { data: fournisseurs } = await db.from("fournisseurs").select("id, nom").limit(1);
  const fournisseur = fournisseurs?.[0];
  const devisIns = await run(() =>
    db.from("psp_devis").insert({
      psp_ligne_id: ligneId,
      fournisseur_id: fournisseur?.id ?? null,
      entreprise: fournisseur?.nom ?? "ENTREPRISE V710",
      montant: null,
      statut: "demande_envoyee",
      document_reference: null,
      commentaire: MARQUEUR,
    }).select("id, created_at, montant, fournisseur_id, document_reference, statut"),
  );
  const devisId = devisIns.data?.[0]?.id;
  if (devisId) created.devis.push(devisId);
  check("J. demande de devis créée SANS montant (montant null)", devisIns.data?.[0]?.montant === null, devisIns.msg);
  check("J. date de DEMANDE persistée (created_at non null)", !!devisIns.data?.[0]?.created_at);
  check("J. statut = demande_envoyee (demande ≠ devis reçu)", devisIns.data?.[0]?.statut === "demande_envoyee");
  check("L. fournisseur_id persisté", devisIns.data?.[0]?.fournisseur_id === (fournisseur?.id ?? null), String(devisIns.data?.[0]?.fournisseur_id));
  check("M. N° devis null (aucun devis reçu)", devisIns.data?.[0]?.document_reference === null);
  // Relu : la demande reste sans montant.
  const reluDevis = await run(() => db.from("psp_devis").select("montant, created_at, fournisseur_id").eq("id", devisId));
  check("J. relecture : montant toujours null, date demande conservée", reluDevis.data?.[0]?.montant === null && !!reluDevis.data?.[0]?.created_at);

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