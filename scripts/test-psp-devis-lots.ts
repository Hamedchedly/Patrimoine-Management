/**
 * V8.16z — Tests PURS du module « Informations des lots » des demandes de devis
 * (`src/lib/psp.devis.lots.view.ts`).
 *
 * Lancement : `npx tsx scripts/test-psp-devis-lots.ts`
 *
 * Couvre (spec §12) : préremplissage, champs manquants → vide (jamais inventé),
 * lot vacant → pas d'ancien locataire, multi-lots, composition du bloc mail.
 */
import assert from "node:assert/strict";

import {
  composerBlocLotsMail,
  construireFicheLot,
  formaterSurface,
  statutOccupationDefaut,
  type LotDevisInfos,
} from "../src/lib/psp/devis.lots.view";

const lot = (over: Partial<LotDevisInfos> = {}): LotDevisInfos => ({
  id: "00000000-0000-0000-0000-000000000001",
  code_patrimoine: "ER.26157",
  tranche_code: "1976",
  type_lot: null,
  batiment: "B",
  etage: "3",
  porte: "23",
  surface_utile: 64,
  dpe: null,
  adresse: "12 rue X",
  code_postal: "77100",
  ville: "MEAUX",
  locataire_nom: "Jean DUPONT",
  locataire_telephone: "06 12 34 56 78",
  locataire_email: null,
  date_entree: null,
  localite_tranche: "MEAUX",
  ...over,
});

let nb = 0;
const test = (name: string, fn: () => void) => {
  nb += 1;
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (e) {
    console.error(`FAIL  ${name}`);
    throw e;
  }
};

// ── statut d'occupation (C5 / C6 : lot vacant → pas d'ancien locataire) ──
test("statutOccupationDefaut: occupé si un locataire existe", () => {
  assert.equal(statutOccupationDefaut(lot()), "occupe");
});
test("statutOccupationDefaut: vacant si aucun locataire (jamais inventé)", () => {
  assert.equal(statutOccupationDefaut(lot({ locataire_nom: null })), "vacant");
  assert.equal(statutOccupationDefaut(lot({ locataire_nom: "   " })), "vacant");
});

// ── préremplissage depuis le référentiel (C1) ──
test("construireFicheLot: préremplissage complet", () => {
  const f = construireFicheLot(lot());
  assert.equal(f.code, "ER.26157");
  assert.equal(f.adresse, "12 rue X");
  assert.equal(f.batiment, "B");
  assert.equal(f.appartement, "23");
  assert.equal(f.etage, "3");
  assert.equal(f.surface, 64);
  assert.equal(f.ville, "MEAUX");
  assert.equal(f.locataire_nom, "Jean DUPONT");
  assert.equal(f.locataire_telephone, "06 12 34 56 78");
  assert.equal(f.statut_occupation, "occupe");
  assert.equal(f.entree, null); // aucune colonne entrée → jamais inventé
  assert.equal(f.contact_complement, "");
  assert.equal(f.conditions_acces, "");
});

// ── champs manquants → vide (C4) ──
test("construireFicheLot: champs manquants → null/vide", () => {
  const f = construireFicheLot(
    lot({
      batiment: null,
      etage: null,
      porte: null,
      surface_utile: null,
      locataire_nom: null,
      locataire_telephone: null,
    }),
  );
  assert.equal(f.batiment, null);
  assert.equal(f.etage, null);
  assert.equal(f.appartement, null);
  assert.equal(f.surface, null);
  assert.equal(f.locataire_nom, null);
  assert.equal(f.locataire_telephone, null);
  assert.equal(f.statut_occupation, "vacant");
});

test("formaterSurface: valeur ou null (jamais inventé)", () => {
  assert.equal(formaterSurface(64), "64 m²");
  assert.equal(formaterSurface(null), null);
  assert.equal(formaterSurface(undefined), null);
});

// ── composition du bloc mail (C1 / C2 / C4 / C6) ──
test("composerBlocLotsMail: un lot — lignes renseignées uniquement", () => {
  const bloc = composerBlocLotsMail([construireFicheLot(lot())]);
  assert.ok(bloc.includes("INFORMATIONS DU LOT — ER.26157"));
  assert.ok(bloc.includes("Adresse : 12 rue X, MEAUX"));
  assert.ok(bloc.includes("Bâtiment : B"));
  assert.ok(bloc.includes("Appartement / local : 23"));
  assert.ok(bloc.includes("Étage : 3"));
  assert.ok(bloc.includes("Surface : 64 m²"));
  assert.ok(bloc.includes("Locataire : Jean DUPONT"));
  assert.ok(bloc.includes("Téléphone locataire : 06 12 34 56 78"));
  assert.ok(!bloc.includes("DPE")); // absent → pas de ligne
  assert.ok(!bloc.includes("Contact complémentaire")); // vide → pas de ligne
});

test("composerBlocLotsMail: plusieurs lots (C2)", () => {
  const a = construireFicheLot(lot());
  const b = construireFicheLot(
    lot({
      id: "00000000-0000-0000-0000-000000000002",
      code_patrimoine: "ER.26158",
      locataire_nom: null,
    }),
  );
  const bloc = composerBlocLotsMail([a, b]);
  assert.ok(bloc.includes("ER.26157") && bloc.includes("ER.26158"));
  assert.equal(bloc.split("\n\n").length, 2);
});

test("composerBlocLotsMail: lot vacant → pas de locataire (C6)", () => {
  const bloc = composerBlocLotsMail([
    construireFicheLot(lot({ locataire_nom: null, locataire_telephone: null })),
  ]);
  assert.ok(bloc.includes("Occupation : Vacant"));
  assert.ok(!bloc.includes("Locataire :"));
  assert.ok(!bloc.includes("Téléphone locataire"));
});

test("composerBlocLotsMail: vide si aucune fiche", () => {
  assert.equal(composerBlocLotsMail([]), "");
});

console.log(`\n${nb} checks OK`);
