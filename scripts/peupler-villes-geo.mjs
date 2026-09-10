// V8.16h — PEUPLEMENT du référentiel `villes_geo` (centres communaux du Dashboard Travaux).
// La table était VIDE (0 ligne) alors que la carte du dashboard (buildDataVilles →
// matchVille) ne lit QUE cette table → aucune ville placée sur la carte « Cartographie ».
// Ce script :
//   1. lit les localités distinctes des tranches ACTIVES (référentiel principal) ;
//   2. y ajoute NANDY + SOUPPES-SUR-LOING (villes issues des commandes SANS tranche,
//      détectées dans l'adresse d'import — référentiel audité du 2026-08-11) ;
//   3. géocode chaque ville via la Base Adresse NationalE (type=municipality → centroïde
//      INSEE) avec validation par commune (refus des homonymes d'autres départements) ;
//   4. upsert dans villes_geo (clé ville_normalisee).
// Aucune ville n'est supprimée : on ajoute/rafraîchit seulement.
// Exécution : node --env-file=.env scripts/peupler-villes-geo.mjs
import { createClient } from "@supabase/supabase-js";
import { geocodeVilleDataGouv } from "../src/lib/geo.ts";

const url = process.env.EXT_SUPABASE_URL;
const key = process.env.EXT_SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("EXT_SUPABASE_URL / EXT_SUPABASE_SERVICE_ROLE_KEY manquantes");
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

/** Normalisation du référentiel (même forme que `villes_geo.ville_normalisee` /
 * `normalizeVillePure` de travaux.ts) : MAJUSCULES, sans accents ni ponctuation,
 * séparateurs réduits à un espace unique. */
const normRef = (s) =>
  (s ?? "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

// 1) Localités des tranches actives.
const { data: tranches, error: errT } = await db
  .from("tranches")
  .select("localite")
  .eq("actif", true);
if (errT) throw new Error(errT.message);

// 2) Villes « spéciales » issues des commandes sans tranche (audit 2026-08-11).
const extraVilles = ["NANDY", "SOUPPES-SUR-LOING"];

// Union normalisée ville → libellé d'affichage.
const villes = new Map();
for (const t of tranches ?? []) {
  if (!t.localite) continue;
  const k = normRef(t.localite);
  if (k && !villes.has(k)) villes.set(k, t.localite.trim());
}
for (const v of extraVilles) {
  const k = normRef(v);
  if (k && !villes.has(k)) villes.set(k, v);
}

// 3) Villes déjà présentes dans le référentiel (on ne re-géocode pas).
const { data: existantes, error: errE } = await db
  .from("villes_geo")
  .select("ville, ville_normalisee, lat, lng");
if (errE) throw new Error(errE.message);
const deja = new Set((existantes ?? []).map((r) => r.ville_normalisee));

const aTraiter = [...villes.entries()].filter(([k]) => !deja.has(k));
console.log(
  `Villes à référencer : ${villes.size} (déjà en base : ${villes.size - aTraiter.length})`,
);

let ok = 0;
let refuse = 0;
let echec = 0;

for (const [norm, ville] of aTraiter) {
  try {
    const p = await geocodeVilleDataGouv({ ville });
    if (p.lat) {
      const { error } = await db
        .from("villes_geo")
        .upsert(
          { ville, ville_normalisee: norm, lat: p.lat, lng: p.lng },
          { onConflict: "ville_normalisee" },
        );
      if (error) throw new Error(error.message);
      ok += 1;
    } else {
      refuse += 1;
      console.log(`  🚫 ${ville} → non géocodée (${p.statut}) — restera « non localisée »`);
    }
  } catch (e2) {
    echec += 1;
    console.error(`  ✗ ${ville} : ${e2.message}`);
  }
  await attendre(250);
}

console.log(`\nTerminé — villes géocodées=${ok} · non géocodées=${refuse} · erreurs=${echec}`);
process.exit(echec === 0 ? 0 : 1);
