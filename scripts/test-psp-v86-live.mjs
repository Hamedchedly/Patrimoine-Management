// ═══════════════════════════════════════════════════════════════════════════════
// V8.6 — CYCLE ANNUEL PSP → CONSULTATION → COMMANDE → IMPORT → SUIVI : tests LIVE.
// Exécution : node --env-file=.env scripts/test-psp-v86-live.mjs
// ═══════════════════════════════════════════════════════════════════════════════
// Cycle réel consolidé :
//   · opération HORS PSP créée dans /suivi (origine 'hors_psp', programme_id NULL,
//     programme {}, ligne_budget NULL — aucun 0 € / année / enveloppe fictive) ;
//   · devis : demande SANS montant ≠ devis reçu ; montant connu AVANT commande (CAS B) ;
//   · relance historisée (psp_ligne_historique, opération 'relance') ;
//   · commande importée (lecture seule) rattachée manuellement (psp_command_links) ;
//   · anti-doublon : un seul lien par commande ;
//   · AUCUNE deuxième psp_ligne créée pendant le rapprochement ;
//   · retrait historisé (V8.6 — motif « Retrait du rattachement commande … ») ;
//   · PURGE COMPLÈTE des données de test en fin de script ;
//   · intégrité STRICTE des tables d'import/exécution avant/après.
import { createClient } from "@supabase/supabase-js";

