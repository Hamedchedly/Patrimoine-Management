// ═══════════════════════════════════════════════════════════════════════════════
// V1 — INTÉGRATION FONCTIONNELLE : tests PURS ciblés.
// Exécution : node scripts/test-psp-v1-integration.mjs
// ═══════════════════════════════════════════════════════════════════════════════
// A. Rue + ER : la rue sélectionnée reste synchronisée dans le champ de recherche
//    (qRue) après l'ajout d'un ER ; correctif V8.6.1 conservé.
// B. Revue V1 : adresse réelle (psp_ligne_patrimoine + helpers), « Sans commande »,
//    statut de consultation dérivé (« Aucune demande »…).
// C. Création V1 : ligne vide d'ajout direct (même workflow que /preparation-psp,
//    createPspOperationComplete — aucun moteur métier parallèle).
// D. Entreprise : libellé robuste (libelleEntreprise / libelleEntrepriseAvecId).
// E. Non-régression : /preparation-psp conserve son workflow complet.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  libelleEntreprise,
  libelleEntrepriseAvecId,
  resumeSelectionAdresse,
  statutConsultationDepuisDevis,
} from "../src/lib/psp.prep.v7.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = (p) => join(__dirname, "..", "src", p);
const fichier = (p) => readFileSync(src(p), "utf8");

const hookRecherche = fichier("components/preparation-psp/useRecherchePatrimoine.ts");
const revue = fichier("components/preparation-psp/PspRevueAnciennes.tsx");
const supabaseFn = fichier("lib/psp.prep.supabase.functions.ts");
const v1Page = fichier("components/preparation-psp/PspV1Page.tsx");
const v1Table = fichier("components/preparation-psp/PspV1Table.tsx");
const v1QuickAdd = fichier("components/preparation-psp/PspV1QuickAddRow.tsx");
const fournisseurSearch = fichier("components/preparation-psp/PspFournisseurSearch.tsx");
const devisWorkflow = fichier("components/preparation-psp/PspDemandeDevisWorkflow.tsx");
const suiviFoundation = fichier("lib/psp.suivi.foundation.ts");
const routePrep = fichier("routes/preparation-psp.tsx");
const routeV1 = fichier("routes/preparation-psp-v1.tsx");
const quickAdd = fichier("components/preparation-psp/PspQuickAddRow.tsx");
const operationForm = fichier("components/preparation-psp/PspOperationForm.tsx");

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

// ═══════════════ A. RUE + ER — synchronisation du champ de recherche ═══════════
console.log("\nA. Rue + ER — champ de recherche synchronisé");
{
  // La sélection d'une rue écrit la rue dans le champ de recherche (qRue).
  check(
    "A1. choisirRue synchronise qRue avec la rue sélectionnée",
    hookRecherche.includes("const choisirRue = (r: string) => {") &&
      hookRecherche.includes("setRue(r);") &&
      hookRecherche.includes("setQRue(r);"),
  );
  // ER ajouté via la recherche globale → la rue dérivée est synchronisée.
  check(
    "A2. choisirLotGlobal synchronise qRue avec la rue de l'ER",
    hookRecherche.includes("const choisirLotGlobal = (l: SuggestionLot) => {") &&
      hookRecherche.includes("setQRue(r);"),
  );
  // ER ajouté via la recherche intra-tranche → la rue dérivée est synchronisée.
  check(
    "A3. choisirLotTranche synchronise qRue avec la rue de l'ER",
    hookRecherche.includes("const choisirLotTranche = (l: SuggestionLot) => {") &&
      hookRecherche.includes("if (r) setQRue(r);"),
  );
  // Invariant maître : la rue sélectionnée se reflète TOUJOURS dans qRue.
  check(
    "A4. effet de synchronisation rue → qRue (if (rue) setQRue(rue))",
    hookRecherche.includes("useEffect(() => {") && hookRecherche.includes("if (rue) setQRue(rue);"),
  );
  // Ajouter un numéro / ER ne doit JAMAIS effacer la rue ni le champ.
  const corpsBasculerAdresse = hookRecherche.slice(
    hookRecherche.indexOf("const basculerAdresse"),
    hookRecherche.indexOf("const basculerLot"),
  );
  const corpsBasculerLot = hookRecherche.slice(
    hookRecherche.indexOf("const basculerLot"),
    hookRecherche.indexOf("const retirerLot"),
  );
  check(
    "A5. l'ajout d'un numéro (basculerAdresse) ne vide ni rue ni qRue",
    !corpsBasculerAdresse.includes('setQRue("")') && !corpsBasculerAdresse.includes("setRue(null)"),
  );
  check(
    "A6. l'ajout d'un lot (basculerLot) ne vide ni rue ni qRue",
    !corpsBasculerLot.includes('setQRue("")') && !corpsBasculerLot.includes("setRue(null)"),
  );
  // Correctif V8.6.1 conservé.
  check(
    "A7. V8.6.1 conservé — qRue initialisé depuis la rue du périmètre",
    hookRecherche.includes('const [qRue, setQRue] = useState(rueInitiale ?? "")'),
  );
  check(
    "A8. V8.6.1 conservé — rue initiale déduite du périmètre existant",
    hookRecherche.includes("initialPerimetres.find((p) => p.rue)?.rue ?? null"),
  );
}

