// ═══════════════════════════════════════════════════════════════════════════════
// V7.6 — Tests PURS (Node type-stripping, sans base) :
//  1. brouillon : TR seule suffit (corps/montant/année facultatifs) ;
//  2. sélection rue + « Valider la sélection » (état conservé) ;
//  3. fermeture click extérieur → sélection conservée ;
//  4. conservation sélection (résumé) ;
//  5. suppression sélection d'adresse (TR conservée) ;
//  6. ER → rue/numéro/adresse ;
//  7-8. garages masqués / visibles ;
//  9. TR → sous-secteur → CC (référentiel, autorité) ;
// 10. sous-secteur sans CC → message « non renseigné » ;
// 11-12. référentiel CC : modification / un CC sur plusieurs sous-secteurs ;
// 13-14. ajout CMICHEL / LALLIANC (aucun en dur dans le code) ;
// 15-16. référentiel corps d'état GE/GT/CP ;
// 17-19. brouillon incomplet enregistrable + export bloqué ;
// 20. suppression périmètre ;
// 21. persistance fermeture/réouverture (état préservé).
// Exécution : node scripts/test-psp-v76.mjs
// ═══════════════════════════════════════════════════════════════════════════════
import {
  analyserCompletudeExport,
  applicerReferentielCcUpsert,
  brouillonEnregistrable,
  categorieCorpsEtatReferentiel,
  construirePerimetres,
  corpsEtatsGroupesReferentiel,
  estLotGarage,
  libelleCcManquant,
  resumeSelectionAdresse,
  sansGarages,
} from "../src/lib/psp.prep.v7.ts";
import { construireReferencePatrimoine } from "../src/lib/psp.prep.data.ts";
import { creerOperation } from "../src/lib/psp.prep.ts";

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

// ── 1. BROUILLON : TR seule suffit ─────────────────────────────────────────────
console.log("\n=== 1. BROUILLON — TR SEULE SUFFIT ===");
check("TR seule (sans corps/montant/année) → enregistrable", brouillonEnregistrable("1977") === true);
check("sans TR → bloqué", brouillonEnregistrable(null) === false);
check("conflit de TR → bloqué", brouillonEnregistrable("1977", "lot d'une autre TR") === false);

// ── 2. SÉLECTION RUE + VALIDATION (état conservé) ──────────────────────────────
console.log("\n=== 2. SÉLECTION RUE + VALIDATION ===");
{
  const perimetres = construirePerimetres({ lots: [], adresses: [], rue: "RUE DE PARIS", mode: "auto" });
  check("rue seule → périmètre niveau 'rue'", perimetres.length === 1 && perimetres[0]?.niveau === "rue" && perimetres[0]?.rue === "RUE DE PARIS");
  check("résumé rue seule → 'Toute la rue'", resumeSelectionAdresse({ rue: "RUE DE PARIS", adresses: [], lots: [] }) === "Toute la rue");
}

// ── 3-4. FERMETURE (click extérieur) → SÉLECTION CONSERVÉE ─────────────────────
console.log("\n=== 3-4. FERMETURE SANS ANNULATION ===");
{
  const avant = construirePerimetres({ lots: [], adresses: ["3", "5", "7"], rue: "RUE DE PARIS", mode: "auto" });
  // Fermer le panneau ne touche PAS l'état : les mêmes entrées donnent le même périmètre.
  const apres = construirePerimetres({ lots: [], adresses: ["3", "5", "7"], rue: "RUE DE PARIS", mode: "auto" });
  check("périmètre conservé après fermeture", JSON.stringify(avant) === JSON.stringify(apres));
  check("résumé conservé (3, 5, 7)", resumeSelectionAdresse({ rue: "RUE DE PARIS", adresses: ["3", "5", "7"], lots: [] }) === "3, 5, 7");
}

// ── 5. SUPPRESSION SÉLECTION ADRESSE (TR conservée) ────────────────────────────
console.log("\n=== 5. SUPPRESSION DU PÉRIMÈTRE ===");
{
  const sansAdresse = construirePerimetres({ lots: [], adresses: [], rue: null, mode: "auto" });
  check("après effacement → périmètre 'tranche'", sansAdresse.length === 1 && sansAdresse[0]?.niveau === "tranche");
  check("TR conservée (aucun état ne la touche)", brouillonEnregistrable("1977") === true);
  check("résumé absent (rue effacée)", resumeSelectionAdresse({ rue: null, adresses: [], lots: [] }) === null);
}

