// ═══════════════════════════════════════════════════════════════════════════════
// V8.8.1 — VALIDATION LIVE DU STATUT DE PILOTAGE.
// Exécution : node --env-file=.env scripts/test-psp-v881-live.mjs
// ═══════════════════════════════════════════════════════════════════════════════
// Utilise UNE opération réelle EXISTANTE (origine='suivi') ; sauvegarde son état
// initial ; teste a_traiter → devis_demande → prioritaire → retour initial ;
// vérifie l'historisation automatique (trigger psp_lignes_history existant :
// avant/apres JSONB complets) ; snapshots des tables d'import avant/après ;
// 0 donnée résiduelle (la ligne et son historique reviennent à l'état initial).
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
const { data: op } = await db
  .from("psp_lignes")
  .select(
    "id, tranche_code, origine, statut, etat_pilotage, programmation_id, programme, ligne_budget",
  )
  .eq("origine", "suivi")
  .order("created_at", { ascending: false })
  .limit(1);
const ligne = op?.[0];
check("1.1. opération réelle existante trouvée (origine='suivi')", ligne?.id != null);
if (!ligne?.id) {
  console.log("Aucune opération réelle — arrêt.");
  process.exit(1);
}
const ETAT_INITIAL = ligne.etat_pilotage ?? null;
console.log(
  `  opération ${ligne.id.slice(0, 8)} · TR ${ligne.tranche_code} · origine ${ligne.origine}`,
);
console.log(`  etat_pilotage initial : ${JSON.stringify(ETAT_INITIAL)}`);

// Snapshot historique avant (ids + états).
const { data: histAvant } = await db
  .from("psp_ligne_historique")
  .select("id")
  .eq("ligne_id", ligne.id);
const histAvantIds = new Set((histAvant ?? []).map((h) => h.id));
console.log(`  historique avant : ${histAvantIds.size} entrée(s)`);

// Snapshots tables d'import.
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

// ════════════ 2. CYCLE DE STATUTS (historisation via trigger existant) ════════
console.log("\n=== 2. Cycle de statuts de pilotage ===");

// Le trigger psp_lignes_history écrit une entrée 'modification' avec avant/apres
// complets à chaque UPDATE. On ne fait QUE l'update (comme la server function).
async function setEtat(valeur) {
  return run(() =>
    db
      .from("psp_lignes")
      .update({ etat_pilotage: valeur })
      .eq("id", ligne.id)
      .select("id, etat_pilotage"),
  );
}

// 2.1 → 'a_traiter'
const r1 = await setEtat("a_traiter");
const l1 = await run(() =>
  db.from("psp_lignes").select("etat_pilotage").eq("id", ligne.id).single(),
);
check(
  "2.1. a_traiter écrit + lu immédiatement",
  r1.ok && l1.data?.etat_pilotage === "a_traiter",
  r1.msg,
);

// 2.2 → 'devis_demande'
const r2 = await setEtat("devis_demande");
const l2 = await run(() =>
  db.from("psp_lignes").select("etat_pilotage").eq("id", ligne.id).single(),
);
check("2.2. devis_demande écrit + lu", r2.ok && l2.data?.etat_pilotage === "devis_demande", r2.msg);

// 2.3 → 'prioritaire'
const r3 = await setEtat("prioritaire");
const l3 = await run(() =>
  db.from("psp_lignes").select("etat_pilotage").eq("id", ligne.id).single(),
);
check("2.3. prioritaire écrit + lu", r3.ok && l3.data?.etat_pilotage === "prioritaire", r3.msg);

// 2.4 → valeur interdite : le CHECK SQL refuse, aucune écriture.
const rInterdit = await run(() =>
  db
    .from("psp_lignes")
    .update({ etat_pilotage: "terminee" })
    .eq("id", ligne.id)
    .select("id, etat_pilotage"),
);
const lApresInterdit = await run(() =>
  db.from("psp_lignes").select("etat_pilotage").eq("id", ligne.id).single(),
);
check(
  "2.4. valeur interdite refusée par le CHECK SQL (aucune écriture)",
  !rInterdit.ok && lApresInterdit.data?.etat_pilotage === "prioritaire",
  rInterdit.msg,
);

