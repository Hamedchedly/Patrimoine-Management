// ═══════════════════════════════════════════════════════════════════════════════
// V7.3 — Tests LIVE des bugs rencontrés, APRÈS la migration
// 20260818_psp_operation_multi_tranche_atomique.sql (contrainte UNIQUE TR+C
// supprimée + RPC atomiques create/update_psp_operation).
//
// Scénarios reproduits (V7.3 §22) :
//  1. deux lignes même TR + même catégorie → OK ;
//  2. ligne montant 2028 → visible en 2028 ;
//  3. ligne 2028+2029 → visible dans les deux (filtre cumulatif) ;
//  4. brouillon TR seule (zéro montant, sans corps d'état) → ACCEPTÉ (V7.6) ;
//  5. recherche TR par numéro ; 6. recherche TR par ville ;
//  8. recherche ER ; 9. recherche locataire ;
// 10. sélection rue SANS ER → OK ; 12. plusieurs adresses → OK ;
// 13. plusieurs lots → OK ; 14. lot d'une autre TR → REJET sans résidu ;
// 15. entreprise par nom ; 16. entreprise par identifiant (alias) ;
// 19. statut prédéfini ; 20. statut + note libre ;
// 21. modification complète persistée (SELECT réel) ;
// 22. historique après modification ; 24. suppression réelle (+ cascade).
//
// Nettoyage : aucune donnée métier touchée, marqueur __V73_TEST__, purge totale
// à la fin (lignes, périmètres par cascade, devis par cascade, historique par
// cascade). Exécution : node --env-file=.env scripts/test-psp-v73-live.mjs
// ═══════════════════════════════════════════════════════════════════════════════
import { createClient } from "@supabase/supabase-js";

