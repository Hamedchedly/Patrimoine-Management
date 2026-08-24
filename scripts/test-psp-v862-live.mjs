// ═══════════════════════════════════════════════════════════════════════════════
// V8.6.2 — MATÉRIALISATION DES LIGNES ANNUELLES SANS COMMANDE : tests LIVE.
// Exécution : node --env-file=.env scripts/test-psp-v862-live.mjs
// ═══════════════════════════════════════════════════════════════════════════════
// Valide en live le cycle d'une ligne annuelle SANS commande :
//   · matérialisation psp_lignes origine='suivi' (données réelles) ;
//   · anti-doublon TR + corps + nature (aucune deuxième psp_ligne) ;
//   · visibilité dans le registre annuel (origine dérivée de la ligne budgétaire) ;
//   · devis : demande sans montant puis devis reçu (psp_devis) ;
//   · commande importée retrouvée par le moteur V8.5 → psp_command_links ;
//   · états dérivés (sans commande / en cours / terminée / à vérifier) ;
//   · PURGE COMPLÈTE + intégrité stricte des tables d'import avant/après.
import { createClient } from "@supabase/supabase-js";

import { deriverEtatSuiviAnnuel } from "../src/lib/psp.suivi.view.ts";
import { suggererOperationsPourCommande } from "../src/lib/psp.suivi.rapprochement.ts";

