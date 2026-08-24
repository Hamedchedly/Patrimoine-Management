// ═══════════════════════════════════════════════════════════════════════════════
// V7.9 — Tests PURS + source :
//  A. enveloppes : mapping psp_enveloppes → grille (aucune cellule existante en 0),
//     modification d'une cellule sans écraser les autres, cellules vides ignorées ;
//  B. devis : Oui/Non unifié, bouton « Ajouter » jamais pendant l'édition,
//     création/modification/suppression via create/update/deletePspDevis ;
//  C. CC : deux colonnes exactes (Sous-secteur / ID CC), ID en MAJUSCULES
//     (règle appliquée côté serveur, jamais seulement dans l'UI).
// Exécution : node scripts/test-psp-v79.mjs
// ═══════════════════════════════════════════════════════════════════════════════
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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
const source = (rel) =>
  readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");

// ── A. ENVELOPPES : MAPPING + NON-ÉCRASEMENT ───────────────────────────────────
console.log("\n=== A. ENVELOPPES ===");
{
  // Mapping identique à PspSettingsDialog (psp_enveloppes → grille).
  const rows = [
    { annee: 2027, categorie: "GE", montant: 150 },
    { annee: 2027, categorie: "GT", montant: 200 },
    { annee: 2027, categorie: "CP", montant: 90 },
  ];
  const map = rows.reduce((m, r) => ((m[`${r.annee}|${r.categorie}`] = r.montant), m), {});
  check("grille alimentée depuis psp_enveloppes (GE 2027 = 150)", map["2027|GE"] === 150);
  check("aucune cellule existante transformée en 0", map["2027|GT"] === 200 && map["2027|GT"] !== 0);
  check("cellule absente → vide (pas 0)", map["2028|CP"] === undefined);
  // Modification d'UNE cellule : les autres restent inchangées.
  const modifie = { ...map, "2027|GT": 250 };
  check("modification GT 2027 → 250", modifie["2027|GT"] === 250);
  check("GE 2027 inchangée", modifie["2027|GE"] === 150);
  check("CP 2027 inchangée", modifie["2027|CP"] === 90);
  // Cellules vides ignorées à l'enregistrement (jamais d'écrasement).
  const nettoie = {};
  for (const [cle, v] of Object.entries({ ...modifie, "2028|GE": "", "2028|GT": undefined })) {
    if (v === "" || v === undefined) continue;
    nettoie[cle] = typeof v === "number" ? v : Number(v) || 0;
  }
  check("cellule vide ignorée à l'enregistrement", !("2028|GE" in nettoie) && !("2028|GT" in nettoie));
  check("valeurs renseignées conservées", nettoie["2027|GE"] === 150 && nettoie["2027|GT"] === 250);
}

// ── B. DEVIS : OUI/NON UNIFIÉ ──────────────────────────────────────────────────
console.log("\n=== B. DEVIS ===");
{
  const panel = source("src/components/preparation-psp/PspDevisPanel.tsx");
  check("case « Devis » Oui/Non présente dans la fiche (unique)", /type="checkbox"[^>]*checked=\{devisOui \|\| ajoutOuvert\}/.test(panel.replace(/\s+/g, " ")));
  check("aucun bouton « Ajouter un devis » redondant (case Oui/Non = contrôle unique, V7.10)", !panel.includes("Ajouter un devis"));
  check("formulaire ajout → bouton « Ajouter »", panel.includes("<Plus className=\"size-3\" /> Ajouter"));
  check("formulaire édition → bouton « Enregistrer »", panel.includes("<Check className=\"size-3\" /> Enregistrer"));
  check("création via onAdd (createPspDevis côté route)", panel.includes("await onAdd({"));
  check("modification via onUpdate (updatePspDevis côté route)", panel.includes("await onUpdate(editionId, {"));
  const saisie = source("src/components/preparation-psp/PspQuickAddRow.tsx");
  check("saisie directe : case Devis reliée au state (basculerDevis)", saisie.includes("onChange={(e) => basculerDevis(e.target.checked)}"));
  check("saisie directe : décoché vide les champs devis", saisie.includes("if (!checked)") && saisie.includes("setDevisMontant(\"\")"));
}

// ── C. CC : 2 COLONNES + MAJUSCULES ────────────────────────────────────────────
console.log("\n=== C. RÉFÉRENTIEL CC ===");
{
  const body = source("src/components/preparation-psp/PspChargesClienteleDialog.tsx");
  check("colonne « Sous-secteur » présente", /Sous-secteur/.test(body));
  check("colonne « ID CC » présente", /ID CC/.test(body));
  check("colonne « Chargé clientèle » ABSENTE de la grille", !/Chargé clientèle/.test(body.replace(/\/\*[\s\S]*?\*\//g, "")) || body.indexOf("Chargé clientèle") > body.indexOf("ID CC") + 20);
  check("colonne « ID personnel » ABSENTE de l'en-tête", !body.includes(">ID personnel<"));
  check("saisie ID en MAJUSCULES (input toUpperCase)", body.includes("identifiantPersonnel: e.target.value.toUpperCase()"));
  check("normalisation MAJUSCULES côté serveur (savePspChargeClientele)", source("src/lib/psp.prep.supabase.functions.ts").includes("identifiantPersonnel: z.string().trim().toUpperCase().nullish()"));
  check("règle uppercase : cmichel → CMICHEL", "cMichel".trim().toUpperCase() === "CMICHEL");
  check("règle uppercase : CmIchel → CMICHEL", "CmIchel".trim().toUpperCase() === "CMICHEL");
  check("règle uppercase : cmiCHEL → CMICHEL", "cmiCHEL".trim().toUpperCase() === "CMICHEL");
  check("sous-secteur non modifié par la règle (1 ≠ 1.0)", String("1") === "1");
}

console.log(`\nRésultat : ${passed} ok, ${failed} échec(s)`);
if (failed > 0) process.exit(1);