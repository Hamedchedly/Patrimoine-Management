// Rapport de parsing du VRAI fichier de commandes PSP (aucune écriture Supabase).
// Exécution : node scripts/rapport-psp-fichier-reel.mjs [chemin.xlsx]
// Affiche : mapping des colonnes + statistiques réelles + exemples de lignes.
import * as XLSX from "xlsx";
import { readFile } from "node:fs/promises";
import { parsePspWorkbook } from "../src/lib/psp.ts";

const FILE =
  process.argv[2] ??
  "C:\\Users\\Hamed\\Downloads\\2026-20260810T232136Z-1-001\\11-08-2026\\Liste_COMD_TRAV_ER_3.xlsx";

const buf = await readFile(FILE);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const parsed = parsePspWorkbook(ab);

const fmt = (n) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(n ?? 0);
const money = (n) =>
  n === null || n === undefined ? "—" : new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(n);

console.log(`\n=== RAPPORT DU FICHIER RÉEL : ${FILE.split("\\").pop()} ===`);
console.log(`Feuille utilisée : ${parsed.feuille ?? "inconnue"}`);

// ── 1. Mapping complet des colonnes ─────────────────────────────────────────
console.log("\n--- MAPPING DES COLONNES (source → champ normalisé) ---");
for (const m of parsed.mapping_colonnes) {
  console.log(`  ${m.normalizedField ?? "(non mappé)"} ← ${m.sourceColumn}`);
}

// ── 2. Statistiques ─────────────────────────────────────────────────────────
const lignes = parsed.lignes;
const commandes = lignes.filter((l) => l.numero_commande !== "").length;
const erTous = new Set(lignes.flatMap((l) => l.er_references));
const corpsCodes = new Set(lignes.map((l) => l.corps_etat_code).filter(Boolean));
const corpsLibelles = [...new Set(lignes.map((l) => l.corps_etat).filter(Boolean))].sort();
const ambigu = lignes.filter((l) => l.er_ambigue);

const totBudget = lignes.reduce((s, l) => s + (l.budget ?? 0), 0);
const totEngage = lignes.reduce((s, l) => s + (l.engage ?? 0), 0);
const totPaye = lignes.reduce((s, l) => s + (l.paye ?? 0), 0);
const totEcart = lignes.reduce((s, l) => s + (l.ecart ?? 0), 0);

console.log("\n--- STATISTIQUES RÉELLES ---");
console.log(`Lignes de données (non vides)   : ${parsed.total_lignes}`);
console.log(`Lignes primaires analysées      : ${lignes.length}`);
console.log(`Commandes (numéro présent)      : ${commandes}`);
console.log(`  valides                       : ${parsed.valides}`);
console.log(`  à contrôler                   : ${parsed.a_controler}`);
console.log(`  en erreur                     : ${parsed.erreurs}`);
console.log(`Doublons identiques             : ${parsed.doublons_identiques}`);
console.log(`Conflits (doublons différents)  : ${parsed.doublons_conflits}`);
console.log(`Références ER distinctes        : ${erTous.size}`);
console.log(`Codes corps d'état distincts    : ${corpsCodes.size}${corpsCodes.size ? ` (${[...corpsCodes].join(", ")})` : ""}`);
console.log(`Lignes à rattachement ER ambigu : ${ambigu.length}`);
console.log(`Montant total budget            : ${money(totBudget)}`);
console.log(`Montant total engagé            : ${money(totEngage)}`);
console.log(`Montant total payé              : ${money(totPaye)}`);
console.log(`Écart total                     : ${money(totEcart)}`);

// Répartition des catégories GE / GT / CP (nature analytique)
const repartition = {};
for (const l of lignes) {
  const key = l.nature_analytique ?? "(vide)";
  repartition[key] = (repartition[key] ?? 0) + 1;
}
console.log("\n--- RÉPARTITION NATURE ANALYTIQUE (GE / GT / CP / …) ---");
for (const [k, v] of Object.entries(repartition).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k}: ${v}`);
}

// Corps d'état (libellés)
console.log(`\n--- CORPS D'ÉTAT (libellés distincts : ${corpsLibelles.length}) ---`);
console.log(`  ${corpsLibelles.slice(0, 30).join(" | ")}${corpsLibelles.length > 30 ? " | …" : ""}`);

// ── 3. Exemples de lignes problématiques ────────────────────────────────────
const problematiques = lignes.filter((l) => l.statut !== "valide");
console.log(`\n--- EXEMPLES DE LIGNES PROBLÉMATIQUES (${problematiques.length}) — 8 max ---`);
for (const l of problematiques.slice(0, 8)) {
  console.log(`  L${l.ligne} [${l.statut}] n°=${l.numero_commande || "—"} interne=${l.numero_commande_interne ?? "—"} er=${l.er_references.join(",") || "—"}`);
  for (const i of l.erreurs_psp.slice(0, 3)) console.log(`      • ${i.code}: ${i.message}`);
}

// ── 4. Exemple d'une ligne valide ───────────────────────────────────────────
const valide = lignes.find((l) => l.statut === "valide");
if (valide) {
  console.log("\n--- EXEMPLE DE LIGNE VALIDE ---");
  console.log(JSON.stringify(valide, null, 2).slice(0, 1500));
}

console.log(`\nTOTAL général : ${lignes.length} lignes, ${commandes} commandes, ${parsed.erreurs} erreurs, ${parsed.a_controler} à contrôler.`);
