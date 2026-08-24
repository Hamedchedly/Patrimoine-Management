// ═══════════════════════════════════════════════════════════════════════════════
// V7.5 — Tests PURS des corrections ciblées :
//  1. filtre garages (lots.type_lot GAR/BOX — filtre d'affichage uniquement) ;
//  2. référentiel CC : résolution tranches.sous_secteur → CC actuel (autorité),
//     avec repli commandes si le référentiel ne couvre pas le sous-secteur ;
//  3. recherche ER → rue / numéro remplis (données déjà retournées, sans re-requête).
// Exécution : node scripts/test-psp-v75.mjs
// ═══════════════════════════════════════════════════════════════════════════════
import {
  construireReferencePatrimoine,
} from "../src/lib/psp.prep.data.ts";
import { estLotGarage, sansGarages } from "../src/lib/psp.prep.v7.ts";

let passed = 0;
let failed = 0;
function check(label, ok, detail = "") {
  if (ok) {
    passed++;
    console.log(`  ✔ ${label}`);
  } else {
    failed++;
    console.error(`  ✘ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// ── 1. Garages : type_lot GAR / BOX masqués par défaut (filtre d'affichage) ─────
console.log("\n=== 1. FILTRE GARAGES ===");
{
  const garage = { id: "g1", code_patrimoine: "ER.1", tranche_code: "1", adresse: "RUE X", type_lot: "GAR" };
  const box = { id: "g2", code_patrimoine: "ER.2", tranche_code: "1", adresse: "RUE X", type_lot: "BOX" };
  const parc = { id: "l1", code_patrimoine: "ER.3", tranche_code: "1", adresse: "RUE X", type_lot: "PAR" };
  const sansType = { id: "l2", code_patrimoine: "ER.4", tranche_code: "1", adresse: "RUE X", type_lot: null };
  check("GAR → garage", estLotGarage(garage) === true);
  check("BOX → garage", estLotGarage(box) === true);
  check("PAR → pas garage", estLotGarage(parc) === false);
  check("type inconnu → pas garage", estLotGarage(sansType) === false);
  check("null → pas garage", estLotGarage({ id: "x", code_patrimoine: "ER.5", tranche_code: "1", adresse: null, type_lot: null }) === false);
  const filtres = sansGarages([garage, box, parc, sansType], false);
  check("sansGarages masque GAR/BOX", filtres.length === 2 && filtres.every((l) => !estLotGarage(l)));
  check("sansGarages(affichage=true) garde tout", sansGarages([garage, box, parc], true).length === 3);
}

// ── 2. Référentiel CC : sous_secteur → CC actuel (autorité) ────────────────────
console.log("\n=== 2. RÉFÉRENTIEL CHARGÉ CLIENTÈLE ===");
{
  const tranches = [
    { code: "1950", libelle: null, localite: "THORIGNY", sous_secteur: "1", secteur: "A", nb_logements: 30 },
    { code: "1976", libelle: null, localite: "THORIGNY", sous_secteur: "2", secteur: "A", nb_logements: 40 },
    { code: "9999", libelle: null, localite: null, sous_secteur: "9", secteur: null, nb_logements: null },
  ];
  const lots = [
    { id: "a", code_patrimoine: "ER.1", tranche_code: "1950", adresse: "RUE DE REIMS", ville: "REIMS" },
  ];
  // Commandes historiques : pour 1950, la fréquence donnerait CANTONY (mauvais) —
  // le référentiel doit faire foi.
  const commandes = [
    { tranche_code: "1950", charge_clientele: "CANTONY" },
    { tranche_code: "1950", charge_clientele: "CANTONY" },
    { tranche_code: "1950", charge_clientele: "CANTONY" },
    { tranche_code: "1950", charge_clientele: "ALOTHORE" },
  ];
  const referentiel = [
    { sous_secteur: "1", charge_clientele: "ALOTHORE", identifiant_personnel: "ALOTHORE", actif: true },
    { sous_secteur: "2", charge_clientele: "SKILIDJIAN", identifiant_personnel: "SKILIDJIAN", actif: true },
    { sous_secteur: "9", charge_clientele: "X", identifiant_personnel: "X", actif: false }, // inactif ignoré
  ];

  const ref = construireReferencePatrimoine(tranches, lots, commandes, referentiel);
  const tr1950 = ref.tranches.get("1950");
  check(
    "TR 1950 → CC RÉFÉRENTIEL (ALOTHORE, pas CANTONY)",
    tr1950?.charge_clientele === "ALOTHORE",
    String(tr1950?.charge_clientele),
  );
  check(
    "TR 1950 → identifiant personnel porté",
    tr1950?.identifiant_personnel === "ALOTHORE",
  );
  const tr1976 = ref.tranches.get("1976");
  check(
    "TR 1976 → CC référentiel sous-secteur 2 (SKILIDJIAN)",
    tr1976?.charge_clientele === "SKILIDJIAN",
  );
  const tr9999 = ref.tranches.get("9999");
  check(
    "sous-secteur sans référentiel actif → CC null (aucune fréquence commandes)",
    tr9999?.charge_clientele === null,
    String(tr9999?.charge_clientele),
  );
  // V7.6 §8 — le CC n'est JAMAIS déduit des commandes historiques : sans
  // référentiel couvrant le sous-secteur → CC non renseigné (null).
  const refSansReferentiel = construireReferencePatrimoine(tranches, lots, commandes, []);
  check(
    "V7.6 : sans référentiel → CC null (plus jamais fréquence commandes CANTONY)",
    refSansReferentiel.tranches.get("1950")?.charge_clientele === null,
    String(refSansReferentiel.tranches.get("1950")?.charge_clientele),
  );
}

// ── 3. Recherche ER : rue + numéro remplis sans requête supplémentaire ────────
console.log("\n=== 3. ER → RUE / NUMÉRO ===");
{
  // La donnée renvoyée par rechercherLotsV7 / rechercherPatrimoineGlobal porte
  // déjà adresse/ville — la rue (rueDe) et le numéro (entreeDe) en sont déduits.
  const { rueDe, entreeDe } = await import("../src/lib/adresses.ts");
  const adresse = "12 RUE DE REIMS";
  const rue = rueDe(adresse);
  const entree = entreeDe(adresse);
  check("rue déduite de l'adresse du lot", rue === "RUE DE REIMS", String(rue));
  check("numéro déduit", entree === "12 RUE DE REIMS", String(entree));
}

console.log(`\nRésultat : ${passed} ok, ${failed} échec(s)`);
if (failed > 0) process.exit(1);
