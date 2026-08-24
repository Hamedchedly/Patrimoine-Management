// ═══════════════════════════════════════════════════════════════════════════════
// V8.5.4 — RAPPROCHER LES COMMANDES DANS LE CYCLE RÉEL : tests LIVE.
// Exécution : node --env-file=.env scripts/test-psp-v854-live.mjs
// ═══════════════════════════════════════════════════════════════════════════════
// Cycle réel : opération existante → commande importée → détection →
// recherche manuelle → rattachement humain → retrait. Les tables d'import
// (travaux_commandes, import_travaux, imports, psp_imports, psp_import_rows)
// doivent être STRICTEMENT identiques avant/après. Aucune création d'opération
// parallèle : on réutilise une opération réelle + une commande réelle.
import { createClient } from "@supabase/supabase-js";
import { determinerRelationPeriode, suggererOperationsPourCommande } from "../src/lib/psp.suivi.rapprochement.ts";

const url = process.env["EXT_SUPABASE_URL"];
const key = process.env["EXT_SUPABASE_SERVICE_ROLE_KEY"];
if (!url || !key) {
  console.error("EXT_SUPABASE_URL / EXT_SUPABASE_SERVICE_ROLE_KEY manquantes");
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

const comptage = async (table) => {
  const { count } = await db.from(table).select("id", { count: "exact", head: true });
  return count;
};

async function main() {
  // 1. SNAPSHOT — toutes les tables de vérité.
  const avant = {
    liens: await comptage("psp_command_links"),
    lignes: await comptage("psp_lignes"),
    commandes: await comptage("travaux_commandes"),
    historiques: await comptage("travaux_commandes_historique"),
    devis: await comptage("psp_devis"),
    importRows: await comptage("psp_import_rows"),
    importTravaux: await comptage("import_travaux"),
    imports: await comptage("imports"),
    pspImports: await comptage("psp_imports"),
    histLignes: await comptage("psp_ligne_historique"),
  };

  // Opération réelle (identité = psp_lignes.id).
  const { data: lignes } = await db
    .from("psp_lignes")
    .select("id, tranche_code, corps_etat, nature_travaux, programme, origine")
    .limit(10);
  const operation = (lignes ?? [])[0];
  check("opération réelle trouvée", !!operation?.id);

  // Commande réelle avec import_row réel (comme V8.5.3).
  const { data: cmds } = await db
    .from("travaux_commandes")
    .select("id, numero_commande, tranche_code, adresse, corps_etat, descriptif, fournisseur, numero_fournisseur, budget, annee_exercice, etat_travaux")
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
  check(
    "commande avec import_row réel trouvée",
    !!commande?.id && !!rows?.[0]?.id,
    `cmd=${commande?.id?.slice(0, 8)}`,
  );

  // 2–3. ANALYSE — le moteur V8.5.1 analyse la commande contre les opérations
  // (aucune écriture). Période en critère d'appui.
  if (operation?.id && commande?.id) {
    const annees = Object.keys(operation.programme ?? {}).map(Number).filter((a) => Number.isFinite(a));
    const relation = determinerRelationPeriode(annees, commande.annee_exercice ?? null, null);
    check("A. relation de période dérivée", ["historique", "courant", "futur", "inconnu"].includes(relation.type), relation.libelle);

    // Proposition via le moteur pur (structure minimale des fixtures réelles).
    const ops = [{
      id: operation.id,
      tranche_code: operation.tranche_code,
      categorie: null,
      corps_etat: operation.corps_etat,
      nature_travaux: operation.nature_travaux,
      ligne_budget: null,
      origine: operation.origine ?? "preparation",
      montant_total: null,
      perimetres: [],
      entreprises_consultees: [],
    }];
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
    check("B. moteur analysable (recherche inversée)", Array.isArray(props));
    check("B. niveau retourné conforme", props.every((p) => ["AUTO", "A_CONFIRMER", "MANUEL"].includes(p.niveau)));

    // 6. RECHERCHE MANUELLE — mêmes critères que rechercherCommandes
    // (n° commande, TR, adresse, descriptif, fournisseur) via ILIKE.
    const num = String(commande.numero_commande).trim();
    const { data: parNum } = await db
      .from("travaux_commandes")
      .select("id, numero_commande")
      .ilike("numero_commande", `%${num.slice(0, 6)}%`)
      .limit(5);
    check("C. recherche par n° commande", (parNum ?? []).some((r) => r.id === commande.id));

    if (commande.tranche_code) {
      const { data: parTr } = await db
        .from("travaux_commandes")
        .select("id")
        .ilike("tranche_code", `%${commande.tranche_code}%`)
        .limit(20);
      check("D. recherche par TR", (parTr ?? []).some((r) => r.id === commande.id));
    } else {
      check("D. recherche par TR (champ absent — ignoré)", true);
    }

    if (commande.adresse) {
      const mot = String(commande.adresse).split(/\s+/).find((w) => w.length > 3);
      const { data: parAdr } = await db
        .from("travaux_commandes")
        .select("id")
        .ilike("adresse", `%${mot}%`)
        .limit(20);
      check("E. recherche par adresse", (parAdr ?? []).some((r) => r.id === commande.id));
    } else {
      check("E. recherche par adresse (champ absent — ignoré)", true);
    }

    if (commande.fournisseur) {
      const mot = String(commande.fournisseur).split(/\s+/).find((w) => w.length > 3);
      const { data: parF } = await db
        .from("travaux_commandes")
        .select("id")
        .ilike("fournisseur", `%${mot}%`)
        .limit(20);
      check("F. recherche par fournisseur", (parF ?? []).some((r) => r.id === commande.id));
    } else {
      check("F. recherche par fournisseur (champ absent — ignoré)", true);
    }

    if (commande.descriptif) {
      const mot = String(commande.descriptif).split(/\s+/).find((w) => w.length > 4);
      const { data: parDesc } = await db
        .from("travaux_commandes")
        .select("id")
        .ilike("descriptif", `%${mot}%`)
        .limit(20);
      check("G. recherche par descriptif", (parDesc ?? []).some((r) => r.id === commande.id));
    } else {
      check("G. recherche par descriptif (champ absent — ignoré)", true);
    }
  } else {
    check("données suffisantes", false, "opération ou commande manquante");
  }

  // 4–5. RATTACHEMENT (workflow V8.5.3 : confirmation → lien → invalidation →
  // rafraîchissement) puis vérification.
  let lienId = null;
  if (operation?.id && commande?.id && rows?.[0]?.id) {
    const { data: lien, error: errC } = await db
      .from("psp_command_links")
      .insert({
        commande_id: commande.id,
        import_row_id: rows[0].id,
        psp_ligne_id: operation.id,
        type_relation: "rattachement_ligne",
        methode: "manuel",
        confiance: 1,
        statut: "valide",
        justification: "Validation manuelle V8.5.4 (recherche)",
      })
      .select("id, commande_id, psp_ligne_id, methode, statut")
      .single();
    if (lien?.id) {
      lienId = lien.id;
      check("H. rattachement créé", true);
      check("H2. methode = manuel, statut = valide", lien.methode === "manuel" && lien.statut === "valide");

      // Anti-doublon serveur : un second lien sur la même commande doit échouer.
      const { error: errDup } = await db
        .from("psp_command_links")
        .insert({
          commande_id: commande.id,
          import_row_id: rows[0].id,
          psp_ligne_id: operation.id,
          type_relation: "rattachement_ligne",
          methode: "manuel",
          confiance: 1,
          statut: "valide",
          justification: "doublon test",
        })
        .select("id")
        .single();
      check("I. anti-doublon : doublon refusé", !!errDup, errDup?.message);

      const { count: nb } = await db
        .from("psp_command_links")
        .select("id", { count: "exact", head: true })
        .eq("commande_id", commande.id);
      check("I2. un seul lien pour cette commande", nb === 1, `nb=${nb}`);

      // La commande apparaît maintenant « déjà rattachée » (recherche croisée).
      const { data: croise } = await db
        .from("psp_command_links")
        .select("id, psp_ligne_id, methode, statut")
        .eq("commande_id", commande.id)
        .single();
      check(
        "J. commande déjà rattachée à une opération (pas de rattachement silencieux)",
        croise?.psp_ligne_id === operation.id && croise?.statut === "valide",
      );
      check("J2. opération cible affichable", croise?.psp_ligne_id === operation.id);
    } else {
      check("H. création du lien", false, errC?.message);
    }
  } else {
    check("données suffisantes pour rattachement", false);
  }

  // 7. RETRAIT du lien (uniquement le lien — aucune autre écriture).
  if (lienId) {
    const { error: errDel } = await db.from("psp_command_links").delete().eq("id", lienId);
    check("K. retrait du lien OK", !errDel, errDel?.message);
    const { count: restant } = await db
      .from("psp_command_links")
      .select("id", { count: "exact", head: true })
      .eq("commande_id", commande.id);
    check("K2. lien retiré (0 restant)", restant === 0);
    lienId = null;
  }

  // 8. VÉRIFICATION RETOUR À L'ÉTAT INITIAL (9 tables — imports STRICTEMENT identiques).
  const apres = {
    liens: await comptage("psp_command_links"),
    lignes: await comptage("psp_lignes"),
    commandes: await comptage("travaux_commandes"),
    historiques: await comptage("travaux_commandes_historique"),
    devis: await comptage("psp_devis"),
    importRows: await comptage("psp_import_rows"),
    importTravaux: await comptage("import_travaux"),
    imports: await comptage("imports"),
    pspImports: await comptage("psp_imports"),
    histLignes: await comptage("psp_ligne_historique"),
  };
  check("INTÉGRITÉ psp_command_links", avant.liens === apres.liens, `${avant.liens} vs ${apres.liens}`);
  check("INTÉGRITÉ psp_lignes", avant.lignes === apres.lignes);
  check("INTÉGRITÉ travaux_commandes", avant.commandes === apres.commandes);
  check("INTÉGRITÉ travaux_commandes_historique", avant.historiques === apres.historiques);
  check("INTÉGRITÉ psp_devis", avant.devis === apres.devis);
  check("INTÉGRITÉ psp_import_rows", avant.importRows === apres.importRows);
  check("INTÉGRITÉ import_travaux", avant.importTravaux === apres.importTravaux);
  check("INTÉGRITÉ imports", avant.imports === apres.imports);
  check("INTÉGRITÉ psp_imports", avant.pspImports === apres.pspImports);
  check("INTÉGRITÉ psp_ligne_historique", avant.histLignes === apres.histLignes);

  console.log(`\nV8.5.4 LIVE : ${passed} ok, ${failed} échec(s)`);
  if (failed > 0) process.exit(1);
}

main();
