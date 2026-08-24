import assert from "node:assert/strict";
import test from "node:test";

import { construireProgrammeDepuisMontants } from "../src/lib/psp.prep.ts";
import { categorieDepuisCorpsEtat, extraireCodeCorpsEtat } from "../src/lib/psp.prep.v7.ts";

test("extraireCodeCorpsEtat valide et catégorise correctement", () => {
  assert.equal(extraireCodeCorpsEtat("(u) Étanchéité"), "u");
  assert.equal(extraireCodeCorpsEtat("(x) Libellé inconnu"), null);
  assert.equal(categorieDepuisCorpsEtat("(u) Étanchéité"), "CP");
});

test("construireProgrammeDepuisMontants garde les 5 années PSP", () => {
  const programme = construireProgrammeDepuisMontants({
    "2027": 1250,
    "2029": "450" as unknown as number,
    "2040": 999,
  });

  assert.deepEqual(programme, {
    "2027": 1250,
    "2028": 0,
    "2029": 450,
    "2030": 0,
    "2031": 0,
  });
});
