import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseTravauxWorkbook } from "../src/lib/travaux.ts";

const downloads = process.env.USERPROFILE + "\\Downloads";

function analyser(nom) {
  const parsed = parseTravauxWorkbook(readFileSync(join(downloads, nom)));
  // Lignes "budgétaires" : commandes + lignes sans commande ayant une LB
  const lignes = [
    ...parsed.commandes.map((c) => ({
      lb: (c.ligne_budget ?? "").trim(),
      budget: c.budget ?? 0,
      id: `CMD ${c.numero_commande}`,
    })),
    ...parsed.sansCommande.map((e) => ({
      lb: (e.ligne_budget ?? "").trim(),
      budget: e.budget ?? 0,
      id: `SANS (ligne ${e.line})`,
    })),
  ].filter((l) => l.lb);
  const parLB = new Map();
  for (const l of lignes) {
    if (!parLB.has(l.lb)) parLB.set(l.lb, []);
    parLB.get(l.lb).push(l);
  }
  const dup = [...parLB.entries()].filter(([, ls]) => ls.length > 1);
  const budgetBrut = lignes.reduce((s, l) => s + l.budget, 0);
  const budgetDistinct = [...parLB.entries()].reduce((s, [, ls]) => s + ls[0].budget, 0);
  console.log(`\n════ ${nom} ════`);
  console.log(`lignes avec LB : ${lignes.length} · LBs distincts : ${parLB.size}`);
  console.log(`somme budget (brute, par ligne)  : ${budgetBrut.toLocaleString("fr-FR")} €`);
  console.log(`somme budget (1ère ligne par LB) : ${budgetDistinct.toLocaleString("fr-FR")} €`);
  console.log(`LBs dupliqués (${dup.length}) :`);
  for (const [lb, ls] of dup) {
    console.log(`  LB ${lb} → ${ls.map((l) => `${l.id} (${l.budget} €)`).join(" | ")}`);
  }
}

analyser("ANM_SUIVTRXSECT 2026.xlsx");
analyser("ANM_SUIVTRXSECT 2023.xlsx");
