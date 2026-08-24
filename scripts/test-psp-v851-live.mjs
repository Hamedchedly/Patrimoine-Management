// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// V8.5.1 â€” MOTEUR DE CORRESPONDANCES : tests LIVE (lecture rÃ©elle, aucune Ã©criture).
// ExÃ©cution : node --env-file=.env scripts/test-psp-v851-live.mjs
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
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
    console.log(`  âœ” ${label}`);
  } else {
    failed++;
    console.error(`  âœ˜ ${label}${detail ? ` â€” ${detail}` : ""}`);
  }
}

const comptage = async (table) => {
  const { count } = await db.from(table).select("id", { count: "exact", head: true });
  return count;
};

async function main() {
  const avant = {
    liens: await comptage("psp_command_links"),
    commandes: await comptage("travaux_commandes"),
    lignes: await comptage("psp_lignes"),
    devis: await comptage("psp_devis"),
    imports: await comptage("import_travaux"),
    importRows: await comptage("psp_import_rows"),
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
      "id, numero_commande, tranche_code, adresse, corps_etat, descriptif, fournisseur, numero_fournisseur, budget, annee_exercice, nature_analytique",
    );
  const { data: liens } = await db
    .from("psp_command_links")
    .select("id, commande_id, psp_ligne_id, methode, confiance, statut");
  const { data: fournisseurs } = await db.from("fournisseurs").select("id, nom");
  const { data: aliases } = await db
    .from("fournisseur_aliases")
    .select("fournisseur_id, source, identifiant_source");
  const { data: lots } = await db.from("lots").select("id, code_patrimoine");

  check("donnÃ©es rÃ©elles lues (lignes)", (lignes ?? []).length > 0);
  check("donnÃ©es rÃ©elles lues (commandes)", (commandes ?? []).length > 0);

  const lotCodes = {};
  for (const lot of lots ?? []) lotCodes[lot.id] = [lot.code_patrimoine];
  const fournisseurRef = (fournisseurs ?? []).map((f) => ({
    id: f.id,
    nom: f.nom,
    aliases: (aliases ?? [])
      .filter((a) => a.fournisseur_id === f.id)
      .map((a) => a.identifiant_source),
  }));

  const perimParLigne = {};
  for (const p of perimetres ?? []) {
    (perimParLigne[p.psp_ligne_id] ??= []).push(p);
  }
  const entreprisesParLigne = {};
  for (const d of devis ?? []) {
    (entreprisesParLigne[d.psp_ligne_id] ??= []).push({
      fournisseur_id: d.fournisseur_id,
      entreprise: d.entreprise,
    });
  }

  const ops = (lignes ?? []).map((l) => ({
    id: l.id,
    tranche_code: l.tranche_code,
    categorie: l.categorie,
    corps_etat: l.corps_etat,
    nature_travaux: l.nature_travaux,
    ligne_budget: l.ligne_budget,
    origine: l.origine,
    montant_total:
      Object.values(l.programme ?? {}).reduce((s, v) => s + (Number(v) || 0), 0) || null,
    perimetres: perimParLigne[l.id] ?? [],
    entreprises_consultees: entreprisesParLigne[l.id] ?? [],
  }));

  // â”€â”€ ExÃ©cution du moteur (aucune Ã©criture) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let total = 0;
  const niveaux = { AUTO: 0, A_CONFIRMER: 0, MANUEL: 0, NON_RAPPROCHE: 0 };
  let exemples = 0;
  for (const op of ops) {
    const propositions = proposerRapprochements({
      operation: op,
      commandes: commandes ?? [],
      liens: liens ?? [],
      fournisseurs: fournisseurRef,
      lotCodesParTranche: lotCodes,
    });
    total += propositions.length;
    for (const p of propositions) {
      niveaux[p.niveau]++;
      if (exemples < 5 && p.niveau !== "NON_RAPPROCHE") {
        console.log(
          `  ex. ${p.operationId.slice(0, 8)} â†” ${p.commandeId.slice(0, 8)} score=${p.score} ${p.niveau} raisons=${p.raisons.join(" | ")}`,
        );
        exemples++;
      }
    }
  }
  check("moteur exÃ©cutÃ© sur opÃ©rations rÃ©elles", ops.length > 0);
  check(
    "propositions produites (observation uniquement)",
    true,
    `total=${total} AUTO=${niveaux.AUTO} A_CONFIRMER=${niveaux.A_CONFIRMER} MANUEL=${niveaux.MANUEL} NON_RAPPROCHE=${niveaux.NON_RAPPROCHE}`,
  );
  if (total === 0) {
    console.log(
      "  âš  Aucune proposition > seuil sur donnÃ©es rÃ©elles â€” commandes rÃ©elles (2023) et opÃ©rations (2027-2031) ne se recouvrent pas. ScÃ©narios AUTO couverts par fixtures purs.",
    );
  }

  const apres = {
    liens: await comptage("psp_command_links"),
    commandes: await comptage("travaux_commandes"),
    lignes: await comptage("psp_lignes"),
    devis: await comptage("psp_devis"),
    imports: await comptage("import_travaux"),
    importRows: await comptage("psp_import_rows"),
  };
  check(
    "INTÃ‰GRITÃ‰ : psp_command_links AVANT = APRÃˆS",
    avant.liens === apres.liens,
    `${avant.liens} vs ${apres.liens}`,
  );
  check(
    "INTÃ‰GRITÃ‰ : travaux_commandes AVANT = APRÃˆS",
    avant.commandes === apres.commandes,
    `${avant.commandes} vs ${apres.commandes}`,
  );
  check(
    "INTÃ‰GRITÃ‰ : psp_lignes AVANT = APRÃˆS",
    avant.lignes === apres.lignes,
    `${avant.lignes} vs ${apres.lignes}`,
  );
  check("INTÃ‰GRITÃ‰ : psp_devis AVANT = APRÃˆS", avant.devis === apres.devis);
  check("INTÃ‰GRITÃ‰ : import_travaux AVANT = APRÃˆS", avant.imports === apres.imports);
  check("INTÃ‰GRITÃ‰ : psp_import_rows AVANT = APRÃˆS", avant.importRows === apres.importRows);

  console.log(`\nV8.5.1 LIVE : ${passed} ok, ${failed} Ã©chec(s)`);
  if (failed > 0) process.exit(1);
}

main();
