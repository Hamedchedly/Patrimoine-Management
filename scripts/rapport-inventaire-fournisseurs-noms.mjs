// Analyse LECTURE SEULE — noms fournisseurs par numero_fournisseur (travaux_commandes)
// + vérification de cohérence des 9 correspondances FRAN_NUM classées CERTAINES.
// Exécution : node scripts/rapport-inventaire-fournisseurs-noms.mjs
// AUCUNE écriture (ni fournisseurs, ni alias, ni sources).
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

const { data: cmd, error: errC } = await supabaseAdmin
  .from("travaux_commandes")
  .select(
    "numero_commande, numero_fournisseur, fournisseur, corps_etat, engage, annee_exercice, date_demarrage, tranche_code, lot_code, batiment, adresse",
  )
  .not("numero_fournisseur", "is", null);
if (errC) {
  console.error("ERR travaux_commandes :", errC.message);
  process.exit(1);
}
const rowsCmd = cmd ?? [];

// ── Agrégats par numero_fournisseur ───────────────────────────────────────────
const agg = new Map();
for (const c of rowsCmd) {
  const id = clean(c.numero_fournisseur);
  if (!id) continue;
  let a = agg.get(id);
  if (!a) {
    a = {
      id,
      noms: new Set(),
      commandes: 0,
      engage: 0,
      corps: new Set(),
      patrimoine: new Set(),
      liste: [],
    };
    agg.set(id, a);
  }
  a.commandes += 1;
  a.engage += Number(c.engage) || 0;
  if (clean(c.fournisseur)) a.noms.add(clean(c.fournisseur));
  if (clean(c.corps_etat)) a.corps.add(clean(c.corps_etat));
  [clean(c.tranche_code), clean(c.lot_code), clean(c.batiment), clean(c.adresse)]
    .filter(Boolean)
    .forEach((p) => a.patrimoine.add(p));
  a.liste.push({
    num: clean(c.numero_commande),
    date: clean(c.date_demarrage),
    annee: c.annee_exercice,
    corps: clean(c.corps_etat),
    montant: Number(c.engage) || null,
  });
}

const statut = (a) => (a.noms.size === 0 ? "VIDE" : a.noms.size === 1 ? "UNIQUE" : "VARIATION");

// Tri des commandes (date puis année) pour premières / dernières
const trie = (liste) =>
  [...liste].sort((x, y) => {
    const dx = x.date || (x.annee ? `${x.annee}-01-01` : "");
    const dy = y.date || (y.annee ? `${y.annee}-01-01` : "");
    return dx.localeCompare(dy);
  });

// ── Rapport 1 : noms par identifiant suivi ────────────────────────────────────
console.log("=".repeat(110));
console.log("ANALYSE LECTURE SEULE — NOMS FOURNISSEURS (travaux_commandes.fournisseur) par numero_fournisseur");
console.log("Statut : UNIQUE (1 nom) · VARIATION (plusieurs noms) · VIDE (aucun nom). Aucune écriture.");
console.log("=".repeat(110));

const liste = [...agg.values()].sort((x, y) => y.commandes - x.commandes);
let nUnique = 0;
let nVariation = 0;
let nVide = 0;
for (const a of liste) {
  const st = statut(a);
  if (st === "UNIQUE") nUnique += 1;
  else if (st === "VARIATION") nVariation += 1;
  else nVide += 1;
  const triee = trie(a.liste);
  const premieres = triee.slice(0, 3);
  const dernieres = triee.slice(-3);
  const anneeTxt = (d) => (d.annee ?? d.date) || "sans date";
  const fmtCmd = (d) => `#${d.num} (${anneeTxt(d)}) ${d.corps ?? ""} ${fmtEuro(d.montant)}`;
  console.log(`\n▶ ${a.id}  — ${st}  (${a.commandes} commande(s) · ${fmtEuro(a.engage)})`);
  console.log(`   Noms            : ${[...a.noms].sort().join(" | ") || "(aucun nom renseigné)"}`);
  console.log(`   Corps d'état    : ${cap([...a.corps].sort(), 8) || "—"}`);
  console.log(`   Lots/patrimoines: ${a.patrimoine.size} distinct(s) : ${cap([...a.patrimoine].sort(), 6) || "—"}`);
  console.log(`   Premières       : ${premieres.map(fmtCmd).join(" ; ") || "—"}`);
  console.log(`   Dernières       : ${dernieres.map(fmtCmd).join(" ; ") || "—"}`);
}

console.log(`\nSYNTHÈSE : ${liste.length} identifiants suivi — UNIQUE : ${nUnique} · VARIATION : ${nVariation} · VIDE : ${nVide}`);

// ── Rapport 2 : 9 correspondances CERTAINES + cohérence du nom ────────────────
const CERTAINES = [
  ["3521", "631015"],
  ["8290", "1207017"],
  ["6047", "1203021"],
  ["5689", "218054"],
  ["16803", "218104"],
  ["15424", "631038"],
  ["8051", "1301168"],
  ["8150", "1301157"],
  ["30888", "662037"],
];

console.log(`\n${"─".repeat(110)}\nVÉRIFICATION DES 9 CORRESPONDANCES CERTAINES (suivi ↔ FRAN_NUM)\n${"─".repeat(110)}`);
for (const [sid, fnum] of CERTAINES) {
  const a = agg.get(sid);
  if (!a) {
    console.log(`\n▶ ${sid} ↔ ${fnum}  — identifiant suivi introuvable dans travaux_commandes`);
    continue;
  }
  const st = statut(a);
  const noms = [...a.noms].sort();
  const coherence =
    noms.length === 0
      ? "NOM VIDE — aucune donnée de nom pour vérifier la cohérence"
      : noms.length === 1
        ? `Nom cohérent : « ${noms[0]} » (UNIQUE sur ${a.commandes} commande(s))`
        : `NOMS MULTIPLES (${noms.join(" | ")}) — cohérence à valider`;
  console.log(`\n▶ ${sid} ↔ ${fnum}  — ${st}`);
  console.log(`   Commandes liées : ${a.commandes} · Montant ${fmtEuro(a.engage)}`);
  console.log(`   Noms observés   : ${noms.join(" | ") || "(aucun)"}`);
  console.log(`   Cohérence       : ${coherence}`);
}

console.log("\nFIN DE L'ANALYSE — aucune écriture effectuée.");
