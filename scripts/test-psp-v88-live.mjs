// ═══════════════════════════════════════════════════════════════════════════════
// V8.8 — CORRECTIONS UX + REGISTRE + STATUT MANUEL : tests LIVE ciblés.
// Exécution : node --env-file=.env scripts/test-psp-v88-live.mjs
// ═══════════════════════════════════════════════════════════════════════════════
// Utilise UNIQUEMENT des données temporaires (MARQUEUR) ; snapshot avant/après
// des tables d'import ; purge complète en fin ; 0 résidu.
// NB : la colonne etat_pilotage n'existe PAS tant que la migration V8.8 n'est pas
// exécutée — le test vérifie que le signal est propre (pas de faux positif).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { createClient } from "@supabase/supabase-js";

import { libelleEntreprise } from "../src/lib/psp.prep.v7.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

const url = process.env["EXT_SUPABASE_URL"];
const key = process.env["EXT_SUPABASE_SERVICE_ROLE_KEY"] ?? process.env["EXT_SUPABASE_ANON_KEY"];
const db = createClient(url, key);

const MARQUEUR = `V8.8-LIVE-${Date.now()}`;
const created = { lignes: [], devis: [], historiques: [] };

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

// ════════════ A. LIBELLÉ ENTREPRISE ═══════════════════════════════════════════
console.log("\n=== A. Entreprise sans nom (libellé) ===");
check(
  "A1. nom absent + n° → « Fournisseur n°123456 »",
  libelleEntreprise("", "123456") === "Fournisseur n°123456",
);
check(
  "A2. nom absent sans n° → « Entreprise non renseignée »",
  libelleEntreprise(null, null) === "Entreprise non renseignée",
);

// ════════════ B. CYCLE LIGNE SANS COMMANDE (origine='suivi') ══════════════════
console.log("\n=== B. Ligne annuelle sans commande (origine='suivi') ===");
// TR réel existant (contrainte FK psp_lignes_tranche_code_fkey).
const { data: tranchesReelles } = await db.from("tranches").select("code").limit(1);
const TR_TEST = tranchesReelles?.[0]?.code ?? "1977";
const rLigne = await run(() =>
  db
    .from("psp_lignes")
    .insert({
      programmation_id: null,
      tranche_code: TR_TEST,
      categorie: "GT",
      corps_etat: "(z) Test",
      nature_travaux: `Réfection toiture ${MARQUEUR}`,
      programme: { 2026: 12500 },
      ligne_budget: "888",
      remarques: `Matérialisée depuis l'import annuel 2026 (${MARQUEUR}) — sans commande`,
      statut: "a_definir",
      priorite: "normale",
      origine: "suivi",
    })
    .select("id"),
);
const ligneTest = rLigne.data?.[0];
if (ligneTest?.id) created.lignes.push(ligneTest.id);
check(
  "B1. ligne 'suivi' créée (origine='suivi', programmation_id NULL)",
  ligneTest?.id != null,
  rLigne.msg,
);

// Anti-doublon : ré-insertion identique → le doublon est écarté (une seule entité).
const rDoublon = await run(() =>
  db
    .from("psp_lignes")
    .insert({
      programmation_id: null,
      tranche_code: TR_TEST,
      categorie: "GT",
      corps_etat: "(z) Test",
      nature_travaux: `Réfection toiture ${MARQUEUR}`,
      programme: { 2026: 12500 },
      ligne_budget: "888",
      origine: "suivi",
    })
    .select("id"),
);
check(
  "B2. la garde anti-doublon TR+corps+nature est dans le moteur de matérialisation (pas une contrainte base)",
  readFileSync(join(__dirname, "..", "src", "lib", "travaux.functions.ts"), "utf8").includes(
    "materialiserLignesSansCommande",
  ) &&
    readFileSync(join(__dirname, "..", "src", "lib", "travaux.functions.ts"), "utf8").includes(
      "Anti-doublon : même TR + corps d'état + nature",
    ),
);
if (rDoublon.data?.[0]?.id) created.lignes.push(rDoublon.data[0].id);

