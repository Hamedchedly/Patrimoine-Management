// Vérification + nettoyage des données de test PSP dans Supabase DEV.
// Exécution : node scripts/test-psp-verify-cleanup.mjs
//
// MODÈLE ACTUEL (étape 3.9) :
//   - numero_commande_interne (COMN_NUM) = identité source (1 ligne Excel = 1 COMN_NUM)
//   - numero_commande (COMC_NOLIG) = attribut NULLABLE, non unique ; son absence
//     n'est PAS une erreur (aucune anomalie « commande_manquante »)
//   - les doublons/conflits sont évalués sur COMN_NUM (un COMN_NUM = un enregistrement)
//   - donnees_brutes conserve l'intégralité de la ligne source
//
// ⚠️ Ce test lit psp_import_rows.numero_commande_interne (COMN_NUM) : il REQUIERT
// la migration `supabase/migrations/20260811_psp_model_isis.sql`. Tant qu'elle
// n'est pas appliquée, le script s'arrête avec le message « Test non exécutable
// avant migration » (aucune exécution artificielle, aucune modification de config).
//
// 1. Pré-requis : migration appliquée ? (colonne numero_commande_interne présente)
// 2. Trouve les imports dont fichier_nom contient "psp-test".
// 3. Contrôle psp_imports et psp_import_rows selon le modèle COMN_NUM/COMC_NOLIG.
// 4. Compare les compteurs des tables PAT S11 (avant/après, affichés).
// 5. Supprime UNIQUEMENT ces imports de test (psp_import_rows puis psp_imports).
// 6. Affiche les compteurs finaux des tables PAT S11.
import "dotenv/config";

