import assert from "node:assert/strict";
import test from "node:test";

import {
  determinerLocataireActuel,
  motifRechercheRegex,
  normaliserRecherche,
  rechercherPatrimoine,
  type LotItem,
} from "../src/lib/adresses.ts";

test("normaliserRecherche retire les accents et la ponctuation", () => {
  assert.equal(normaliserRecherche(" Plessis-Trévise "), "PLESSIS TREVISE");
  assert.equal(normaliserRecherche(null), "");
});

test("motifRechercheRegex supporte le joker * et la recherche contient", () => {
  const avecJoker = motifRechercheRegex("pless*");
  assert.ok(avecJoker);
  assert.ok(avecJoker?.test(normaliserRecherche("Plessis-Trévise")));

  const sansJoker = motifRechercheRegex("paris");
  assert.ok(sansJoker);
  assert.ok(sansJoker?.test(normaliserRecherche("Rue de Paris")));
});

test("rechercherPatrimoine classe villes, adresses, locataires et ER", () => {
  const lots: LotItem[] = [
    {
      code_patrimoine: "ER.123456",
      tranche_code: "T1",
      type_lot: "APP",
      batiment: null,
      etage: null,
      porte: null,
      surface_utile: null,
      dpe: null,
      ville: "Paris",
      code_postal: "75000",
      adresse: "25 rue de Ruze",
      locataire_nom: "Dupont",
    },
    {
      code_patrimoine: "ER.123457",
      tranche_code: "T1",
      type_lot: "APP",
      batiment: null,
      etage: null,
      porte: null,
      surface_utile: null,
      dpe: null,
      ville: "Paris",
      code_postal: "75000",
      adresse: "25 rue de Ruze",
      locataire_nom: "Martin",
    },
  ];

  const resultatsVille = rechercherPatrimoine("paris", lots, [
    { ville: "Paris", tranches: 1, lots: 2 },
  ]);
  assert.equal(resultatsVille.villes.length, 1);
  assert.equal(resultatsVille.adresses.length, 0);

  const resultatsAdresse = rechercherPatrimoine("ruze", lots, [
    { ville: "Paris", tranches: 1, lots: 2 },
  ]);
  assert.equal(resultatsAdresse.adresses.length, 1);
  assert.equal(resultatsAdresse.adresses[0]?.lots, 2);

  const resultatsLocataire = rechercherPatrimoine("dup", lots, [
    { ville: "Paris", tranches: 1, lots: 2 },
  ]);
  assert.equal(resultatsLocataire.locataires.length, 1);
  assert.equal(resultatsLocataire.locataires[0]?.nom, "Dupont");

  const resultatsEr = rechercherPatrimoine("123456", lots, [
    { ville: "Paris", tranches: 1, lots: 2 },
  ]);
  assert.equal(resultatsEr.ers.length, 1);
  assert.equal(resultatsEr.ers[0]?.code, "ER.123456");
});

test("determinerLocataireActuel choisit le candidat le plus récent et exclut les sorties passées", () => {
  const occupant = determinerLocataireActuel(
    [
      {
        id: "1",
        lot_code: "L1",
        nom: "Zola",
        prenom: "Alice",
        date_naissance: null,
        date_entree: "2024-01-01",
        date_sortie: null,
        created_at: null,
      },
      {
        id: "2",
        lot_code: "L1",
        nom: "Adam",
        prenom: "Bruno",
        date_naissance: null,
        date_entree: "2024-01-01",
        date_sortie: null,
        created_at: null,
      },
      {
        id: "3",
        lot_code: "L1",
        nom: "Sorti",
        prenom: "Ancien",
        date_naissance: null,
        date_entree: "2023-01-01",
        date_sortie: "2024-01-01",
        created_at: null,
      },
    ],
    { aujourdHui: "2024-06-01" },
  );

  assert.equal(occupant?.id, "2");
});
