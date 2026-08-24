// Validation V2 — lecture réelle PAT S11 (requêtes directes, identiques à
// psp.prep.data.functions.ts). Exécution : node --env-file=.env scripts/test-psp-prep-connect.mjs
import { supabaseAdmin } from "../src/integrations/supabase-ext/client.server.ts";
import {
  construireReferencePatrimoine,
  enrichirOperationsAvecReference,
  resoudreTranche,
} from "../src/lib/psp.prep.data.ts";
import { PSP_OPERATIONS } from "../src/lib/psp.prep.ts";

const db = supabaseAdmin;
const PAGE = 1000;

const { data: tranches, error: e1 } = await db
  .from("tranches")
  .select("code, libelle, localite, sous_secteur, secteur, nb_logements")
  .eq("actif", true);
if (e1) throw new Error(`tranches: ${e1.message}`);

const lots = [];
for (let from = 0; ; from += PAGE) {
  const { data, error } = await db
    .from("lots")
    .select("tranche_code, adresse, ville")
    .order("created_at")
    .range(from, from + PAGE - 1);
  if (error) throw new Error(`lots: ${error.message}`);
  lots.push(...(data ?? []));
  if ((data ?? []).length < PAGE) break;
}

const commandes = [];
for (let from = 0; ; from += PAGE) {
  const { data, error } = await db
    .from("travaux_commandes")
    .select("tranche_code, charge_clientele")
    .order("created_at")
    .range(from, from + PAGE - 1);
  if (error) throw new Error(`commandes: ${error.message}`);
  commandes.push(...(data ?? []));
  if ((data ?? []).length < PAGE) break;
}

console.log(`tranches=${tranches.length} lots=${lots.length} commandes=${commandes.length}`);

const ref = construireReferencePatrimoine(tranches ?? [], lots, commandes);
const ex = resoudreTranche(ref, "1976");
console.log(
  `TR 1976 → CC=${ex?.charge_clientele ?? "—"} adresse=${ex?.adresse_reference ?? "—"} ville=${ex?.ville ?? "—"} ss=${ex?.sous_secteur ?? "—"}`,
);

const enrichies = enrichirOperationsAvecReference(PSP_OPERATIONS, ref);
const op = enrichies.find((o) => o.tranche === "1976");
console.log(
  `op 1976 enrichie → CC=${op?.charge_clientele} adresse=${op?.adresse} ville=${op?.ville}`,
);
console.log("OK");