const { supabaseAdmin } = await import("../src/integrations/supabase-ext/client.server.ts");
const db = supabaseAdmin;

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) {
    passed += 1;
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
async function compter(table) {
  const { count, error } = await db.from(table).select("id", { count: "exact", head: true });
  return { count: count ?? 0, error: error?.message ?? null };
}

async function main() {
  // ── 0. Pré-requis : la migration du modèle COMN_NUM est-elle appliquée ? ────
  // Le modèle actuel exige psp_import_rows.numero_commande_interne (COMN_NUM),
  // ajoutée par la migration 20260811_psp_model_isis.sql (volontairement NON
  // appliquée). Sans cette colonne, le test ne peut pas s'exécuter : on le signale
  // clairement et on s'arrête, sans forcer artificiellement l'exécution.
  const probe = await db.from("psp_import_rows").select("numero_commande_interne").limit(1);
  const colonneManquante = Boolean(
    probe.error && /(does not exist|could not find|not found)/i.test(probe.error.message ?? ""),
  );
  if (colonneManquante) {
    console.log("");
    console.log("══════════════════════════════════════════════════════════════════════");
    console.log("Test non exécutable avant migration");
    console.log("  La colonne psp_import_rows.numero_commande_interne (COMN_NUM)");
    console.log("  n'existe pas encore en base : elle est ajoutée par la migration");
    console.log("  supabase/migrations/20260811_psp_model_isis.sql, qui n'est volontairement");
    console.log("  PAS appliquée (validation humaine requise avant toute écriture).");
    console.log("  Le code de ce test est aligné sur le modèle actuel COMN_NUM/COMC_NOLIG");
    console.log("  (COMN_NUM = identité, COMC_NOLIG nullable, pas de commande_manquante).");
    console.log("  → Réexécuter ce script une fois la migration validée et appliquée.");
    console.log("══════════════════════════════════════════════════════════════════════");
    process.exitCode = 2;
    return;
  }

  const tablesPatrimoine = ["travaux_commandes", "tranches", "lots", "import_travaux", "occupants"];
  const comptesAvant = {};
  for (const t of tablesPatrimoine) comptesAvant[t] = (await compter(t)).count;
  console.log("Compteurs PAT S11 AVANT nettoyage :", JSON.stringify(comptesAvant));

  // ── 1. Imports de test ──────────────────────────────────────────────────────
  const { data: importsTest, error: errImports } = await db
    .from("psp_imports")
    .select("*")
    .ilike("fichier_nom", "%psp-test%")
    .order("created_at");
  check("lecture des imports de test", !errImports, errImports?.message ?? "");
  const ids = (importsTest ?? []).map((i) => i.id);
  console.log(`Imports de test trouvés : ${ids.length}`);
  for (const imp of importsTest ?? []) {
    console.log(`  - ${imp.id} | ${imp.fichier_nom} | statut=${imp.statut} | total=${imp.lignes_total} valides=${imp.lignes_valides} erreurs=${imp.lignes_erreur} doublons=${imp.doublons}`);
  }

  if (ids.length === 0) {
    console.log("Aucun import de test à vérifier — l'import n'a peut-être pas abouti.");
    process.exitCode = 1;
    return;
  }

  // ── 2. Vérifications (modèle actuel COMN_NUM/COMC_NOLIG) ────────────────────
  for (const imp of importsTest ?? []) {
    const tag = `import ${imp.id.slice(0, 8)}`;
    check(`${tag} : statut terminal (termine|a_controler)`, imp.statut === "termine" || imp.statut === "a_controler", imp.statut);
    // Nouveau modèle : aucun statut "erreur" n'est produit → lignes_erreur doit être 0.
    check(`${tag} : lignes_erreur = 0 (plus de statut erreur)`, imp.lignes_erreur === 0, String(imp.lignes_erreur));
    check(`${tag} : lignes_total = nombre de lignes sources`, Number.isInteger(imp.lignes_total) && imp.lignes_total > 0, String(imp.lignes_total));
    check(`${tag} : doublons = nombre entier >= 0`, Number.isInteger(imp.doublons) && imp.doublons >= 0, String(imp.doublons));

    const { data: lignes, error: errRows } = await db
      .from("psp_import_rows")
      .select("*")
      .eq("import_id", imp.id)
      .order("ligne_numero");
    check(`${tag} : lecture psp_import_rows`, !errRows, errRows?.message ?? "");
    const reel = (lignes ?? []).length;

    // ── Identité : COMN_NUM obligatoire et UNIQUE (règles 1, 2, 4, 5) ──
    const comn = (lignes ?? []).map((l) => (l.numero_commande_interne ?? "").trim());
    const sansComn = comn.filter((v) => v === "").length;
    check(`${tag} : COMN_NUM présent sur chaque ligne (identité source)`, sansComn === 0, `${sansComn} ligne(s) sans COMN_NUM`);
    check(`${tag} : COMN_NUM uniques (un COMN_NUM = un enregistrement, pas de fusion)`, new Set(comn).size === reel, `${new Set(comn).size}/${reel}`);

    // ── COMC_NOLIG nullable : lignes sans numero_commande acceptées (règles 2/3) ──
    const sansComc = (lignes ?? []).filter((l) => !l.numero_commande || String(l.numero_commande).trim() === "");
    check(
      `${tag} : lignes sans COMC_NOLIG acceptées (présentes, jamais en erreur)`,
      sansComc.every((l) => l.statut !== "erreur" && !(l.erreurs ?? []).some((i) => i?.code === "commande_manquante")),
      `${sansComc.length} ligne(s) sans COMC_NOLIG`,
    );

    // ── Cohérence des lignes avec le modèle actuel ──
    const anomalies = (lignes ?? []).flatMap((l) => (Array.isArray(l.erreurs) ? l.erreurs : []));
    check(`${tag} : aucune anomalie commande_manquante sur l'import`, !anomalies.some((i) => i?.code === "commande_manquante"));
    check(`${tag} : aucune ligne en statut erreur`, (lignes ?? []).every((l) => l.statut !== "erreur"));
    // Un statut "valide" <=> aucune anomalie ; "a_controler" <=> anomalies présentes.
    let coherence = 0;
    for (const l of lignes ?? []) {
      const a = Array.isArray(l.erreurs) ? l.erreurs.length : 0;
      if ((l.statut === "valide" && a === 0) || (l.statut === "a_controler" && a > 0)) coherence += 1;
    }
    check(`${tag} : statut cohérent avec erreurs (valide<=>0 anomalie)`, coherence === reel, `${coherence}/${reel}`);

    // ── Nombre de lignes conservées conforme ──
    // lignes enregistrées = sources - doublons identiques - conflits (les conflits
    // sont comptés dans erreurs_detail sous code doublon_conflit).
    const conflits = (imp.erreurs_detail ?? []).filter((i) => i?.code === "doublon_conflit").length;
    const attenduLignes = imp.lignes_total - imp.doublons - conflits;
    check(`${tag} : nombre de lignes conservées conforme (total - doublons - conflits)`, reel === attenduLignes, `réel=${reel} attendu=${attenduLignes}`);

    // ── Fidélité de donnees_brutes (règle 6) ──
    for (const l of lignes ?? []) {
      const t = `${tag} ligne ${l.ligne_numero}`;
      check(`${t} : donnees_brutes présent (objet)`, Boolean(l.donnees_brutes) && typeof l.donnees_brutes === "object");
      check(`${t} : erreurs est un tableau`, Array.isArray(l.erreurs));
      if (l.numero_commande_interne) {
        check(
          `${t} : COMN_NUM reflété dans donnees_brutes`,
          l.donnees_brutes?.numero_commande_interne === l.numero_commande_interne,
          String(l.donnees_brutes?.numero_commande_interne),
        );
      }
      if (l.numero_commande) {
        check(
          `${t} : numero_commande reflété dans donnees_brutes`,
          l.donnees_brutes?.numero_commande === l.numero_commande,
          String(l.donnees_brutes?.numero_commande),
        );
      }
    }
  }

  // ── 3. Nettoyage UNIQUEMENT des imports de test ─────────────────────────────
  for (const id of ids) {
    await db.from("psp_import_rows").delete().eq("import_id", id);
  }
  await db.from("psp_imports").delete().in("id", ids);

  // ── 4. Vérification du nettoyage + compteurs finaux ─────────────────────────
  const restants = (await db.from("psp_imports").select("id", { count: "exact", head: true }).ilike("fichier_nom", "%psp-test%")).count ?? 0;
  check("nettoyage : plus aucun import de test", restants === 0, `restants=${restants}`);
  const lignesRestantes = (await db.from("psp_import_rows").select("id", { count: "exact", head: true }).in("import_id", ids)).count ?? 0;
  check("nettoyage : plus aucune ligne de test", lignesRestantes === 0, `restantes=${lignesRestantes}`);

  const comptesApres = {};
  for (const t of tablesPatrimoine) comptesApres[t] = (await compter(t)).count;
  console.log("Compteurs PAT S11 APRÈS nettoyage :", JSON.stringify(comptesApres));
  for (const t of tablesPatrimoine) {
    check(`PAT S11 inchangée : ${t}`, comptesApres[t] === comptesAvant[t], `${comptesAvant[t]} → ${comptesApres[t]}`);
  }

  console.log(`\n${passed} passé(s), ${failed} échec(s)`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main()
  .catch((err) => {
    console.error("Erreur inattendue :", err);
    process.exitCode = 1;
  })
  .finally(() => {
    // Sortie propre APRÈS la fin de main() : le client Supabase (HTTP keep-alive)
    // peut garder des sockets ouverts qui bloquent la sortie naturelle ; on force
    // la sortie avec le code fixé après un court délai laissant les handles se
    // fermer (évite l'assertion libuv « UV_HANDLE_CLOSING » sous Windows).
    setTimeout(() => process.exit(process.exitCode ?? 0), 150);
  });

