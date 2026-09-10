// V8.16 — RE-MATÉRIALISATION des lignes « sans commande » perdues à l'import.
// Exécution (après migration V8.16 + backfill-suivi-engagements.mjs) :
//   node --env-file=.env scripts/backfill-lignes-suivi-manquantes.mjs
//
// Cause : une ligne sans commande dont le tranche_code est ABSENT de la table
// `tranches` échouait silencieusement à la matérialisation (FK psp_lignes.tranche_code
// → tranches.code ; l'erreur était avalée par `if (error) continue`). Son engagé/payé
// était donc perdu (ex. 2023 ligne 63, TR 2174 « POMPAGE POSTE DE RELEVAGE », 4 212 €).
// Ce script re-parse les fichiers présents, crée la tranche manquante (minimale) puis
// matérialise la ligne avec annee_exercice + montant_engage/montant_paye.
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

// Lignes suivi existantes : identité par remarques (année:ligne) + anti-doublon TR|corps|nature.
const { data: suivi, error: errS } = await db
  .from("psp_lignes")
  .select("id, tranche_code, corps_etat, nature_travaux, remarques")
  .eq("origine", "suivi");
if (errS) throw new Error(`psp_lignes : ${errS.message}`);

const matchees = new Set();
const existants = new Set();
for (const l of suivi ?? []) {
  const m = /import annuel (\d{4}) \([^)]*,\s*ligne (\d+)\)/.exec(l.remarques ?? "");
  if (m) matchees.add(`${m[1]}:${m[2]}`);
  // Anti-doublon du SUIVI ANNUEL : identité par (tranche, ligne budgétaire). Une LB est
  // unique dans un fichier annuel ; deux lignes du même TR avec des LB différentes sont
  // des opérations distinctes (ex. TR 1430 : LB 527 / LB 541 / LB 563).
  existants.add(`${String(l.tranche_code).trim()}|${String(l.ligne_budget ?? "").trim()}`);
}

const { data: tranches, error: errT } = await db.from("tranches").select("code");
if (errT) throw new Error(`tranches : ${errT.message}`);
const trancheSet = new Set((tranches ?? []).map((t) => String(t.code)));

let creees = 0;
let trancheCreee = 0;
let sautees = 0;

for (const f of FICHIERS) {
  const chemin = join(downloads, f.nom);
  if (!existsSync(chemin)) {
    console.log(`  ↷ ${f.nom} : absent — lignes 2023/2026 uniquement traitables`);
    continue;
  }
  const parsed = parseTravauxWorkbook(readFileSync(chemin));
  for (const iss of parsed.sansCommande ?? []) {
    const cle = `${f.annee}:${iss.line}`;
    if (matchees.has(cle)) continue; // déjà matérialisée/backfillée
    const tranche = String(iss.tranche_code ?? "").trim();
    const corps = String(iss.corps_etat ?? "").trim() || null;
    const nature = String(iss.descriptif ?? "").trim() || null;
    if (!tranche || (!corps && !nature)) {
      sautees += 1;
      continue; // insuffisante (pas de TR ni corps/nature)
    }
    const cleDoublon = `${tranche}|${String(iss.ligne_budget ?? "").trim()}`;
    if (existants.has(cleDoublon)) {
      sautees += 1;
      continue; // déjà représentée (anti-doublon TR+LB)
    }
    // Créer la tranche manquante (minimale, actif=true par défaut).
    if (!trancheSet.has(tranche)) {
      const { error } = await db.from("tranches").insert({ code: tranche });
      if (error) {
        console.log(`  ✗ tranche ${tranche} : ${error.message}`);
        sautees += 1;
        continue;
      }
      trancheSet.add(tranche);
      trancheCreee += 1;
      console.log(`  ➕ tranche créée : ${tranche}`);
    }
    const cat = ["GE", "GT", "CP"].includes(
      String(iss.nature_analytique ?? "")
        .trim()
        .toUpperCase(),
    )
      ? String(iss.nature_analytique).trim().toUpperCase()
      : "GT";
    const budget =
      typeof iss.budget === "number" && Number.isFinite(iss.budget) && iss.budget > 0
        ? iss.budget
        : null;
    const { error } = await db.from("psp_lignes").insert({
      programmation_id: null,
      tranche_code: tranche,
      categorie: cat,
      corps_etat_code: null,
      corps_etat: corps,
      nature_travaux: nature,
      programme: budget != null ? { [String(f.annee)]: budget } : {},
      ligne_budget: String(iss.ligne_budget ?? "").trim() || null,
      annee_exercice: f.annee,
      montant_engage:
        typeof iss.engage === "number" && Number.isFinite(iss.engage) ? iss.engage : null,
      montant_paye: typeof iss.paye === "number" && Number.isFinite(iss.paye) ? iss.paye : null,
      remarques: `Matérialisée depuis l'import annuel ${f.annee} (${f.nom}, ligne ${iss.line}) — sans commande [backfill tranche manquante]`,
      statut: "a_definir",
      priorite: "normale",
      origine: "suivi",
    });
    if (error) {
      console.log(`  ✗ ligne ${iss.line} (${tranche}) : ${error.message}`);
      sautees += 1;
      continue;
    }
    creees += 1;
    console.log(
      `  ✓ ligne ${iss.line} ${tranche} ${cat} LB=${iss.ligne_budget ?? "-"} engage=${iss.engage ?? "-"} ${(nature ?? "").slice(0, 40)}`,
    );
  }
}

console.log(
  `\nLignes créées : ${creees} · tranches créées : ${trancheCreee} · sautées : ${sautees}`,
);
process.exit(0);
