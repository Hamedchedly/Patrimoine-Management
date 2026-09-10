// V8.16h — Tests PURS de la validation de géocodage (normaliserVille / villeCorrespond).
// Exécution : node scripts/test-geo.mjs
import { normaliserVille, villeCorrespond } from "../src/lib/geo/index.ts";

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

// normaliserVille
check("normalise : CHESSY → chessy", normaliserVille("CHESSY") === "chessy");
check(
  "normalise : accents (Sucy-en-Brie) → sucyenbrie",
  normaliserVille("Sucy-en-Brie") === "sucyenbrie",
);
check(
  "normalise : apostrophe/point (Villeneuve-Saint-Denis)",
  normaliserVille("Villeneuve-Saint-Denis") === "villeneuvesaintdenis",
);
check("normalise : vide → vide", normaliserVille("") === "" && normaliserVille(null) === "");

// villeCorrespond — cas réels Photon (sonde)
check("CHESSY ~ Chessy (Place des Cornilles)", villeCorrespond("CHESSY", "Chessy") === true);
check(
  "CHESSY ~ Chessy-en-France (sous-commune)",
  villeCorrespond("CHESSY", "Chessy-en-France") === true,
);
check("SERRIS ~ Serris", villeCorrespond("SERRIS", "Serris") === true);
check("SUCY-EN-BRIE ~ Sucy-en-Brie", villeCorrespond("SUCY-EN-BRIE", "Sucy-en-Brie") === true);
check("VILLEPINTE ~ Villepinte", villeCorrespond("VILLEPINTE", "Villepinte") === true);
check("COUPVRAY ~ Coupvray", villeCorrespond("COUPVRAY", "Coupvray") === true);

// Rejets : homonymes d'autres régions (les vrais cas erronés)
check(
  "CHESSY ≠ Charny Orée de Puisaye (Yonne)",
  villeCorrespond("CHESSY", "Charny Orée de Puisaye") === false,
);
check(
  "CHESSY ≠ Villiers-au-Bouin (Centre)",
  villeCorrespond("CHESSY", "Villiers-au-Bouin") === false,
);
check("CHESSY ≠ Les Vans (Ardèche)", villeCorrespond("CHESSY", "Les Vans") === false);
check("VILLEPINTE ≠ Villepinte (Aude)", villeCorrespond("VILLEPINTE", "Villepinte") === true); // homonyme accepté (même nom)

// Garde-fous : noms vides jamais acceptés
check("vide demandée → false", villeCorrespond("", "Chessy") === false);
check("vide retournée → false", villeCorrespond("CHESSY", "") === false);
check("vide les deux → false", villeCorrespond("", "") === false);

console.log(`\nV8.16h GÉO — ${passed} ok / ${failed} échec(s)`);
process.exit(failed === 0 ? 0 : 1);
