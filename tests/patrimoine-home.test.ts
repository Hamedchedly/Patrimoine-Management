import assert from "node:assert/strict";
import test from "node:test";

import {
  agregerPatrimoineHome,
  adressesDeVille,
  type AdressesGeoApercu,
} from "../src/lib/patrimoine.home.ts";
import type { LotItem } from "../src/lib/adresses.ts";

const lt = (
  code: string,
  type: string | null,
  adresse: string | null,
  ville: string | null,
  tranche = "1400",
) =>
  ({
    code_patrimoine: code,
    tranche_code: tranche,
    type_lot: type,
    batiment: null,
    etage: null,
    porte: null,
    surface_utile: null,
    dpe: null,
    ville,
    code_postal: "77700",
    adresse,
    locataire_nom: null,
  }) as LotItem;

const lotsTest: LotItem[] = [
  // CHESSY — A1 (localisée) : 3 lots + 2 garages (tranche 1001) ; A2 (NON localisée) :
  //           2 lots + 1 garage (tranche 1002) ; A3 (localisée) : 1 lot + 1 garage (tranche 1003).
  lt("ER.0001", "1", "6/8/10 PLACE DES CORNILLES", "CHESSY", "1001"),
  lt("ER.0002", "2", "6/8/10 PLACE DES CORNILLES", "CHESSY", "1001"),
  lt("ER.0003", "2", "6/8/10 PLACE DES CORNILLES", "CHESSY", "1005"),
  lt("ER.G0001", "PAR", "6/8/10 PLACE DES CORNILLES", "CHESSY", "1001"),
  lt("ER.G0002", "GAR", "6/8/10 PLACE DES CORNILLES", "CHESSY", "1001"),
  lt("ER.0004", "1", "15 RUE DE PARIS", "CHESSY", "1002"),
  lt("ER.0005", "1", "15 RUE DE PARIS", "CHESSY", "1002"),
  lt("ER.G0003", "BOX", "15 RUE DE PARIS", "CHESSY", "1002"),
  lt("ER.0006", "1", "2 AVENUE DU GENERAL", "CHESSY", "1003"),
  lt("ER.G0004", "MOT", "2 AVENUE DU GENERAL", "CHESSY", "1003"),
  // SERRIS — 1 adresse localisée : 2 lots, 0 garage.
  lt("ER.0101", "1", "12 RUE DE LA GARE", "SERRIS", "1400"),
  lt("ER.0102", "1", "12 RUE DE LA GARE", "SERRIS", "1400"),
  // NANGIS — ville absente du cache d'adresses → ville non localisée.
  lt("ER.0201", "1", "1 RUE DE NANGIS", "NANGIS", "2001"),
  // Lots non rattachables → ignorés proprement.
  lt("ER.0301", "1", null, "CHESSY"),
  lt("ER.0302", "1", "10 RUE X", null),
];

const geoTest: AdressesGeoApercu[] = [
  { cle: "6/8/10 PLACE DES CORNILLES|CHESSY", lat: 48.876, lng: 2.769 },
  { cle: "2 AVENUE DU GENERAL|CHESSY", lat: 48.877, lng: 2.77 },
  { cle: "12 RUE DE LA GARE|SERRIS", lat: 48.851, lng: 2.775 },
];

test("agregerPatrimoineHome : regroupement ville/adresse et garages séparés", () => {
  const t = agregerPatrimoineHome(lotsTest, geoTest);
  const chessyVilles = t.villes.filter((v) => v.ville === "CHESSY");
  const chessy = t.villes.find((v) => v.ville === "CHESSY");

  // P1 plusieurs adresses d'une même ville → UN seul marker ville (CHESSY)
  assert.equal(chessyVilles.length, 1);
  // P2 nombre d'adresses distinctes = 3 (CHESSY)
  assert.equal(chessy?.adresses, 3);
  // P3 lots hors garages = 6 (CHESSY : 3 + 2 + 1)
  assert.equal(chessy?.lots, 6);
  // P4 garages comptés séparément = 4 (CHESSY : 2 + 1 + 1)
  assert.equal(chessy?.garages, 4);
  // P5 clic ville → adressesDeVille(CHESSY) = ses 2 adresses localisées
  assert.equal(adressesDeVille(t.adresses, "CHESSY").length, 2);

  const a1 = t.adresses.find((a) => a.adresse === "6/8/10 PLACE DES CORNILLES");
  // P6 adresse A1 → 3 lots / 2 garages
  assert.equal(a1?.lots, 3);
  assert.equal(a1?.garages, 2);
  // P7 retour villes → niveau 1 restauré (2 villes localisées)
  assert.equal(t.villes.length, 2);
  // P8 adresse sans coordonnées → comptée sans erreur (2 adresses, 1 ville)
  assert.equal(t.nonGeolocaliseesAdresses, 2);
  assert.equal(t.villesNonLocalisees, 1);
  // P8b SERRIS → 1 adresse / 2 lots / 0 garage
  assert.equal(t.villes.find((v) => v.ville === "SERRIS")?.lots, 2);
  // P9 CHESSY → 4 tranches distinctes (1001/1002/1003/1005)
  assert.equal(chessy?.tranches, 4);
  // P9b adresse A1 → tranche la plus représentée (1001) / rue brute conservée
  assert.equal(a1?.tranche, "1001");
  assert.equal(a1?.rue, "6/8/10 PLACE DES CORNILLES");
  // P9d adresse multi-tranches → répartition 1001 (2 lots/2 garages) + 1005 (1 lot)
  assert.equal(a1?.tranches.length, 2);
  assert.equal(a1?.tranches.find((tr) => tr.code === "1001")?.lots, 2);
  assert.equal(a1?.tranches.find((tr) => tr.code === "1001")?.garages, 2);
  assert.equal(a1?.tranches.find((tr) => tr.code === "1005")?.lots, 1);
  // P9c SERRIS → 1 tranche
  assert.equal(t.villes.find((v) => v.ville === "SERRIS")?.tranches, 1);
});
