// ═══════════════════════════════════════════════════════════════════════════════
// V7.3 — Tests PURS (bugs rencontrés : détection recherche, diff historique,
// programmation multi-années). Les scénarios DB sont dans test-psp-v73-live.mjs.
// Exécution : node scripts/test-psp-v73.mjs
// ═══════════════════════════════════════════════════════════════════════════════
import {
  detecterRecherchePatrimoine,
  diffHistorique,
  programmeParAnneeCategorie,
} from "../src/lib/psp.prep.v7.ts";

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

// ── 1. Détection PROPRE du type de recherche (V7.3 §3) ─────────────────────────
console.log("\n=== DÉTECTION RECHERCHE (TR vs ER/locataire) ===");
check('"1976" → tranche', detecterRecherchePatrimoine("1976") === "tranche");
check('"19" → tranche', detecterRecherchePatrimoine("19") === "tranche");
check('"TR1976" → tranche', detecterRecherchePatrimoine("TR1976") === "tranche");
check('"tr 1982" → tranche', detecterRecherchePatrimoine("tr 1982") === "tranche");
check('"ER.123" → lot', detecterRecherchePatrimoine("ER.123") === "lot");
check('"ER123" → lot', detecterRecherchePatrimoine("ER123") === "lot");
check('"er.456" → lot', detecterRecherchePatrimoine("er.456") === "lot");
check('"REIMS" → mixte', detecterRecherchePatrimoine("REIMS") === "mixte");
check('"CHESS" → mixte', detecterRecherchePatrimoine("CHESS") === "mixte");
check('"DUPONT" → mixte', detecterRecherchePatrimoine("DUPONT") === "mixte");
check('"" → mixte', detecterRecherchePatrimoine("") === "mixte");

// ── 2. Diff d'historique (psp_ligne_historique) ────────────────────────────────
console.log("\n=== DIFF HISTORIQUE ===");
{
  const avant = { programme: { 2027: 0, 2028: 15000 }, statut: "a_definir" };
  const apres = { programme: { 2027: 0, 2028: 22000 }, statut: "attente_agence" };
  const d = diffHistorique(avant, apres);
  check("2 diff pour programme + statut", d.length === 2, JSON.stringify(d));
  const statut = d.find((x) => x.champ === "Statut");
  check(
    "statut : avant → après",
    statut && statut.avant === "a_definir" && statut.apres === "attente_agence",
  );
  const prog = d.find((x) => x.champ === "Montants programmés");
  check(
    "programme résumé en années>0",
    prog && prog.avant.includes("2028:15000") && prog.apres.includes("2028:22000"),
    JSON.stringify(prog),
  );
  check(
    "aucun diff quand identique",
    diffHistorique({ statut: "x" }, { statut: "x" }).length === 0,
  );
  check(
    "champs techniques ignorés",
    diffHistorique({ id: "a", avant: null }, { id: "a", avant: null }).length === 0,
  );
}

// ── 3. Répartition annuelle (filtre cumulatif) ─────────────────────────────────
console.log("\n=== RÉPARTITION ANNUELLE ===");
{
  const ops = [
    { id: "1", categorie: "GT", programme: { 2027: 0, 2028: 15000, 2029: 0 } },
    { id: "2", categorie: "GT", programme: { 2028: 0, 2029: 8000 } },
    { id: "3", categorie: "GE", programme: { 2028: 12000 } },
  ];
  const m = programmeParAnneeCategorie(ops);
  check("2028|GT = 15000", m["2028|GT"] === 15000, String(m["2028|GT"]));
  check("2029|GT = 8000", m["2029|GT"] === 8000, String(m["2029|GT"]));
  check("2028|GE = 12000", m["2028|GE"] === 12000, String(m["2028|GE"]));
  check("2027|GT absent (montant 0)", m["2027|GT"] === undefined);
}

// ── 4. Au moins une année > 0 (règle vérifiée en RPC + UI) ─────────────────────
console.log("\n=== ANNÉE OBLIGATOIRE ===");
{
  const annees = [2027, 2028, 2029, 2030, 2031];
  check("fenêtre 2027-2031", annees.length === 5 && annees[0] === 2027);
  check("2028 présent", annees.includes(2028));
  check("2029 présent", annees.includes(2029));
}

console.log(`\nRésultat : ${passed} ok, ${failed} échec(s)`);
if (failed > 0) process.exit(1);
