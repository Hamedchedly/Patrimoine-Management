// V8.16p — Diagnostic commande 4715627 (montant manquant signalé par l'user).
// Lecture seule par défaut + option `--fix <montant>` pour renseigner budget/engage
// s'ils sont nuls (montant fourni par l'user).
// Exécution : node --env-file=.env scripts/diag-commande-4715627.mjs [--fix 1980]
import { createClient } from "@supabase/supabase-js";

const url = process.env.EXT_SUPABASE_URL;
const key = process.env.EXT_SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("EXT_SUPABASE_URL / EXT_SUPABASE_SERVICE_ROLE_KEY manquants (.env).");
  process.exit(1);
}
const db = createClient(url, key);

const num = "4715627";
const fixIdx = process.argv.indexOf("--fix");
const fix = fixIdx >= 0 ? Number(process.argv[fixIdx + 1]) : null;

// 1. travaux_commandes (source immuable du suivi annuel).
const { data: cmd, error: e1 } = await db
  .from("travaux_commandes")
  .select("*")
  .eq("numero_commande", num);
if (e1) {
  console.error("erreur travaux_commandes :", e1.message);
  process.exit(1);
}
console.log(`=== travaux_commandes (${num}) ===`);
for (const c of cmd ?? []) {
  console.log(
    JSON.stringify(
      {
        id: c.id,
        annee: c.annee_exercice,
        actif: c.actif,
        corps_etat: c.corps_etat,
        fournisseur: c.fournisseur,
        numero_fournisseur: c.numero_fournisseur,
        budget: c.budget,
        engage: c.engage,
        paye: c.paye,
        solde: c.solde,
        etat_travaux: c.etat_travaux,
        date_demarrage: c.date_demarrage,
        tranche_code: c.tranche_code,
      },
      null,
      1,
    ),
  );
}

// 2. psp_import_rows (Historique CMD — montant de repli psp_montant_engage).
const { data: hist, error: e2 } = await db
  .from("psp_import_rows")
  .select(
    "numero_commande_interne, fournisseur, date_commande, montant_engage, corps_etat_libelle, patrimoine",
  )
  .eq("numero_commande_interne", num);
if (e2) console.error("erreur psp_import_rows :", e2.message);
console.log(`=== psp_import_rows (${num}) ===`);
for (const h of hist ?? []) {
  console.log(
    JSON.stringify(
      {
        fournisseur: h.fournisseur,
        date_commande: h.date_commande,
        montant_engage: h.montant_engage,
        corps_etat_libelle: h.corps_etat_libelle,
        patrimoine: h.patrimoine,
      },
      null,
      1,
    ),
  );
}

if (fix != null && !Number.isNaN(fix) && fix > 0) {
  for (const c of cmd ?? []) {
    const patch = {};
    if (c.budget == null) patch.budget = fix;
    // engage absent OU 0 (montant non capturé) → renseigné au montant fourni.
    if (c.engage == null || c.engage === 0) patch.engage = fix;
    if (Object.keys(patch).length === 0) {
      console.log(
        `Commande ${num} déjà renseignée (budget=${c.budget}, engage=${c.engage}) — aucun correctif.`,
      );
      continue;
    }
    const { error: ue } = await db.from("travaux_commandes").update(patch).eq("id", c.id);
    if (ue) {
      console.error(`Échec update ${num} :`, ue.message);
      process.exit(1);
    }
    console.log(`✓ ${num} (id ${c.id}) corrigée :`, JSON.stringify(patch));
  }
} else {
  console.log(
    "(lecture seule — passez --fix <montant> pour renseigner budget/engage s'ils sont nuls)",
  );
}
