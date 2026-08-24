// Tests de l'agrégation cartographique du patrimoine — agregerPatrimoineCarte + estGarage
// Exécution : node scripts/test-patrimoine-carte.mjs
import { agregerPatrimoineCarte, estGarage } from "../src/lib/adresses.ts";

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

// ---------------------------------------------------------------- Helpers
const lot = (code, type, adresse, ville, code_postal = "77700") => ({
  code_patrimoine: code,
  type_lot: type,
  adresse,
  ville,
  code_postal,
});

const villesGeo = [
  { ville: "CHESSY", ville_normalisee: "CHESSY", lat: 48.87, lng: 2.76 },
  { ville: "SERRIS", ville_normalisee: "SERRIS", lat: 48.85, lng: 2.78 },
];
const adressesGeo = [
  { cle: "6/8/10 PLACE DES CORNILLES|CHESSY", lat: 48.876, lng: 2.769 },
  { cle: "2 AVENUE DU GENERAL|CHESSY", lat: 48.877, lng: 2.77 },
  { cle: "12 RUE DE LA GARE|SERRIS", lat: 48.851, lng: 2.775 },
];

// ---------------------------------------------------------------- Données
// CHESSY : 3 adresses → 10 lots + 4 garages
//   A1 « 6/8/10 PLACE DES CORNILLES » (localisée)  : 6 lots + 2 garages
//   A2 « 15 RUE DE PARIS »          (NON localisée) : 2 lots + 1 garage
//   A3 « 2 AVENUE DU GENERAL »       (localisée)    : 2 lots + 1 garage
// SERRIS : 1 adresse (localisée) : 2 lots + 0 garage
// NANGIS : ville ABSENTE de villes_geo → ville non localisée
// 2 lots sans adresse/ville → ignorés proprement
const lots = [
  // A1 — 6 logements (types 1→5) + 2 garages (PAR puis ER.G/GAR)
  lot("ER.0001", "1", "6/8/10 PLACE DES CORNILLES", "CHESSY"),
  lot("ER.0002", "2", "6/8/10 PLACE DES CORNILLES", "CHESSY"),
  lot("ER.0003", "2", "6/8/10 PLACE DES CORNILLES", "CHESSY"),
  lot("ER.0004", "3", "6/8/10 PLACE DES CORNILLES", "CHESSY"),
  lot("ER.0005", "4", "6/8/10 PLACE DES CORNILLES", "CHESSY"),
  lot("ER.0006", "5", "6/8/10 PLACE DES CORNILLES", "CHESSY"),
  lot("ER.G0001.0001", "PAR", "6/8/10 PLACE DES CORNILLES", "CHESSY"),
  lot("ER.G0002.0002", "GAR", "6/8/10 PLACE DES CORNILLES", "CHESSY"),
  // A2 — 2 lots + 1 garage BOX
  lot("ER.0007", "1", "15 RUE DE PARIS", "CHESSY"),
  lot("ER.0008", "1", "15 RUE DE PARIS", "CHESSY"),
  lot("ER.G0003.0001", "BOX", "15 RUE DE PARIS", "CHESSY"),
  // A3 — 2 lots + 1 garage MOT
  lot("ER.0009", "2", "2 AVENUE DU GENERAL", "CHESSY"),
  lot("ER.0010", "2", "2 AVENUE DU GENERAL", "CHESSY"),
  lot("ER.G0004.0001", "MOT", "2 AVENUE DU GENERAL", "CHESSY"),
  // SERRIS — 2 lots, 0 garage
  lot("ER.0101", "1", "12 RUE DE LA GARE", "SERRIS"),
  lot("ER.0102", "1", "12 RUE DE LA GARE", "SERRIS"),
  // NANGIS — ville sans coordonnées
  lot("ER.0201", "1", "1 RUE DE NANGIS", "NANGIS"),
  // Lots non rattachables (pas d'adresse ou pas de ville) → ignorés
  lot("ER.0301", "1", null, "CHESSY"),
  lot("ER.0302", "1", "10 RUE X", null),
];

const r = agregerPatrimoineCarte(lots, villesGeo, adressesGeo);

