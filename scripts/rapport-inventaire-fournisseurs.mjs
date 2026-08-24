// Inventaire LECTURE SEULE des fournisseurs / identifiants présents dans :
//   - travaux_commandes.numero_fournisseur  (suivi annuel)
//   - psp_import_rows.fournisseur / FRAN_NUM (Historique CMD)
// Exécution : node scripts/rapport-inventaire-fournisseurs.mjs
// AUCUNE écriture : aucun INSERT/UPDATE/DELETE (ni fournisseurs ni sources).
// Corps d'état / lots / patrimoines / montants / statistiques : calculés depuis
// les commandes liées, jamais stockés sur le fournisseur.
import "dotenv/config";
import { supabaseAdmin } from "../src/integrations/supabase-ext/client.server.ts";

const fmtEuro = (n) =>
  n == null
    ? "—"
    : new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(n);
const clean = (s) => (s ?? "").trim();
const cap = (arr, n) => {
  const shown = arr.slice(0, n).join(", ");
  return arr.length > n ? `${shown} (+${arr.length - n})` : shown;
};

// ── Lecture (lecture seule) ──────────────────────────────────────────────────
const { data: cmd, error: errC } = await supabaseAdmin
  .from("travaux_commandes")
  .select(
    "numero_commande, numero_fournisseur, corps_etat, engage, annee_exercice, date_demarrage, tranche_code, lot_code, batiment, adresse",
  )
  .not("numero_fournisseur", "is", null);
if (errC) {
  console.error("ERR travaux_commandes :", errC.message);
  process.exit(1);
}

const { data: pspr, error: errP } = await supabaseAdmin
  .from("psp_import_rows")
  .select(
    "numero_commande_interne, fournisseur, montant_engage, date_commande, patrimoine, corps_etat_libelle, donnees_brutes",
  )
  .not("fournisseur", "is", null);
if (errP) {
  console.error("ERR psp_import_rows :", errP.message);
  process.exit(1);
}

const rowsCmd = cmd ?? [];
const rowsPsp = pspr ?? [];

// Lignes psp par commande (numero_commande_interne = COMN_NUM = numero_commande suivi)
const pspParComn = new Map();
for (const r of rowsPsp) {
  const comn = clean(r.numero_commande_interne);
  if (!comn) continue;
  const arr = pspParComn.get(comn) ?? [];
  arr.push(r);
  pspParComn.set(comn, arr);
}

// ── Agrégats SUIVI (par numero_fournisseur) ──────────────────────────────────
const suivi = new Map();
for (const c of rowsCmd) {
  const id = clean(c.numero_fournisseur);
  if (!id) continue;
  let a = suivi.get(id);
  if (!a) {
    a = { id, commandes: 0, engage: 0, corps: new Set(), patrimoine: new Set(), dernieres: [], pspIds: new Set() };
    suivi.set(id, a);
  }
  a.commandes += 1;
  a.engage += Number(c.engage) || 0;
  if (clean(c.corps_etat)) a.corps.add(clean(c.corps_etat));
  [clean(c.tranche_code), clean(c.lot_code), clean(c.batiment), clean(c.adresse)]
    .filter(Boolean)
    .forEach((p) => a.patrimoine.add(p));
  a.dernieres.push({
    num: clean(c.numero_commande),
    annee: c.annee_exercice,
    corps: clean(c.corps_etat),
    montant: Number(c.engage) || null,
  });
  for (const p of pspParComn.get(clean(c.numero_commande)) ?? []) {
    const fid = clean(p.fournisseur);
    if (fid) a.pspIds.add(fid);
  }
}

// ── Agrégats PSP (par FRAN_NUM) ───────────────────────────────────────────────
const psp = new Map();
for (const r of rowsPsp) {
  const id = clean(r.fournisseur);
  if (!id) continue;
  let a = psp.get(id);
  if (!a) {
    a = { id, lignes: 0, engage: 0, nature: new Set(), corps: new Set(), patrimoine: new Set(), dernieres: [], suiviIds: new Set() };
    psp.set(id, a);
  }
  a.lignes += 1;
  a.engage += Number(r.montant_engage) || 0;
  if (clean(r.corps_etat_libelle)) a.nature.add(clean(r.corps_etat_libelle));
  if (clean(r.patrimoine)) a.patrimoine.add(clean(r.patrimoine));
  const dn = r.donnees_brutes ?? {};
  if (clean(dn.adresse)) a.patrimoine.add(clean(dn.adresse));
  const comn = clean(r.numero_commande_interne);
  a.dernieres.push({ comn, date: clean(r.date_commande) });
  for (const c of rowsCmd) {
    if (clean(c.numero_commande) === comn) {
      if (clean(c.corps_etat)) a.corps.add(clean(c.corps_etat));
      const sid = clean(c.numero_fournisseur);
      if (sid) a.suiviIds.add(sid);
    }
  }
}

// ── Classification des correspondances suivi ↔ FRAN_NUM ───────────────────────
//  certaine : paire 1:1 cohérente (observée, sans autre voisin dans les deux sens)
//  a_valider : un identifiant est lié à plusieurs identifiants de l'autre espace
//  inconnue : aucun correspondant observé
function statutCorrespondance(sid, pspSet) {
  if (pspSet.size === 0) return "inconnue";
  if (pspSet.size === 1) {
    const pid = [...pspSet][0];
    const suiviSet = psp.get(pid)?.suiviIds ?? new Set();
    if (suiviSet.size === 1 && suiviSet.has(sid)) return "certaine";
    return "a_valider";
  }
  return "a_valider";
}