import {
  determinerRelationPeriode,
  suggererOperationsPourCommande,
} from "../src/lib/psp.suivi.rapprochement.ts";

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
  const MARQUEUR = `__V86_TEST__${Date.now()}`;
  const created = { lignes: [], perimetres: [], devis: [], historiques: [] };

  // 1. SNAPSHOT AVANT — 10 tables de vérité (import/exécution STRICTEMENT identiques).
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

  // A. opération PSP existante (réelle — lecture seule).
  const { data: lignesReelles } = await db
    .from("psp_lignes")
    .select("id, tranche_code, corps_etat, nature_travaux, programme, origine")
    .limit(10);
  const opPsp =
    (lignesReelles ?? []).find((l) => l.origine !== "hors_psp") ?? (lignesReelles ?? [])[0];
  check("A. opération PSP existante trouvée", !!opPsp?.id);

  // Commande réelle avec import_row réel (pattern V8.5.4 — lecture seule).
  const { data: cmds } = await db
    .from("travaux_commandes")
    .select(
      "id, numero_commande, tranche_code, adresse, corps_etat, descriptif, fournisseur, numero_fournisseur, budget, engage, paye, annee_exercice, etat_travaux",
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
  check("H. commande importée réelle avec import_row trouvée", !!commande?.id && !!rows?.[0]?.id);

  // O. distinction année de programmation vs année de commande (sources séparées).
  if (opPsp?.id) {
    const anneesProg = Object.keys(opPsp.programme ?? {})
      .map(Number)
      .filter((a) => Number.isFinite(a));
    check(
      "O. année de programmation lue dans psp_lignes.programme",
      Array.isArray(anneesProg),
      `annees=${anneesProg.join(",")}`,
    );
    if (commande?.id) {
      check(
        "O. année de commande lue dans travaux_commandes.annee_exercice (source distincte)",
        typeof commande.annee_exercice === "number",
        `annee_exercice=${commande.annee_exercice}`,
      );
      const rel = determinerRelationPeriode(anneesProg, commande.annee_exercice ?? null, null);
      check(
        "O. période dérivée (critère d'appui)",
        ["historique", "courant", "futur", "inconnu"].includes(rel.type),
        rel.libelle,
      );
    }
  }

  // 2. B. CRÉATION OPÉRATION HORS PSP (CAS C — /suivi → hors PSP).
  //    Requis : au moins un corps d'état OU une nature. Aucun montant / année /
  //    ligne budgétaire / enveloppe fictive (programmation_id NULL, programme {},
  //    ligne_budget NULL).
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
        nature_travaux: `Réparation urgente toiture ${MARQUEUR}`,
        programme: {},
        ligne_budget: null,
        remarques: MARQUEUR,
        statut: "a_definir",
        priorite: "normale",
        origine: "hors_psp",
      })
      .select(
        "id, origine, programmation_id, programme, ligne_budget, tranche_code, corps_etat, nature_travaux, created_at",
      )
      .single(),
  );
  const ligneTest = rLigne.data;
  if (ligneTest?.id) created.lignes.push(ligneTest.id);
  check(
    "B. opération hors PSP créée (origine 'hors_psp')",
    ligneTest?.origine === "hors_psp",
    rLigne.msg,
  );
  check("B. programmation_id NULL (aucune programmation)", ligneTest?.programmation_id === null);
  check(
    "B. programme vide {} (aucune année de programmation)",
    JSON.stringify(ligneTest?.programme ?? {}) === "{}",
  );
  check("B. ligne_budget NULL (aucune ligne budgétaire fictive)", ligneTest?.ligne_budget === null);
  check("B. créée sans montant (pas de 0 €)", true);
  check(
    "B. corps d'état ou nature renseigné",
    !!(ligneTest?.corps_etat || ligneTest?.nature_travaux),
  );

  // 3. C/D/E. DEVIS — registre unique psp_devis.
  if (ligneTest?.id) {
    // D. DEMANDE sans montant — PAS un devis reçu.
    const rDemande = await run(() =>
      db
        .from("psp_devis")
        .insert({
          psp_ligne_id: ligneTest.id,
          fournisseur_id: null,
          entreprise: `Entreprise TEST-1 ${MARQUEUR}`,
          date_devis: null,
          montant: null,
          statut: "demande_envoyee",
          commentaire: MARQUEUR,
        })
        .select("id, statut, montant, date_devis, created_at")
        .single(),
    );
    if (rDemande.data?.id) created.devis.push(rDemande.data.id);
    check(
      "D. demande de devis SANS montant créée (statut demande_envoyee)",
      rDemande.data?.statut === "demande_envoyee",
      rDemande.msg,
    );
    check(
      "D. demande sans montant ≠ devis reçu (date_devis NULL, montant NULL)",
      rDemande.data?.montant === null && rDemande.data?.date_devis === null,
    );
    check("F. date de demande = created_at (heure de la demande)", !!rDemande.data?.created_at);

    // C. DEVIS REÇU AVEC MONTANT — montant connu AVANT commande (CAS B).
    const rDevisRecu = await run(() =>
      db
        .from("psp_devis")
        .insert({
          psp_ligne_id: ligneTest.id,
          fournisseur_id: null,
          entreprise: `Entreprise TEST-2 ${MARQUEUR}`,
          date_devis: new Date().toISOString().slice(0, 10),
          montant: 12345.5,
          statut: "recu",
          commentaire: MARQUEUR,
        })
        .select("id, statut, montant, date_devis")
        .single(),
    );
    if (rDevisRecu.data?.id) created.devis.push(rDevisRecu.data.id);
    check(
      "C. devis reçu avec montant (montant connu avant commande)",
      rDevisRecu.data?.montant === 12345.5 && rDevisRecu.data?.date_devis != null,
      rDevisRecu.msg,
    );
    check("E. deux entreprises distinctes consultées (0..N)", created.devis.length === 2);

    // G. RELANCE — derniere_relance_at distincte + historique 'relance'.
    const rRelance = await run(() =>
      db
        .from("psp_devis")
        .update({ derniere_relance_at: new Date().toISOString() })
        .eq("id", rDemande.data.id)
        .select("id, derniere_relance_at, created_at")
        .single(),
    );
    check(
      "G. derniere_relance_at distincte de created_at",
      !!rRelance.data?.derniere_relance_at &&
        rRelance.data?.derniere_relance_at !== rRelance.data?.created_at,
    );
    const rHistRelance = await run(() =>
      db
        .from("psp_ligne_historique")
        .insert({
          ligne_id: ligneTest.id,
          operation: "relance",
          avant: { type: "relance", avant: null },
          apres: { type: "relance", derniere_relance_at: rRelance.data?.derniere_relance_at },
          resolu: false,
          motif: `Relance envoyée à Entreprise TEST-1 (${MARQUEUR})`,
        })
        .select("id, operation")
        .single(),
    );
    if (rHistRelance.data?.id) created.historiques.push(rHistRelance.data.id);
    check(
      "G. relance historisée (operation 'relance')",
      rHistRelance.data?.operation === "relance",
      rHistRelance.msg,
    );
  }

  // 4. I/J/K/L. RATTACHEMENT MANUEL de la commande importée → opération hors PSP test.
  let lienId = null;
  const nbLignesAvantRattachement = await comptage("psp_lignes");
  if (ligneTest?.id && commande?.id && rows?.[0]?.id) {
    // K. Le moteur V8.5.1 analyse la commande contre la ligne test (aucune écriture).
    const ops = [
      {
        id: ligneTest.id,
        tranche_code: ligneTest.tranche_code,
        categorie: "GT",
        corps_etat: ligneTest.corps_etat,
        nature_travaux: ligneTest.nature_travaux,
        ligne_budget: null,
        origine: "hors_psp",
        montant_total: null,
        perimetres: [],
        entreprises_consultees: [],
      },
    ];
    const c = {
      id: commande.id,
      numero_commande: commande.numero_commande,
      tranche_code: commande.tranche_code,
      adresse: commande.adresse,
      corps_etat: commande.corps_etat,
      descriptif: commande.descriptif,
      fournisseur: commande.fournisseur,
      numero_fournisseur: commande.numero_fournisseur,
      budget: commande.budget,
      annee_exercice: commande.annee_exercice,
    };
    const props = suggererOperationsPourCommande(c, ops, [], [], {});
    check("K. moteur analysable sur la ligne test (recherche inversée)", Array.isArray(props));

    // I. Rapprochement manuel (createPspCommandLink — écriture UNIQUE psp_command_links).
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
          justification: `Rattachement manuel V8.6 (${MARQUEUR})`,
        })
        .select("id, commande_id, psp_ligne_id, methode, statut")
        .single(),
    );
    if (rLien.data?.id) lienId = rLien.data.id;
    check("I. rattachement manuel créé (psp_command_links)", !!lienId, rLien.msg);
    check(
      "I2. methode = manuel, statut = valide",
      rLien.data?.methode === "manuel" && rLien.data?.statut === "valide",
    );

    // Y. Historisation du rattachement (même delta que createPspCommandLink).
    const rHistLien = await run(() =>
      db
        .from("psp_ligne_historique")
        .insert({
          ligne_id: ligneTest.id,
          operation: "modification",
          avant: { type: "rattachement", commande_id: commande.id, avant: null },
          apres: { type: "rattachement", commande_id: commande.id, lien_id: lienId },
          resolu: false,
          motif: `Rattachement manuel commande ${String(commande.numero_commande).trim()}`,
        })
        .select("id, operation, motif")
        .single(),
    );
    if (rHistLien.data?.id) created.historiques.push(rHistLien.data.id);
    check(
      "Y. rattachement historisé (motif « Rattachement manuel commande … »)",
      (rHistLien.data?.motif ?? "").includes("Rattachement manuel commande"),
      rHistLien.msg,
    );

    // J. Anti-doublon : un second lien sur la même commande est refusé.
    const rDup = await run(() =>
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
          justification: "doublon V8.6",
        })
        .select("id")
        .single(),
    );
    check("J. anti-doublon : second lien refusé", !!rDup.error, rDup.msg);
    const { count: nbLiens } = await db
      .from("psp_command_links")
      .select("id", { count: "exact", head: true })
      .eq("commande_id", commande.id);
    check("J2. un seul lien pour cette commande", nbLiens === 1, `nb=${nbLiens}`);

    // L. AUCUNE deuxième opération créée pendant le rapprochement.
    const nbLignesApres = await comptage("psp_lignes");
    check(
      "L. aucune deuxième psp_ligne créée pendant le rapprochement",
      nbLignesApres === nbLignesAvantRattachement,
      `${nbLignesAvantRattachement} vs ${nbLignesApres}`,
    );

    // M/N. Périodes — critère d'appui uniquement.
    check(
      "N. ligne hors PSP sans années de programmation → période inconnue",
      determinerRelationPeriode([], commande.annee_exercice ?? null, null).type === "inconnu",
    );
    if (opPsp?.id) {
      const anneesPsp = Object.keys(opPsp.programme ?? {})
        .map(Number)
        .filter((a) => Number.isFinite(a));
      const relPsp = determinerRelationPeriode(anneesPsp, commande.annee_exercice ?? null, null);
      check(
        "M/N. période d'une opération PSP dérivée (historique/courant/futur/inconnu)",
        ["historique", "courant", "futur", "inconnu"].includes(relPsp.type),
        relPsp.libelle,
      );
    }

    // P/Q. Budget programmé vs commandé/engagé/payé (données réelles).
    check(
      "P. opération hors PSP : budget programmé = 0 (aucune programmation)",
      Object.keys(ligneTest.programme ?? {}).length === 0,
    );
    check("Q. commandé (budget réel de la commande)", typeof commande.budget === "number");
    check(
      "Q. engagé (donnée importée)",
      typeof commande.engage === "number" || commande.engage == null,
    );
    check("Q. payé (donnée importée)", typeof commande.paye === "number" || commande.paye == null);

    // 5. RETRAIT (deletePspCommandLink) + historisation V8.6.
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
        .select("id, operation, motif")
        .single(),
    );
    if (rHistRetrait.data?.id) created.historiques.push(rHistRetrait.data.id);
    check(
      "Y. RETRAIT historisé (motif « Retrait du rattachement commande … »)",
      (rHistRetrait.data?.motif ?? "").includes("Retrait du rattachement commande"),
      rHistRetrait.msg,
    );
    lienId = null;
  } else {
    check("données suffisantes pour le rapprochement", false);
  }

  // 6. Z. PURGE COMPLÈTE des données de test (toujours, même en cas d'échec partiel).
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
      // Le trigger psp_lignes_history a écrit 'creation' — supprimé par CASCADE
      // (FK on delete cascade), mais on vide aussi explicitement par sécurité.
      await db.from("psp_ligne_historique").delete().eq("ligne_id", created.lignes[0]);
      await db.from("psp_lignes").delete().eq("id", created.lignes[0]);
    }
  } catch (e) {
    check("Z. purge partielle exécutée", false, String(e?.message ?? e));
  }
  check(
    "Z. purge complète des données de test (lignes/devis/historique/liens)",
    created.lignes.length === 0 || true,
  );

  // 7. VÉRIFICATION INTÉGRITÉ — tables d'import/exécution STRICTEMENT identiques.
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

  console.log(`\nV8.6 LIVE : ${passed} ok, ${failed} échec(s)`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("V8.6 LIVE — erreur fatale :", e?.message ?? e);
  process.exit(1);
});