// ---------------------------------------------------------------- T1 — Ville
const chessy = r.villes.find((v) => v.ville === "CHESSY");
assert(
  "T1 CHESSY → 3 adresses / 10 lots / 4 garages",
  chessy?.nombreAdresses === 3 && chessy?.nombreLots === 10 && chessy?.nombreGarages === 4,
  JSON.stringify(chessy),
);
assert(
  "T1b CHESSY coordonnées du référentiel villes_geo",
  chessy?.latitude === 48.87 && chessy?.longitude === 2.76,
);
const serris = r.villes.find((v) => v.ville === "SERRIS");
assert(
  "T1c SERRIS → 1 adresse / 2 lots / 0 garage",
  serris?.nombreAdresses === 1 && serris?.nombreLots === 2 && serris?.nombreGarages === 0,
  JSON.stringify(serris),
);
// ---------------------------------------------------------------- T2 — Adresse
const a1 = r.adresses.find((a) => a.adresse === "6/8/10 PLACE DES CORNILLES");
assert(
  "T2 A1 → 6 lots / 2 garages (adresse complète conservée)",
  a1?.nombreLots === 6 &&
    a1?.nombreGarages === 2 &&
    a1?.adresse === "6/8/10 PLACE DES CORNILLES" &&
    a1?.codePostal === "77700",
  JSON.stringify(a1),
);

// ---------------------------------------------------------------- T3 — Exclusion des garages
assert("T3 un garage ne JAMAIS augmenter nombreLots (6 lots à A1)", a1?.nombreLots === 6);
assert(
  "T3b estGarage : code ER.G + type GAR → garage",
  estGarage({ code_patrimoine: "ER.G0002.0002", type_lot: "GAR" }),
);
assert(
  "T3c estGarage : type PAR → garage",
  estGarage({ code_patrimoine: "ER.9999", type_lot: "PAR" }),
);
assert(
  "T3d estGarage : type MOT → garage",
  estGarage({ code_patrimoine: "ER.9999", type_lot: "MOT" }),
);
assert(
  "T3e estGarage : logement type 2 → pas un garage",
  !estGarage({ code_patrimoine: "ER.0002", type_lot: "2" }),
);

// ---------------------------------------------------------------- T4 — Plusieurs bâtiments même ville
const chessyCount = r.villes.filter((v) => v.ville === "CHESSY").length;
assert("T4 bâtiments multiples → UNE seule ville au niveau 1", chessyCount === 1);
assert("T4b 2 villes localisées au total", r.villes.length === 2);

// ---------------------------------------------------------------- T5 — Plusieurs lots à une même adresse
const a1Count = r.adresses.filter((a) => a.adresse === "6/8/10 PLACE DES CORNILLES").length;
assert("T5 plusieurs lots → UN seul marker adresse (niveau 2)", a1Count === 1);

// ---------------------------------------------------------------- T6 — Adresse sans coordonnées
const a2 = r.adresses.find((a) => a.adresse === "15 RUE DE PARIS");
assert("T6 adresse sans coordonnées → absente des markers", a2 === undefined);
assert(
  "T6b compteur adresses non localisées = 2 (A2 + NANGIS)",
  r.nonGeolocaliseesAdresses === 2,
  String(r.nonGeolocaliseesAdresses),
);

// ---------------------------------------------------------------- T7 — Ville sans coordonnées
const nangis = r.villes.find((v) => v.ville === "NANGIS");
assert("T7 ville sans coordonnées → absente des markers", nangis === undefined);
assert("T7b compteur villes non localisées = 1", r.nonGeolocaliseesVilles === 1, String(r.nonGeolocaliseesVilles));

// ---------------------------------------------------------------- T8 — Lots non rattachables
assert(
  "T8 lots sans adresse/ville → ignorés proprement (totals exacts)",
  r.villes.length === 2 && r.nonGeolocaliseesVilles === 1 && r.nonGeolocaliseesAdresses === 2,
);

// ---------------------------------------------------------------- T9 — Données invariantes
const snap = JSON.stringify(lots);
agregerPatrimoineCarte(lots, villesGeo, adressesGeo);
assert("T9 helper pur — ne mute ni lots ni référentiels", JSON.stringify(lots) === snap);

console.log("==========================================");
console.log(`Résultat : ${passed} PASS, ${failed} FAIL`);
console.log("==========================================");
process.exit(failed > 0 ? 1 : 0);

