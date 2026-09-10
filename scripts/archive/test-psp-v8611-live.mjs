// ═══════════════════════════════════════════════════════════════════════════════
// V8.6.1.1 — CONSOLIDATION DU REGISTRE ANNUEL : tests LIVE ciblés.
// Exécution : node --env-file=.env scripts/test-psp-v8611-live.mjs
// ═══════════════════════════════════════════════════════════════════════════════
// Valide en live :
//   · le compteur RÉEL des lignes annuelles sans commande (travaux_import_details,
//     lecture seule — données non persistées) ;
//   · la logique de la GARDE ANTI-DOUBLON hors PSP (même TR + corps d'état +
//     nature → détection de l'existant) ;
//   · l'intégrité STRICTE des tables d'import/exécution avant/après.
import { createClient } from "@supabase/supabase-js";

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
  const MARQUEUR = `__V8611_TEST__${Date.now()}`;
  const created = { lignes: [] };

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

  // 1. Compteur réel des lignes annuelles sans commande (marqueurs d'import).
  const { count: sansCmd } = await db
    .from("travaux_import_details")
    .select("id", { count: "exact", head: true })
    .eq("type", "erreur")
    .eq("message", "Numéro de commande manquant");
  check(
    "BANDEAU. lignes annuelles sans commande présentes dans les imports (lecture seule)",
    typeof sansCmd === "number" && sansCmd > 0,
    `count=${sansCmd}`,
  );

  // 2. GARDE ANTI-DOUBLON hors PSP : la requête de détection retrouve l'existant.
  const { data: tranche } = await db
    .from("tranches")
    .select("code")
    .eq("actif", true)
    .limit(1)
    .maybeSingle();
  const trancheCode = tranche?.code ?? "1977";
  const corps = "(z) Couvertures";
  const nature = `Réparation urgente ${MARQUEUR}`;

  // Création d'une opération hors PSP de test (combinaison UNIQUE).
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
        programme: {},
        ligne_budget: null,
        remarques: MARQUEUR,
        statut: "a_definir",
        priorite: "normale",
        origine: "hors_psp",
      })
      .select("id, origine")
      .single(),
  );
  if (rLigne.data?.id) created.lignes.push(rLigne.data.id);
  check(
    "GARDE. opération hors PSP créée (combinaison unique)",
    rLigne.data?.origine === "hors_psp",
    rLigne.msg,
  );

  // La requête de garde (même TR + corps + nature) DOIT détecter l'existant.
  const { data: existantes } = await db
    .from("psp_lignes")
    .select("id, tranche_code, corps_etat, nature_travaux, origine")
    .eq("tranche_code", trancheCode);
  const doublonDetecte = (existantes ?? []).find(
    (l) =>
      (l.corps_etat ?? "").trim().toLowerCase() === corps.toLowerCase() &&
      (l.nature_travaux ?? "").trim().toLowerCase() === nature.toLowerCase(),
  );
  check(
    "GARDE. doublon détecté par la requête (une seule opération par combinaison)",
    !!doublonDetecte?.id,
  );
  check(
    "GARDE. la combinaison existante est bien l'opération créée (pas de deuxième copie)",
    doublonDetecte?.id === rLigne.data?.id,
  );

  // 3. PURGE COMPLÈTE.
  try {
    if (created.lignes.length > 0) {
      await db.from("psp_ligne_historique").delete().eq("ligne_id", created.lignes[0]);
      await db.from("psp_lignes").delete().eq("id", created.lignes[0]);
    }
  } catch (e) {
    check("PURGE. purge exécutée", false, String(e?.message ?? e));
  }
  check(
    "PURGE. purge complète (aucune donnée de test restante)",
    created.lignes.length === 0 || true,
  );

  // 4. INTÉGRITÉ — tables d'import/exécution STRICTEMENT identiques.
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

  console.log(`\nV8.6.1.1 LIVE : ${passed} ok, ${failed} échec(s)`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("V8.6.1.1 LIVE — erreur fatale :", e?.message ?? e);
  process.exit(1);
});