const url = process.env["EXT_SUPABASE_URL"];
const key = process.env["EXT_SUPABASE_SERVICE_ROLE_KEY"];
if (!url || !key) {
  console.error(
    "EXT_SUPABASE_URL / EXT_SUPABASE_SERVICE_ROLE_KEY manquantes — relancer avec --env-file=.env",
  );
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const MARQUEUR = `__V73_TEST__${Date.now()}`;
const PASS = [];
const FAIL = [];
function check(label, ok, detail = "") {
  if (ok) PASS.push(label);
  else FAIL.push(`${label}${detail ? ` — ${detail}` : ""}`);
}
async function run(fn) {
  try {
    const { data, error } = await fn();
    return { data, error, code: error?.code ?? null, msg: error?.message ?? "" };
  } catch (e) {
    return { data: null, error: e, code: e?.code ?? null, msg: String(e?.message ?? e) };
  }
}

const created = { lignes: [], perimetres: [], devis: [], programmations: [] };

async function main() {
  // ── Préparatifs : tranche + lots réels (lecture seule) ──
  const { data: tranches } = await db
    .from("tranches")
    .select("code, localite")
    .eq("actif", true)
    .order("code")
    .limit(60);
  const { data: lots } = await db
    .from("lots")
    .select("id, tranche_code, code_patrimoine, adresse, ville, locataire_nom")
    .eq("actif", true)
    .order("code_patrimoine")
    .limit(300);
  if ((tranches ?? []).length < 1 || (lots ?? []).length < 2) {
    console.error("Données patrimoniales insuffisantes (1 tranche + 2 lots requis).");
    process.exit(1);
  }
  const trancheA = tranches[0].code;
  const lotsA = lots.filter((l) => l.tranche_code === trancheA);
  let trancheB = null;
  let lotB = null;
  for (const l of lots) {
    if (l.tranche_code !== trancheA) {
      trancheB = l.tranche_code;
      lotB = l;
      break;
    }
  }
  if (lotsA.length < 2 || !lotB) {
    console.error("Il faut 2 lots dans la tranche A et 1 lot dans une autre tranche.");
    process.exit(1);
  }
  const lotA1 = lotsA[0];
  const lotA2 = lotsA[1];

  // Programmation brouillon de test — années de test hautes pour éviter la
  // collision avec la programmation officielle 2027-2031 v1 (UNIQUE annee_debut+version).
  const rP = await run(() =>
    db
      .from("psp_programmations")
      .insert({ annee_debut: 2095, annee_fin: 2099, version: 1, remarques: MARQUEUR })
      .select("id"),
  );
  const P1 = rP.data?.[0];
  if (P1?.id) created.programmations.push(P1.id);
  check("préparatif programmation", !!P1?.id, rP.msg);

  // ── 1. Contrainte UNIQUE TR+C SUPPRIMÉE : 2 lignes même TR + même catégorie ──
  console.log("\n=== 1. PLUSIEURS OPÉRATIONS PAR TRANCHE ===");
  const l1 = await run(() =>
    db
      .from("psp_lignes")
      .insert({
        programmation_id: P1.id,
        tranche_code: trancheA,
        categorie: "GT",
        programme: { 2028: 15000 },
        nature_travaux: "toiture",
        remarques: MARQUEUR,
      })
      .select("id"),
  );
  const l2 = await run(() =>
    db
      .from("psp_lignes")
      .insert({
        programmation_id: P1.id,
        tranche_code: trancheA,
        categorie: "GT",
        programme: { 2028: 5000 },
        nature_travaux: "façade",
        remarques: MARQUEUR,
      })
      .select("id"),
  );
  check(
    "1. deux lignes même TR + même catégorie → OK",
    !l1.error && !l2.error,
    `${l1.msg} ${l2.msg}`,
  );
  if (l1.data?.[0]?.id) created.lignes.push(l1.data[0].id);
  if (l2.data?.[0]?.id) created.lignes.push(l2.data[0].id);

  // ── 2/3. RPC ATOMIQUE : année 2028 puis 2028+2029 ──
  console.log("\n=== 2/3. ANNÉES DE PROGRAMMATION (filtre cumulatif) ===");
  const rpc2028 = await run(() =>
    db.rpc("create_psp_operation", {
      p_programmation_id: P1.id,
      p_tranche_code: trancheA,
      p_categorie: "GT",
      p_corps_etat_code: null,
      p_corps_etat: "Couverture",
      p_nature_travaux: "réfection toiture",
      p_programme: { 2027: 0, 2028: 15000, 2029: 0, 2030: 0, 2031: 0 },
      p_ligne_budget: null,
      p_remarques: MARQUEUR,
      p_statut: "attente_agence",
      p_priorite: "prioritaire",
      p_origine: "preparation",
      p_perimetres: [{ niveau: "tranche", rue: null, numero: null, lot_id: null }],
      p_devis: null,
    }),
  );
  const ligne2028 = rpc2028.data;
  if (!ligne2028?.id) {
    console.error("  [debug] rpc2028 complet :", JSON.stringify(rpc2028));
  }
  check("2. création atomique RPC (2028) OK", !!ligne2028?.id, rpc2028.msg);
  if (ligne2028?.id) {
    created.lignes.push(ligne2028.id);
    check("2. programme 2028 = 15000", Number(ligne2028.programme?.["2028"]) === 15000);
    check(
      "2. statut + priorité persistés",
      ligne2028.statut === "attente_agence" && ligne2028.priorite === "prioritaire",
    );
    const p1 = await run(() =>
      db.from("psp_ligne_patrimoine").select("*").eq("psp_ligne_id", ligne2028.id),
    );
    check(
      "2. périmètre tranche créé",
      (p1.data ?? []).length === 1 && p1.data?.[0]?.niveau === "tranche",
      p1.msg,
    );
  }

  const rpc29 = await run(() =>
    db.rpc("create_psp_operation", {
      p_programmation_id: P1.id,
      p_tranche_code: trancheA,
      p_categorie: "GE",
      p_corps_etat_code: null,
      p_corps_etat: "Électricité",
      p_nature_travaux: "rénovation élec",
      p_programme: { 2028: 8000, 2029: 4000 },
      p_ligne_budget: null,
      p_remarques: MARQUEUR,
      p_statut: "a_definir",
      p_priorite: "normale",
      p_origine: "preparation",
      p_perimetres: [],
      p_devis: null,
    }),
  );
  const ligne29 = rpc29.data;
  check("3. création atomique RPC (2028+2029) OK", !!ligne29?.id, rpc29.msg);
  if (ligne29?.id) {
    created.lignes.push(ligne29.id);
    check("3. visible en 2028", Number(ligne29.programme?.["2028"]) === 8000);
    check("3. visible en 2029", Number(ligne29.programme?.["2029"]) === 4000);
  }

  // ── 4. ZÉRO MONTANT → ACCEPTÉ (brouillon V7.6 §1 : TR seule suffit) ──
  // Le contrôle « au moins une année > 0 » a été DÉPLACÉ à l'export (analyse
  // de complétude) ; la saisie brouillon reste permissive.
  console.log("\n=== 4. BROUILLON : ZÉRO MONTANT ACCEPTÉ ===");
  const zero = await run(() =>
    db.rpc("create_psp_operation", {
      p_programmation_id: P1.id,
      p_tranche_code: trancheA,
      p_categorie: "GT",
      p_corps_etat_code: null,
      p_corps_etat: null,
      p_nature_travaux: null,
      p_programme: { 2027: 0, 2028: 0, 2029: 0, 2030: 0, 2031: 0 },
      p_ligne_budget: null,
      p_remarques: MARQUEUR,
      p_statut: "a_definir",
      p_priorite: "normale",
      p_origine: "preparation",
      p_perimetres: [{ niveau: "tranche", rue: null, numero: null, lot_id: null }],
      p_devis: null,
    }),
  );
  check("4. brouillon TR seule (zéro montant, sans corps) → ACCEPTÉ", !zero.error, zero.msg);
  if (zero.data?.id) created.lignes.push(zero.data.id);
  {
    const n = await run(() =>
      db
        .from("psp_lignes")
        .select("id, programme")
        .eq("id", zero.data?.id ?? "00000000-0000-0000-0000-000000000000"),
    );
    check("4. ligne présente et persistée (programme vide)", (n.data ?? []).length === 1, n.msg);
  }

  // ── 5/6. RECHERCHE TR par numéro / par ville ──
  console.log("\n=== 5/6. RECHERCHE TR ===");
  const trNumero = await run(() =>
    db
      .from("tranches")
      .select("code")
      .eq("actif", true)
      .ilike("code", `${trancheA.slice(0, 2)}%`)
      .limit(5),
  );
  check(
    "5. TR par numéro partiel",
    (trNumero.data ?? []).some((t) => t.code === trancheA),
    trNumero.msg,
  );
  const ville = tranches.find((t) => t.localite)?.localite ?? "";
  if (ville) {
    const trVille = await run(() =>
      db
        .from("tranches")
        .select("code")
        .eq("actif", true)
        .ilike("localite", `%${ville.slice(0, 4)}%`)
        .limit(5),
    );
    check("6. TR par ville/localité", (trVille.data ?? []).length >= 1, trVille.msg);
  } else {
    check("6. TR par ville/localité", true, "aucune localité disponible, scénario ignoré");
  }

  // ── 8/9. RECHERCHE ER / locataire ──
  console.log("\n=== 8/9. RECHERCHE LOTS ===");
  const er = lotA1.code_patrimoine;
  const rER = await run(() =>
    db.from("lots").select("id").eq("actif", true).ilike("code_patrimoine", `%${er}%`).limit(20),
  );
  check(
    "8. recherche ER",
    (rER.data ?? []).some((l) => l.id === lotA1.id),
    rER.msg,
  );
  if (lotA1.locataire_nom) {
    const nom = lotA1.locataire_nom;
    const rNom = await run(() =>
      db.from("lots").select("id").eq("actif", true).ilike("locataire_nom", `%${nom}%`).limit(20),
    );
    check(
      "9. recherche locataire",
      (rNom.data ?? []).some((l) => l.id === lotA1.id),
      rNom.msg,
    );
  } else {
    check("9. recherche locataire", true, "aucun locataire renseigné, scénario ignoré");
  }

  // ── 10/12/13/14. PÉRIMÈTRE SANS ER, ADRESSES, LOTS, LOT AUTRE TR ──
  console.log("\n=== PÉRIMÈTRE PATRIMONIAL ===");
  const rueSansEr = await run(() =>
    db.rpc("create_psp_operation", {
      p_programmation_id: P1.id,
      p_tranche_code: trancheA,
      p_categorie: "GT",
      p_corps_etat_code: null,
      p_corps_etat: null,
      p_nature_travaux: "rue entière",
      p_programme: { 2028: 1000 },
      p_ligne_budget: null,
      p_remarques: MARQUEUR,
      p_statut: "a_definir",
      p_priorite: "normale",
      p_origine: "preparation",
      p_perimetres: [
        { niveau: "rue", rue: lotA1.adresse ?? "RUE TEST", numero: null, lot_id: null },
      ],
      p_devis: null,
    }),
  );
  check("10. rue SANS ER → OK", !!rueSansEr.data?.id, rueSansEr.msg);
  if (rueSansEr.data?.id) created.lignes.push(rueSansEr.data.id);

  const multiAdresses = await run(() =>
    db.rpc("create_psp_operation", {
      p_programmation_id: P1.id,
      p_tranche_code: trancheA,
      p_categorie: "CP",
      p_corps_etat_code: null,
      p_corps_etat: null,
      p_nature_travaux: "deux adresses",
      p_programme: { 2028: 1000 },
      p_ligne_budget: null,
      p_remarques: MARQUEUR,
      p_statut: "a_definir",
      p_priorite: "normale",
      p_origine: "preparation",
      p_perimetres: [
        { niveau: "adresse", rue: lotA1.adresse ?? "RUE A", numero: "1", lot_id: null },
        { niveau: "adresse", rue: lotA1.adresse ?? "RUE A", numero: "2", lot_id: null },
      ],
      p_devis: null,
    }),
  );
  check("12. plusieurs adresses → OK", !!multiAdresses.data?.id, multiAdresses.msg);
  if (multiAdresses.data?.id) {
    created.lignes.push(multiAdresses.data.id);
    const pp = await run(() =>
      db.from("psp_ligne_patrimoine").select("*").eq("psp_ligne_id", multiAdresses.data.id),
    );
    check("12. deux périmètres adresse créés", (pp.data ?? []).length === 2, pp.msg);
  }

  const multiLots = await run(() =>
    db.rpc("create_psp_operation", {
      p_programmation_id: P1.id,
      p_tranche_code: trancheA,
      p_categorie: "GT",
      p_corps_etat_code: null,
      p_corps_etat: null,
      p_nature_travaux: "deux lots",
      p_programme: { 2028: 1000 },
      p_ligne_budget: null,
      p_remarques: MARQUEUR,
      p_statut: "a_definir",
      p_priorite: "normale",
      p_origine: "preparation",
      p_perimetres: [
        { niveau: "lot", rue: null, numero: null, lot_id: lotA1.id },
        { niveau: "lot", rue: null, numero: null, lot_id: lotA2.id },
      ],
      p_devis: null,
    }),
  );
  check("13. plusieurs lots → OK", !!multiLots.data?.id, multiLots.msg);
  if (multiLots.data?.id) created.lignes.push(multiLots.data.id);

  const lotAutreTr = await run(() =>
    db.rpc("create_psp_operation", {
      p_programmation_id: P1.id,
      p_tranche_code: trancheA,
      p_categorie: "GT",
      p_corps_etat_code: null,
      p_corps_etat: null,
      p_nature_travaux: "lot autre tranche",
      p_programme: { 2028: 1000 },
      p_ligne_budget: null,
      p_remarques: MARQUEUR,
      p_statut: "a_definir",
      p_priorite: "normale",
      p_origine: "preparation",
      p_perimetres: [{ niveau: "lot", rue: null, numero: null, lot_id: lotB.id }],
      p_devis: null,
    }),
  );
  check("14. lot d'une AUTRE tranche → REJET (atomicité)", !!lotAutreTr.error, lotAutreTr.msg);
  if (lotAutreTr.error) {
    const residue = await run(() =>
      db
        .from("psp_lignes")
        .select("id")
        .eq("nature_travaux", "lot autre tranche")
        .eq("remarques", MARQUEUR),
    );
    check("14. aucun résidu après échec (0 ligne)", (residue.data ?? []).length === 0, residue.msg);
  }

  // ── 15/16. FOURNISSEURS (devis) par nom / par identifiant ──
  console.log("\n=== 15/16. RECHERCHE FOURNISSEURS ===");
  const { data: fournisseurs } = await db.from("fournisseurs").select("id, nom").limit(20);
  const { data: aliases } = await db
    .from("fournisseur_aliases")
    .select("fournisseur_id, identifiant_source")
    .limit(50);
  if ((fournisseurs ?? []).length > 0) {
    const nom = fournisseurs[0].nom.slice(0, 4);
    const rNom = await run(() =>
      db.from("fournisseurs").select("id").ilike("nom", `%${nom}%`).limit(5),
    );
    check(
      "15. entreprise par nom",
      (rNom.data ?? []).some((f) => f.id === fournisseurs[0].id),
      rNom.msg,
    );
  } else {
    check("15. entreprise par nom", true, "référentiel vide, scénario ignoré");
  }
  if ((aliases ?? []).length > 0) {
    const code = aliases[0].identifiant_source.slice(0, 4);
    const rCode = await run(() =>
      db
        .from("fournisseur_aliases")
        .select("fournisseur_id")
        .ilike("identifiant_source", `%${code}%`)
        .limit(5),
    );
    check(
      "16. entreprise par identifiant/code",
      (rCode.data ?? []).some((a) => a.fournisseur_id === aliases[0].fournisseur_id),
      rCode.msg,
    );
  } else {
    check("16. entreprise par identifiant/code", true, "aucun alias, scénario ignoré");
  }

  // ── 19/20. STATUT PRÉDÉFINI + NOTE LIBRE ──
  console.log("\n=== 19/20. STATUT + NOTE LIBRE ===");
  {
    const r = await run(() =>
      db
        .from("psp_lignes")
        .update({ statut: "attente_confirmation", remarques: `En attente agence ${MARQUEUR}` })
        .eq("id", ligne2028.id)
        .select("statut, remarques"),
    );
    check("19. statut prédéfini persisté", r.data?.[0]?.statut === "attente_confirmation", r.msg);
    check(
      "20. note libre persistée (remarques)",
      (r.data?.[0]?.remarques ?? "").includes("En attente agence"),
      r.msg,
    );
  }

  // ── 21/22. MODIFICATION COMPLÈTE + HISTORIQUE ──
  console.log("\n=== 21/22. MODIFICATION + HISTORIQUE ===");
  const beforeHist = await run(() =>
    db
      .from("psp_ligne_historique")
      .select("id")
      .eq("ligne_id", ligne2028.id)
      .order("created_at", { ascending: false }),
  );
  const upd = await run(() =>
    db.rpc("update_psp_operation", {
      p_id: ligne2028.id,
      p_tranche_code: trancheA,
      p_categorie: "GE",
      p_corps_etat_code: null,
      p_corps_etat: "Électricité",
      p_nature_travaux: "remplacement colonnes électriques",
      p_programme: { 2028: 22000, 2029: 3000 },
      p_remarques: `modifié ${MARQUEUR}`,
      p_statut: "a_definir",
      p_priorite: "prioritaire",
      p_perimetres: [
        { niveau: "rue", rue: lotA1.adresse ?? "RUE TEST", numero: null, lot_id: null },
      ],
    }),
  );
  check("21. modification atomique RPC OK", !!upd.data?.id, upd.msg);
  if (upd.data?.id) {
    const sel = await run(() =>
      db
        .from("psp_lignes")
        .select("categorie, corps_etat, nature_travaux, programme, statut, priorite, remarques")
        .eq("id", upd.data.id)
        .single(),
    );
    const d = sel.data;
    check("21. SELECT réel : catégorie GE", d?.categorie === "GE");
    check("21. SELECT réel : corps d'état", d?.corps_etat === "Électricité");
    check("21. SELECT réel : nature", (d?.nature_travaux ?? "").includes("colonnes"));
    check("21. SELECT réel : 2028=22000", Number(d?.programme?.["2028"]) === 22000);
    check("21. SELECT réel : 2029=3000", Number(d?.programme?.["2029"]) === 3000);
    check("21. SELECT réel : statut", d?.statut === "a_definir");
    check("21. SELECT réel : priorité", d?.priorite === "prioritaire");
    const per = await run(() =>
      db.from("psp_ligne_patrimoine").select("*").eq("psp_ligne_id", upd.data.id),
    );
    check(
      "21. périmètre remplacé (1 rue)",
      (per.data ?? []).length === 1 && per.data?.[0]?.niveau === "rue",
      per.msg,
    );
    const afterHist = await run(() =>
      db
        .from("psp_ligne_historique")
        .select("operation, avant, apres")
        .eq("ligne_id", upd.data.id)
        .order("created_at", { ascending: false }),
    );
    const modifs = (afterHist.data ?? []).filter((h) => h.operation === "modification");
    check(
      "22. historique créé après modification",
      modifs.length >= 1 && (beforeHist.data ?? []).length < (afterHist.data ?? []).length,
      `avant=${(beforeHist.data ?? []).length} après=${(afterHist.data ?? []).length}`,
    );
    const hasDelta = modifs.some((h) => JSON.stringify(h.apres).includes("22000"));
    check("22. delta programme capturé (avant/après)", hasDelta);
  }

  // ── 24. SUPPRESSION RÉELLE + CASCADE ──
  console.log("\n=== 24. SUPPRESSION ===");
  {
    const cible = ligne2028.id;
    const del = await run(() => db.from("psp_lignes").delete().eq("id", cible).select("id"));
    check("24. DELETE réel", (del.data ?? []).length === 1, del.msg);
    const sel = await run(() => db.from("psp_lignes").select("id").eq("id", cible));
    check("24. ligne disparue après SELECT", (sel.data ?? []).length === 0);
    const per = await run(() =>
      db.from("psp_ligne_patrimoine").select("id").eq("psp_ligne_id", cible),
    );
    check("24. périmètre disparu par CASCADE", (per.data ?? []).length === 0, per.msg);
    const hist = await run(() =>
      db.from("psp_ligne_historique").select("id").eq("ligne_id", cible),
    );
    check(
      "24. historique supprimé par CASCADE (mécanisme existant)",
      (hist.data ?? []).length === 0,
      hist.msg,
    );
  }

  // ── PURGE TOTALE ──
  console.log("\n=== PURGE ===");
  if (created.lignes.length) {
    await db.from("psp_lignes").delete().in("id", created.lignes);
  }
  if (created.perimetres.length) {
    await db.from("psp_ligne_patrimoine").delete().in("id", created.perimetres);
  }
  if (created.devis.length) {
    await db.from("psp_devis").delete().in("id", created.devis);
  }
  if (created.programmations.length) {
    await db.from("psp_programmations").delete().in("id", created.programmations);
  }
  // Vérifications finales : zéro résidu __V73_TEST__.
  const restLignes = await db.from("psp_lignes").select("id").eq("remarques", MARQUEUR);
  check(
    "purge : 0 ligne PSP de test résiduelle",
    (restLignes.data ?? []).length === 0,
    restLignes.error?.message ?? "",
  );
  const restProgs = await db.from("psp_programmations").select("id").eq("remarques", MARQUEUR);
  check(
    "purge : 0 programmation de test",
    (restProgs.data ?? []).length === 0,
    restProgs.error?.message ?? "",
  );
  // Contrôle des orphelins : les périmètres des lignes supprimées doivent avoir
  // disparu par CASCADE (vérifié au §24). Aucun marqueur n'existe sur cette table.

  console.log(`\nV7.3 LIVE — ${PASS.length} ok, ${FAIL.length} échec(s)`);
  for (const f of FAIL) console.error(`  ✘ ${f}`);
  if (FAIL.length > 0) process.exit(1);
  console.log("✔ Tous les scénarios V7.3 passent.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