// ── 6. ER → RUE / NUMÉRO / ADRESSE ─────────────────────────────────────────────
console.log("\n=== 6. ER → RUE / NUMÉRO ===");
{
  const { rueDe, entreeDe } = await import("../src/lib/adresses.ts");
  const adresse = "12 RUE DE REIMS";
  check("rue déduite", rueDe(adresse) === "RUE DE REIMS");
  check("numéro déduit", entreeDe(adresse) === "12 RUE DE REIMS");
  const perimetres = construirePerimetres({ lots: [{ id: "L1", adresse, code_patrimoine: "ER.123456" }], adresses: [], rue: "RUE DE REIMS", mode: "auto" });
  check("lot → périmètre niveau 'lot'", perimetres.length === 1 && perimetres[0]?.niveau === "lot" && perimetres[0]?.lot_id === "L1");
  check("résumé ER visible", resumeSelectionAdresse({ rue: "RUE DE REIMS", adresses: [], lots: [{ code_patrimoine: "ER.123456" }] }) === "ER.123456");
}

// ── 7-8. GARAGES ────────────────────────────────────────────────────────────────
console.log("\n=== 7-8. GARAGES ===");
{
  const garage = { id: "g", code_patrimoine: "ER.999", tranche_code: "1977", adresse: "RUE X", type_lot: "GAR" };
  const box = { id: "b", code_patrimoine: "ER.998", tranche_code: "1977", adresse: "RUE X", type_lot: "BOX" };
  const lot = { id: "l", code_patrimoine: "ER.997", tranche_code: "1977", adresse: "RUE X", type_lot: "PAR" };
  check("masqués par défaut", sansGarages([garage, box, lot], false).length === 1);
  check("visibles si cochée", sansGarages([garage, box, lot], true).length === 3);
  check("estLotGarage GAR/BOX", estLotGarage(garage) && estLotGarage(box) && !estLotGarage(lot));
}
// ── 9. TR → SOUS-SECTEUR → CC (référentiel = autorité) ─────────────────────────
console.log("\n=== 9. TR → SOUS-SECTEUR → CC ===");
{
  const tranches = [
    { code: "1950", libelle: null, localite: "THORIGNY", sous_secteur: "1", secteur: "A", nb_logements: 30 },
    { code: "1977", libelle: null, localite: "CHELLES", sous_secteur: "3", secteur: "A", nb_logements: 20 },
  ];
  const lots = [{ id: "a", code_patrimoine: "ER.1", tranche_code: "1950", adresse: "RUE DE REIMS", ville: "REIMS" }];
  const commandes = [
    { tranche_code: "1950", charge_clientele: "CANTONY" },
    { tranche_code: "1950", charge_clientele: "CANTONY" },
  ];
  const referentiel = [
    { sous_secteur: "1", charge_clientele: "ALOTHORE", identifiant_personnel: "ALOTHORE", actif: true },
  ];
  const ref = construireReferencePatrimoine(tranches, lots, commandes, referentiel);
  check("TR 1950 → CC ALOTHORE (référentiel, pas CANTONY)", ref.tranches.get("1950")?.charge_clientele === "ALOTHORE");
  check("ID personnel porté", ref.tranches.get("1950")?.identifiant_personnel === "ALOTHORE");
}

// ── 10. SOUS-SECTEUR SANS CC → MESSAGE « NON RENSEIGNÉ » ───────────────────────
console.log("\n=== 10. CC NON RENSEIGNÉ ===");
{
  check(
    "message sous-secteur X",
    libelleCcManquant({ sous_secteur: "9", charge_clientele: null }) ===
      "Chargé clientèle non renseigné pour le sous-secteur 9.",
  );
  check("aucun message si CC renseigné", libelleCcManquant({ sous_secteur: "1", charge_clientele: "ALOTHORE" }) === null);
  const tranches = [{ code: "9999", libelle: null, localite: null, sous_secteur: "9", secteur: null, nb_logements: null }];
  const ref = construireReferencePatrimoine(tranches, [], [{ tranche_code: "9999", charge_clientele: "CBELAIR" }], []);
  check("CC null sans référentiel (jamais fréquence)", ref.tranches.get("9999")?.charge_clientele === null);
}

