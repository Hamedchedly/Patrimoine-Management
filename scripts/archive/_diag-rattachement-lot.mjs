// Phase 0 — DIAGNOSTIC (lecture seule) : rattachement des commandes à leur lot (ER).
// But : confirmer que les commandes suivi annuel sans lot_code peuvent être rattachées
//   à un logement via  (1) l'Historique CMD (psp_import_rows, source PRIORITAIRE) puis
//   (2) l'ER présent dans l'adresse/descriptif de la ligne suivi annuel.
// Exécution : node --env-file=.env scripts/_diag-rattachement-lot.mjs
// AUCUNE écriture (ni INSERT/UPDATE/DELETE).
import { createClient } from "@supabase/supabase-js";

const url = process.env.EXT_SUPABASE_URL;
const key = process.env.EXT_SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Variables EXT_SUPABASE_URL / EXT_SUPABASE_SERVICE_ROLE_KEY manquantes (.env).");
  process.exit(1);
}
const db = createClient(url, key);

const clean = (s) => (s ?? "").trim();

/** Références ER présentes dans un texte (ER.xxxxx / ER.G... / ER.T...) dédupliquées. */
const erDans = (texte) => {
  if (!texte) return [];
  const out = new Set();
  for (const m of String(texte).matchAll(/ER\.[A-Za-z0-9][A-Za-z0-9._-]*/gi)) {
    const ref = m[0].replace(/\.+$/, "").toUpperCase();
    if (ref.length >= 4 && !out.has(ref)) out.add(ref);
  }
  return [...out];
};

/** Clé normalisée d'un code ER (« ER.39351 » → « ER.39351 », insensible casse/ponctuation). */
const cleEr = (v) =>
  clean(v)
    .replace(/^er[.\s-]*/i, "")
    .replace(/[^a-z0-9]/gi, "")
    .toUpperCase();

const CHUNK = 1000;

async function lireTout(table, select) {
  const rows = [];
  let from = 0;
  for (;;) {
    const { data, error } = await db
      .from(table)
      .select(select)
      .order("id", { ascending: true })
      .range(from, from + CHUNK - 1);
    if (error) throw new Error(`${table} : ${error.message}`);
    rows.push(...(data ?? []));
    if ((data ?? []).length < CHUNK) break;
    from += CHUNK;
  }
  return rows;
}

// ── 1. Lectures ──────────────────────────────────────────────────────────────
console.log("Chargement des données (lecture seule)…");
const commandes = await lireTout(
  "travaux_commandes",
  "id, numero_commande, tranche_code, lot_code, batiment, adresse, descriptif, annee_exercice, actif, engage, numero_fournisseur",
);
const psps = await lireTout(
  "psp_import_rows",
  "id, numero_commande, numero_commande_interne, patrimoine, lot_er, er_reference, tranche_er, batiment_er, entree_er, donnees_brutes, annee_exercice",
);
const lots = await lireTout(
  "lots",
  "code_patrimoine, tranche_code, type_lot, batiment, adresse, ville, actif",
);

const lotsParCle = new Map();
for (const l of lots) lotsParCle.set(cleEr(l.code_patrimoine), l);

// Lignes Historique CMD groupées par numéro de commande SUIVI.
// Clé retenue (architecture V8) : psp.numero_commande_interne (COMN_NUM) = suivi.numero_commande.
const pspParInterne = new Map();
const pspParNumero = new Map();
const push = (map, cle, r) => {
  if (!cle) return;
  if (!map.has(cle)) map.set(cle, []);
  map.get(cle).push(r);
};
for (const r of psps) {
  push(pspParInterne, cleEr(r.numero_commande_interne), r);
  push(pspParNumero, cleEr(r.numero_commande), r);
}

/** ER de niveau LOT extraits d'une ligne Historique CMD (patrimoine, lot_er, er_reference). */
function erHistorique(r) {
  const refs = [];
  for (const v of [r.patrimoine, r.lot_er, r.er_reference]) {
    if (v) refs.push(...erDans(v));
  }
  const dn = r.donnees_brutes ?? null;
  if (dn) {
    for (const f of ["er_reference", "patrimoine", "lot_er"]) {
      const v = typeof dn === "object" ? dn[f] : null;
      if (typeof v === "string") refs.push(...erDans(v));
    }
    const arr = typeof dn === "object" ? dn["er_references"] : null;
    if (Array.isArray(arr))
      for (const e of arr) refs.push(...erDans(typeof e === "string" ? e : e?.reference));
  }
  return [...new Set(refs)];
}

function resolveRefsVersLots(refs, trancheCode) {
  const trouves = new Map(); // clé normalisée -> lot
  for (const ref of refs) {
    const lot = lotsParCle.get(cleEr(ref));
    if (lot) trouves.set(cleEr(ref), lot);
  }
  return [...trouves.values()];
}