// 2.5 → retour à l'état initial
const rRetour = await setEtat(ETAT_INITIAL);
const lFinal = await run(() =>
  db.from("psp_lignes").select("etat_pilotage").eq("id", ligne.id).single(),
);
check(
  "2.5. retour à l'état initial",
  rRetour.ok && lFinal.data?.etat_pilotage === ETAT_INITIAL,
  rRetour.msg,
);

// ════════════ 3. HISTORISATION (trigger existant) ══════════════════════════════
console.log("\n=== 3. Historisation (psp_ligne_historique) ===");
const { data: histApres } = await db
  .from("psp_ligne_historique")
  .select("id, operation, avant, apres, created_at")
  .eq("ligne_id", ligne.id)
  .order("created_at", { ascending: false });
const nouvelles = (histApres ?? []).filter((h) => !histAvantIds.has(h.id));
// Transitions d'état de pilotage observées dans avant/apres (JSONB complets).
const transitions = nouvelles
  .map((h) => ({
    avant: h.avant?.etat_pilotage ?? null,
    apres: h.apres?.etat_pilotage ?? null,
  }))
  .filter((t) => t.avant !== t.apres);
check(
  "3.1. entrées historisées à chaque changement (a_traiter, devis_demande, prioritaire, retour)",
  transitions.length >= 4,
  `(${transitions.length})`,
);
check(
  "3.2. chaque changement indique l'ancien et le nouvel état (avant/apres distincts)",
  transitions.some((t) => t.apres === "a_traiter") &&
    transitions.some((t) => t.apres === "devis_demande") &&
    transitions.some((t) => t.apres === "prioritaire"),
);
check(
  "3.3. le retour à l'état initial est historisé",
  transitions.some((t) => t.apres === ETAT_INITIAL && t.avant !== ETAT_INITIAL),
);
check(
  "3.4. mécanisme existant (psp_ligne_historique, opération 'modification') — aucun parallèle",
  nouvelles.every((h) => h.operation === "modification"),
);
// Nettoyage : on supprime les entrées créées par CE test (aucune donnée réelle
// supprimée — la ligne retrouvera son état initial en 4.2).
if (nouvelles.length > 0) {
  await db
    .from("psp_ligne_historique")
    .delete()
    .in(
      "id",
      nouvelles.map((h) => h.id),
    );
}
check("3.5. entrées de test purgées", true);

// ════════════ 4. SÉPARATION DES ÉTATS + INTÉGRITÉ ═════════════════════════════
console.log("\n=== 4. Séparation des états + intégrité ===");
const l4 = await run(() =>
  db
    .from("psp_lignes")
    .select("etat_pilotage, statut, origine, programmation_id, programme, ligne_budget")
    .eq("id", ligne.id)
    .single(),
);
check(
  "4.1. état réel / préparation / origine non modifiés par le pilotage",
  l4.data?.statut === ligne.statut &&
    l4.data?.origine === ligne.origine &&
    l4.data?.programmation_id === ligne.programmation_id &&
    JSON.stringify(l4.data?.programme ?? {}) === JSON.stringify(ligne.programme ?? {}) &&
    l4.data?.ligne_budget === ligne.ligne_budget,
);
check(
  "4.2. etat_pilotage restauré exactement à l'état initial",
  (l4.data?.etat_pilotage ?? null) === ETAT_INITIAL,
);

const apres = await comptage();
console.log("  imports après :", JSON.stringify(apres));
check(
  "4.3. les 7 tables d'import strictement identiques avant/après",
  tablesImport.every((t) => avant[t] === apres[t]),
);

const { data: residus } = await db
  .from("psp_ligne_historique")
  .select("id")
  .eq("ligne_id", ligne.id);
check(
  "4.4. historique final = état initial (aucune entrée de test résiduelle)",
  (residus ?? []).length === histAvantIds.size,
  `(${(residus ?? []).length} vs ${histAvantIds.size})`,
);

console.log(`\nV8.8.1 LIVE — ${passed} ok / ${failed} échec(s)`);
if (failed > 0) process.exit(1);
