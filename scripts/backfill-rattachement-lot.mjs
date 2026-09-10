// V8.17 — BACKFILL du rattachement commande → lot : remplit `travaux_commandes.lot_code`
// pour les commandes dont le lot (ER) est résolu à UN SEUL logement du référentiel `lots`.
// Source du lot : Historique CMD (psp_import_rows) d'abord, puis ER de la ligne suivi
// (adresse/descriptif). Jamais inventé ; jamais rempli en multi-lots / hors référentiel.
//
// Exécution :
//   node --env-file=.env scripts/backfill-rattachement-lot.mjs          (écriture)
//   node --env-file=.env scripts/backfill-rattachement-lot.mjs --dry-run (prévisualisation)
import { createClient } from "@supabase/supabase-js";
import { rattacherLotsACommandes } from "../src/lib/commande/rattachement.supabase.functions.ts";

const url = process.env.EXT_SUPABASE_URL;
const key = process.env.EXT_SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Variables EXT_SUPABASE_URL / EXT_SUPABASE_SERVICE_ROLE_KEY manquantes (.env).");
  process.exit(1);
}
const db = createClient(url, key);
const DRY_RUN = process.argv.includes("--dry-run");

const CHUNK = 1000;
const commandes = [];
{
  let from = 0;
  for (;;) {
    const { data, error } = await db
      .from("travaux_commandes")
      .select(
        "id, numero_commande, tranche_code, adresse, descriptif, annee_exercice, actif, lot_code",
      )
      .is("lot_code", null)
      .order("id", { ascending: true })
      .range(from, from + CHUNK - 1);
    if (error) throw new Error(`travaux_commandes : ${error.message}`);
    commandes.push(...(data ?? []));
    if ((data ?? []).length < CHUNK) break;
    from += CHUNK;
  }
}

console.log(`Commandes sans lot_code : ${commandes.length} (${DRY_RUN ? "DRY RUN" : "écriture"})`);
const resolution = await rattacherLotsACommandes(
  db,
  commandes.map((c) => ({
    id: c.id,
    numero_commande: c.numero_commande ?? null,
    adresse: c.adresse ?? null,
    descriptif: c.descriptif ?? null,
  })),
);

const stats = { rattache: 0, multi_lots: 0, hors_referentiel: 0, non_rattache: 0 };
const aRattacher = [];
for (const c of commandes) {
  const r = resolution.get(c.id);
  const statut = r?.statut ?? "non_rattache";
  stats[statut] = (stats[statut] ?? 0) + 1;
  if (statut === "rattache" && r?.codes?.[0]) {
    aRattacher.push({ id: c.id, numero: c.numero_commande, code: r.codes[0], source: r.source });
  }
}

console.log(
  `Résolution : rattachés(mono)=${stats.rattache} · multi=${stats.multi_lots} · hors référentiel=${stats.hors_referentiel} · sans ER=${stats.non_rattache}`,
);

let maj = 0;
let erreurs = 0;
for (const item of aRattacher) {
  if (DRY_RUN) {
    console.log(`  [dry] #${item.numero} → lot_code = ${item.code} (source ${item.source})`);
    continue;
  }
  const { error } = await db
    .from("travaux_commandes")
    .update({ lot_code: item.code })
    .eq("id", item.id);
  if (error) {
    erreurs++;
    console.error(`  ✗ #${item.numero} → ${item.code} : ${error.message}`);
  } else {
    maj++;
    console.log(`  ✓ #${item.numero} → lot_code = ${item.code}`);
  }
}
console.log(
  `\nTerminé : ${maj} mis à jour / ${erreurs} erreur(s)${DRY_RUN ? " (dry-run, rien écrit)" : ""}.`,
);