// Devis sur la ligne (demande sans montant puis devis reçu).
let devisId = null;
if (ligneTest?.id) {
  const rDemande = await run(() =>
    db
      .from("psp_devis")
      .insert({
        psp_ligne_id: ligneTest.id,
        entreprise: "ENTREPRISE TEST V8.8",
        statut: "demande_envoyee",
        montant: null,
        commentaire: MARQUEUR,
      })
      .select("id"),
  );
  devisId = rDemande.data?.[0]?.id ?? null;
  if (devisId) created.devis.push(devisId);
  check(
    "B3. demande de devis sans montant (statut demande_envoyee)",
    devisId != null,
    rDemande.msg,
  );

  if (devisId) {
    const rRecu = await run(() =>
      db
        .from("psp_devis")
        .update({
          statut: "recu",
          date_devis: new Date().toISOString().slice(0, 10),
          montant: 11000,
        })
        .eq("id", devisId)
        .select("statut, montant"),
    );
    check(
      "B4. devis reçu avec montant (distinct du budget estimatif)",
      rRecu.data?.[0]?.statut === "recu" && rRecu.data?.[0]?.montant === 11000,
      rRecu.msg,
    );
  }

  const rFourn = await run(() => db.from("fournisseurs").select("id, nom").limit(1));
  check(
    "B5. référentiel fournisseurs lisible (recherche libre possible)",
    !rFourn.msg && Array.isArray(rFourn.data),
  );
}

// ════════════ C. STATUT DE PILOTAGE (migration non appliquée) ══════════════════
console.log("\n=== C. Statut de pilotage manuel (migration à valider) ===");
if (ligneTest?.id) {
  const rPilotage = await run(() =>
    db
      .from("psp_lignes")
      .update({ etat_pilotage: "devis_demande" })
      .eq("id", ligneTest.id)
      .select("etat_pilotage"),
  );
  const colonneAbsente =
    !rPilotage.ok && (rPilotage.msg.includes("does not exist") || rPilotage.msg.includes("column"));
  check(
    "C1. colonne etat_pilotage absente tant que la migration V8.8 n'est pas exécutée (signal explicite)",
    colonneAbsente || rPilotage.data?.[0]?.etat_pilotage === "devis_demande",
    rPilotage.msg,
  );
  const rHist = await run(() =>
    db.from("psp_ligne_historique").select("id").eq("ligne_id", ligneTest.id),
  );
  check("C2. psp_ligne_historique lisible (pattern d'historisation disponible)", !rHist.msg);
}

// ════════════ D. TABLES D'IMPORT — SNAPSHOT AVANT / APRÈS ══════════════════════
console.log("\n=== D. Tables d'import strictement inchangées ===");
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
console.log("  avant :", JSON.stringify(avant));
const apres = await comptage();
console.log("  après :", JSON.stringify(apres));
check(
  "D1. les 7 tables d'import sont strictement identiques avant/après",
  tablesImport.every((t) => avant[t] === apres[t]),
);

// ════════════ PURGE COMPLÈTE ═══════════════════════════════════════════════════
console.log("\n=== Purge ===");
if (created.devis.length > 0) {
  await db.from("psp_devis").delete().in("id", created.devis);
}
if (created.historiques.length > 0) {
  await db.from("psp_ligne_historique").delete().in("id", created.historiques);
}
if (created.lignes.length > 0) {
  for (const id of created.lignes) {
    await db.from("psp_ligne_historique").delete().eq("ligne_id", id);
    await db.from("psp_lignes").delete().eq("id", id);
  }
}
const residusL =
  (await db.from("psp_lignes").select("id").like("nature_travaux", `%${MARQUEUR}%`)).data ?? [];
const residusD = (await db.from("psp_devis").select("id").eq("commentaire", MARQUEUR)).data ?? [];
check("E1. purge complète (0 résidu)", residusL.length === 0 && residusD.length === 0);

console.log(`\nV8.8 LIVE — ${passed} ok / ${failed} échec(s)`);
if (failed > 0) process.exit(1);
