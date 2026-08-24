// ═══════════════════════════════════════════════════════════════════════════════
// V8.9.1 — REVUE DES ANCIENNES PROGRAMMATIONS : test LIVE (lecture seule).
// Exécution : node --env-file=.env scripts/test-psp-v891-live.mjs
// ═══════════════════════════════════════════════════════════════════════════════
import { createClient } from "@supabase/supabase-js";

import { construireRevueAnciennesProgrammations } from "../src/lib/psp.prep.suivi.ts";

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

// ════════════ 1. SNAPSHOT AVANT ═════════════════════════════════════════════
console.log("\n=== 1. Snapshot avant ===");
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
  const { count: lignes } = await db
    .from("psp_lignes")
    .select("id", { count: "exact", head: true });
  const { count: hist } = await db
    .from("psp_ligne_historique")
    .select("id", { count: "exact", head: true });
  const { count: liens } = await db
    .from("psp_command_links")
    .select("id", { count: "exact", head: true });
  const { count: devis } = await db.from("psp_devis").select("id", { count: "exact", head: true });
  out["psp_lignes"] = lignes;
  out["psp_ligne_historique"] = hist;
  out["psp_command_links"] = liens;
  out["psp_devis"] = devis;
  return out;
};
const avant = await comptage();
console.log("  avant :", JSON.stringify(avant));

// ════════════ 2. REVUE SUR DONNÉES RÉELLES ══════════════════════════════════
console.log("\n=== 2. Revue des anciennes programmations (référence 2027) ===");
const { data: lignes } = await db.from("psp_lignes").select("*");
check("2.1. psp_lignes lisible (lecture seule)", Array.isArray(lignes), "");

const { data: perimetres } = await db
  .from("psp_ligne_patrimoine")
  .select("psp_ligne_id, rue, numero");
const { data: devis } = await db
  .from("psp_devis")
  .select("psp_ligne_id, statut, montant, entreprise");
const { data: liens } = await db
  .from("psp_command_links")
  .select("id, psp_ligne_id, commande_id, statut");

const adressePar = new Map();
for (const p of perimetres ?? []) {
  if (!p.psp_ligne_id) continue;
  const libelle = [p.rue, p.numero].filter(Boolean).join(" ");
  if (libelle && !adressePar.has(p.psp_ligne_id)) adressePar.set(p.psp_ligne_id, libelle);
}
const commandeIds = [...new Set((liens ?? []).map((l) => l.commande_id).filter(Boolean))];
let commandesParId = new Map();
if (commandeIds.length > 0) {
  const { data: cmd } = await db
    .from("travaux_commandes")
    .select("id, numero_commande, etat_commande, etat_travaux")
    .in("id", commandeIds);
  commandesParId = new Map((cmd ?? []).map((c) => [c.id, c]));
}
const commandeIdParLigne = new Map(
  (liens ?? [])
    .filter((l) => l.psp_ligne_id)
    .map((l) => [l.psp_ligne_id, commandesParId.get(l.commande_id) ?? null]),
);
const devisParLigne = new Map();
for (const d of devis ?? []) {
  if (!d.psp_ligne_id) continue;
  const liste = devisParLigne.get(d.psp_ligne_id) ?? [];
  liste.push({
    statut: d.statut ?? "a_demander",
    montant: d.montant != null ? Number(d.montant) : null,
    entreprise: d.entreprise ?? null,
  });
  devisParLigne.set(d.psp_ligne_id, liste);
}

const brutes = (lignes ?? []).map((l) => ({
  id: l.id,
  tranche: l.tranche_code,
  categorie: l.categorie ?? "GT",
  corps_etat: l.corps_etat ?? null,
  nature_travaux: l.nature_travaux ?? null,
  programme: l.programme ?? {},
  origine: l.origine ?? "preparation",
  remarques: l.remarques ?? null,
  ligne_budget: l.ligne_budget ?? null,
  adresse: adressePar.get(l.id) ?? null,
  commande_liee: commandeIdParLigne.get(l.id) ?? null,
  devis: devisParLigne.get(l.id) ?? [],
}));

const anneeReference = 2027;
const entrees = construireRevueAnciennesProgrammations(brutes, anneeReference);
console.log(`  références : ${lignes?.length ?? 0} lignes, ${entrees.length} entrées anciennes`);

// 2.2. Toutes les entrées anciennes ont une année < 2027 et montant > 0.
check(
  "2.2. chaque entrée = année < 2027 ET montant > 0",
  entrees.every((e) => e.annee < anneeReference && e.montant > 0),
);

// 2.3. Défense §11 : aucune année antérieure à 2026 inventée (la base ne contient
// QUE 2026 pour les lignes 'suivi' et 2027-2031 pour les 'preparation').
const anneesTrouvees = [...new Set(entrees.map((e) => e.annee))].sort();
console.log("  années anciennes réellement trouvées :", JSON.stringify(anneesTrouvees));
check(
  "2.3. AUCUNE année < 2026 inventée (la donnée historique n'existe pas)",
  anneesTrouvees.length === 0 || anneesTrouvees.every((a) => a >= 2026),
);

// 2.4. Cohérence : chaque entrée provient d'une année réellement dans programme.
const origineOk = entrees.every((e) => {
  const ligne = (lignes ?? []).find((l) => l.id === e.pspLigneId);
  return ligne ? (ligne.programme?.[String(e.annee)] ?? 0) === e.montant : false;
});
check("2.4. chaque montant lu depuis psp_lignes.programme (cohérence)", origineOk);

// 2.5. Une entrée par (ligne, année) — aucun doublon.
const cles = entrees.map((e) => `${e.pspLigneId}|${e.annee}`);
check(
  "2.5. aucune entrée dupliquée (couple ligne+année unique)",
  new Set(cles).size === cles.length,
);

// 2.6. Lignes 'preparation' 2027-2031 → aucune entrée ancienne (programme[N] >= 2027).
const prepFutures = (lignes ?? []).filter((l) =>
  Object.keys(l.programme ?? {}).some((a) => Number(a) >= 2027 && (l.programme?.[a] ?? 0) > 0),
);
const prepDansRevue = entrees.filter((e) => prepFutures.some((l) => l.id === e.pspLigneId));
check(
  "2.6. aucune programmation future (2027-2031) traitée comme ancienne",
  prepDansRevue.length === 0,
);

// ════════════ 3. INTÉGRITÉ (aucune écriture) ═══════════════════════════════
console.log("\n=== 3. Intégrité (lecture seule) ===");
const apres = await comptage();
console.log("  après :", JSON.stringify(apres));
check(
  "3.1. les 7 tables d'import strictement identiques avant/après",
  tablesImport.every((t) => avant[t] === apres[t]),
);
check("3.2. psp_lignes inchangé", avant["psp_lignes"] === apres["psp_lignes"]);
check(
  "3.3. psp_ligne_historique inchangé",
  avant["psp_ligne_historique"] === apres["psp_ligne_historique"],
);
check(
  "3.4. psp_command_links inchangé (aucun auto-rattachement)",
  avant["psp_command_links"] === apres["psp_command_links"],
);
check("3.5. psp_devis inchangé", avant["psp_devis"] === apres["psp_devis"]);

console.log(`\nV8.9.1 LIVE — ${passed} ok / ${failed} échec(s)`);
if (failed > 0) process.exit(1);
