// ═══════════════════════════════════════════════════════════════════════════════
// V8.8 — MATÉRIALISATION DES LIGNES ANNUELLES SANS COMMANDE (script one-shot).
// Exécution : node --env-file=.env scripts/materialiser-lignes-2026.mjs
// ═══════════════════════════════════════════════════════════════════════════════
// RÉUTILISE le moteur d'import existant : parseTravauxWorkbook (travaux.ts) +
// la même logique que materialiserLignesSansCommande (travaux.functions.ts).
// RÈGLES :
//  · aucune modification des tables d'import (lecture seule) ;
//  · aucune copie de commande dans psp_lignes ;
//  · origine='suivi', programmation_id=NULL, programme[2026]=budget, LB, adresse ;
//  · anti-doublon TR + corps d'état + nature (aucune deuxième psp_ligne) ;
//  · lignes insuffisantes → non créées (marqueur existant conservé).
// Ce script est exécuté DANS le workflow d'import (une seule fois), jamais à
// chaque ouverture de /suivi.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

import { parseTravauxWorkbook } from "../src/lib/travaux.ts";

const dir = fileURLToPath(new URL("../data/2026/", import.meta.url));
const FICHIER = "Suivi_Travaux_Secteur_2026.xlsx";
const ANNEE = 2026;

const arrayBuffer = (chemin) => {
  const b = readFileSync(chemin);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};

const url = process.env["EXT_SUPABASE_URL"];
const key = process.env["EXT_SUPABASE_SERVICE_ROLE_KEY"] ?? process.env["EXT_SUPABASE_ANON_KEY"];
const db = createClient(url, key);

const parsed = parseTravauxWorkbook(arrayBuffer(`${dir}${FICHIER}`));
const sansCommande = parsed.erreurs.filter((e) => e.message === "Numéro de commande manquant");
console.log(`Lignes sans commande dans le fichier : ${sansCommande.length}`);

// Snapshot des tables d'import (avant) — vérification d'intégrité.
const tablesImport = [
  "travaux_commandes",
  "travaux_commandes_historique",
  "import_travaux",
  "imports",
  "psp_imports",
  "psp_import_rows",
  "travaux_import_details",
];
const avant = {};
for (const t of tablesImport) {
  const { count } = await db.from(t).select("id", { count: "exact", head: true });
  avant[t] = count;
}
console.log("Snapshots AVANT (tables d'import) :", JSON.stringify(avant));

// Opérations existantes (anti-doublon TR + corps + nature).
const { data: existantesRows } = await db
  .from("psp_lignes")
  .select("id, tranche_code, corps_etat, nature_travaux");
const existantes = (existantesRows ?? []).map((l) => ({
  tranche: String(l.tranche_code ?? "").trim(),
  corps: String(l.corps_etat ?? "")
    .trim()
    .toLowerCase(),
  nature: String(l.nature_travaux ?? "")
    .trim()
    .toLowerCase(),
}));

let creees = 0;
let doublons = 0;
let insuffisantes = 0;

for (const issue of sansCommande) {
  const tranche = String(issue.tranche_code ?? "").trim();
  const corps = String(issue.corps_etat ?? "").trim() || null;
  const nature = String(issue.descriptif ?? "").trim() || null;
  if (!tranche || (!corps && !nature)) {
    insuffisantes += 1;
    continue;
  }
  const budget =
    typeof issue.budget === "number" && Number.isFinite(issue.budget) && issue.budget > 0
      ? issue.budget
      : null;
  const cat = ["GE", "GT", "CP"].includes(
    String(issue.nature_analytique ?? "")
      .trim()
      .toUpperCase(),
  )
    ? String(issue.nature_analytique).trim().toUpperCase()
    : "GT";

  // Anti-doublon : même TR + corps + nature → opération déjà existante.
  const doublon = existantes.some(
    (l) =>
      l.tranche === tranche &&
      (l.corps === (corps ?? "").toLowerCase() || corps === null) &&
      (l.nature === (nature ?? "").toLowerCase() || nature === null),
  );
  if (doublon) {
    doublons += 1;
    continue;
  }

  const { error } = await db.from("psp_lignes").insert({
    programmation_id: null,
    tranche_code: tranche,
    categorie: cat,
    corps_etat_code: null,
    corps_etat: corps,
    nature_travaux: nature,
    programme: budget != null ? { [String(ANNEE)]: budget } : {},
    ligne_budget: String(issue.ligne_budget ?? "").trim() || null,
    remarques: [
      `Matérialisée depuis l'import annuel ${ANNEE} (${FICHIER}) — sans commande`,
      issue.adresse ? `Adresse : ${issue.adresse}` : null,
    ]
      .filter(Boolean)
      .join(" · "),
    statut: "a_definir",
    priorite: "normale",
    origine: "suivi",
  });
  if (error) {
    console.error(`  insert échoué (TR ${tranche}) : ${error.message}`);
    continue;
  }
  existantes.push({
    tranche,
    corps: (corps ?? "").toLowerCase(),
    nature: (nature ?? "").toLowerCase(),
  });
  creees += 1;
  console.log(
    `  + créée : TR ${tranche} · ${corps ?? "—"} · ${(nature ?? "").slice(0, 40)} · ${budget ?? 0} €`,
  );
}

// Vérification après (tables d'import strictement inchangées).
const apres = {};
for (const t of tablesImport) {
  const { count } = await db.from(t).select("id", { count: "exact", head: true });
  apres[t] = count;
}
console.log("Snapshots APRÈS (tables d'import) :", JSON.stringify(apres));
const identique = tablesImport.every((t) => avant[t] === apres[t]);
console.log(
  `\nRésultat : ${creees} créée(s) · ${doublons} doublon(s) · ${insuffisantes} insuffisante(s)`,
);
console.log(`Tables d'import strictement inchangées : ${identique}`);
if (!identique) {
  console.error("ERREUR : une table d'import a été modifiée !");
  process.exit(1);
}
