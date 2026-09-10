// V8.16b — CRÉATION de la ligne 2026 de la commande 4929053 (report multi-exercice) +
// résolution du conflit. À exécuter APRÈS la migration 20260821_psp_v816b (identité
// (numero_commande, annee_exercice)).
//   node --env-file=.env scripts/backfill-commande-report-2026.mjs
// Contexte : 4929053 (REMPLACEMENT VELUX) existe en 2025 (2/3 des travaux : budget 7 000,
// engagé 4 620) ; le fichier 2026 la porte en REPORT (1/3 : budget 3 000, engagé 2 310).
// L'import 2026 a créé un CONFLIT (non appliqué) → la base 2026 manquait 2 310 €.
// Décision utilisateur : CONSERVER LES DEUX exercices.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { createClient } from "@supabase/supabase-js";

import { parseTravauxWorkbook } from "../src/lib/travaux.ts";

const url = process.env["EXT_SUPABASE_URL"];
const key = process.env["EXT_SUPABASE_SERVICE_ROLE_KEY"];
if (!url || !key) throw new Error("EXT_SUPABASE_URL / EXT_SUPABASE_SERVICE_ROLE_KEY manquantes");
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const NUMERO = "4929053";
const ANNEE = 2026;
const downloads = process.env.USERPROFILE + "\\Downloads";
const fichier = join(downloads, "ANM_SUIVTRXSECT 2026.xlsx");
if (!existsSync(fichier)) throw new Error(`Fichier absent : ${fichier}`);

// 1. Ligne source dans le fichier 2026.
const parsed = parseTravauxWorkbook(readFileSync(fichier));
const src = parsed.commandes.find((c) => String(c.numero_commande).trim() === NUMERO);
if (!src) throw new Error(`${NUMERO} absente du fichier 2026`);
console.log(
  `Source fichier 2026 : ${NUMERO} budget=${src.budget} engage=${src.engage} paye=${src.paye} TR=${src.tranche_code} LB=${src.ligne_budget} fournisseur=${src.fournisseur}`,
);

// 2. Ligne 2025 existante (à conserver).
const { data: existantes } = await db
  .from("travaux_commandes")
  .select("id, annee_exercice")
  .eq("numero_commande", NUMERO);
const ligne2025 = (existantes ?? []).find((r) => r.annee_exercice === 2025);
const deja2026 = (existantes ?? []).find((r) => r.annee_exercice === 2026);
if (deja2026) {
  console.log(`Ligne 2026 déjà présente (id=${deja2026.id}) — rien à créer.`);
} else {
  if (!ligne2025) throw new Error(`Aucune ligne 2025 pour ${NUMERO}`);
  // Dernier import 2026 (pour vu_dans_import_id).
  const { data: imp26 } = await db
    .from("import_travaux")
    .select("id")
    .eq("annee_exercice", 2026)
    .order("demarre_at", { ascending: false })
    .limit(1);
  const importId = imp26?.[0]?.id ?? null;

  const insert = {
    numero_commande: NUMERO,
    secteur: src.secteur ?? "S11",
    tranche_code: src.tranche_code,
    lot_code: src.lot_code ?? null,
    batiment: src.batiment ?? null,
    charge_clientele: src.charge_clientele ?? null,
    adresse: src.adresse ?? null,
    nature_analytique: src.nature_analytique ?? null,
    corps_etat: src.corps_etat ?? null,
    charge_operation: src.charge_operation ?? null,
    ligne_budget: src.ligne_budget ?? null,
    descriptif: src.descriptif ?? null,
    budget: src.budget ?? null,
    numero_fournisseur: src.numero_fournisseur ?? null,
    fournisseur: src.fournisseur ?? null,
    etat_commande: src.etat_commande ?? null,
    engage: src.engage ?? null,
    ecart: src.ecart ?? null,
    paye: src.paye ?? null,
    solde: src.solde ?? null,
    etat_travaux: src.etat_travaux ?? null,
    date_demarrage: src.date_demarrage ?? null,
    date_fin_travaux: src.date_fin_travaux ?? null,
    annee_exercice: ANNEE,
    vu_dans_import_id: importId,
    actif: true,
  };
  const { data: creee, error } = await db
    .from("travaux_commandes")
    .insert(insert)
    .select("id, numero_commande, annee_exercice, budget, engage, paye")
    .single();
  if (error) throw new Error(`Création ligne 2026 : ${error.message}`);
  console.log(
    `Ligne 2026 créée : id=${creee.id} engage=${creee.engage} (2025 conservée id=${ligne2025.id})`,
  );
}

// 3. Résoudre le/les conflit(s) en attente pour cette commande (version 2026 désormais
// matérialisée en ligne propre — plus rien à arbitrer).
const { data: conflits } = await db
  .from("travaux_commandes_historique")
  .select("id")
  .eq("commande_id", ligne2025.id)
  .eq("operation", "conflit")
  .eq("resolu", false);
let resolus = 0;
for (const c of conflits ?? []) {
  await db.from("travaux_commandes_historique").update({ resolu: true }).eq("id", c.id);
  resolus += 1;
}
console.log(`Conflits résolus : ${resolus}`);
process.exit(0);