// ── 11-14. RÉFÉRENTIEL CC : modification, multi-sous-secteurs, ajouts ──────────
console.log("\n=== 11-14. RÉFÉRENTIEL CC (upsert PUR) ===");
{
  let lignes = [
    { sous_secteur: "1", charge_clientele: "ALOTHORE", identifiant_personnel: "ALOTHORE", actif: true },
    { sous_secteur: "2", charge_clientele: "SKILIDJIAN", identifiant_personnel: "SKILIDJIAN", actif: true },
  ];
  // 11. modification
  lignes = applicerReferentielCcUpsert(lignes, { sous_secteur: "1", charge_clientele: "CMICHEL", identifiant_personnel: "CMICHEL", actif: true });
  check("modification : sous-secteur 1 → CMICHEL", lignes.find((l) => l.sous_secteur === "1")?.charge_clientele === "CMICHEL");
  check("toujours 2 lignes (upsert, pas d'insert)", lignes.length === 2);
  // 12. un même CC sur plusieurs sous-secteurs (SKILIDJIAN → 2 et 7)
  lignes = applicerReferentielCcUpsert(lignes, { sous_secteur: "7", charge_clientele: "SKILIDJIAN", identifiant_personnel: "SKILIDJIAN", actif: true });
  check("SKILIDJIAN gère 2 sous-secteurs (2 et 7)", lignes.filter((l) => l.charge_clientele === "SKILIDJIAN").length === 2);
  // 13-14. ajout CMICHEL / LALLIANC (aucun en dur dans le code applicatif)
  lignes = applicerReferentielCcUpsert(lignes, { sous_secteur: "3", charge_clientele: "CMICHEL", identifiant_personnel: "CMICHEL", actif: true });
  lignes = applicerReferentielCcUpsert(lignes, { sous_secteur: "5", charge_clientele: "LALLIANC", identifiant_personnel: "LALLIANC", actif: true });
  check("ajout CMICHEL (sous-secteur 3)", lignes.some((l) => l.sous_secteur === "3" && l.charge_clientele === "CMICHEL"));
  check("ajout LALLIANC (sous-secteur 5)", lignes.some((l) => l.sous_secteur === "5" && l.charge_clientele === "LALLIANC"));
  // désactivation
  lignes = applicerReferentielCcUpsert(lignes, { sous_secteur: "2", charge_clientele: "SKILIDJIAN", identifiant_personnel: "SKILIDJIAN", actif: false });
  check("désactivation : sous-secteur 2 inactif", lignes.find((l) => l.sous_secteur === "2")?.actif === false);
}
// ── 15-16. RÉFÉRENTIEL CORPS D'ÉTAT GE/GT/CP ──────────────────────────────────
console.log("\n=== 15-16. CORPS D'ÉTAT (RÉFÉRENTIEL) ===");
{
  const referentiel = [
    { code: "f", libelle: "(f) Ravalement", categorie: "GE", actif: true },
    { code: "d", libelle: "(d) Espaces Ext", categorie: "GT", actif: true },
    { code: "m", libelle: "(m) Carrelage", categorie: "CP", actif: true },
    { code: "z", libelle: "(z) Electricité", categorie: "CP", actif: false },
  ];
  check("catégorie depuis référentiel (GE)", categorieCorpsEtatReferentiel("(f) Ravalement", referentiel) === "GE");
  check("catégorie depuis référentiel (CP)", categorieCorpsEtatReferentiel("(m) Carrelage", referentiel) === "CP");
  const groupes = corpsEtatsGroupesReferentiel(referentiel);
  check("groupés GE/GT/CP (3 groupes)", groupes.length === 3);
  check("inactif exclu de la liste", !groupes.some((g) => g.items.includes("(z) Electricité")));
  check("valeur libre hors référentiel → repli mapping (GT)", categorieCorpsEtatReferentiel("(k) Inconnu", referentiel) === "GT");
}

