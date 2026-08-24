// ═══════════════════════════════════════════════════════════════════════════════
// V8.3 — OPÉRATIONS HORS PSP : tests LIVE Supabase (données réelles).
//  · sonde la contrainte réelle (origine 'hors_psp' + programmation_id NULL) ;
//    si bloqué → MIGRATION 20260818 NON APPLIQUÉE (signalé, pas de faux positif) ;
//  · sinon : création hors PSP + périmètre + demande sans montant + devis reçu +
//    devis retenu + lecture agrégée (une seule entité) ;
//  · PUGE COMPLÈTE des données de test en fin de script (toujours).
// Exécution : node --env-file=.env scripts/test-psp-v83-live.mjs
// ═══════════════════════════════════════════════════════════════════════════════
import { createClient } from "@supabase/supabase-js";

import { construireSuiviOperation } from "../src/lib/psp.suivi.foundation.ts";

const url = process.env["EXT_SUPABASE_URL"];
const key = process.env["EXT_SUPABASE_SERVICE_ROLE_KEY"];
if (!url || !key) {
  console.error(
    "EXT_SUPABASE_URL / EXT_SUPABASE_SERVICE_ROLE_KEY manquantes — relancer avec --env-file=.env",
  );
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

let passed = 0;
let failed = 0;
let skipped = 0;
function check(label, ok, detail = "") {
  if (ok) {
    passed++;
    console.log(`  ✔ ${label}`);
  } else {
    failed++;
    console.error(`  ✘ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
function skip(label, detail = "") {
  skipped++;
  console.log(`  ⚠ ${label} — NON TESTÉ EN LIVE${detail ? ` (${detail})` : ""}`);
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
  const MARQUEUR = `__V83_TEST__${Date.now()}`;
  const created = { lignes: [], perimetres: [], devis: [] };

  // ── Sonde : la contrainte réelle accepte-t-elle origine='hors_psp' (NULL programmation) ?
  const { data: tranche } = await db
    .from("tranches")
    .select("code, libelle, localite, sous_secteur")
    .eq("actif", true)
    .limit(1)
    .maybeSingle();
  check("tranche réelle trouvée", !!tranche?.code);

  const sonde = await run(() =>
    db
      .from("psp_lignes")
      .insert({
        programmation_id: null,
        tranche_code: tranche?.code ?? "1977",
        categorie: "GT",
        corps_etat: "Couverture",
        nature_travaux: `Sonde V8.3 ${MARQUEUR}`,
        programme: {},
        ligne_budget: null,
        remarques: MARQUEUR,
        statut: "a_definir",
        priorite: "normale",
        origine: "hors_psp",
      })
      .select("id"),
  );

  const migrationAppliquee = !!sonde.data?.[0]?.id;
  if (sonde.data?.[0]?.id) created.lignes.push(sonde.data[0].id);
  if (migrationAppliquee) {
    console.log("\n  ⟶ MIGRATION V8.3 APPLIQUÉE : origine 'hors_psp' acceptée en live.\n");
  } else {
    console.error(
      `\n  ✘ MIGRATION 20260818 NON APPLIQUÉE EN LIVE — sonde bloquée : ${sonde.msg}\n` +
        "    Le workflow hors PSP ne peut PAS fonctionner tant que le SQL de la migration\n" +
        "    (supabase/migrations/20260818_psp_operation_hors_psp.sql) n'est pas exécuté\n" +
        "    dans Supabase SQL Editor. Les tests suivants sont donc RÉDUITS.\n",
    );
    check("sonde hors PSP : migration appliquée", false, sonde.msg);
  }

  if (migrationAppliquee) {
    const ligneId = sonde.data[0].id;

    // ── B. Création hors PSP : lecture retour + historique trigger ─────────────
    const { data: ligne } = await db.from("psp_lignes").select("*").eq("id", ligneId).single();
    check("B1. ligne hors PSP créée (identité = id)", !!ligne);
    check("B2. origine = hors_psp", ligne?.origine === "hors_psp");
    check("B3. programmation_id NULL", ligne?.programmation_id === null);
    check(
      "B4. programme vide (aucun montant/année)",
      Object.keys(ligne?.programme ?? {}).length === 0,
    );
    check(
      "B5. AUCUNE donnée de commande dans psp_lignes",
      !("numero_commande" in (ligne ?? {})) &&
        !("montant_engage" in (ligne ?? {})) &&
        !("montant_paye" in (ligne ?? {})),
    );
    const h = await db
      .from("psp_ligne_historique")
      .select("operation")
      .eq("ligne_id", ligneId)
      .order("created_at", { ascending: true });
    check(
      "B6. historique créé automatiquement (trigger psp_ligne_historique)",
      (h.data ?? []).some((r) => r.operation === "creation"),
    );

    // ── Périmètre ──────────────────────────────────────────────────────────────
    const rPer = await run(() =>
      db
        .from("psp_ligne_patrimoine")
        .insert({
          psp_ligne_id: ligneId,
          tranche_code: tranche?.code ?? "1977",
          niveau: "tranche",
          rue: null,
          numero: null,
          lot_id: null,
        })
        .select("id"),
    );
    if (rPer.data?.[0]?.id) created.perimetres.push(rPer.data[0].id);
    check("C1. périmètre créé pour l'opération hors PSP", !!rPer.data?.[0]?.id, rPer.msg);

    // ── K/L. Demande sans montant (date = created_at) ──────────────────────────
    const rD1 = await run(() =>
      db
        .from("psp_devis")
        .insert({
          psp_ligne_id: ligneId,
          fournisseur_id: null,
          entreprise: "ENTREPRISE TEST V83 A",
          montant: null,
          statut: "demande_envoyee",
          commentaire: MARQUEUR,
        })
        .select("id, created_at, montant, statut"),
    );
    if (rD1.data?.[0]?.id) created.devis.push(rD1.data[0].id);
    check(
      "K1. demande de devis SANS montant enregistrée",
      rD1.data?.[0]?.montant === null,
      rD1.msg,
    );
    check("K2. statut demande_envoyee", rD1.data?.[0]?.statut === "demande_envoyee");
    check("L1. date de demande = created_at", !!rD1.data?.[0]?.created_at);

    // ── M/N. Devis reçu puis retenu ────────────────────────────────────────────
    const rD2 = await run(() =>
      db
        .from("psp_devis")
        .insert({
          psp_ligne_id: ligneId,
          fournisseur_id: null,
          entreprise: "ENTREPRISE TEST V83 B",
          date_devis: "2026-08-01",
          montant: 95000,
          statut: "recu",
          commentaire: MARQUEUR,
        })
        .select("id, montant, statut"),
    );
    if (rD2.data?.[0]?.id) created.devis.push(rD2.data[0].id);
    check(
      "M1. devis reçu avec montant",
      rD2.data?.[0]?.montant === 95000 && rD2.data?.[0]?.statut === "recu",
      rD2.msg,
    );

    const rU = await run(() =>
      db
        .from("psp_devis")
        .update({ statut: "retenu" })
        .eq("id", rD2.data[0].id)
        .select("id, statut"),
    );
    check("N1. devis marqué retenu", rU.data?.[0]?.statut === "retenu", rU.msg);
  } else {
    skip("B. création hors PSP", "migration non appliquée");
    skip("C. périmètre hors PSP", "migration non appliquée");
    skip("K/L. demande sans montant + date", "migration non appliquée");
    skip("M/N. devis reçu + retenu", "migration non appliquée");
  }

  // ── E. Vue agrégée (mêmes requêtes que getPspSuiviOperation) ────────────────
  if (migrationAppliquee) {
    const ligneId = created.lignes[0];
    const [perimetresR, devisR] = await Promise.all([
      db.from("psp_ligne_patrimoine").select("*").eq("psp_ligne_id", ligneId),
      db.from("psp_devis").select("*").eq("psp_ligne_id", ligneId),
    ]);
    const { data: ligne } = await db.from("psp_lignes").select("*").eq("id", ligneId).single();
    const vue = construireSuiviOperation({
      ligne: {
        id: ligneId,
        programmation_id: null,
        tranche_code: ligne.tranche_code,
        categorie: ligne.categorie,
        corps_etat_code: ligne.corps_etat_code,
        corps_etat: ligne.corps_etat,
        nature_travaux: ligne.nature_travaux,
        programme: ligne.programme ?? {},
        ligne_budget: ligne.ligne_budget,
        remarques: ligne.remarques,
        origine: ligne.origine,
        statut: ligne.statut,
        priorite: ligne.priorite,
        created_at: ligne.created_at,
      },
      perimetres: perimetresR.data ?? [],
      devis: devisR.data ?? [],
      patrimoine: {
        adresse: [tranche?.libelle, tranche?.localite].filter(Boolean).join(" – ") || null,
        cc: null,
        sous_secteur: tranche?.sous_secteur ?? null,
      },
      exercice: 2026,
    });
    check("E1. vue agrégée : origine hors_psp", vue.identite.origine === "hors_psp");
    check(
      "E2. vue agrégée : aucune programmation (annees vides)",
      vue.programmation.annees.length === 0,
    );
    check(
      "E3. vue agrégée : montant programmé 0 (aucun faux 0 € côté vue)",
      vue.programmation.montant_total === 0,
    );
    check("E4. vue agrégée : 2 demandes (dont 1 sans montant)", vue.consultation.nb_demandes === 2);
    check("E5. vue agrégée : devis reçu visible", vue.consultation.nb_devis_recus === 1);
    check(
      "E6. vue agrégée : devis retenu identifiable",
      vue.consultation.devis_retenu?.statut === "retenu",
    );
    check(
      "E7. vue agrégée : entreprises consultées = 2",
      vue.consultation.nb_entreprises_consultees === 2,
    );

    // ── R. Registre : lecture des lignes hors PSP ─────────────────────────────
    const reg = await db
      .from("psp_lignes")
      .select("id, origine, programmation_id")
      .is("programmation_id", null);
    check(
      "R1. registre : la ligne hors PSP est listée",
      (reg.data ?? []).some((r) => r.id === ligneId),
    );

    // ── R2. Anti-doublon (préparation V8.5) : psp_command_links relie l'opération
    // hors PSP à UNE commande réelle importée (travaux_commandes reste la source).
    // Aucun moteur de rapprochement n'est implémenté ici — on vérifie seulement que
    // le lien permet de préparer le rapprochement futur sans créer de doublon.
    // Reproduit exactement la logique de createPspCommandLink (V6.1) : import_row_id
    // résolu réellement via psp_import_rows.numero_commande_interne, confiance=1.
    const { data: cmdReelle } = await db
      .from("travaux_commandes")
      .select("id, numero_commande, fournisseur, budget, engage, paye")
      .not("numero_commande", "is", null)
      .limit(25)
      .then((r) => r);
    const { data: importRows } = await db
      .from("psp_import_rows")
      .select("id, numero_commande_interne")
      .in(
        "numero_commande_interne",
        (cmdReelle ?? []).map((c) => String(c.numero_commande).trim()).filter((n) => n.length > 0),
      );
    const importRow = importRows?.[0];
    const cmdLiee = (cmdReelle ?? []).find(
      (c) =>
        String(c.numero_commande).trim() ===
        String(importRow?.numero_commande_interne ?? "").trim(),
    );
    if (cmdLiee?.id && importRow?.id) {
      const lien = await run(() =>
        db
          .from("psp_command_links")
          .insert({
            psp_ligne_id: ligneId,
            commande_id: cmdLiee.id,
            import_row_id: importRow.id,
            type_relation: "rattachement_ligne",
            methode: "manuel",
            confiance: 1,
            statut: "valide",
            justification: `Anti-doublon V8.3 ${MARQUEUR}`,
          })
          .select("id, psp_ligne_id, commande_id"),
      );
      check(
        "R2. lien psp_command_links créé (opération hors PSP → commande réelle)",
        lien.data?.[0]?.psp_ligne_id === ligneId && lien.data?.[0]?.commande_id === cmdLiee.id,
        lien.msg,
      );
      if (lien.data?.[0]?.id) {
        const vueR = construireSuiviOperation({
          ligne: {
            id: ligneId,
            programmation_id: null,
            tranche_code: ligne.tranche_code,
            categorie: ligne.categorie,
            corps_etat_code: ligne.corps_etat_code,
            corps_etat: ligne.corps_etat,
            nature_travaux: ligne.nature_travaux,
            programme: ligne.programme ?? {},
            ligne_budget: ligne.ligne_budget,
            remarques: ligne.remarques,
            origine: ligne.origine,
            statut: ligne.statut,
            priorite: ligne.priorite,
            created_at: ligne.created_at,
          },
          perimetres: perimetresR.data ?? [],
          devis: devisR.data ?? [],
          liens: [
            {
              id: lien.data[0].id,
              psp_ligne_id: ligneId,
              commande_id: cmdLiee.id,
              methode: "manuel",
              confiance: 1,
              statut: "valide",
              justification: `Anti-doublon V8.3 ${MARQUEUR}`,
            },
          ],
          commandes: [
            {
              id: cmdLiee.id,
              numero_commande: cmdLiee.numero_commande,
              fournisseur: cmdLiee.fournisseur,
              budget: cmdLiee.budget,
              engage: cmdLiee.engage,
              paye: cmdLiee.paye,
            },
          ],
          patrimoine: {
            adresse: [tranche?.libelle, tranche?.localite].filter(Boolean).join(" – ") || null,
            cc: null,
            sous_secteur: tranche?.sous_secteur ?? null,
          },
          exercice: 2026,
        });
        check(
          "R3. commande réelle visible dans la vue (sans doublon)",
          vueR.commandes.nb_commandes === 1 &&
            vueR.commandes.liees[0]?.commande_id === cmdLiee.id &&
            vueR.identite.id === ligneId,
        );
        const { error: delLien } = await db
          .from("psp_command_links")
          .delete()
          .eq("id", lien.data[0].id);
        check("PURGE psp_command_links", !delLien, delLien?.message);
      }
    } else {
      skip("R2/R3. lien commande réelle", "aucune commande avec import_row réel");
    }
  } else {
    skip("E. vue agrégée hors PSP", "migration non appliquée");
    skip("R. registre hors PSP", "migration non appliquée");
  }

  // ── PURGE COMPLÈTE (devis → périmètre → ligne [cascade historique]) ─────────
  if (created.devis.length > 0) {
    const { error } = await db.from("psp_devis").delete().in("id", created.devis);
    check("PURGE devis", !error, error?.message);
  }
  if (created.perimetres.length > 0) {
    const { error } = await db.from("psp_ligne_patrimoine").delete().in("id", created.perimetres);
    check("PURGE périmètres", !error, error?.message);
  }
  if (created.lignes.length > 0) {
    const { error } = await db.from("psp_lignes").delete().in("id", created.lignes);
    check("PURGE lignes (historique cascadé)", !error, error?.message);
  }
  const vide = ["00000000-0000-0000-0000-000000000000"];
  const restant = await db
    .from("psp_lignes")
    .select("id")
    .in("id", created.lignes.length ? created.lignes : vide);
  check("PURGE vérifiée (0 résidu hors PSP)", (restant.data ?? []).length === 0);

  console.log(
    `\nV8.3 LIVE : ${passed} ok, ${failed} échec(s), ${skipped} non testé(s)` +
      (migrationAppliquee ? "" : " — ⚠ migration 20260818 NON APPLIQUÉE"),
  );
  if (failed > 0) process.exit(1);
}

main();
