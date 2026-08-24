// ═══════════════════════════════════════════════════════════════════════════════
// V8.1 — SOCLE SUIVI : tests LIVE Supabase (données réelles, aucune écriture
// hormis la purge de données de test marquées __V81__).
//  - lecture agrégée d'une opération (mêmes requêtes que getPspSuiviOperation) ;
//  - CC dérivé de tranches.sous_secteur → psp_charges_clientele ;
//  - aucune copie de commande dans psp_lignes (schéma) ;
//  - aucun MOCK ;
//  - recommandation d'entreprises = données réelles uniquement.
// Exécution : node --env-file=.env scripts/test-psp-v81-live.mjs
// ═══════════════════════════════════════════════════════════════════════════════
import { createClient } from "@supabase/supabase-js";
import {
  construireSuiviOperation,
  recommanderEntreprises,
} from "../src/lib/psp.suivi.foundation.ts";

const url = process.env["EXT_SUPABASE_URL"];
const key = process.env["EXT_SUPABASE_SERVICE_ROLE_KEY"];
if (!url || !key) {
  console.error(
    "EXT_SUPABASE_URL / EXT_SUPABASE_SERVICE_ROLE_KEY manquantes — relancer avec --env-file=.env",
  );
  process.exit(1);
}
const db = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

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
async function run(fn) {
  try {
    const { data, error } = await fn();
    return { data, error, msg: error?.message ?? "" };
  } catch (e) {
    return { data: null, error: e, msg: String(e?.message ?? e) };
  }
}

