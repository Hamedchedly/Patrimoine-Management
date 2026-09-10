// V8.16h — RELANCE re-géocodage avec retry/backoff pour les adresses restantes.
// Le premier passage a échoué sur 182 adresses (Photon 503 / fetch failed = rate-limit,
// puis blocage IP complet de photon.komoot.io).
// Ce script ne traite que les lignes de adresses_geo qui ont ENCORE des coordonnées
// (lat IS NOT NULL) : soit des géocodes validés, soit d'anciens géocodes non re-validés.
// Géocodage via la Base Adresse Nationale (data.gouv) UNIQUEMENT — autorité française,
// sans quota bloquant. En cas d'échec définitif, on garde l'ancienne coordonnée (ne pas détruire).
// Exécution : node --env-file=.env scripts/regeocode-adresses-retry.mjs
import { createClient } from "@supabase/supabase-js";
import { geocodeDataGouv } from "../src/lib/geo/index.ts";

const url = process.env.EXT_SUPABASE_URL;
const key = process.env.EXT_SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("EXT_SUPABASE_URL / EXT_SUPABASE_SERVICE_ROLE_KEY manquantes");
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const MAX_ATTEMPTS = 5;
const BASE_DELAY = 1200; // ms, doublé à chaque tentative + jitter

const { data: adresses, error } = await db
  .from("adresses_geo")
  .select("cle, adresse, ville")
  .not("lat", "is", null);
if (error) throw new Error(error.message);
console.log(`Adresses encore géocodées à re-valider : ${adresses?.length ?? 0}`);

let ok = 0;
let refuse = 0;
let vide = 0;
let echec = 0;

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

for (const a of adresses ?? []) {
  let p = null;
  for (let t = 1; t <= MAX_ATTEMPTS; t += 1) {
    try {
      p = await geocodeDataGouv({ adresse: a.adresse, ville: a.ville });
      break;
    } catch (err) {
      if (t === MAX_ATTEMPTS) {
        echec += 1;
        console.error(`  ✗ ${a.cle} : ${err.message} (après ${MAX_ATTEMPTS} tentatives)`);
        break;
      }
      const d = BASE_DELAY * 2 ** (t - 1) + Math.floor(Math.random() * 500);
      console.warn(`  … ${a.cle} : ${err.message} → retry ${t + 1}/${MAX_ATTEMPTS} dans ${d}ms`);
      await attendre(d);
    }
  }
  if (!p) continue;

  const maj = { lat: p.lat, lng: p.lng, statut: p.statut };
  const { error: e } = await db.from("adresses_geo").update(maj).eq("cle", a.cle);
  if (e) {
    echec += 1;
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
  `\nTerminé — ok=${ok} · hors commune purgés=${refuse} · sans résultat=${vide} · échec définitif=${echec}`,
);
process.exit(echec === 0 ? 0 : 1);
