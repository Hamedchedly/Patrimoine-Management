// V8.16h — RE-GÉOCODAGE validé des adresses (purge des coordonnées fausses).
// Photon pouvait ignorer la ville et renvoyer un homonyme d'une autre région (ex. « RUE DES
// PETITS CHAMPS » à CHESSY → Charny, Yonne) → des cercles de carte placés sur de mauvaises
// villes. Ce script re-géocode TOUTES les adresses avec la validation par commune
// (geocodeDataGouv, src/lib/geo.ts) et met à jour le cache adresses_geo (coordonnées nulles
// pour les résultats hors commune, statut « VILLE_DIFFERENTE »). Photon a été abandonné ici
// (blocage IP après ~700 requêtes) au profit de la Base Adresse Nationale, autorité française.
// Exécution : node --env-file=.env scripts/regeocode-adresses.mjs
import { createClient } from "@supabase/supabase-js";
import { geocodeDataGouv } from "../src/lib/geo/index.ts";

const url = process.env.EXT_SUPABASE_URL;
const key = process.env.EXT_SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("EXT_SUPABASE_URL / EXT_SUPABASE_SERVICE_ROLE_KEY manquantes");
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const MAX_ATTEMPTS = 3;
const BASE_DELAY = 800; // ms, doublé à chaque tentative + jitter

const { data: adresses, error } = await db.from("adresses_geo").select("cle, adresse, ville");
if (error) throw new Error(error.message);
console.log(`Adresses à re-géocoder : ${adresses?.length ?? 0}`);

let ok = 0;
let refuse = 0;
let vide = 0;
let erreurs = 0;

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

for (const a of adresses ?? []) {
  let p = null;
  for (let t = 1; t <= MAX_ATTEMPTS; t += 1) {
    try {
      p = await geocodeDataGouv({ adresse: a.adresse, ville: a.ville });
      break;
    } catch (err) {
      if (t === MAX_ATTEMPTS) {
        erreurs += 1;
        console.error(`  ✗ ${a.cle} : ${err.message}`);
        break;
      }
      await attendre(BASE_DELAY * 2 ** (t - 1) + Math.floor(Math.random() * 300));
    }
  }
  if (!p) continue;

  const maj = { lat: p.lat, lng: p.lng, statut: p.statut };
  const { error: e } = await db.from("adresses_geo").update(maj).eq("cle", a.cle);
  if (e) {
    erreurs += 1;
    console.error(`  ✗ ${a.cle} : ${e.message}`);
  } else if (p.lat) {
    ok += 1;
  } else if (p.statut === "VILLE_DIFFERENTE") {
    refuse += 1;
    console.log(`  🚫 ${a.cle} → hors commune (coordonnées purgées)`);
  } else {
    vide += 1;
  }
  await attendre(250);
}

console.log(
  `\nTerminé — ok=${ok} · hors commune purgés=${refuse} · sans résultat=${vide} · erreurs=${erreurs}`,
);
process.exit(erreurs === 0 ? 0 : 1);
