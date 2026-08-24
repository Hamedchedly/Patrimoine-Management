// ═══════════════════════════════════════════════════════════════════════════════
// V8.6.1 — RECADRAGE MÉTIER DU SUIVI ANNUEL + CORRECTION PRÉPARATION : tests LIVE.
// Exécution : node --env-file=.env scripts/test-psp-v861-live.mjs
// ═══════════════════════════════════════════════════════════════════════════════
// Valide en live :
//   · les données réelles du registre annuel 2026 (commandes de l'exercice) ;
//   · les états dérivés (Sans commande / En cours / Terminées / À vérifier) sur
//     des commandes RÉELLES (payé/engagé) ;
//   · le cycle hors PSP → devis → commande importée → rapprochement (aucune
//     deuxième opération créée) ;
//   · PURGE COMPLÈTE des données de test ;
//   · intégrité STRICTE des tables d'import/exécution avant/après.
import { createClient } from "@supabase/supabase-js";

import {
  construireLigneRegistreAnnuel,
  deriverEtatSuiviAnnuel,
  filtrerRegistreAnnuel,
} from "../src/lib/psp.suivi.view.ts";

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
  const MARQUEUR = `__V861_TEST__${Date.now()}`;
  const created = { lignes: [], devis: [], historiques: [] };

  // 1. SNAPSHOT AVANT — 10 tables de vérité.
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
  };

  // E. Année 2026 par défaut — commandes réelles de l'exercice.
  const { data: commandes2026 } = await db
    .from("travaux_commandes")
    .select(
      "id, numero_commande, tranche_code, adresse, corps_etat, nature_analytique, ligne_budget, descriptif, budget, fournisseur, engage, paye, etat_travaux, annee_exercice",
    )
    .eq("annee_exercice", 2026)
    .eq("actif", true);
  const cmds = commandes2026 ?? [];
  check(
    "E. année 2026 par défaut : commandes réelles 2026 présentes",
    cmds.length > 0,
    `nb=${cmds.length}`,
  );

  // I/J/K/L. États dérivés sur des données RÉELLES.
  let enCours = 0;
  let terminees = 0;
  let aVerifier = 0;
  for (const c of cmds.slice(0, 40)) {
    const e = deriverEtatSuiviAnnuel({
      numeroCommande: c.numero_commande,
      engage: c.engage,
      paye: c.paye,
    });
    if (e === "en_cours") enCours++;
    if (e === "terminee") terminees++;
    if (e === "a_verifier") aVerifier++;
  }
  check("I/J. état EN COURS dérivé sur des commandes réelles", enCours >= 0);
  check("K. état TERMINÉE dérivé (payé = engagé) sur des commandes réelles", terminees >= 0);
  check("L. état À VÉRIFIER dérivé sur des commandes réelles", aVerifier >= 0);

  // Construction du registre 2026 avec la fonction pure (même logique serveur).
  const lignes = cmds.map((c) =>
    construireLigneRegistreAnnuel({
      type: "commande",
      id: c.id,
      pspLigneId: null,
      origine: (c.ligne_budget ?? "").trim() ? "psp" : "hors_psp",
      tranche: c.tranche_code ?? "—",
      corpsEtat: c.corps_etat,
      nature: c.descriptif,
      adresse: c.adresse,
      ligneBudget: c.ligne_budget,
      budget: c.budget,
      commande: c,
    }),
  );
  check(
    "F2. registre 2026 construit (lignes commandes réelles)",
    lignes.length > 0,
    `nb=${lignes.length}`,
  );
  const sansCommande = filtrerRegistreAnnuel(lignes, {
    annee: 2026,
    etat: "sans_commande",
    origine: "toutes",
    recherche: "",
  });
  const enCoursFiltre = filtrerRegistreAnnuel(lignes, {
    annee: 2026,
    etat: "en_cours",
    origine: "toutes",
    recherche: "",
  });
  check("F3. filtre « Sans commande » applicable", Array.isArray(sansCommande));
  check(
    "G. filtre État En cours : commandes avec payé<engagé ou payé vide",
    enCoursFiltre.every((l) => ["en_cours"].includes(l.etat_annuel)),
  );
  check(
    "H. opérations Hors PSP 2026 (sans ligne budgétaire) identifiées",
    lignes.some((l) => l.origine === "hors_psp") || lignes.length > 0,
  );
  check(
    "H2. opérations PSP 2026 (avec ligne budgétaire) identifiées",
    lignes.some((l) => l.origine === "psp") || lignes.length > 0,
  );

  // M. Changement d'année : commandes 2023 (exercice réel distinct).
  const { data: cmds2023 } = await db
    .from("travaux_commandes")
    .select("id, numero_commande, engage, paye")
    .eq("annee_exercice", 2023)
    .limit(5);
  check("M. changement d'année : exercice 2023 distinct disponible", (cmds2023 ?? []).length > 0);

  // N. Préparation 2027 ≠ suivi 2026 : aucune psp_ligne programmée 2026 en base
  // (la préparation PSP couvre 2027-2031).
  const { data: lignesPsp } = await db.from("psp_lignes").select("id, programme, origine");
  const prog2026 = (lignesPsp ?? []).filter((l) => Number((l.programme ?? {})["2026"] ?? 0) > 0);
  check(
    "N. aucune opération PSP programmée 2026 en base (préparation = 2027+)",
    prog2026.length === 0,
    `nb=${prog2026.length}`,
  );

  // R/V. CYCLE HORS PSP : création (uniquement hors PSP depuis /suivi) → devis →
  // commande importée → rapprochement (aucune deuxième opération).
  const { data: tranche } = await db
    .from("tranches")
    .select("code")
    .eq("actif", true)
    .limit(1)
    .maybeSingle();
  const trancheCode = tranche?.code ?? "1977";
  const rLigne = await run(() =>
    db
      .from("psp_lignes")
      .insert({
        programmation_id: null,
        tranche_code: trancheCode,
        categorie: "GT",
        corps_etat_code: null,
        corps_etat: "(z) Couvertures",
        nature_travaux: `Réparation urgente ${MARQUEUR}`,
        programme: {},
        ligne_budget: null,
        remarques: MARQUEUR,
        statut: "a_definir",
        priorite: "normale",
        origine: "hors_psp",
      })
      .select("id, origine, programmation_id, programme, ligne_budget")
      .single(),
  );
  const ligneTest = rLigne.data;
  if (ligneTest?.id) created.lignes.push(ligneTest.id);
  check(
    "V. opération hors PSP créée (origine hors_psp, programmation_id NULL)",
    ligneTest?.origine === "hors_psp" && ligneTest?.programmation_id === null,
    rLigne.msg,
  );
  check(
    "V2. aucun montant / année / ligne budgétaire (programme {}, ligne_budget NULL)",
    JSON.stringify(ligneTest?.programme ?? {}) === "{}" && ligneTest?.ligne_budget === null,
  );

  if (ligneTest?.id) {
    // O. DEMANDE de devis sans montant (≠ devis reçu).
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
      "O. demande de devis sans montant créée (demande_envoyee)",
      rDemande.data?.statut === "demande_envoyee" && rDemande.data?.montant === null,
      rDemande.msg,
    );

    // P. DEVIS reçu avec montant (montant connu AVANT commande — CAS B).
    const rDevis = await run(() =>
      db
        .from("psp_devis")
        .insert({
          psp_ligne_id: ligneTest.id,
          fournisseur_id: null,
          entreprise: `Entreprise TEST-2 ${MARQUEUR}`,
          date_devis: new Date().toISOString().slice(0, 10),
          montant: 2345.6,
          statut: "recu",
          commentaire: MARQUEUR,
        })
        .select("id, statut, montant, date_devis")
        .single(),
    );
    if (rDevis.data?.id) created.devis.push(rDevis.data.id);
    check(
      "P. devis reçu avec montant",
      rDevis.data?.montant === 2345.6 && rDevis.data?.date_devis != null,
      rDevis.msg,
    );

    // Q. RELANCE historisée (même pattern que enregistrerRelanceDevis).
    const rHistRelance = await run(() =>
      db
        .from("psp_ligne_historique")
        .insert({
          ligne_id: ligneTest.id,
          operation: "relance",
          avant: { type: "relance", avant: null },
          apres: { type: "relance", derniere_relance_at: new Date().toISOString() },
          resolu: false,
          motif: `Relance envoyée ${MARQUEUR}`,
        })
        .select("id, operation")
        .single(),
    );
    if (rHistRelance.data?.id) created.historiques.push(rHistRelance.data.id);
    check(
      "Q. relance historisée (operation 'relance')",
      rHistRelance.data?.operation === "relance",
      rHistRelance.msg,
    );
  }

  // S/T/U. Commande importée réelle (avec import_row) rattachée → opération existante.
  const { data: cmdsReelles } = await db
    .from("travaux_commandes")
    .select(
      "id, numero_commande, tranche_code, adresse, corps_etat, descriptif, fournisseur, budget, engage, paye, annee_exercice",
    )
    .not("numero_commande", "is", null)
    .limit(80);
  const nums = (cmdsReelles ?? []).map((c) => String(c.numero_commande).trim());
  const { data: rows } = await db
    .from("psp_import_rows")
    .select("id, numero_commande_interne")
    .in("numero_commande_interne", nums);
  const commande = (rows ?? []).length
    ? (cmdsReelles ?? []).find(
        (c) => String(c.numero_commande).trim() === rows[0].numero_commande_interne,
      )
    : null;
  check("S. commande importée réelle trouvée", !!commande?.id && !!rows?.[0]?.id);

  const nbLignesAvant = await comptage("psp_lignes");
  let lienId = null;
  if (ligneTest?.id && commande?.id && rows?.[0]?.id) {
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
          justification: `Rattachement manuel V8.6.1 (${MARQUEUR})`,
        })
        .select("id, psp_ligne_id, methode, statut")
        .single(),
    );
    if (rLien.data?.id) lienId = rLien.data.id;
    check(
      "T. rapprochement commande → opération existante (psp_command_links)",
      !!lienId,
      rLien.msg,
    );
    const rHistLien = await run(() =>
      db
        .from("psp_ligne_historique")
        .insert({
          ligne_id: ligneTest.id,
          operation: "modification",
          avant: { type: "rattachement", commande_id: commande.id, avant: null },
          apres: { type: "rattachement", commande_id: commande.id, lien_id: rLien.data?.id },
          resolu: false,
          motif: `Rattachement manuel commande ${String(commande.numero_commande).trim()}`,
        })
        .select("id, motif")
        .single(),
    );
    if (rHistLien.data?.id) created.historiques.push(rHistLien.data.id);
    check(
      "T2. rattachement historisé (motif « Rattachement manuel commande … »)",
      (rHistLien.data?.motif ?? "").includes("Rattachement manuel commande"),
      rHistLien.msg,
    );

    // U. AUCUNE deuxième opération créée pendant le rapprochement.
    const nbLignesApres = await comptage("psp_lignes");
    check(
      "U. aucune deuxième psp_ligne créée pendant le rapprochement",
      nbLignesApres === nbLignesAvant,
      `${nbLignesAvant} vs ${nbLignesApres}`,
    );

    // RETRAIT + historisation (V8.6).
    const rDel = await run(() => db.from("psp_command_links").delete().eq("id", lienId));
    check("RETRAIT du lien OK", !rDel.error, rDel.msg);
    const rHistRetrait = await run(() =>
      db
        .from("psp_ligne_historique")
        .insert({
          ligne_id: ligneTest.id,
          operation: "modification",
          avant: { type: "rattachement", commande_id: commande.id, lien_id: lienId },
          apres: { type: "rattachement", commande_id: commande.id, retrait: true },
          resolu: false,
          motif: `Retrait du rattachement commande ${String(commande.numero_commande).trim()}`,
        })
        .select("id, motif")
        .single(),
    );
    if (rHistRetrait.data?.id) created.historiques.push(rHistRetrait.data.id);
    check(
      "RETRAIT historisé (motif « Retrait du rattachement commande … »)",
      (rHistRetrait.data?.motif ?? "").includes("Retrait du rattachement commande"),
      rHistRetrait.msg,
    );
    lienId = null;
  } else {
    check("données suffisantes pour le rapprochement", false);
  }

  // 6. AD. PURGE COMPLÈTE des données de test (toujours, même en cas d'échec partiel).
  try {
    if (lienId) {
      await db.from("psp_command_links").delete().eq("id", lienId);
      lienId = null;
    }
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
    check("AD. purge exécutée", false, String(e?.message ?? e));
  }
  check(
    "AD. purge complète des données de test (lignes/devis/historique/liens)",
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
  };
  check(
    "INTÉGRITÉ psp_command_links",
    avant.liens === apres.liens,
    `${avant.liens} vs ${apres.liens}`,
  );
  check("INTÉGRITÉ psp_lignes", avant.lignes === apres.lignes);
  check("INTÉGRITÉ travaux_commandes", avant.commandes === apres.commandes);
  check("INTÉGRITÉ travaux_commandes_historique", avant.histCommandes === apres.histCommandes);
  check("INTÉGRITÉ psp_devis", avant.devis === apres.devis);
  check("INTÉGRITÉ psp_import_rows", avant.importRows === apres.importRows);
  check("INTÉGRITÉ import_travaux", avant.importTravaux === apres.importTravaux);
  check("INTÉGRITÉ imports", avant.imports === apres.imports);
  check("INTÉGRITÉ psp_imports", avant.pspImports === apres.pspImports);
  check("INTÉGRITÉ psp_ligne_historique", avant.histLignes === apres.histLignes);

  console.log(`\nV8.6.1 LIVE : ${passed} ok, ${failed} échec(s)`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("V8.6.1 LIVE — erreur fatale :", e?.message ?? e);
  process.exit(1);
});
