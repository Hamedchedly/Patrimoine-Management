// Analyse des fichiers réels 2026 (programmation + suivi) — V4.
// Exécution : node scripts/analyse-fichiers-2026.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parseProgrammationWorkbook } from "../src/lib/psp.prep.data.ts";
import { parseTravauxWorkbook } from "../src/lib/travaux.ts";
import {
  analyserLignesReport,
  cleIdentitePsp,
  ligneSuiviDepuisRaw,
  resumeArbitrage,
} from "../src/lib/psp.prep.suivi.ts";

const dir = fileURLToPath(new URL("../data/2026/", import.meta.url));

/** ArrayBuffer exact d'un fichier lu en Node (le `.buffer` brut peut être poolé). */
const arrayBuffer = (chemin) => {
  const b = readFileSync(chemin);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};

const prog = parseProgrammationWorkbook(arrayBuffer(`${dir}Prog_Secteur_11_2026.xlsx`), {
  nom: "Prog_Secteur_11_2026.xlsx",
  feuille: "Prog 2026",
});
console.log(`\n=== PROGRAMMATION 2026 ===`);
console.log(`lignes : ${prog.lignes.length} · années : ${prog.annees.join(",")}`);
console.log(`C invalides : ${prog.erreurs.length}`);
console.log(
  `lignes avec LB : ${prog.lignes.filter((l) => l.ligne_budget).length} · avec montant 2026 : ${
    prog.lignes.filter((l) => (l.programme["2026"] ?? 0) > 0).length
  }`,
);

const suivi = parseTravauxWorkbook(arrayBuffer(`${dir}Suivi_Travaux_Secteur_2026.xlsx`));
console.log(`\n=== SUIVI 2026 (moteur d'import existant) ===`);
console.log(
  `commandes : ${suivi.commandes.length} · sans commande (erreurs) : ${suivi.erreurs.length} · doublons : ${suivi.doublons} · conflits : ${suivi.conflits.length}`,
);
console.log(
  `autres erreurs que « Numéro de commande manquant » : ${
    suivi.erreurs.filter((e) => e.message !== "Numéro de commande manquant").length
  }`,
);

const programmees = prog.lignes
  .filter((l) => (l.programme["2026"] ?? 0) > 0)
  .map((l) => ({
    tranche: l.tranche,
    categorie: l.categorie ?? "GT",
    nature_travaux: l.nature_travaux,
    montant: l.programme["2026"] ?? 0,
    annee: 2026,
    ligne_budget: l.ligne_budget,
  }));
const suiviLignes = [
  ...suivi.commandes.map((c) => ligneSuiviDepuisRaw(c)),
  ...suivi.erreurs.map((e) => ligneSuiviDepuisRaw(e)),
];

const lignes = analyserLignesReport(programmees, suiviLignes, 2027);
console.log(`\n=== REVUE DES REPORTS 2026 → 2027 ===`);
console.log(`lignes d'arbitrage : ${lignes.length}`);
console.log(JSON.stringify(resumeArbitrage(lignes), null, 2));

// Correspondances manquantes / excédentaires.
const cleProgrammees = new Set(programmees.map((p) => cleIdentitePsp(p.tranche, p.categorie)));
const cleSuivi = new Set(suiviLignes.map((s) => cleIdentitePsp(s.tranche, s.categorie)));
const programmeesSansSuivi = [...cleProgrammees].filter((c) => !cleSuivi.has(c));
const suiviSansProgramme = [...cleSuivi].filter((c) => !cleProgrammees.has(c));
console.log(
  `programmées sans ligne au suivi (TR|C) : ${programmeesSansSuivi.join(", ") || "aucune"}`,
);
console.log(`suivi sans programmation (TR|C) : ${suiviSansProgramme.join(", ") || "aucune"}`);

console.log("\néchantillon lignes d'arbitrage :");
for (const l of lignes.slice(0, 8)) {
  console.log(
    `  ${l.tranche} ${l.categorie} ${l.ligne_budget ?? "—"} | ${l.nature_travaux.slice(0, 40)} | ${l.montant_programme} € | cmd=${l.commande ?? "—"} | ${l.statut}`,
  );
}