// ── 2. Analyse par commande sans lot_code ─────────────────────────────────────
const sansLot = commandes.filter((c) => !clean(c.lot_code));
const stats = { mono: 0, multi: 0, aucun: 0, hors: 0, monoSuivi: 0, monoHistorique: 0 };
const exemples = [];

for (const c of sansLot) {
  const num = cleEr(c.numero_commande);
  const hist = [...(pspParInterne.get(num) ?? []), ...(pspParNumero.get(num) ?? [])];
  const histRefs = [...new Set(hist.flatMap(erHistorique))];
  const suiviRefs = [...new Set([...erDans(c.adresse), ...erDans(c.descriptif)])];

  const lotsHist = resolveRefsVersLots(histRefs, c.tranche_code);
  const lotsSuivi = resolveRefsVersLots(suiviRefs, c.tranche_code);

  // Priorité utilisateur : Historique CMD d'abord, ER ligne suivi en repli.
  let source = null;
  let lotsRetenus = lotsHist;
  if (lotsHist.length > 0) source = "historique";
  else if (lotsSuivi.length > 0) {
    lotsRetenus = lotsSuivi;
    source = "suivi";
  }

  const codes = [...new Set(lotsRetenus.map((l) => l.code_patrimoine))];
  let statut;
  if (lotsRetenus.length === 0)
    statut = erDans([...histRefs, ...suiviRefs].join(" ")).length ? "hors" : "aucun";
  else if (codes.length === 1) statut = "mono";
  else statut = "multi";

  stats[statut] = (stats[statut] ?? 0) + 1;
  if (statut === "mono") {
    if (source === "historique") stats.monoHistorique++;
    else stats.monoSuivi++;
  }
  if (c.numero_commande === "5037762" || exemples.length < 8) {
    exemples.push({
      numero: c.numero_commande,
      annee: c.annee_exercice,
      tranche: c.tranche_code,
      actif: c.actif,
      engage: c.engage,
      statut,
      source,
      codes,
      histRefs: histRefs.slice(0, 5),
      suiviRefs: suiviRefs.slice(0, 5),
      adresse: clean(c.adresse).slice(0, 90),
    });
  }
}

// ── 3. Rapport ────────────────────────────────────────────────────────────────
console.log(`\n=== RAPPORT RATTACHEMENT LOT ===`);
console.log(`Commandes totales         : ${commandes.length}`);
console.log(`  dont lot_code NULL      : ${sansLot.length}`);
console.log(`  dont lot_code rempli    : ${commandes.length - sansLot.length}`);
console.log(`Lots (référentiel)        : ${lots.length}`);
console.log(`psp_import_rows           : ${psps.length}`);
console.log(`\nRépartition des ${sansLot.length} commandes sans lot_code :`);
console.log(
  `  MONO  (rattachable 1 lot) : ${stats.mono}   (via historique: ${stats.monoHistorique} · via suivi: ${stats.monoSuivi})`,
);
console.log(`  MULTI (N lots distincts)  : ${stats.multi}`);
console.log(`  HORS  (ER non dans lots)  : ${stats.hors}`);
console.log(`  AUCUN (pas d'ER)          : ${stats.aucun}`);

console.log(`\nExemples :`);
for (const e of exemples) {
  console.log(
    `  #${e.numero} (${e.annee}) TR ${e.tranche} actif=${e.actif} engage=${e.engage} → ${e.statut}${e.source ? " (" + e.source + ")" : ""} lots=[${e.codes.join(", ")}]`,
  );
  console.log(`      hist=[${e.histRefs.join(", ")}] suivi=[${e.suiviRefs.join(", ")}]`);
  console.log(`      adresse: ${e.adresse}`);
}

// Cas ciblé 5037762
const cible = commandes.find((c) => c.numero_commande === "5037762");
console.log(`\n=== CAS CIBLÉ 5037762 ===`);
if (cible) {
  const num = cleEr(cible.numero_commande);
  const hist = [...(pspParInterne.get(num) ?? []), ...(pspParNumero.get(num) ?? [])];
  console.log(`suivi : tranche=${cible.tranche_code} lot_code=${cible.lot_code}`);
  console.log(`  adresse   : ${cible.adresse}`);
  console.log(`  descriptif: ${cible.descriptif}`);
  console.log(`lignes Historique CMD rattachées : ${hist.length}`);
  for (const h of hist.slice(0, 6)) {
    console.log(
      `   COMC_NOLIG=${h.numero_commande} COMN_NUM=${h.numero_commande_interne} patrimoine=${h.patrimoine} lot_er=${h.lot_er} er_ref=${h.er_reference}`,
    );
  }
  const lot = lotsParCle.get(cleEr("ER.39351"));
  console.log(
    `lot ER.39351 dans lots : ${lot ? `OUI (TR ${lot.tranche_code}, ${lot.adresse}, ${lot.ville}, type ${lot.type_lot}, actif=${lot.actif})` : "NON"}`,
  );
} else {
  console.log("Commande 5037762 introuvable.");
}
