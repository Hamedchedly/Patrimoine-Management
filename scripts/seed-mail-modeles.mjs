// V8.16p/r — Seed des modèles de mail en base (mail_modeles) depuis MAIL_MODELES (code).
// Source unique : src/lib/psp.suivi.foundation.ts (aucun texte dupliqué).
// V8.16r — inclut delai_jours (délai de réponse, défaut 7 jours) + le modèle groupé.
// Exécution : node --env-file=.env scripts/seed-mail-modeles.mjs
import { createClient } from "@supabase/supabase-js";

import { MAIL_MODELES } from "../src/lib/psp.suivi.foundation.ts";

const url = process.env.EXT_SUPABASE_URL;
const key = process.env.EXT_SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("EXT_SUPABASE_URL / EXT_SUPABASE_SERVICE_ROLE_KEY manquants (.env).");
  process.exit(1);
}
const db = createClient(url, key);

for (const m of MAIL_MODELES) {
  const { error } = await db.from("mail_modeles").upsert(
    {
      id: m.id,
      libelle: m.libelle,
      sujet: m.sujet,
      corps: m.corps,
      delai_jours: m.delai_jours ?? 7,
    },
    { onConflict: "id" },
  );
  if (error) {
    console.error(`Échec seed ${m.id} :`, error.message);
    process.exit(1);
  }
  console.log(`✓ ${m.id} (${m.libelle}) · délai ${m.delai_jours ?? 7} j`);
}
console.log(`Modèles de mail synchronisés : ${MAIL_MODELES.length}`);
