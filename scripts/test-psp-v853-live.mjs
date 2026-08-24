// ═══════════════════════════════════════════════════════════════════════════════
// V8.5.3 — VALIDATION MANUELLE DU RATTACHEMENT : tests LIVE.
// Exécution : node --env-file=.env scripts/test-psp-v853-live.mjs
// ═══════════════════════════════════════════════════════════════════════════════
import { createClient } from "@supabase/supabase-js";

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
  const avant = {
    liens: await comptage("psp_command_links"),
    lignes: await comptage("psp_lignes"),
    commandes: await comptage("travaux_commandes"),
    historiques: await comptage("travaux_commandes_historique"),
    devis: await comptage("psp_devis"),
    importRows: await comptage("psp_import_rows"),
    imports: await comptage("import_travaux"),
    histLignes: await comptage("psp_ligne_historique"),
  };

  const { data: lignes } = await db
    .from("psp_lignes")
    .select("id, tranche_code, corps_etat")
    .limit(10);
  const operation = (lignes ?? [])[0];
  check("opération réelle trouvée", !!operation?.id);

  const { data: cmds } = await db
    .from("travaux_commandes")
    .select("id, numero_commande, tranche_code")
    .not("numero_commande", "is", null)
    .limit(50);
  const nums = (cmds ?? []).map((c) => String(c.numero_commande).trim());
  const { data: rows } = await db
    .from("psp_import_rows")
    .select("id, numero_commande_interne")
    .in("numero_commande_interne", nums);
  const pairs = rows ?? [];
  const commande = pairs[0]
    ? (cmds ?? []).find(
        (c) => String(c.numero_commande).trim() === pairs[0].numero_commande_interne,
      )
    : null;
  check(
    "commande avec import_row réel trouvée",
    !!commande?.id && !!pairs[0]?.id,
    `cmd=${commande?.id?.slice(0, 8)}`,
  );

  let lienId = null;
  if (operation?.id && commande?.id && pairs[0]?.id) {
    const { data: lien, error: errC } = await db
      .from("psp_command_links")
      .insert({
        commande_id: commande.id,
        import_row_id: pairs[0].id,
        psp_ligne_id: operation.id,
        type_relation: "rattachement_ligne",
        methode: "manuel",
        confiance: 1,
        statut: "valide",
        justification: "Validation manuelle par l'utilisateur",
      })
      .select("id, commande_id, psp_ligne_id, methode, confiance, statut")
      .single();
    if (lien?.id) {
      lienId = lien.id;
      check("A. lien créé", true);
      check("C. methode = manuel", lien.methode === "manuel");
      check("D. statut = valide", lien.statut === "valide");
      check("E. confiance = 1", lien.confiance === 1);
      check(
        "F. lien opération correcte",
        lien.psp_ligne_id === operation.id && lien.commande_id === commande.id,
      );

      const { error: errDup } = await db
        .from("psp_command_links")
        .insert({
          commande_id: commande.id,
          import_row_id: pairs[0].id,
          psp_ligne_id: operation.id,
          type_relation: "rattachement_ligne",
          methode: "manuel",
          confiance: 1,
          statut: "valide",
          justification: "doublon test",
        })
        .select("id")
        .single();
      check("G. anti-doublon : doublon refusé", !!errDup, errDup?.message);
      const { count: nbLiens } = await db
        .from("psp_command_links")
        .select("id", { count: "exact", head: true })
        .eq("commande_id", commande.id);
      check("G2. un seul lien pour cette commande", nbLiens === 1, `nb=${nbLiens}`);

      const { data: relecture } = await db
        .from("psp_command_links")
        .select("id, methode, statut")
        .eq("id", lienId)
        .single();
      check("H. lien relisible (après écriture)", relecture?.id === lienId);

      const { error: errDel } = await db.from("psp_command_links").delete().eq("id", lienId);
      check("I. retrait du lien OK", !errDel, errDel?.message);
      const { count: restant } = await db
        .from("psp_command_links")
        .select("id", { count: "exact", head: true })
        .eq("commande_id", commande.id);
      check("I2. lien retiré (0 restant)", restant === 0);
      lienId = null;
    } else {
      check("A. création du lien", false, errC?.message);
    }
  } else {
    check("données suffisantes", false, "opération ou commande manquante");
  }

  const apres = {
    liens: await comptage("psp_command_links"),
    lignes: await comptage("psp_lignes"),
    commandes: await comptage("travaux_commandes"),
    historiques: await comptage("travaux_commandes_historique"),
    devis: await comptage("psp_devis"),
    importRows: await comptage("psp_import_rows"),
    imports: await comptage("import_travaux"),
    histLignes: await comptage("psp_ligne_historique"),
  };
  check(
    "INTÉGRITÉ psp_command_links",
    avant.liens === apres.liens,
    `${avant.liens} vs ${apres.liens}`,
  );
  check("INTÉGRITÉ psp_lignes", avant.lignes === apres.lignes);
  check("INTÉGRITÉ travaux_commandes", avant.commandes === apres.commandes);
  check("INTÉGRITÉ travaux_commandes_historique", avant.historiques === apres.historiques);
  check("INTÉGRITÉ psp_devis", avant.devis === apres.devis);
  check("INTÉGRITÉ psp_import_rows", avant.importRows === apres.importRows);
  check("INTÉGRITÉ import_travaux", avant.imports === apres.imports);
  check("INTÉGRITÉ psp_ligne_historique", avant.histLignes === apres.histLignes);

  console.log(`\nV8.5.3 LIVE : ${passed} ok, ${failed} échec(s)`);
  if (failed > 0) process.exit(1);
}

main();