const statutLabel = { certaine: "CERTAINE", a_valider: "À VALIDER", inconnue: "INCONNUE" };

// Paires observées (section correspondances)
const paires = new Map(); // `${sid}|${pid}` -> { sid, pid, observations }
for (const [sid, a] of suivi) {
  for (const pid of a.pspIds) {
    const k = `${sid}|${pid}`;
    const p = paires.get(k) ?? { sid, pid, observations: 0 };
    p.observations += 1;
    paires.set(k, p);
  }
}


// ── Rapport ──────────────────────────────────────────────────────────────────
console.log("=".repeat(100));
console.log("INVENTAIRE LECTURE SEULE — FOURNISSEURS / IDENTIFIANTS");
console.log("Sources : travaux_commandes.numero_fournisseur  +  psp_import_rows.fournisseur (FRAN_NUM)");
console.log("Aucune écriture. Corps d'état / lots / montants calculés depuis les commandes liées.");
console.log("=".repeat(100));

console.log(`\nTOTAL : ${suivi.size} identifiants suivi annuel · ${psp.size} identifiants Historique CMD (FRAN_NUM)`);

console.log(`\n${"─".repeat(100)}\nSECTION A — IDENTIFIANTS SUIVI ANNUEL (travaux_commandes.numero_fournisseur)\n${"─".repeat(100)}`);
const suiviSorted = [...suivi.values()].sort((x, y) => y.commandes - x.commandes);
for (const a of suiviSorted) {
  const st = statutCorrespondance(a.id, a.pspIds);
  const pspLiens = [...a.pspIds].join(", ") || "—";
  console.log(`\n▶ ${a.id}  (${a.commandes} commande(s) · ${fmtEuro(a.engage)})  — correspondance : ${statutLabel[st]}`);
  console.log(`   Corps d'état  : ${cap([...a.corps].sort(), 8) || "—"}`);
  console.log(`   Patrimoine    : ${cap([...a.patrimoine].sort(), 8) || "—"}`);
  console.log(`   FRAN_NUM liés : ${pspLiens}`);
  console.log(
    `   Dernières     : ${a.dernieres
      .slice(0, 3)
      .map((d) => `#${d.num} (${d.annee ?? "sans année"}) ${d.corps ?? ""} ${fmtEuro(d.montant)}`)
      .join(" ; ") || "—"}`,
  );
}

console.log(`\n${"─".repeat(100)}\nSECTION B — IDENTIFIANTS HISTORIQUE CMD (psp_import_rows.fournisseur / FRAN_NUM)\n${"─".repeat(100)}`);
const pspSorted = [...psp.values()].sort((x, y) => y.lignes - x.lignes);
for (const a of pspSorted) {
  const suiviSet = a.suiviIds;
  const st = suiviSet.size === 0 ? "inconnue" : suiviSet.size === 1 ? "certaine" : "a_valider";
  const suiviLiens = [...suiviSet].join(", ") || "—";
  console.log(`\n▶ ${a.id}  (${a.lignes} ligne(s) · ${fmtEuro(a.engage)})  — correspondance : ${statutLabel[st]}`);
  console.log(`   Corps d'état (suivi) : ${cap([...a.corps].sort(), 8) || "—"}`);
  console.log(`   Nature (WNATURE)     : ${cap([...a.nature].sort(), 6) || "—"}`);
  console.log(`   Patrimoine           : ${cap([...a.patrimoine].sort(), 8) || "—"}`);
  console.log(`   N° suivi liés        : ${suiviLiens}`);
  console.log(
    `   Dernières            : ${a.dernieres
      .slice(0, 3)
      .map((d) => `#${d.comn} (${d.date || "sans date"})`)
      .join(" ; ") || "—"}`,
  );
}

console.log(`\n${"─".repeat(100)}\nSECTION C — CORRESPONDANCES POTENTIELLES suivi ↔ FRAN_NUM (observées sur les mêmes commandes)\n${"─".repeat(100)}`);
const pairesSorted = [...paires.values()].sort((x, y) => y.observations - x.observations);
if (pairesSorted.length === 0) console.log("\nAucune correspondance observée (aucune commande ne porte les deux identifiants).");
for (const p of pairesSorted) {
  const st = statutCorrespondance(p.sid, suivi.get(p.sid).pspIds);
  console.log(`   ${p.sid}  ↔  ${p.pid}   (${p.observations} commande(s) communes)   → ${statutLabel[st]}`);
}

console.log(`\n${"─".repeat(100)}\nSECTION D — IDENTIFIANTS SANS CORRESPONDANCE OBSERVÉE\n${"─".repeat(100)}`);
const sansPsp = suiviSorted.filter((a) => a.pspIds.size === 0);
const sansSuivi = pspSorted.filter((a) => a.suiviIds.size === 0);
console.log(`\nSuivi annuel sans FRAN_NUM observé (${sansPsp.length}) : ${sansPsp.map((a) => a.id).join(", ") || "—"}`);
console.log(`FRAN_NUM sans numéro suivi observé (${sansSuivi.length}) : ${sansSuivi.map((a) => a.id).join(", ") || "—"}`);

console.log("\nFIN DE L'INVENTAIRE — aucune écriture effectuée.");

