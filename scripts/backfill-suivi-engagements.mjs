// V8.16 — BACKFILL des lignes suivi annuel (origine='suivi') : exercice + engagé/payé.
// Exécution (APRÈS avoir appliqué la migration 20260821_psp_v816_suivi_engagements.sql) :
//   node --env-file=.env scripts/backfill-suivi-engagements.mjs
//
// But : les lignes sans commande matérialisées dans psp_lignes n'ont PAS porté
// jusqu'ici leur exercice (perdu quand budget=0 → programme={}) ni leur engagé/payé
// (STSN_ENGAGE / STSN_PAYE du fichier annuel). Ce script :
//   · règle annee_exercice depuis les `remarques` (« import annuel 2023 (…, ligne 42) »),
//     ou depuis programme[annee]>0 en repli ;
//   · pour les fichiers présents (2023, 2026 dans Downloads), ré-parse le fichier et
//     matche chaque ligne sans commande par (année, n° ligne Excel) → montant_engage/paye ;
//   · signal des années dont le fichier est absent (engagé non récupérable = 0).
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { createClient } from "@supabase/supabase-js";

import { parseTravauxWorkbook } from "../src/lib/travaux/index.ts";

const url = process.env["EXT_SUPABASE_URL"];
const key = process.env["EXT_SUPABASE_SERVICE_ROLE_KEY"];
if (!url || !key) throw new Error("EXT_SUPABASE_URL / EXT_SUPABASE_SERVICE_ROLE_KEY manquantes");
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const downloads = process.env.USERPROFILE + "\\Downloads";
const FICHIERS = [
  { annee: 2023, nom: "ANM_SUIVTRXSECT 2023.xlsx" },
  { annee: 2024, nom: "ANM_SUIVTRXSECT 2024.xlsx" },
  { annee: 2025, nom: "ANM_SUIVTRXSECT 2025.xlsx" },
  { annee: 2026, nom: "ANM_SUIVTRXSECT 2026.xlsx" },
];

const numberOrNull = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

// ── 1. Charger les lignes suivi existantes ────────────────────────────────────
const { data: lignes, error: errLignes } = await db
  .from("psp_lignes")
  .select(
    "id, tranche_code, categorie, corps_etat, nature_travaux, programme, ligne_budget, origine, remarques",
  )
  .eq("origine", "suivi");
if (errLignes) throw new Error(`Chargement psp_lignes : ${errLignes.message}`);
console.log(`Lignes suivi chargées : ${lignes?.length ?? 0}`);

// Extrait (année, ligne Excel) des remarques, ex. « import annuel 2023 (…, ligne 42) ».
const extraireRef = (remarques) => {
  const m = /import annuel (\d{4}) \([^)]*,\s*ligne (\d+)\)/.exec(remarques ?? "");
  if (!m) return null;
  return { annee: Number(m[1]), ligne: Number(m[2]) };
};

// année de repli depuis programme (clé numérique à montant > 0).
const anneeDepuisProgramme = (programme) => {
  const prog = programme ?? {};
  const annees = Object.keys(prog)
    .map(Number)
    .filter((a) => Number.isFinite(a) && Number(prog[String(a)]) > 0);
  return annees.length ? Math.max(...annees) : null;
};

// ── 2. Construire les mises à jour ────────────────────────────────────────────
const misesAJour = new Map(); // id -> { annee_exercice, montant_engage, montant_paye }
const refs = new Map(); // `${annee}:${ligne}` -> id  (clé de match fichier → ligne)

for (const l of lignes ?? []) {
  const ref = extraireRef(l.remarques);
  let annee = ref?.annee ?? anneeDepuisProgramme(l.programme);
  if (ref) refs.set(`${ref.annee}:${ref.ligne}`, l.id);
  if (annee !== null && annee !== undefined) {
    misesAJour.set(l.id, { annee_exercice: annee, montant_engage: null, montant_paye: null });
  }
}

let fichiersTraites = 0;
let lignesMatch = 0;
for (const f of FICHIERS) {
  const chemin = join(downloads, f.nom);
  if (!existsSync(chemin)) {
    console.log(`  ↷ ${f.nom} : absent — engagé/payé ${f.annee} non récupérable (0)`);
    continue;
  }
  fichiersTraites += 1;
  const parsed = parseTravauxWorkbook(readFileSync(chemin));
  let matchFichier = 0;
  for (const issue of parsed.sansCommande ?? []) {
    const id = refs.get(`${f.annee}:${issue.line}`);
    if (!id) continue;
    const maj = misesAJour.get(id) ?? {
      annee_exercice: f.annee,
      montant_engage: null,
      montant_paye: null,
    };
    maj.annee_exercice = f.annee;
    maj.montant_engage = numberOrNull(Number(issue.engage) || null);
    maj.montant_paye = numberOrNull(Number(issue.paye) || null);
    misesAJour.set(id, maj);
    matchFichier += 1;
    lignesMatch += 1;
  }
  console.log(
    `  ✓ ${f.nom} : ${parsed.sansCommande?.length ?? 0} lignes sans commande → ${matchFichier} matche(s)`,
  );
}

// ── 3. Appliquer les mises à jour (une par ligne) ─────────────────────────────
let majOk = 0;
let majErr = 0;
for (const [id, maj] of misesAJour) {
  const { error } = await db.from("psp_lignes").update(maj).eq("id", id);
  if (error) {
    majErr += 1;
    console.error(`  ✗ ${id} : ${error.message}`);
  } else {
    majOk += 1;
  }
}

// ── 4. Synthèse ───────────────────────────────────────────────────────────────
console.log(
  `\nFichiers traités : ${fichiersTraites}/4 · lignes sans commande matchées : ${lignesMatch}`,
);
console.log(`Mises à jour appliquées : ${majOk} · erreurs : ${majErr}`);
console.log(
  `Lignes suivi restées sans année : ${[...misesAJour.values()].filter((m) => m.annee_exercice == null).length}`,
);
process.exit(majErr === 0 ? 0 : 1);
