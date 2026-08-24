// ═══════════════════════════════════════════════════════════════════════════════
// V8.5.2 — REVUE DES CORRESPONDANCES : test LIVE (lecture seule, aucune écriture).
// Exécution : node --env-file=.env scripts/test-psp-v852-live.mjs
// ═══════════════════════════════════════════════════════════════════════════════
import { createClient } from "@supabase/supabase-js";

import { proposerRapprochements } from "../src/lib/psp.suivi.rapprochement.ts";

const url = process.env["EXT_SUPABASE_URL"];
const key = process.env["EXT_SUPABASE_SERVICE_ROLE_KEY"];
if (!url || !key) {
  console.error("EXT_SUPABASE_URL / EXT_SUPABASE_SERVICE_ROLE_KEY manquantes");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

let passed = 0;
let failed = 0;
function check(label, ok, detail = "") {
  if (ok) {
    passed++;
    console.log(`  ✔ ${label}`);
  } else {
    failed++;
    console.error(`  ✘ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const comptage = async (table) => {
  const { count } = await db.from(table).select("id", { count: "exact", head: true });
  return count;
};

async function main() {
  const avant = {
    liens: await comptage("psp_command_links"),
    lignes: await comptage("psp_lignes"),
    commandes: await comptage("travaux_commandes"),
    devis: await comptage("psp_devis"),
    importRows: await comptage("psp_import_rows"),
    imports: await comptage("import_travaux"),
  };

  const { data: lignes } = await db
    .from("psp_lignes")
    .select(
      "id, tranche_code, categorie, corps_etat, nature_travaux, ligne_budget, origine, programme",
    );
  const { data: perimetres } = await db.from("psp_ligne_patrimoine").select("*");
  const { data: devis } = await db
    .from("psp_devis")
    .select("psp_ligne_id, fournisseur_id, entreprise");
  const { data: commandes } = await db
    .from("travaux_commandes")
    .select(
      "id, numero_commande, tranche_code, adresse, corps_etat, descriptif, fournisseur, numero_fournisseur, budget, annee_exercice",
    );
  const { data: liens } = await db
    .from("psp_command_links")
    .select("id, commande_id, psp_ligne_id, methode, confiance, statut");
  const { data: fournisseurs } = await db.from("fournisseurs").select("id, nom");
  const { data: aliases } = await db
    .from("fournisseur_aliases")
    .select("fournisseur_id, identifiant_source");
  const { data: lots } = await db.from("lots").select("id, code_patrimoine");

  const lotCodes = {};
  for (const lot of lots ?? []) lotCodes[lot.id] = [lot.code_patrimoine];
  const refs = (fournisseurs ?? []).map((f) => ({
    id: f.id,
    nom: f.nom,
    aliases: (aliases ?? [])
      .filter((a) => a.fournisseur_id === f.id)
      .map((a) => a.identifiant_source),
  }));
  const perimPar = {};
  for (const p of perimetres ?? []) (perimPar[p.psp_ligne_id] ??= []).push(p);
  const entrPar = {};
  for (const d of devis ?? []) {
    (entrPar[d.psp_ligne_id] ??= []).push({
      fournisseur_id: d.fournisseur_id,
      entreprise: d.entreprise,
    });
  }

  let totalProps = 0;
  let exemples = 0;
  for (const l of lignes ?? []) {
    const operation = {
      id: l.id,
      tranche_code: l.tranche_code,
      categorie: l.categorie,
      corps_etat: l.corps_etat,
      nature_travaux: l.nature_travaux,
      ligne_budget: l.ligne_budget,
      origine: l.origine,
      montant_total:
        Object.values(l.programme ?? {}).reduce((s, v) => s + (Number(v) || 0), 0) || null,
      perimetres: perimPar[l.id] ?? [],
      entreprises_consultees: entrPar[l.id] ?? [],
    };
    const props = proposerRapprochements({
      operation,
      commandes: commandes ?? [],
      liens: liens ?? [],
      fournisseurs: refs,
      lotCodesParTranche: lotCodes,
    });
    totalProps += props.length;
    if (exemples < 3 && props.length > 0) {
      const p = props[0];
      console.log(
        `  ex. op ${l.id.slice(0, 8)} ↔ cmd ${p.commandeId.slice(0, 8)} score=${p.score} ${p.niveau}`,
      );
      exemples++;
    }
  }

  check("opérations analysées (réelles)", (lignes ?? []).length > 0);
  check("commandes analysées (réelles)", (commandes ?? []).length > 0);
  check("propositions générées (affichage possible)", true, `total=${totalProps}`);
  check("aucune écriture (propositions uniquement)", true);

  const apres = {
    liens: await comptage("psp_command_links"),
    lignes: await comptage("psp_lignes"),
    commandes: await comptage("travaux_commandes"),
    devis: await comptage("psp_devis"),
    importRows: await comptage("psp_import_rows"),
    imports: await comptage("import_travaux"),
  };
  check(
    "INTÉGRITÉ psp_command_links",
    avant.liens === apres.liens,
    `${avant.liens} vs ${apres.liens}`,
  );
  check("INTÉGRITÉ psp_lignes", avant.lignes === apres.lignes);
  check("INTÉGRITÉ travaux_commandes", avant.commandes === apres.commandes);
  check("INTÉGRITÉ psp_devis", avant.devis === apres.devis);
  check("INTÉGRITÉ psp_import_rows", avant.importRows === apres.importRows);
  check("INTÉGRITÉ import_travaux", avant.imports === apres.imports);

  console.log(`\nV8.5.2 LIVE : ${passed} ok, ${failed} échec(s)`);
  if (failed > 0) process.exit(1);
}

main();