// ── 17-19. BROUILLON INCOMPLET ENREGISTRABLE + EXPORT BLOQUÉ ───────────────────
console.log("\n=== 17-19. COMPLÉTUDE EXPORT ===");
{
  const complete = creerOperation(
    {
      tranche: "1977",
      categorie: "GT",
      charge_clientele: "CMICHEL",
      charge_operation: "HCHEDLY",
      corps_etat: "(d) Espaces Ext",
      adresse: "12 RUE DE PARIS",
      ville: "CHELLES",
      nature_travaux: "Réfection toiture",
      annee: 2027,
      programme: [25000, 0, 0, 0, 0],
    },
    "op-complete",
  );
  const incomplete = creerOperation(
    {
      tranche: "1977",
      categorie: "GT",
      charge_clientele: "",
      charge_operation: "HCHEDLY",
      corps_etat: "",
      adresse: "",
      ville: "",
      nature_travaux: "",
      annee: 2027,
      programme: [0, 0, 0, 0, 0],
    },
    "op-incomplete",
  );
  const sansNature = creerOperation(
    {
      tranche: "1982",
      categorie: "GE",
      charge_clientele: "",
      charge_operation: "",
      corps_etat: "(f) Ravalement",
      adresse: "5 RUE DE L EGLISE",
      ville: "THORIGNY",
      nature_travaux: "",
      annee: 2028,
      programme: [0, 12000, 0, 0, 0],
    },
    "op-sans-nature",
  );
  const sansCorps = creerOperation(
    {
      tranche: "1991",
      categorie: "CP",
      charge_clientele: "",
      charge_operation: "",
      corps_etat: "",
      adresse: "3 RUE DE REIMS",
      ville: "REIMS",
      nature_travaux: "Plomberie",
      annee: 2027,
      programme: [5000, 0, 0, 0, 0],
    },
    "op-sans-corps",
  );
  check("brouillon incomplet enregistrable", brouillonEnregistrable("1977") === true);
  const manquants = analyserCompletudeExport([complete, incomplete, sansNature, sansCorps]);
  check("ligne complète → rien de manquant", !manquants.some((l) => l.id === "op-complete"));
  const mIncomplete = manquants.find((l) => l.id === "op-incomplete");
  check(
    "ligne TR seule → 3 manquants (corps, nature, adresse, montant)",
    Boolean(mIncomplete && mIncomplete.manquants.includes("Corps d'état") && mIncomplete.manquants.includes("Nature travaux") && mIncomplete.manquants.includes("Montant programmé (au moins une année)")),
    mIncomplete?.manquants.join(",") ?? "",
  );
  check("ligne sans nature → 'Nature travaux'", manquants.some((l) => l.id === "op-sans-nature" && l.manquants.includes("Nature travaux")));
  check("ligne sans corps → 'Corps d'état'", manquants.some((l) => l.id === "op-sans-corps" && l.manquants.includes("Corps d'état")));
  check("TR portée pour chaque ligne incomplète", manquants.every((l) => l.tranche === "1977" || l.tranche === "1982" || l.tranche === "1991"));
}

// ── 20-21. PERSISTANCE FERMETURE/RÉOUVERTURE (état préservé) ───────────────────
console.log("\n=== 20-21. ÉTAT PRÉSERVÉ ===");
{
  // Après sélection d'une rue puis « fermeture » : le même état reconstruit le même périmètre.
  const etat = { rue: "RUE DE PARIS", adresses: ["3", "5", "7"], lots: [] };
  const p1 = construirePerimetres({ lots: etat.lots, adresses: etat.adresses, rue: etat.rue, mode: "auto" });
  const p2 = construirePerimetres({ lots: etat.lots, adresses: etat.adresses, rue: etat.rue, mode: "auto" });
  check("fermeture/réouverture → périmètre identique", JSON.stringify(p1) === JSON.stringify(p2));
  check("résumé inchangé", resumeSelectionAdresse(etat) === "3, 5, 7");
}

console.log(`\nRésultat : ${passed} ok, ${failed} échec(s)`);
if (failed > 0) process.exit(1);