// Tests du modèle PSP sur le VRAI fichier ISIS (Liste_COMD_TRAV_ER_3.xlsx).
// Exécution : node scripts/test-psp-isis-reel.mjs
// Vérifie la structure réelle : 407 lignes, COMN_NUM uniques, COMC_NOLIG 91/316,
// NAAC_CODE GE/GT/CP/AC/HO, WNATURE, WPATRIMOINE, montants, donnees_brutes.
// Aucune écriture Supabase.
import * as XLSX from "xlsx";
import { readFile } from "node:fs/promises";
import { getCategorieBudget, parsePspWorkbook } from "../src/lib/psp.ts";
import { buildPspImportRowInsert } from "../src/lib/psp.functions.ts";

const FILE =
  process.argv[2] ??
  "C:\\Users\\Hamed\\Downloads\\2026-20260810T232136Z-1-001\\11-08-2026\\Liste_COMD_TRAV_ER_3.xlsx";

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) {
    passed += 1;
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

let buf;
try {
  buf = await readFile(FILE);
} catch {
  console.error(`Fichier réel introuvable : ${FILE}`);
  process.exit(1);
}
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const wb = XLSX.read(ab, { cellDates: true });
const ws = wb.Sheets[wb.SheetNames[0]];
const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
const H = matrix[0] ?? [];
const col = (name) => H.findIndex((c) => String(c ?? "").startsWith(name));
const I = {
  PAT: col("WPATRIMOINE"),
  NOLIG: col("COMC_NOLIG"),
  NUM: col("COMN_NUM"),
  NAAC: col("NAAC_CODE"),
  DEVIS: col("COMN_MT_DEVIS"),
  RAPPRO: col("W_MT_RAPPRO"),
  ECART: col("W_MT_ECART"),
  NATURE: col("WNATURE"),
  NOTES: col("WNOTES"),
};
const t = (v) => (v === null || v === undefined || v === "" ? null : String(v).trim());
const n = (v) => {
  const x = t(v);
  if (!x) return null;
  const p = parseFloat(x.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(p) ? p : null;
};
const lignes = matrix.slice(1).filter((r) => t(r[I.NOLIG]) !== null || t(r[I.NUM]) !== null);

// ── 1. Structure brute ───────────────────────────────────────────────────────
check("S1  407 lignes de données", lignes.length === 407, String(lignes.length));

const nums = lignes.map((r) => t(r[I.NUM]));
check("S2  407 COMN_NUM présents (aucun null)", nums.every((x) => x !== null), JSON.stringify(nums.filter((x) => x === null).length));
check("S3  COMN_NUM tous distincts (407)", new Set(nums).size === 407, String(new Set(nums).size));

const avecNolig = lignes.filter((r) => t(r[I.NOLIG]) !== null).length;
const sansNolig = lignes.length - avecNolig;
check("S4  91 lignes avec COMC_NOLIG", avecNolig === 91, String(avecNolig));
check("S5  316 lignes sans COMC_NOLIG", sansNolig === 316, String(sansNolig));

// ── 2. NAAC_CODE (catégorie budgétaire) ─────────────────────────────────────
const naacCompte = {};
for (const r of lignes) {
  const k = t(r[I.NAAC]) ?? "(vide)";
  naacCompte[k] = (naacCompte[k] ?? 0) + 1;
}
const naacSet = new Set(lignes.map((r) => t(r[I.NAAC])).filter(Boolean));
check("S6  GE présent", naacSet.has("GE"));
check("S7  GT présent", naacSet.has("GT"));
check("S8  CP présent", naacSet.has("CP"));
check("S9  AC présent (non converti)", naacSet.has("AC"));
check("S10 HO présent (non converti)", naacSet.has("HO"));
for (const code of [...naacSet].sort()) {
  const c = getCategorieBudget(code);
  const attendu = ["GE", "GT", "CP"].includes(code) ? "valide" : "a_confirmer";
  check(`S11 catégorie ${code} → ${attendu}`, c.statut === attendu && c.categorie === code, `${c.categorie}/${c.statut}`);
}

// ── 3. WNATURE / WPATRIMOINE / montants ─────────────────────────────────────
const avecNature = lignes.filter((r) => t(r[I.NATURE]) !== null).length;
const avecPat = lignes.filter((r) => t(r[I.PAT]) !== null).length;
check("S12 WNATURE renseigné (majorité)", avecNature >= lignes.length * 0.9, `${avecNature}/${lignes.length}`);
check("S13 WPATRIMOINE renseigné (majorité)", avecPat >= lignes.length * 0.9, `${avecPat}/${lignes.length}`);
const devisReels = lignes.filter((r) => n(r[I.DEVIS]) !== null).length;
check("S14 montants devis numériques (majorité)", devisReels >= lignes.length * 0.9, `${devisReels}/${lignes.length}`);

// ── 4. Parseur : 407 enregistrements primaires (clé = COMN_NUM) ─────────────
const parsed = parsePspWorkbook(ab);
check("P1  mapping numero_commande ← COMC_NOLIG",
  parsed.mapping_colonnes.some((m) => m.normalizedField === "numero_commande" && m.sourceColumn.startsWith("COMC_NOLIG")));
check("P2  mapping numero_commande_interne ← COMN_NUM",
  parsed.mapping_colonnes.some((m) => m.normalizedField === "numero_commande_interne" && m.sourceColumn.startsWith("COMN_NUM")));
check("P3  enregistrements parsés = 407", parsed.lignes.length === 407, String(parsed.lignes.length));
check("P4  COMN_NUM distincts = 407", new Set(parsed.lignes.map((l) => l.numero_commande_interne)).size === 407, String(new Set(parsed.lignes.map((l) => l.numero_commande_interne)).size));
check("P5  COMN_NUM null = 0", parsed.lignes.filter((l) => !l.numero_commande_interne).length === 0);
check("P6  COMC_NOLIG renseignés = 91", parsed.lignes.filter((l) => l.numero_commande !== "").length === 91, String(parsed.lignes.filter((l) => l.numero_commande !== "").length));
check("P7  COMC_NOLIG vides = 316", parsed.lignes.filter((l) => l.numero_commande === "").length === 316, String(parsed.lignes.filter((l) => l.numero_commande === "").length));

// Groupes multi-lignes (même COMC_NOLIG, COMN_NUM différents) — NON fusionnés.
const nbGroupe = (nolig) => parsed.lignes.filter((l) => l.numero_commande === nolig).length;
check("P8  groupe 0559/2026 = 4 enregistrements", nbGroupe("0559/2026") === 4, String(nbGroupe("0559/2026")));
check("P9  groupe 0266/2023 = 3 enregistrements", nbGroupe("0266/2023") === 3, String(nbGroupe("0266/2023")));
check("P10 groupe 0245/2023 = 2 enregistrements", nbGroupe("0245/2023") === 2, String(nbGroupe("0245/2023")));
check("P11 groupe 0267/2023 = 2 enregistrements", nbGroupe("0267/2023") === 2, String(nbGroupe("0267/2023")));
check("P12 groupe 0270/2023 = 2 enregistrements", nbGroupe("0270/2023") === 2, String(nbGroupe("0270/2023")));

// Aucune ligne source perdue, aucun doublon artificiel.
check("P13 aucune ligne perdue (407 primaires = 407 sources)", parsed.lignes.length === lignes.length);
check("P14 aucun doublon détecté (COMN_NUM tous distincts)", parsed.doublons.length === 0, String(parsed.doublons.length));

// Fidélité des champs sources + donnees_brutes.
const correspondance = parsed.lignes.every((l, i) => {
  const src = lignes[i];
  const ins = buildPspImportRowInsert("11111111-1111-4111-8111-111111111111", 2026, l);
  return (
    l.nature_analytique === t(src[I.NAAC]) &&
    l.patrimoine === t(src[I.PAT]) &&
    l.corps_etat === t(src[I.NATURE]) &&
    l.numero_commande_interne === t(src[I.NUM]) &&
    JSON.stringify(ins.donnees_brutes) === JSON.stringify(l)
  );
});
check("P15 donnees_brutes fidèle + NAAC_CODE/WPATRIMOINE/WNATURE inchangés", correspondance);

console.log(`\n${passed} passé(s), ${failed} échec(s)`);
process.exit(failed > 0 ? 1 : 0);