async function main() {
  const MARQUEUR = `__V81_TEST__${Date.now()}`;
  const created = { programmations: [], lignes: [], devis: [] };

  // ── Préparatifs : programmation de test + ligne + demande de devis sans montant.
  const rP = await run(() =>
    db
      .from("psp_programmations")
      .insert({
        annee_debut: 2090,
        annee_fin: 2094,
        version: 1,
        remarques: MARQUEUR,
      })
      .select("id"),
  );
  const pid = rP.data?.[0]?.id;
  if (pid) created.programmations.push(pid);
  check("programmation de test créée", !!pid, rP.msg);

  const { data: tranche } = await db
    .from("tranches")
    .select("code, libelle, localite, sous_secteur")
    .eq("actif", true)
    .limit(1)
    .maybeSingle();
  check("une tranche réelle trouvée", !!tranche?.code);

  const rL = await run(() =>
    db.rpc("create_psp_operation", {
      p_programmation_id: pid,
      p_tranche_code: tranche.code,
      p_categorie: "GT",
      p_corps_etat_code: null,
      p_corps_etat: "Couverture",
      p_nature_travaux: "Test socle V8.1",
      p_programme: { 2090: 50000 },
      p_ligne_budget: null,
      p_remarques: MARQUEUR,
      p_statut: "a_definir",
      p_priorite: "normale",
      p_origine: "preparation",
      p_perimetres: [{ niveau: "tranche", rue: null, numero: null, lot_id: null }],
      p_devis: null,
    }),
  );
  const ligneId = rL.data?.id;
  if (ligneId) created.lignes.push(ligneId);
  check("ligne créée (identité = id)", !!ligneId, rL.msg);

  const rD = await run(() =>
    db
      .from("psp_devis")
      .insert({
        psp_ligne_id: ligneId,
        fournisseur_id: null,
        entreprise: "ENTREPRISE TEST V81",
        montant: null,
        statut: "demande_envoyee",
        document_reference: null,
        commentaire: MARQUEUR,
      })
      .select("id, created_at, montant, statut"),
  );
  if (rD.data?.[0]?.id) created.devis.push(rD.data[0].id);
  check("demande de devis sans montant créée", rD.data?.[0]?.montant === null, rD.msg);

  // ── Lecture agrégée (mêmes requêtes que getPspSuiviOperation).
  const ligne = (
    await db.from("psp_lignes").select("*").eq("id", ligneId).single()
  ).data;
  const perimetres =
    (await db.from("psp_ligne_patrimoine").select("*").eq("psp_ligne_id", ligneId)).data ?? [];
  const devis = (await db.from("psp_devis").select("*").eq("psp_ligne_id", ligneId)).data ?? [];
  const liens =
    (await db.from("psp_command_links").select("*").eq("psp_ligne_id", ligneId)).data ?? [];
  const decisions =
    (await db.from("psp_decisions").select("*").eq("psp_ligne_id", ligneId)).data ?? [];
  const prog = (
    await db.from("psp_programmations").select("statut").eq("id", pid).single()
  ).data;

  // CC : tranches.sous_secteur → psp_charges_clientele (règle §1A).
  let cc = null;
  let adresse = null;
  if (tranche?.sous_secteur) {
    const ccRow = (
      await db
        .from("psp_charges_clientele")
        .select("identifiant_personnel")
        .eq("sous_secteur", tranche.sous_secteur)
        .eq("actif", true)
        .maybeSingle()
    ).data;
    cc = ccRow?.identifiant_personnel ?? null;
    adresse = [tranche.libelle, tranche.localite].filter(Boolean).join(" – ") || null;
  }

  const vue = construireSuiviOperation({
    ligne,
    perimetres,
    devis,
    liens,
    commandes: [],
    decisions,
    patrimoine: { adresse, cc },
    programmationStatut: prog?.statut ?? null,
  });

  check("identité = psp_lignes.id", vue.identite.id === ligneId);
  check(
    "source réelle (aucun MOCK)",
    vue.source.donnees_reelles === true && vue.source.mock === false,
  );
  check("TR réel", vue.identite.tranche === tranche.code);
  check("CC dérivé du patrimoine (tranches→référentiel)", vue.programmation.cc === cc);
  check("adresse patrimoine réelle", vue.programmation.adresse === adresse);
  check("1 demande de devis", vue.consultation.nb_demandes === 1);
  check(
    "devis sans montant accepté (pas 0)",
    vue.consultation.entreprises[0]?.montant === null,
  );
  check(
    "consultation = en_attente (demande envoyée)",
    vue.consultation.statut === "en_attente",
  );
  check("sans commande (aucun lien)", vue.commandes.nb_commandes === 0);
  check("exécution = sans_commande", vue.execution.statut === "sans_commande");
  check("synthèse Programmé atteinte", vue.synthese[0]?.atteint === true);
  check("aucune valeur MOCK 3200000", JSON.stringify(vue).includes("3200000") === false);

  // ── Recommandation d'entreprises : données RÉELLES uniquement.
  const fournisseurs = (await db.from("fournisseurs").select("id, nom")).data ?? [];
  const activites =
    (
      await db
        .from("fournisseur_activites")
        .select("fournisseur_id, corps_etat_code, corps_etat_libelle, niveau")
    ).data ?? [];
  const aliases =
    (await db.from("fournisseur_aliases").select("fournisseur_id, source, identifiant_source")).data ??
    [];
  const commandes =
    (
      await db
        .from("travaux_commandes")
        .select("id, numero_fournisseur, corps_etat, budget, annee_exercice")
        .not("numero_fournisseur", "is", null)
    ).data ?? [];
  const parNumero = new Map();
  for (const a of aliases) {
    if (a.source === "travaux_commandes" && a.identifiant_source != null) {
      parNumero.set(String(a.identifiant_source).trim(), a.fournisseur_id);
    }
  }
  const historique = commandes
    .map((c) => ({
      fournisseur_id: parNumero.get(String(c.numero_fournisseur ?? "").trim()),
      corps_etat: c.corps_etat,
      montant: c.budget,
      annee: c.annee_exercice,
    }))
    .filter((h) => h.fournisseur_id != null);

  check("historique réel mappé (alias numéro fournisseur)", historique.length > 0);

  const suggestions = recommanderEntreprises({
    fournisseurs,
    historique,
    activites,
    corps_etat_operation: "Couverture",
    limite: 20,
  });
  check("suggestions produites", suggestions.length > 0);
  check(
    "aucune « Meilleure entreprise »",
    JSON.stringify(suggestions).includes("Meilleure") === false,
  );
  check(
    "libellés compatibles uniquement",
    suggestions.every((s) => ["forte", "compatible"].includes(s.correspondance)),
  );
  check(
    "étiquettes = données réelles",
    suggestions.every((s) => s.etiquettes.every((e) => !e.includes("invent"))),
  );

  // ── J. aucune copie de commande dans psp_lignes (schéma).
  const cols = (await db.from("psp_lignes").select("*").limit(1)).data?.[0] ?? {};
  check(
    "psp_lignes sans numero_commande/budget/engage",
    !("numero_commande" in cols) &&
      !("engage" in cols) &&
      !("paye" in cols) &&
      !("budget_commande" in cols),
  );

  // ── Purge.
  await db.from("psp_devis").delete().in("id", created.devis);
  await db.from("psp_lignes").delete().in("id", created.lignes);
  await db.from("psp_programmations").delete().in("id", created.programmations);
  const residu = (await db.from("psp_lignes").select("id").eq("remarques", MARQUEUR)).data ?? [];
  check("purge : aucune ligne de test résiduelle", residu.length === 0);

  console.log(`\nRésultat : ${passed} ok, ${failed} échec(s)`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("Échec inattendu :", e);
  process.exit(1);
});