// ═══════════════ B. REVUE V1 — adresse / commande / consultation ═══════════════
console.log("\nB. Revue V1 — données réellement disponibles");
{
  // Adresse réelle depuis psp_ligne_patrimoine (helpers existants).
  check(
    "B1. getPspRevueAnciennes lit le périmètre complet (niveau, rue, numero, lot_id)",
    supabaseFn.includes('select("psp_ligne_id, tranche_code, niveau, rue, numero, lot_id")'),
  );
  check(
    "B2. l'adresse de revue est formatée via resumeSelectionAdresse (helper existant)",
    supabaseFn.includes("resumeSelectionAdresse({") && supabaseFn.includes("rue: s.rue"),
  );
  check(
    "B3. un périmètre « lot » résout le lot réel (code/adresse) — jamais inventé",
    supabaseFn.includes('from("lots")') &&
      supabaseFn.includes('select("id, code_patrimoine, adresse")') &&
      supabaseFn.includes("lot?.code_patrimoine"),
  );
  // Absence de commande → « Sans commande » (libellé métier, plus un tiret).
  check(
    "B4. revue : absence de commande affichée « Sans commande »",
    revue.includes(">Sans commande</span>"),
  );
  // Consultation / devis → statut de consultation dérivé existant.
  check(
    "B5. revue : statut de consultation dérivé réutilisé",
    revue.includes("statutConsultationDepuisDevis(e.devis).code") &&
      revue.includes("STATUT_CONSULTATION_PREP_LABELS["),
  );
  check(
    "B6. revue : absence de devis affichée « Aucune demande »",
    revue.includes(">Aucune demande</span>"),
  );
  {
    // Libellés dérivés exacts (même source que le module PSP existant).
    const codes = new Set(
      ["aucune", "a_demander", "demande_envoyee", "devis_recu", "devis_retenu"].map((c) => c),
    );
    check(
      "B7. statutConsultationDepuisDevis couvre les 5 états demandés",
      ["aucune", "a_demander", "demande_envoyee", "devis_recu", "devis_retenu"].every((c) =>
        codes.has(statutConsultationDepuisDevis([{ statut: c }]).code),
      ),
    );
  }
  {
    // Adresse réelle : lot → code lot ; rue seule → rue.
    const libelle = resumeSelectionAdresse({
      rue: "AV. DU STADE",
      adresses: [],
      lots: [{ code_patrimoine: "ER.G1977.01024" }],
    });
    check("B8. resumeSelectionAdresse lot → code ER", libelle === "ER.G1977.01024", libelle);
  }
}

// ═══════════════ C. CRÉATION V1 — ligne d'ajout direct ═════════════════════════
console.log("\nC. Création V1 — ligne vide d'ajout direct (workflow existant)");
{
  check(
    "C1. V1 : bouton « Ajouter une opération » bascule la ligne d'ajout",
    v1Page.includes("setAjoutOuvert((o) => !o)") && v1Page.includes("ajoutOuvert"),
  );
  check(
    "C2. V1 : la ligne d'ajout est rendue DANS le tableau (PspV1QuickAddRow)",
    v1Table.includes("PspV1QuickAddRow") && v1Table.includes("ajoutOuvert && programmationId"),
  );
  check(
    "C3. V1 : plus de dialogue maquette pour l'ajout (PspOperationForm retiré de l'ajout)",
    !v1Page.includes('mode="ajout"'),
  );
  check(
    "C4. la ligne d'ajout réutilise useRecherchePatrimoine (même hook que /preparation-psp)",
    v1QuickAdd.includes("useRecherchePatrimoine({ reference })"),
  );
  check(
    "C5. la ligne d'ajout réutilise PspAdressePanel (même panneau que /preparation-psp)",
    v1QuickAdd.includes("PspAdressePanel rec={rec}"),
  );
  check(
    "C6. la création passe par createPspOperationComplete (même serveur function)",
    v1QuickAdd.includes("createPspOperationComplete({") &&
      v1QuickAdd.includes("programmationId") &&
      v1QuickAdd.includes("trancheCode: rec.tranche"),
  );
  check(
    "C7. la ligne d'ajout gère les 5 montants multi-années",
    v1QuickAdd.includes("PSP_ANNEES.map((a) =>") && v1QuickAdd.includes("montants[String(a)]"),
  );
  check(
    "C8. le périmètre réel est transmis (rec.perimetres → perimetres)",
    v1QuickAdd.includes("perimetres: rec.perimetres.map("),
  );
  check(
    "C9. aucune nouvelle écriture directe : pas de .from(...).insert dans la ligne",
    !v1QuickAdd.includes(".from(") && !v1QuickAdd.includes(".insert("),
  );
  check(
    "C10. la V1 reste une route parallèle distincte (/preparation-psp-v1)",
    routeV1.includes('createFileRoute("/preparation-psp-v1")') &&
      routeV1.includes("component: PspV1Page"),
  );
}