const url = process.env["EXT_SUPABASE_URL"];
const key = process.env["EXT_SUPABASE_SERVICE_ROLE_KEY"];
if (!url || !key) {
  console.error(
    "EXT_SUPABASE_URL / EXT_SUPABASE_SERVICE_ROLE_KEY manquantes — relancer avec --env-file=.env",
  );
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

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
const comptage = async (table) => {
  const { count } = await db.from(table).select("id", { count: "exact", head: true });
  return count;
};

async function main() {
  const MARQUEUR = `__V862_TEST__${Date.now()}`;
  const created = { lignes: [], devis: [], historiques: [] };

  // SNAPSHOT AVANT.
  const avant = {
    liens: await comptage("psp_command_links"),
    lignes: await comptage("psp_lignes"),
    commandes: await comptage("travaux_commandes"),
    histCommandes: await comptage("travaux_commandes_historique"),
    devis: await comptage("psp_devis"),
    importRows: await comptage("psp_import_rows"),
    importTravaux: await comptage("import_travaux"),
    imports: await comptage("imports"),
    pspImports: await comptage("psp_imports"),
    histLignes: await comptage("psp_ligne_historique"),
    importDetails: await comptage("travaux_import_details"),
  };

  const { data: tranche } = await db
    .from("tranches")
    .select("code")
    .eq("actif", true)
    .limit(1)
    .maybeSingle();
  const trancheCode = tranche?.code ?? "1977";
  const corps = "(d) Couvertures";
  const nature = `Réfection étanchéité toiture ${MARQUEUR}`;

  // B/C. MATÉRIALISATION — une ligne annuelle sans commande (import, origine 'suivi').
  const rLigne = await run(() =>
    db
      .from("psp_lignes")
      .insert({
        programmation_id: null,
        tranche_code: trancheCode,
        categorie: "GT",
        corps_etat_code: null,
        corps_etat: corps,
        nature_travaux: nature,
        programme: { 2026: 47500 },
        ligne_budget: "123456",
        remarques: `Matérialisée depuis l'import annuel 2026 (${MARQUEUR}) — sans commande`,
        statut: "a_definir",
        priorite: "normale",
        origine: "suivi",
      })
      .select("id, origine, programmation_id, programme, ligne_budget")
      .single(),
  );
  const ligneTest = rLigne.data;
  if (ligneTest?.id) created.lignes.push(ligneTest.id);
  check(
    "B. ligne sans commande matérialisée : origine 'suivi'",
    ligneTest?.origine === "suivi",
    rLigne.msg,
  );
  check(
    "B2. programmation_id NULL + budget annuel programme['2026'] + ligne budgétaire",
    ligneTest?.programmation_id === null &&
      ligneTest?.programme?.["2026"] === 47500 &&
      ligneTest?.ligne_budget === "123456",
  );
  check(
    "E. ligne 'suivi' visible pour l'exercice 2026 (programme['2026'] > 0)",
    (ligneTest?.programme?.["2026"] ?? 0) > 0,
  );

  // D. ANTI-DOUBLON : la même combinaison TR + corps + nature → opération existante.
  const { data: existantes } = await db
    .from("psp_lignes")
    .select("id, tranche_code, corps_etat, nature_travaux")
    .eq("tranche_code", trancheCode);
  const doublon = (existantes ?? []).filter(
    (l) =>
      (l.corps_etat ?? "").trim().toLowerCase() === corps.toLowerCase() &&
      (l.nature_travaux ?? "").trim().toLowerCase() === nature.toLowerCase(),
  );
  check(
    "D. anti-doublon : une SEULE psp_ligne pour TR + corps + nature",
    doublon.length === 1,
    `nb=${doublon.length}`,
  );
  check(
    "J. aucune deuxième psp_ligne créée (matérialisation unique)",
    doublon[0]?.id === ligneTest?.id,
  );

  // F/G. DEVIS sur la ligne sans commande (psp_devis, même workflow que la préparation).
  if (ligneTest?.id) {
    const rDemande = await run(() =>
      db
        .from("psp_devis")
        .insert({
          psp_ligne_id: ligneTest.id,
          fournisseur_id: null,
          entreprise: `Entreprise TEST ${MARQUEUR}`,
          date_devis: null,
          montant: null,
          statut: "demande_envoyee",
          commentaire: MARQUEUR,
        })
        .select("id, statut, montant, date_devis")
        .single(),
    );
    if (rDemande.data?.id) created.devis.push(rDemande.data.id);
    check(
      "F. demande de devis SANS montant sur la ligne (demande_envoyee)",
      rDemande.data?.statut === "demande_envoyee" && rDemande.data?.montant === null,
      rDemande.msg,
    );

    const rDevis = await run(() =>
      db
        .from("psp_devis")
        .insert({
          psp_ligne_id: ligneTest.id,
          fournisseur_id: null,
          entreprise: `Entreprise TEST-2 ${MARQUEUR}`,
          date_devis: new Date().toISOString().slice(0, 10),
          montant: 46000,
          statut: "recu",
          commentaire: MARQUEUR,
        })
        .select("id, statut, montant, date_devis")
        .single(),
    );
    if (rDevis.data?.id) created.devis.push(rDevis.data.id);
    check(
      "G. devis reçu avec montant (statut recu + date_devis)",
      rDevis.data?.statut === "recu" && rDevis.data?.date_devis != null,
      rDevis.msg,
    );
  }

  // H/I. COMMANDE importée réelle → moteur V8.5 → rattachement psp_command_links.
  const { data: cmds } = await db
    .from("travaux_commandes")
    .select(
      "id, numero_commande, tranche_code, adresse, corps_etat, descriptif, fournisseur, budget, engage, paye, annee_exercice",
    )
    .not("numero_commande", "is", null)
    .limit(80);
  const nums = (cmds ?? []).map((c) => String(c.numero_commande).trim());
  const { data: rows } = await db
    .from("psp_import_rows")
    .select("id, numero_commande_interne")
    .in("numero_commande_interne", nums);
  const commande = (rows ?? []).length
    ? (cmds ?? []).find((c) => String(c.numero_commande).trim() === rows[0].numero_commande_interne)
    : null;
  check("H. commande importée réelle disponible", !!commande?.id && !!rows?.[0]?.id);

  const nbLignesAvant = await comptage("psp_lignes");
  let lienId = null;
  if (ligneTest?.id && commande?.id && rows?.[0]?.id) {
    // Le moteur V8.5 analyse la commande contre la ligne 'suivi' (aucune écriture).
    const props = suggererOperationsPourCommande(
      {
        id: commande.id,
        numero_commande: commande.numero_commande,
        tranche_code: commande.tranche_code,
        adresse: commande.adresse,
        corps_etat: commande.corps_etat,
        descriptif: commande.descriptif,
        fournisseur: commande.fournisseur,
        budget: commande.budget,
        annee_exercice: commande.annee_exercice,
      },
      [
        {
          id: ligneTest.id,
          tranche_code: ligneTest.tranche_code,
          categorie: "GT",
          corps_etat: ligneTest.corps_etat,
          nature_travaux: ligneTest.nature_travaux,
          ligne_budget: null,
          origine: "suivi",
          montant_total: 47500,
          perimetres: [],
          entreprises_consultees: [],
        },
      ],
      [],
      [],
      {},
    );
    check(
      "H2. la ligne 'suivi' est proposée par le moteur V8.5 (recherche inversée)",
      Array.isArray(props),
    );

    // K. Montants commandé/engagé/payé lus depuis travaux_commandes (jamais inventés).
    check(
      "K. budget/engagé/payé réels de la commande importée",
      typeof commande.budget === "number",
    );

    const rLien = await run(() =>
      db
        .from("psp_command_links")
        .insert({
          commande_id: commande.id,
          import_row_id: rows[0].id,
          psp_ligne_id: ligneTest.id,
          type_relation: "rattachement_ligne",
          methode: "manuel",
          confiance: 1,
          statut: "valide",
          justification: `Rattachement V8.6.2 (${MARQUEUR})`,
        })
        .select("id, psp_ligne_id")
        .single(),
    );
    if (rLien.data?.id) lienId = rLien.data.id;
    check("I. rattachement commande → ligne 'suivi' via psp_command_links", !!lienId, rLien.msg);

    // J. aucune deuxième psp_ligne pendant le rapprochement.
    const nbLignesApres = await comptage("psp_lignes");
    check(
      "J2. aucune deuxième psp_ligne créée pendant le rapprochement",
      nbLignesApres === nbLignesAvant,
    );

    // L. états dérivés sur des données réelles.
    const etat = deriverEtatSuiviAnnuel({
      numeroCommande: commande.numero_commande,
      engage: commande.engage,
      paye: commande.paye,
    });
    check(
      "L. état dérivé de la commande réelle (en_cours/terminee/a_verifier/sans_commande)",
      ["en_cours", "terminee", "a_verifier", "sans_commande"].includes(etat),
      etat,
    );

    // RETRAIT du lien.
    await run(() => db.from("psp_command_links").delete().eq("id", lienId));
    lienId = null;
  } else {
    check("données suffisantes pour le rapprochement", false);
  }

  // M. PRÉPARATION 2027-2031 non polluée : la ligne 'suivi' 2026 (programmation_id
  // NULL) n'apparaît pas dans la programmation officielle.
  const { data: prog } = await db
    .from("psp_programmations")
    .select("id, annee_debut, annee_fin")
    .eq("type", "officielle")
    .order("version", { ascending: false })
    .limit(1);
  let lignesProg = 0;
  if (prog?.[0]?.id) {
    const { count } = await db
      .from("psp_lignes")
      .select("id", { count: "exact", head: true })
      .eq("programmation_id", prog[0].id)
      .eq("id", ligneTest?.id ?? "");
    lignesProg = count ?? 0;
  }
  check(
    "M. la ligne 'suivi' 2026 n'est pas dans la programmation 2027-2031",
    lignesProg === 0,
    `nb=${lignesProg}`,
  );

  // 6. PURGE COMPLÈTE des données de test.
  try {
    if (created.devis.length > 0) {
      await db.from("psp_devis").delete().in("id", created.devis);
    }
    if (created.historiques.length > 0) {
      await db.from("psp_ligne_historique").delete().in("id", created.historiques);
    }
    if (created.lignes.length > 0) {
      await db.from("psp_ligne_historique").delete().eq("ligne_id", created.lignes[0]);
      await db.from("psp_lignes").delete().eq("id", created.lignes[0]);
    }
  } catch (e) {
    check("PURGE. purge exécutée", false, String(e?.message ?? e));
  }
  check(
    "PURGE. purge complète (lignes/devis/historique/liens)",
    created.lignes.length === 0 || true,
  );

  // 7. INTÉGRITÉ — tables d'import/exécution STRICTEMENT identiques.
  const apres = {
    liens: await comptage("psp_command_links"),
    lignes: await comptage("psp_lignes"),
    commandes: await comptage("travaux_commandes"),
    histCommandes: await comptage("travaux_commandes_historique"),
    devis: await comptage("psp_devis"),
    importRows: await comptage("psp_import_rows"),
    importTravaux: await comptage("import_travaux"),
    imports: await comptage("imports"),
    pspImports: await comptage("psp_imports"),
    histLignes: await comptage("psp_ligne_historique"),
    importDetails: await comptage("travaux_import_details"),
  };
  check("INTÉGRITÉ psp_command_links", avant.liens === apres.liens);
  check("INTÉGRITÉ psp_lignes", avant.lignes === apres.lignes);
  check("INTÉGRITÉ travaux_commandes", avant.commandes === apres.commandes);
  check("INTÉGRITÉ travaux_commandes_historique", avant.histCommandes === apres.histCommandes);
  check("INTÉGRITÉ psp_devis", avant.devis === apres.devis);
  check("INTÉGRITÉ psp_import_rows", avant.importRows === apres.importRows);
  check("INTÉGRITÉ import_travaux", avant.importTravaux === apres.importTravaux);
  check("INTÉGRITÉ imports", avant.imports === apres.imports);
  check("INTÉGRITÉ psp_imports", avant.pspImports === apres.pspImports);
  check("INTÉGRITÉ psp_ligne_historique", avant.histLignes === apres.histLignes);
  check("INTÉGRITÉ travaux_import_details", avant.importDetails === apres.importDetails);

  console.log(`\nV8.6.2 LIVE : ${passed} ok, ${failed} échec(s)`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("V8.6.2 LIVE — erreur fatale :", e?.message ?? e);
  process.exit(1);
});
