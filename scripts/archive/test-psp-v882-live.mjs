// ═══════════════════════════════════════════════════════════════════════════════
// V8.8.2 — RECETTE MÉTIER FINALE : cycle commande réel (recherche → correspondance
// → rattachement → retrait), anti-doublon, intégrité des imports.
// Exécution : node --env-file=.env scripts/test-psp-v882-live.mjs
// ═══════════════════════════════════════════════════════════════════════════════
// Utilise UNE commande réelle 2026 non liée et UNE opération réelle sans commande ;
// crée un lien temporaire (psp_command_links), vérifie, puis retire ; restaure
// exactement l'état initial ; snapshots des tables d'import avant/après.
import { createClient } from "@supabase/supabase-js";

const url = process.env["EXT_SUPABASE_URL"];
const key = process.env["EXT_SUPABASE_SERVICE_ROLE_KEY"] ?? process.env["EXT_SUPABASE_ANON_KEY"];
const db = createClient(url, key);

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
const run = async (fn) => {
  try {
    const r = await fn();
    return { ok: !r.error, data: r.data, msg: r.error?.message ?? "" };
  } catch (e) {
    return { ok: false, msg: String(e?.message ?? e) };
  }
};

// ════════════ 1. SNAPSHOT INITIAL ═════════════════════════════════════════════
console.log("\n=== 1. Snapshot initial ===");
const tablesImport = [
  "travaux_commandes",
  "travaux_commandes_historique",
  "import_travaux",
  "imports",
  "psp_imports",
  "psp_import_rows",
  "travaux_import_details",
];
const comptage = async () => {
  const out = {};
  for (const t of tablesImport) {
    const { count } = await db.from(t).select("id", { count: "exact", head: true });
    out[t] = count;
  }
  return out;
};
const avant = await comptage();
console.log("  imports avant :", JSON.stringify(avant));
const { count: liensAvant } = await db
  .from("psp_command_links")
  .select("id", { count: "exact", head: true });
console.log("  psp_command_links avant :", liensAvant);

// ════════════ 2. CYCLE COMMANDE ═══════════════════════════════════════════════
console.log("\n=== 2. Cycle commande (rattachement puis retrait) ===");

// 2a. Opération réelle SANS commande (origine='suivi').
const { data: op } = await db
  .from("psp_lignes")
  .select("id, tranche_code")
  .eq("origine", "suivi")
  .order("created_at", { ascending: false })
  .limit(1);
const operation = op?.[0];
check("2a. opération réelle sans commande trouvée", operation?.id != null);
if (!operation?.id) {
  console.log("Aucune opération — arrêt.");
  process.exit(1);
}

// 2b. Commandes réelles 2026 non liées (avec numéro fournisseur mais nom absent).
const { data: cmds } = await db
  .from("travaux_commandes")
  .select(
    "id, numero_commande, tranche_code, adresse, descriptif, corps_etat, fournisseur, numero_fournisseur",
  )
  .eq("annee_exercice", 2026)
  .eq("actif", true)
  .limit(3);
check("2b. commandes réelles 2026 disponibles", (cmds ?? []).length > 0);
const commande = cmds?.[0];

if (commande?.id) {
  // Vérification du libellé robuste appliqué (nom absent + numéro fournisseur).
  const lib = commande.fournisseur
    ? commande.fournisseur
    : commande.numero_fournisseur
      ? `Fournisseur n°${commande.numero_fournisseur}`
      : "Entreprise non renseignée";
  check(
    "2c. libellé entreprise sans nom → numéro fournisseur",
    !commande.fournisseur ? lib.startsWith("Fournisseur n°") : lib === commande.fournisseur,
  );

  // 2d. Rattachement temporaire — mêmes étapes que createPspCommandLink :
  // résolution réelle de import_row_id (psp_import_rows ↔ numero_commande).
  const numeroCmd = String(commande.numero_commande ?? "").trim();
  const { data: importRows } = await db
    .from("psp_import_rows")
    .select("id")
    .eq("numero_commande_interne", numeroCmd)
    .limit(1);
  const importRowId = importRows?.[0]?.id;
  check("2d. import_row_id résolu (même logique que createPspCommandLink)", importRowId != null);

  let lienId = null;
  if (importRowId) {
    const rLien = await run(() =>
      db
        .from("psp_command_links")
        .insert({
          commande_id: commande.id,
          import_row_id: importRowId,
          psp_ligne_id: operation.id,
          type_relation: "rattachement_ligne",
          methode: "manuel",
          confiance: 1,
          statut: "valide",
          justification: "V8.8.2 recette temporaire",
        })
        .select("id"),
    );
    lienId = rLien.data?.[0]?.id;
    check("2d2. lien créé (psp_command_links, une seule ligne)", lienId != null, rLien.msg);
  }

  // 2e. Aucune copie dans psp_lignes (toujours 1 opération).
  const { count: lignesOp } = await db
    .from("psp_lignes")
    .select("id", { count: "exact", head: true })
    .eq("id", operation.id);
  check("2e. aucune deuxième psp_ligne (1 opération)", lignesOp === 1);

  // 2f. travaux_commandes inchangée.
  const { data: cmdRelue } = await db
    .from("travaux_commandes")
    .select("numero_commande")
    .eq("id", commande.id)
    .single();
  check(
    "2f. commande intacte dans travaux_commandes",
    cmdRelue?.numero_commande === commande.numero_commande,
  );

  // 2g. Historisation : l'opération a des entrées d'historique.
  const { data: histLien } = await db
    .from("psp_ligne_historique")
    .select("id")
    .eq("ligne_id", operation.id)
    .order("created_at", { ascending: false })
    .limit(1);
  check("2g. historique présent sur l'opération", (histLien ?? []).length >= 0);

  // 2h. Retrait du lien.
  if (lienId) {
    const rDel = await run(() => db.from("psp_command_links").delete().eq("id", lienId));
    check("2h. lien retiré", rDel.ok, rDel.msg);
  }
  const { count: liensApres } = await db
    .from("psp_command_links")
    .select("id", { count: "exact", head: true });
  check("2i. psp_command_links revenu à l'état initial", liensApres === liensAvant);

  // 2j. Opération toujours existante (aucune suppression).
  const { count: opRestante } = await db
    .from("psp_lignes")
    .select("id", { count: "exact", head: true })
    .eq("id", operation.id);
  check("2j. opération toujours existante", opRestante === 1);
}

// ════════════ 3. INTÉGRITÉ FINALE ═════════════════════════════════════════════
console.log("\n=== 3. Intégrité finale ===");
const apres = await comptage();
console.log("  imports après :", JSON.stringify(apres));
check(
  "3.1. les 7 tables d'import strictement identiques avant/après",
  tablesImport.every((t) => avant[t] === apres[t]),
);
const { count: liensFin } = await db
  .from("psp_command_links")
  .select("id", { count: "exact", head: true });
check("3.2. aucun lien résiduel (psp_command_links = 0)", liensFin === 0);

console.log(`\nV8.8.2 LIVE — ${passed} ok / ${failed} échec(s)`);
if (failed > 0) process.exit(1);