// ═══════════════ D. ENTREPRISE — libellé robuste (nom absent → n° fournisseur) ══
console.log("\nD. Entreprise — « Fournisseur n°XXXX » si nom absent");
{
  check(
    "D1. la recherche fournisseur affiche via libelleEntreprise",
    fournisseurSearch.includes("libelleEntreprise(f.nom, f.codes[0])"),
  );
  check(
    "D2. la sélection fournisseur transporte le numéro réel",
    fournisseurSearch.includes("numero?: string | null") &&
      fournisseurSearch.includes("numero: f.codes[0] ?? null"),
  );
  check(
    "D3. le workflow suggestions affiche via libelleEntrepriseAvecId",
    devisWorkflow.includes("libelleEntrepriseAvecId(s.nom, s.numero ?? null, s.fournisseur_id)"),
  );
  check(
    "D4. SuggestionEntreprise transporte le numéro fournisseur",
    suiviFoundation.includes("numero?: string | null"),
  );
  check(
    "D5. getPspEntreprisesSuggestions alimente le numéro depuis les alias réels",
    supabaseFn.includes("numeroParFournisseur.get(f.id as string) ?? null"),
  );
  {
    // Comportements exacts du helper réutilisé.
    check(
      "D6. nom présent → le nom (libelleEntreprise)",
      libelleEntreprise("TOITURE PRO", "12345") === "TOITURE PRO",
    );
    check(
      "D7. nom absent + numéro → « Fournisseur n°12345 »",
      libelleEntreprise("", "12345") === "Fournisseur n°12345",
    );
    check(
      "D8. nom absent + numéro + id → « Fournisseur n°12345 » (AvecId)",
      libelleEntrepriseAvecId(null, "12345", "uuid") === "Fournisseur n°12345",
    );
    check(
      "D9. nom et numéro absents → « Entreprise non renseignée » (jamais vide)",
      libelleEntrepriseAvecId("", null, "uuid") === "Entreprise non renseignée",
    );
  }
}

// ═══════════════ E. NON-RÉGRESSION — /preparation-psp intact ═══════════════════
console.log("\nE. Non-régression — /preparation-psp reste le module principal");
{
  check(
    "E1. la route /preparation-psp conserve PspTable (saisie directe)",
    routePrep.includes("PspTable") && routePrep.includes('createFileRoute("/preparation-psp")'),
  );
  check(
    "E2. PspQuickAddRow conserve createPspOperationComplete (création atomique)",
    quickAdd.includes("createPspOperationComplete({") &&
      quickAdd.includes("useRecherchePatrimoine"),
  );
  check(
    "E3. PspOperationForm conservé (fiche modification / ajout de /preparation-psp)",
    operationForm.includes("PspAdressePanel rec={rec}") &&
      operationForm.includes("createPspOperationComplete") === false,
  );
  check(
    "E4. la revue partagée (PspRevueAnciennes) reste utilisée par /preparation-psp",
    routePrep.includes("PspRevueAnciennes"),
  );
  check(
    "E5. aucune nouvelle table : pas de .from(...).insert dans la ligne V1",
    !v1QuickAdd.includes(".insert("),
  );
  check(
    "E6. la V1 ne remplace pas la navigation principale",
    routeV1.includes('createFileRoute("/preparation-psp-v1")'),
  );
}

console.log(`\nV1 INTÉGRATION — ${passed} ok / ${failed} échec(s)`);
process.exit(failed > 0 ? 1 : 0);
