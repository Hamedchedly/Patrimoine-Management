// Tests page /adresses — regroupement Ville → Tranches → Adresses (logique pure)
// Exécution : node scripts/test-adresses.mjs
import {
  adressesParTranche,
  construireSearchAdresses,
  estGarage,
  rueDe,
  entreeDe,
  normaliserRecherche,
  rechercherPatrimoine,
  libelleDateTravail,
  formatMontantTravaux,
  libelleNbCommandesTravaux,
} from "../src/lib/adresses.ts";
import { villeDeCommande } from "../src/lib/travaux.ts";

let passed = 0;
let failed = 0;

function assert(name, cond, detail = "") {
  if (cond) {
    passed += 1;
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const lot = (code, tranche, adresse) => ({
  code_patrimoine: code,
  tranche_code: tranche,
  adresse,
  type_lot: "LOG",
  ville: "SERRIS",
  code_postal: null,
  batiment: null,
  etage: null,
  porte: null,
  surface_utile: null,
  dpe: null,
  locataire_nom: null,
});

// Hiérarchie ville → tranche → adresse (déjà filtrée des garages masqués).
const tranches = {
  "1400": {
    "AVENUE DE SARIA": [lot("L1", "1400", "AVENUE DE SARIA"), lot("L2", "1400", "AVENUE DE SARIA")],
    "RUE ROBERT THIBOUST": [lot("L3", "1400", "RUE ROBERT THIBOUST")],
  },
  "1401": {
    "PLACE THOMAS LE PILLEUR": [
      lot("L4", "1401", "PLACE THOMAS LE PILLEUR"),
      lot("L5", "1401", "PLACE THOMAS LE PILLEUR"),
      lot("L6", "1401", "PLACE THOMAS LE PILLEUR"),
    ],
  },
};

const groupes = adressesParTranche(tranches);

// Regroupement : une section par tranche, adresses directement listées dedans.
assert("regroupement → 2 tranches (sections)", groupes.length === 2);
assert("Tranches triées par ordre d'apparition (1400, 1401)", groupes[0].code === "1400" && groupes[1].code === "1401");

// Conservation des compteurs par tranche.
const t1400 = groupes.find((g) => g.code === "1400");
assert("TRANCHE 1400 → 2 adresses", t1400?.nbAdresses === 2);
assert("TRANCHE 1400 → 3 lots", t1400?.nbLots === 3);
assert(
  "TRANCHE 1400 → adresse AVENUE DE SARIA = 2 lots",
  t1400?.adresses.find((a) => a.adresse === "AVENUE DE SARIA")?.lots === 2,
);
assert(
  "TRANCHE 1400 → adresse RUE ROBERT THIBOUST = 1 lot",
  t1400?.adresses.find((a) => a.adresse === "RUE ROBERT THIBOUST")?.lots === 1,
);
const t1401 = groupes.find((g) => g.code === "1401");
assert("TRANCHE 1401 → 1 adresse / 3 lots", t1401?.nbAdresses === 1 && t1401?.nbLots === 3);

// Les tranches sans adresse visible (ex. uniquement des garages masqués) ne sont pas affichées.
assert("tranche sans adresse visible → absente", adressesParTranche({}).length === 0);
assert(
  "adresses d'une tranche → 0 ligne quand vide",
  adressesParTranche({ "9999": {} }).length === 0,
);

// Helpers patrimoine inchangés (réutilisés par la page).
assert("estGarage code ER.G → true", estGarage({ code_patrimoine: "ER.G12", type_lot: "LOG" }));
assert("estGarage type PAR → true", estGarage({ code_patrimoine: "L7", type_lot: "PAR" }));
assert("estGarage lot standard → false", estGarage({ code_patrimoine: "L7", type_lot: "LOG" }) === false);
assert("rueDe retire le numéro", rueDe("25-27  RUE DE RUZE") === "RUE DE RUZE");
assert("entreeDe normalise les espaces", entreeDe("  PLACE  THOMAS  ") === "PLACE THOMAS");

// =====================================================================
// Recherche hiérarchique multi-catégories (T1 → T20)
// =====================================================================
const mkLot = (code, tranche, adresse, ville, locataire, typeLot = "LOG") => ({
  code_patrimoine: code,
  tranche_code: tranche,
  adresse,
  ville,
  locataire_nom: locataire,
  type_lot: typeLot,
  code_postal: null,
  batiment: null,
  etage: null,
  porte: null,
  surface_utile: null,
  dpe: null,
});
const villesRef = [
  { ville: "OTHIS", tranches: 2, lots: 5 },
  { ville: "SERRIS", tranches: 3, lots: 40 },
  { ville: "PARIS 20", tranches: 1, lots: 7 },
];
const lotsRef = [
  mkLot("O1", "2120", "8 RUE CARON", "OTHIS", "Marie PARIS"),
  mkLot("S1", "1400", "14 RUE ROBERT CARON", "SERRIS", "Jean CARON"),
  mkLot("S2", "1400", "14 RUE ROBERT CARON", "SERRIS", "Lucie MARTIN"),
  mkLot("S3", "1401", "PLACE THOMAS LE PILLEUR", "SERRIS", "Paul CARON"),
  mkLot("S4", "1400", "RUE DES FRÈRES", "SERRIS", "René LÉVÊQUE"),
  mkLot("P1", "1718", "10 RUE DE PARIS", "PARIS 20", "Mohamed PARIS"),
];

// T1 : recherche ville exacte
const rOthis = rechercherPatrimoine("OTHIS", lotsRef, villesRef);
assert("T1 OTHIS → ville trouvée", rOthis.villes.some((v) => v.ville === "OTHIS"));
// T2 : recherche ville partielle
const rOth = rechercherPatrimoine("OTH", lotsRef, villesRef);
assert("T2 OTH → OTHIS trouvé", rOth.villes.some((v) => v.ville === "OTHIS"));
// T3 : recherche adresse
const rCaron = rechercherPatrimoine("CARON", lotsRef, villesRef);
assert(
  "T3 CARON → adresses contenant CARON",
  rCaron.adresses.some((a) => a.adresse.includes("CARON")),
);
// T4 : recherche locataire
assert(
  "T4 CARON → locataires contenant CARON",
  rCaron.locataires.some((l) => l.nom.includes("CARON")),
);
// T5 : même terme adresse + locataire → les deux groupes
assert("T5 CARON → adresses ET locataires", rCaron.adresses.length > 0 && rCaron.locataires.length > 0);
// T6 : même terme ville + adresse + locataire (PARIS)
const rParis = rechercherPatrimoine("PARIS", lotsRef, villesRef);
assert(
  "T6 PARIS → 3 groupes non vides",
  rParis.villes.length > 0 && rParis.adresses.length > 0 && rParis.locataires.length > 0,
);
// T7 : ordre des groupes (VILLE → ADRESSE → LOCATAIRE, aucune priorité exclusive)
assert(
  "T7 PARIS → ville PARIS 20 + adresse + locataire visibles",
  rParis.villes.some((v) => v.ville === "PARIS 20") &&
    rParis.adresses.some((a) => a.adresse === "10 RUE DE PARIS") &&
    rParis.locataires.some((l) => l.nom === "Mohamed PARIS"),
);
// T8 : plusieurs adresses → chaque adresse une seule fois (14 RUE ROBERT CARON a 2 lots)
assert(
  "T8 CARON → 2 adresses distinctes (14 RUE ROBERT CARON = 2 lots)",
  rCaron.adresses.length === 2 &&
    rCaron.adresses.find((a) => a.adresse === "14 RUE ROBERT CARON")?.lots === 2 &&
    rCaron.adresses.find((a) => a.adresse === "8 RUE CARON")?.lots === 1,
);
// T9 : plusieurs locataires → chacun affiché
assert(
  "T9 CARON → locataires Jean et Paul CARON",
  rCaron.locataires.some((l) => l.nom === "Jean CARON") &&
    rCaron.locataires.some((l) => l.nom === "Paul CARON"),
);
// T10 : insensible à la casse
assert(
  "T10 othis = OTHIS",
  rechercherPatrimoine("othis", lotsRef, villesRef).villes.some((v) => v.ville === "OTHIS"),
);

// T11 : insensible aux accents
assert(
  "T11 FRERES → RUE DES FRÈRES",
  rechercherPatrimoine("FRERES", lotsRef, villesRef).adresses.some((a) => a.adresse === "RUE DES FRÈRES"),
);
assert("T11b normaliserRecherche('frères') = FRERES", normaliserRecherche("frères") === "FRERES");
assert(
  "T11c LEVEQUE → René LÉVÊQUE",
  rechercherPatrimoine("LEVEQUE", lotsRef, villesRef).locataires.some((l) => l.nom === "René LÉVÊQUE"),
);
// T12 : recherche partielle
assert(
  "T12 thomas → PLACE THOMAS LE PILLEUR",
  rechercherPatrimoine("thomas", lotsRef, villesRef).adresses.some((a) => a.adresse === "PLACE THOMAS LE PILLEUR"),
);
// T13 : recherche vide → aucun résultat (comportement normal de /adresses)
const rVide = rechercherPatrimoine("", lotsRef, villesRef);
assert(
  "T13 recherche vide → 0 résultat",
  rVide.villes.length === 0 && rVide.adresses.length === 0 && rVide.locataires.length === 0,
);
// T14 : garages masqués → aucun résultat provenant uniquement d'un garage masqué
const garage = mkLot("ER.G1", "9999", "ALLÉE DU GARAGE", "SERRIS", null, "GAR");
const rGarageCache = rechercherPatrimoine("GARAGE", lotsRef, villesRef);
assert(
  "T14 garages masqués → 0 résultat garage",
  rGarageCache.adresses.length === 0 && rGarageCache.locataires.length === 0,
);
// T15 : garages affichés → résultat visible
const rGarageVisible = rechercherPatrimoine("GARAGE", [...lotsRef, garage], villesRef);
assert(
  "T15 garages affichés → ALLÉE DU GARAGE trouvée",
  rGarageVisible.adresses.some((a) => a.adresse === "ALLÉE DU GARAGE"),
);
// T16 : navigation depuis un résultat Ville → ville + compteurs
assert(
  "T16 résultat Ville porte la ville cible + compteurs",
  rOthis.villes[0].ville === "OTHIS" && rOthis.villes[0].tranches === 2 && rOthis.villes[0].lots === 5,
);
// T17 : navigation depuis un résultat Adresse → contexte ville/tranche/lots
const adrCaron = rCaron.adresses.find((a) => a.adresse === "14 RUE ROBERT CARON");
assert(
  "T17 résultat Adresse porte ville/tranche/lots",
  adrCaron?.ville === "SERRIS" && adrCaron?.tranche === "1400" && adrCaron?.lots === 2,
);
// T18 : navigation depuis un résultat Locataire → contexte adresse/ville/tranche
const locJean = rCaron.locataires.find((l) => l.nom === "Jean CARON");
assert(
  "T18 résultat Locataire porte adresse/ville/tranche",
  locJean?.adresse === "14 RUE ROBERT CARON" && locJean?.ville === "SERRIS" && locJean?.tranche === "1400",
);
// T19 : aucun résultat → groupes vides (message « Aucun résultat » côté page)
const rRien = rechercherPatrimoine("ZZZ", lotsRef, villesRef);
assert(
  "T19 ZZZ → aucun résultat",
  rRien.villes.length === 0 && rRien.adresses.length === 0 && rRien.locataires.length === 0,
);
// T20 : recherche déterministe — un seul parcours, aucune requête par résultat
assert(
  "T20 recherche déterministe (fonction pure, sans requête par résultat)",
  JSON.stringify(rechercherPatrimoine("CARON", lotsRef, villesRef)) === JSON.stringify(rCaron),
);

// =====================================================================
// Modal « Travaux » historique — ville, dates, montants (TEST 1 → 10)
// =====================================================================
const tranchesModal = [
  { code: "2293", localite: "NANGIS" },
  { code: "2294", localite: "NANGIS" },
  { code: "1396", localite: "CHESSY" },
];
const villesGeoModal = [
  { ville: "NANGIS", lat: 0, lng: 0, n: 1 },
  { ville: "SERRIS", lat: 0, lng: 0, n: 1 },
];
const cmdModal = (id, { tranche, adresse, annee, actif, engage }) => ({
  id,
  tranche_code: tranche,
  adresse,
  annee_exercice: annee,
  actif,
  engage,
});
// Rattachement d'une ville (même filtre que getTravaux niveau « ville », via villeDeCommande).
const historiqueDeLaVille = (rows, ville) =>
  rows.filter((c) => villeDeCommande(c, tranchesModal, villesGeoModal) === ville);

// TEST 1 : commande actif=false incluse dans l'historique
const histNangis = historiqueDeLaVille(
  [
    cmdModal("a", { tranche: "2293", adresse: "RUE", annee: 2024, actif: false, engage: 100 }),
    cmdModal("b", { tranche: "2294", adresse: "RUE", annee: 2025, actif: false, engage: 200 }),
    cmdModal("c", { tranche: "2294", adresse: "RUE", annee: 2026, actif: true, engage: 300 }),
  ],
  "NANGIS",
);
assert("TEST 1 actif=false inclus dans l'historique", histNangis.some((c) => c.actif === false));
// TEST 2 : ville avec commandes 2024 + 2025 + 2026 → les trois années
assert(
  "TEST 2 années 2024+2025+2026 retournées",
  [2024, 2025, 2026].every((y) => histNangis.some((c) => c.annee_exercice === y)),
);
// TEST 3 : adresse d'import prioritaire (adresse « SERRIS » prime sur tranche CHESSY)
const adressePrime = [{ id: "d", tranche_code: "1396", adresse: "5 RUE Z, SERRIS", annee_exercice: 2026, actif: true }];
assert(
  "TEST 3 adresse d'import prioritaire (SERRIS)",
  historiqueDeLaVille(adressePrime, "SERRIS").length === 1 &&
    historiqueDeLaVille(adressePrime, "CHESSY").length === 0,
);
// TEST 4 : adresse sans ville → fallback tranche.localite
const fallbackTranche = [{ id: "e", tranche_code: "2293", adresse: "RUE TEST", annee_exercice: 2026, actif: true }];
assert("TEST 4 fallback tranche.localite → NANGIS", historiqueDeLaVille(fallbackTranche, "NANGIS").length === 1);
// TEST 5 : date_demarrage présente → affichée
assert(
  "TEST 5 date_demarrage → affichée",
  libelleDateTravail("2024-09-11", null, null).includes("11/09/2024"),
);
// TEST 6 : demarrage absente + fin présente → « Fin : … »
assert(
  "TEST 6 date_fin_travaux → « Fin : … »",
  libelleDateTravail(null, "2025-03-28", null).startsWith("Fin :") &&
    libelleDateTravail(null, "2025-03-28", null).includes("28/03/2025"),
);
// TEST 7 : demarrage + fin absentes + communication présente → « Comm. : … »
assert(
  "TEST 7 date_communication → « Comm. : … »",
  libelleDateTravail(null, null, "2025-06-06").startsWith("Comm. :"),
);
// TEST 8 : aucune date → « Date non précisée »
assert("TEST 8 aucune date → « Date non précisée »", libelleDateTravail(null, null, null) === "Date non précisée");
// TEST 8b : priorité demarrage > fin > comm
assert(
  "TEST 8b priorité demarrage > fin > comm",
  libelleDateTravail("2024-09-11", "2025-03-28", "2025-06-06").includes("11/09/2024"),
);
// TEST 9 : annee_exercice n'est jamais utilisée comme date
assert(
  "TEST 9 annee_exercice ≠ date (commande 2024 sans date → Date non précisée)",
  libelleDateTravail(null, null, null) === "Date non précisée",
);
// TEST 10 : montant négatif conservé (jamais Math.abs)
const montantNeg = formatMontantTravaux(-2641.38).replace(/\s+/g, " ");
assert(
  "TEST 10 montant négatif conservé",
  montantNeg.startsWith("-") && montantNeg.includes("2 641,38"),
);

// Libellé du compteur du modal Travaux (correction « travailx » → « commandes de travaux »)
assert("T6 1 commande → « 1 commande de travaux »", libelleNbCommandesTravaux(1) === "1 commande de travaux");
assert("T7 3 commandes → « 3 commandes de travaux »", libelleNbCommandesTravaux(3) === "3 commandes de travaux");
assert("T8 aucune occurrence de « travailx »", !libelleNbCommandesTravaux(1).includes("travailx") && !libelleNbCommandesTravaux(3).includes("travailx"));

// ── Phase 6B : construireSearchAdresses (helper navigation partagé, module pur) ──
// Le helper retourne TOUTES les clés du search /adresses ; les valeurs undefined sont
// omises par JSON.stringify (et par la sérialisation TanStack → URL sans param inutile).
assert(
  "S1 helper : les 6 clés du search /adresses sont toujours présentes",
  Object.keys(construireSearchAdresses({})).length === 6 &&
    Object.values(construireSearchAdresses({})).every((v) => v === undefined),
);
assert(
  "S2 helper : valeurs conservées, champs absents → undefined (omis en sérialisation)",
  JSON.stringify(construireSearchAdresses({ q: "1426", ville: "SERRIS", retour: "abc-123" })) ===
    '{"q":"1426","ville":"SERRIS","retour":"abc-123"}',
);
assert("S3 helper : null et undefined normalisés pareil", 
  JSON.stringify(construireSearchAdresses({ tranche: null, rue: undefined })) ===
  JSON.stringify(construireSearchAdresses({ tranche: undefined, rue: null })),
);

console.log("\n==========================================");
console.log(`Résultat : ${passed} PASS, ${failed} FAIL`);
console.log("==========================================");
process.exit(failed > 0 ? 1 : 0);
