// ═══════════════════════════════════════════════════════════════════════════════
// V7.10 — Tests PURS + source :
//  A. aucune donnée mock affichée pendant chargement ;
//  B. brouillon Supabase = source de vérité ;
//  E. budget disponible = somme GE+GT+CP ; F. absence d'enveloppe ≠ 0 ;
//  G. aucune mention « source MOCK » dans l'UI ; H. une seule checkbox Devis ;
//  I. devis enregistrable sans montant ; J. date de demande ; K. date devis ;
//  N. export XLSX 13 colonnes ; O. Arl/sect = identifiant_personnel uppercase ;
//  P. CC issu uniquement patrimoine + référentiel.
// Exécution : node scripts/test-psp-v710.mjs
// ═══════════════════════════════════════════════════════════════════════════════
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  construireDonneesExportXlsx,
  ENTETES_EXPORT_XLSX,
  creerOperation,
} from "../src/lib/psp.prep.ts";
import { construireReferencePatrimoine } from "../src/lib/psp.prep.data.ts";
import {
  budgetDisponibleParAnnee,
  budgetDisponibleTotalReel,
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
const source = (rel) =>
  readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");
const route = source("src/routes/preparation-psp.tsx");
const kpi = source("src/components/preparation-psp/PspKpi.tsx");
const devisPanel = source("src/components/preparation-psp/PspDevisPanel.tsx");
const quickAdd = source("src/components/preparation-psp/PspQuickAddRow.tsx");
const settings = source("src/components/preparation-psp/PspSettingsDialog.tsx");

// ── A. AUCUNE DONNÉE MOCK AFFICHÉE PENDANT CHARGEMENT ─────────────────────────
console.log("\n=== A. AUCUN MOCK AU CHARGEMENT ===");
check("état initial des opérations VIDE (pas PSP_OPERATIONS)", /useState<PspOperation[]>\[\]/.test(route.replace(/\s+/g, " ")) || route.includes("useState<PspOperation[]>([])"));
check("PSP_OPERATIONS non importé dans la route", !route.includes("PSP_OPERATIONS"));
check("état « Chargement de la programmation… » présent", route.includes("Chargement de la programmation"));
check("chargement conditionné au brouillon (brouillonChargement)", route.includes("brouillonChargement ?"));

// ── B. BROUILLON SUPABASE = SOURCE DE VÉRITÉ ──────────────────────────────────
console.log("\n=== B. SOURCE DE VÉRITÉ ===");
check("route consomme getPspBrouillon", route.includes("getPspBrouillon"));
check(
    "opérations alimentées depuis brouillon.lignes",
    route.includes("brouillon.lignes ?? []") || route.includes("brouillon?.lignes"),
  );

// ── E/F. BUDGET DISPONIBLE = SOMME GE+GT+CP (PAS DE MOCK) ──────────────────────
console.log("\n=== E/F. BUDGET ===");
{
  const enveloppes = { "2027|GE": 150, "2027|GT": 200, "2027|CP": 90 };
  check("budget disponible 2027 = GE+GT+CP = 440", budgetDisponibleParAnnee(2027, enveloppes) === 440);
  check("total = somme des années (440 + 0 = 440)", budgetDisponibleTotalReel(enveloppes) === 440);
  check("absence d'enveloppe → 0 (jamais de fallback 3,2 M€)", budgetDisponibleParAnnee(2028, {}) === 0);
  check("PspKpi ne passe plus PSP_BUDGET_DISPONIBLE_PAR_ANNEE", !kpi.includes("PSP_BUDGET_DISPONIBLE_PAR_ANNEE"));
  check("PspKpi affiche « — » si budget = 0", kpi.includes('budgetDisponible > 0 ? money0(budgetDisponible) : "—"'));
}

// ── G. AUCUNE MENTION « SOURCE MOCK » DANS L'UI ───────────────────────────────
console.log("\n=== G. AUCUNE MENTION MOCK ===");
check("PspKpi sans BUDGET_SOURCE", !kpi.includes("BUDGET_SOURCE"));
check("route sans « BUDGET_SOURCE = MOCK »", !route.includes("BUDGET_SOURCE = MOCK"));
check("Paramètres PSP sans mention MOCK", !settings.includes("MOCK"));
check("PspDevisPanel sans mention MOCK", !devisPanel.includes("MOCK"));

// ── H. UNE SEULE CHECKBOX DEVIS ────────────────────────────────────────────────
console.log("\n=== H. UNE SEULE CHECKBOX DEVIS ===");
check("fiche : case Devis Oui/Non unique", (devisPanel.match(/type="checkbox"/g) ?? []).length === 1);
check("fiche : bouton « Ajouter un devis » supprimé", !devisPanel.includes("Ajouter un devis"));
check("fiche : le formulaire est piloté par la case (devisOui || ajoutOuvert)", devisPanel.includes("devisOui || ajoutOuvert"));
check("saisie directe : une seule case Devis (basculerDevis)", quickAdd.includes("basculerDevis(e.target.checked)"));

// ── I. DEVIS SANS MONTANT ──────────────────────────────────────────────────────
console.log("\n=== I. DEVIS SANS MONTANT ===");
check("fiche : montant null quand vide (ajouter)", devisPanel.includes("montant: montant.trim() === \"\" ? null : Number(montant)"));
check("fiche : montant null quand vide (enregistrer)", devisPanel.includes("montant: editForm.montant.trim() === \"\" ? null : Number(editForm.montant)"));
check("route : createPspDevis reçoit montant nullable", route.includes("montant: d.montant ?? null,"));
check("saisie directe : montant null quand vide", quickAdd.includes("montant: devisMontant.trim() === \"\" ? null : Number(devisMontant)"));

// ── J/K. DATES DEMANDE / DEVIS ─────────────────────────────────────────────────
console.log("\n=== J/K. DATES ===");
check("type PspDevis expose date_demande (= created_at)", source("src/lib/psp.prep.ts").includes("date_demande?: string | null;"));
check("route mappe created_at → date_demande", route.includes("date_demande: (d[\"created_at\"] as string | null) ?? null,"));
check("fiche affiche « Demande le » distinct de « Devis le »", devisPanel.includes("Demande le") && devisPanel.includes("Devis le"));
check("date_devis reste nullable (montant+date distincts)", source("src/lib/psp.prep.ts").includes("date_devis?: string | null;"));

// ── N/O. EXPORT XLSX ───────────────────────────────────────────────────────────
console.log("\n=== N/O. EXPORT ===");
{
  const op = creerOperation(
    { tranche: "1950", categorie: "CP", charge_clientele: "", charge_operation: "", corps_etat: "(m) Carrelage", adresse: "3 RUE DE PARIS", ville: "", nature_travaux: "Carrelage", annee: 2027, programme: [12000, 0, 0, 0, 0] },
    "op-ex",
  );
  const donnees = construireDonneesExportXlsx([op], { secteurDeTranche: (t) => (t === "1950" ? "CMICHEL" : null) });
  check("13 colonnes exactes", ENTETES_EXPORT_XLSX.length === 13);
  check("Arl/sect = identifiant_personnel (CMICHEL)", donnees.lignes[0]?.[1] === "CMICHEL");
  check("Arl/sect uppercase", donnees.lignes[0]?.[1] === String(donnees.lignes[0]?.[1]).toUpperCase());
  check("aucun « Total » / « 2026 » / « CC » dans l'export", !ENTETES_EXPORT_XLSX.includes("Total") && !ENTETES_EXPORT_XLSX.includes("2026") && !ENTETES_EXPORT_XLSX.includes("CC"));
}

// ── P. CC : PATRIMOINE + RÉFÉRENTIEL (PAS DE FRÉQUENCE) ───────────────────────
console.log("\n=== P. CC ===");
{
  const tranches = [{ code: "1950", libelle: null, localite: null, sous_secteur: "1", secteur: "S11", nb_logements: 30 }];
  const commandes = [{ tranche_code: "1950", charge_clientele: "CANTONY" }, { tranche_code: "1950", charge_clientele: "CANTONY" }];
  const referentiel = [{ sous_secteur: "1", charge_clientele: "ALOTHORE", identifiant_personnel: "CMICHEL", actif: true }];
  const ref = construireReferencePatrimoine(tranches, [], commandes, referentiel);
  check("CC = référentiel (ALOTHORE, pas fréquence CANTONY)", ref.tranches.get("1950")?.charge_clientele === "ALOTHORE");
  check("ID = identifiant_personnel (CMICHEL)", ref.tranches.get("1950")?.identifiant_personnel === "CMICHEL");
  const sansRef = construireReferencePatrimoine(tranches, [], commandes, []);
  check("sans référentiel → CC null (jamais fréquence commandes)", sansRef.tranches.get("1950")?.charge_clientele === null);
}

console.log(`\nRésultat : ${passed} ok, ${failed} échec(s)`);
if (failed > 0) process.exit(1);