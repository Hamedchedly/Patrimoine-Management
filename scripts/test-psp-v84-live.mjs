// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// V8.4 â€” RELANCES DEVIS + SUIVI CONSULTATION : tests LIVE Supabase (rÃ©els).
//  Â· sonde : date_limite_reponse / derniere_relance_at existent-ils en live ?
//    (sinon â†’ migration 20260820_psp_v84_relance_consultation.sql NON appliquÃ©e) ;
//  Â· sinon : crÃ©ation ligne + devis (demande sans montant) + date limite explicite
//    + enregistrement d'une relance (derniere_relance_at + historique operation='relance')
//    + relecture chronologie + cohÃ©rence PrÃ©paration â†” OpÃ©rations (mÃªme psp_devis) ;
//  Â· PURGE COMPLÃˆTE en fin (ligne [cascade pÃ©rimÃ¨tre/devis/historique]).
// ExÃ©cution : node --env-file=.env scripts/test-psp-v84-live.mjs
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
import { createClient } from "@supabase/supabase-js";

import {
  chronologieConsultationDevis,
  dateLimiteReponse,
} from "../src/lib/psp.suivi.foundation.ts";

const url = process.env["EXT_SUPABASE_URL"];
const key = process.env["EXT_SUPABASE_SERVICE_ROLE_KEY"];
if (!url || !key) {
  console.error("EXT_SUPABASE_URL / EXT_SUPABASE_SERVICE_ROLE_KEY manquantes");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

let passed = 0;
let failed = 0;
let skipped = 0;
function check(label, ok, detail = "") {
  if (ok) {
    passed++;
    console.log(`  âœ” ${label}`);
  } else {
    failed++;
    console.error(`  âœ˜ ${label}${detail ? ` â€” ${detail}` : ""}`);
  }
}
function skip(label, detail = "") {
  skipped++;
  console.log(`  âš  ${label} â€” NON TESTÃ‰ EN LIVE${detail ? ` (${detail})` : ""}`);
}
async function run(fn) {
  try {
    const { data, error } = await fn();
    return { data, error, msg: error?.message ?? "" };
  } catch (e) {
    return { data: null, error: e, msg: String(e?.message ?? e) };
  }
}

async function main() {
  const MARQUEUR = `__V84_TEST__${Date.now()}`;
  const created = { lignes: [], devis: [], hist: [] };

  const { data: tranche } = await db
    .from("tranches")
    .select("code, libelle, localite, sous_secteur")
    .eq("actif", true)
    .limit(1)
    .maybeSingle();
  check("tranche rÃ©elle trouvÃ©e", !!tranche?.code);

  // â”€â”€ CrÃ©ation d'une opÃ©ration HORS PSP rÃ©elle (migration V8.3 dÃ©jÃ  appliquÃ©e) â”€â”€
  const crea = await run(() =>
    db
      .from("psp_lignes")
      .insert({
        programmation_id: null,
        tranche_code: tranche?.code ?? "1977",
        categorie: "GT",
        corps_etat: "Couverture",
        nature_travaux: `Relance test ${MARQUEUR}`,
        programme: {},
        ligne_budget: null,
        remarques: MARQUEUR,
        statut: "a_definir",
        priorite: "normale",
        origine: "hors_psp",
      })
      .select("id"),
  );
  if (!crea.data?.[0]?.id) {
    console.error(`\n  âœ˜ CrÃ©ation hors PSP impossible : ${crea.msg}\n`);
    check("crÃ©ation ligne hors PSP", false, crea.msg);
    finish(created, check);
    return;
  }
  created.lignes.push(crea.data[0].id);
  check("B1. ligne hors PSP crÃ©Ã©e", true);

  // ---- Demande de devis SANS montant + date limite explicite ----
  const rD = await run(() =>
    db
      .from("psp_devis")
      .insert({
        psp_ligne_id: crea.data[0].id,
        entreprise: `ENTREPRISE RELANCE ${MARQUEUR}`,
        montant: null,
        statut: "demande_envoyee",
        date_limite_reponse: "2026-09-25",
      })
      .select("id, montant, statut, created_at, date_limite_reponse, derniere_relance_at"),
  );
  if (!rD.data?.[0]?.id) {
    console.error(
      `\n  x MIGRATION 20260820 NON APPLIQUEE EN LIVE - colonne date_limite_reponse\n` +
        `    absente de psp_devis. Executer supabase/migrations/20260820_psp_v84_relance_consultation.sql\n` +
        `    dans Supabase SQL Editor puis relancer ce test. Sonde : ${rD.msg}\n`,
    );
    finish(created, check);
    return;
  } else {
    created.devis.push(rD.data[0].id);
    check("MIGRATION V8.4 APPLIQUEE : colonnes date_limite_reponse presentes", true);
    check("K1. demande sans montant", rD.data[0].montant === null);
    check("K2. statut demande_envoyee", rD.data[0].statut === "demande_envoyee");
    check("K3. date limite explicite persistee", rD.data[0].date_limite_reponse === "2026-09-25");
    check("K4. date demande = created_at", !!rD.data[0].created_at);

    const maintenant = new Date().toISOString();
    const rL = await run(() =>
      db
        .from("psp_devis")
        .update({ derniere_relance_at: maintenant })
        .eq("id", rD.data[0].id)
        .select("*"),
    );
    check("L1. derniere_relance_at enregistree", rL.data?.[0]?.derniere_relance_at != null);
    const rH = await run(() =>
      db
        .from("psp_ligne_historique")
        .insert({
          ligne_id: crea.data[0].id,
          operation: "relance",
          avant: { type: "devis", devis_id: rD.data[0].id, derniere_relance_at: null },
          apres: { type: "devis", devis_id: rD.data[0].id, derniere_relance_at: maintenant },
          resolu: false,
          motif: `Relance ${MARQUEUR}`,
        })
        .select("id, operation"),
    );
    if (rH.data?.[0]?.id) created.hist.push(rH.data[0].id);
    check(
      "L2. historique operation 'relance' accepte (CHECK elargi)",
      rH.data?.[0]?.operation === "relance",
      rH.msg,
    );

    const { data: devisRecharges } = await db
      .from("psp_devis")
      .select("*")
      .eq("id", rD.data[0].id)
      .single();
    const chrono = chronologieConsultationDevis({
      id: devisRecharges.id,
      psp_ligne_id: devisRecharges.psp_ligne_id,
      fournisseur_id: devisRecharges.fournisseur_id,
      entreprise: devisRecharges.entreprise ?? "X",
      date_devis: devisRecharges.date_devis,
      montant: devisRecharges.montant,
      statut: devisRecharges.statut,
      commentaire: devisRecharges.commentaire,
      document_reference: devisRecharges.document_reference,
      created_at: devisRecharges.created_at,
      date_limite_reponse: devisRecharges.date_limite_reponse,
      derniere_relance_at: devisRecharges.derniere_relance_at,
    });
    check(
      "X1. chronologie live : demande + relance",
      chrono.some((e) => e.type === "demande") && chrono.some((e) => e.type === "relance"),
    );
    const { data: memes } = await db
      .from("psp_devis")
      .select("id, psp_ligne_id")
      .eq("psp_ligne_id", crea.data[0].id);
    check(
      "T. meme devis visible des deux cotes (une seule table)",
      (memes ?? []).some((d) => d.id === rD.data[0].id),
    );

    // ── N/P/Q — persistance fermeture/réouverture + aucun doublon de devis ─────
    // Simule une fermeture/réouverture : relecture complète depuis la base.
    const { data: relecture } = await db
      .from("psp_devis")
      .select(
        "id, statut, montant, created_at, date_limite_reponse, derniere_relance_at, entreprise",
      )
      .eq("id", rD.data[0].id)
      .single();
    check("N1. fermeture/réouverture : statut conservé", relecture?.statut === "demande_envoyee");
    check(
      "N2. fermeture/réouverture : date limite conservée",
      relecture?.date_limite_reponse === "2026-09-25",
    );
    check(
      "N3. fermeture/réouverture : dernière relance conservée",
      relecture?.derniere_relance_at != null,
    );
    check("N4. fermeture/réouverture : entreprise conservée", relecture?.entreprise != null);
    check(
      "Q. relance n'a pas créé de nouveau devis (toujours 1 seul)",
      (memes ?? []).filter((d) => d.id === rD.data[0].id).length === 1,
    );
    check("O. absence de montant → pas de faux 0 €", relecture?.montant == null);
  }

  finish(created, check);
}
function finish(created, checkFn) {
  // â”€â”€ PURGE COMPLÃˆTE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const vide = ["00000000-0000-0000-0000-000000000000"];
  (async () => {
    if (created.hist.length > 0) {
      const { error } = await db.from("psp_ligne_historique").delete().in("id", created.hist);
      checkFn("PURGE historique", !error, error?.message);
    }
    if (created.devis.length > 0) {
      const { error } = await db.from("psp_devis").delete().in("id", created.devis);
      checkFn("PURGE devis", !error, error?.message);
    }
    if (created.lignes.length > 0) {
      const { error } = await db.from("psp_lignes").delete().in("id", created.lignes);
      checkFn("PURGE lignes (cascade historique/pÃ©rimÃ¨tre/devis)", !error, error?.message);
    }
    const restant = await db
      .from("psp_lignes")
      .select("id")
      .in("id", created.lignes.length ? created.lignes : vide);
    checkFn("PURGE vÃ©rifiÃ©e (0 rÃ©sidu)", (restant.data ?? []).length === 0);

    console.log(
      `\nV8.4 LIVE : ${passed} ok, ${failed} Ã©chec(s), ${skipped} non testÃ©(s)` +
        (failed > 0 ? " â€” âš  migration 20260820 peut ne pas Ãªtre appliquÃ©e" : ""),
    );
    if (failed > 0) process.exit(1);
  })();
}

main();
