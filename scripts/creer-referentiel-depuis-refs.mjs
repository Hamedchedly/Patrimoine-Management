// Premier remplissage du référentiel fournisseur depuis les refs RÉELLES du suivi
// annuel (travaux_commandes.numero_fournisseur) — aucun nom inventé.
//
// Écritures UNIQUEMENT dans : fournisseurs + fournisseur_aliases.
// Jamais dans les tables sources (travaux_commandes, psp_import_rows, ...).
// Le nom reste « À renseigner » (placeholder affiché « Entreprise non renseignée »).
//
// Usage : node scripts/creer-referentiel-depuis-refs.mjs
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const NOM_A_RENSEIGNER = "À renseigner";

const url = process.env.EXT_SUPABASE_URL;
const key = process.env.EXT_SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Variables EXT_SUPABASE_URL / EXT_SUPABASE_SERVICE_ROLE_KEY manquantes (.env).");
  process.exit(1);
}

const db = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const normaliser = (code) =>
  (code ?? "").toString().trim().replace(/\s+/g, "");

async function main() {
  // 1) Refs réelles du suivi annuel (lecture seule).
  const { data: refsRows, error: eRefs } = await db
    .from("travaux_commandes")
    .select("numero_fournisseur")
    .not("numero_fournisseur", "is", null);
  if (eRefs) throw new Error("travaux_commandes : " + eRefs.message);
  const refsDistinct = [
    ...new Set(
      refsRows
        .map((r) => normaliser(r.numero_fournisseur))
        .filter(Boolean),
    ),
  ].sort();

  // 2) Alias suivi existants (références déjà rattachées au référentiel).
  const { data: aliases, error: eAli } = await db
    .from("fournisseur_aliases")
    .select("identifiant_source")
    .eq("source", "travaux_commandes");
  if (eAli) throw new Error("fournisseur_aliases : " + eAli.message);
  const deja = new Set((aliases ?? []).map((a) => normaliser(a.identifiant_source)));

  const aCreer = refsDistinct.filter((r) => !deja.has(r));

  console.log(`Refs suivi distinctes : ${refsDistinct.length}`);
  console.log(`Déjà rattachées       : ${refsDistinct.length - aCreer.length}`);
  console.log(`À créer               : ${aCreer.length}`);
  console.log(`Références            : ${refsDistinct.join(", ")}`);

  if (aCreer.length === 0) {
    console.log("Rien à faire.");
    return;
  }

  const now = new Date().toISOString();
  const cree = [];
  for (const ref of aCreer) {
    const { data: f, error: ef } = await db
      .from("fournisseurs")
      .insert({
        nom: NOM_A_RENSEIGNER,
        adresse: null,
        complement_adresse: null,
        code_postal: null,
        ville: null,
        pays: null,
        site_web: null,
        notes: null,
        created_at: now,
        updated_at: now,
      })
      .select("id")
      .single();
    if (ef) {
      console.error(`Échec création fiche pour ref ${ref} : ${ef.message}`);
      continue;
    }
    const { error: ea } = await db.from("fournisseur_aliases").insert({
      fournisseur_id: f.id,
      source: "travaux_commandes",
      identifiant_source: ref,
      created_at: now,
    });
    if (ea) {
      console.error(`Échec alias pour ref ${ref} : ${ea.message}`);
      continue;
    }
    cree.push(ref);
  }

  console.log(`Créés : ${cree.length} fournisseur(s)`);
  console.log(`Références : ${cree.join(", ")}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
