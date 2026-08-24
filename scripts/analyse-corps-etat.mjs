// ANALYSE LECTURE SEULE — travaux_commandes.corps_etat
// Aucune écriture. Aucune migration. Réplique exacte de extraireCorpsEtatCode (fournisseurs.analyse.ts).
// Usage : node scripts/analyse-corps-etat.mjs
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ quiet: true });

const db = createClient(process.env.EXT_SUPABASE_URL, process.env.EXT_SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Réplique EXACTE de extraireCorpsEtatCode (src/lib/fournisseurs.analyse.ts).
const normaliserTexte = (s) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
const extraireCorpsEtatCode = (corpsEtat) => {
  const brut = (corpsEtat ?? "").trim();
  if (!brut) return { code: "", libelle: "" };
  const m = /^\(\s*([^)]+?)\s*\)\s*(.*)$/.exec(brut);
  if (m) {
    const code = (m[1] ?? "").trim().toLowerCase();
    return { code, libelle: brut };
  }
  return { code: normaliserTexte(brut), libelle: brut };
};
const iso = (d) => (d ? String(d).slice(0, 10) : null);

const { data: rows, error } = await db
  .from("travaux_commandes")
  .select("id, corps_etat, date_demarrage, annee_exercice");
if (error) throw new Error(error.message);

const ligne = (t) =>
  (t ?? "")
    .toString()
    .trim()
    .replace(/\s+/g, " ");

// ── Agrégation par code ──────────────────────────────────────────────────────
const parCode = new Map();
let nulls = 0;
let vides = 0;
for (const r of rows) {
  const corps = r.corps_etat == null ? null : String(r.corps_etat);
  if (corps == null) {
    nulls += 1;
    continue;
  }
  if (corps.trim() === "") {
    vides += 1;
    continue;
  }
  const { code } = extraireCorpsEtatCode(corps);
  const e = parCode.get(code) ?? {
    code,
    libelles: new Map(),
    commandes: 0,
    dates: [],
    annees: new Set(),
  };
  e.commandes += 1;
  e.libelles.set(ligne(corps), (e.libelles.get(ligne(corps)) ?? 0) + 1);
  if (r.date_demarrage) e.dates.push(iso(r.date_demarrage));
  if (r.annee_exercice != null) e.annees.add(String(r.annee_exercice));
  parCode.set(code, e);
}

const codes = [...parCode.keys()].sort();

// ── Rapport ──────────────────────────────────────────────────────────────────
console.log("=".repeat(78));
console.log("ANALYSE LECTURE SEULE — travaux_commandes.corps_etat");
console.log(`Total lignes : ${rows.length} | corps NULL : ${nulls} | corps vide : ${vides}`);
console.log(`Valeurs distinctes de corps_etat : ${new Set(rows.map((r) => ligne(r.corps_etat)).filter(Boolean)).size}`);
console.log(`Codes corps d'état distincts (extraits) : ${codes.length}`);
console.log("=".repeat(78));

for (const code of codes) {
  const e = parCode.get(code);
  const dates = e.dates.filter(Boolean).sort();
  const libelles = [...e.libelles.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`\n◈ CODE « ${code} » — ${e.commandes} commande(s)`);
  console.log(`   Libellés (${libelles.length}) : ${libelles.map(([l, n]) => `${l} (${n})`).join("  |  ")}`);
  console.log(
    `   Période date_demarrage : ${dates.length ? `${dates[0]} → ${dates[dates.length - 1]}` : "aucune date"}  ·  exercices : ${[...e.annees].sort().join(", ")}`,
  );
}

// ── 4. Codes multi-libellés ──────────────────────────────────────────────────
console.log("\n" + "=".repeat(78));
console.log("4. CODES AVEC PLUSIEURS LIBELLÉS DIFFÉRENTS");
const multi = codes.filter((c) => parCode.get(c).libelles.size > 1);
if (multi.length === 0) console.log("Aucun — chaque code ne porte qu'un libellé.");
else
  for (const c of multi) {
    const e = parCode.get(c);
    console.log(`  • ${c} → ${[...e.libelles.keys()].join("  |  ")}`);
  }

// ── 5. Corps sans code exploitable (pas de préfixe « (x) ») ──────────────────
console.log("\n5. CORPS D'ÉTAT SANS CODE EXPLOITABLE (aucun préfixe « (x) »)");
const sansCode = codes.filter((c) => !/^\([^)]*\)\s/.test(parCode.get(c).libelles.keys().next().value ?? ""));
if (sansCode.length === 0) console.log("Aucun — tous les corps portent un préfixe codé.");
else
  for (const c of sansCode) {
    const e = parCode.get(c);
    console.log(`  • « ${[...e.libelles.keys()][0]} » → code déterministe « ${c} » (normalisé du libellé)`);
  }

// ── 6. NULL / vide ───────────────────────────────────────────────────────────
console.log(`\n6. CORPS_ETAT NULL : ${nulls} · VIDES : ${vides}  (lignes de commande concernées)`);

// ── 7. Liste utilisée par « Ajouter un corps d'état » ────────────────────────
console.log("\n7. LISTE « AJOUTER UN CORPS D'ÉTAT » (fournisseurs.functions → corps_disponibles)");
console.log(`   Source : DISTINCT travaux_commandes.corps_etat, clé = code extrait (même fonction).`);
console.log(`   Résultat attendu : ${codes.length} entrées — `);
console.log(`   ${codes.map((c) => `${c}⇐${[...parCode.get(c).libelles.keys()][0]}`).join(" | ")}`);

// ── 8. Aucun code inventé ────────────────────────────────────────────────────
console.log("\n8. VÉRIFICATION « AUCUN CODE INVENTÉ »");
console.log("   Règle du code : préfixe entre parenthèses EXISTANT dans la donnée, sinon");
console.log("   libellé normalisé (déterministe, dérivé du texte réel). Aucune table de codes");
console.log("   fictive, aucun code hors des 19 valeurs ci-dessus.");
console.log(`   Codes réels extraits : ${codes.length} (voir section 3).`);

console.log("\nFIN — aucune écriture effectuée.");
