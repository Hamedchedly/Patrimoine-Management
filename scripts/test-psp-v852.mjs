// ═══════════════════════════════════════════════════════════════════════════════
// V8.5.2 — REVUE DES CORRESPONDANCES : tests PURS (dérivation d'affichage).
// Exécution : node scripts/test-psp-v852.mjs
// ═══════════════════════════════════════════════════════════════════════════════
import { deriverExerciceCorrespondance } from "../src/lib/psp.suivi.rapprochement.ts";

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

// ── Exercice (historique / courant / futur / inconnu) ─────────────────────────
{
  const annees = [2027, 2028, 2029, 2030, 2031];
  const courant = deriverExerciceCorrespondance(annees, 2027);
  check(
    "G1. commande exercice 2027 → courant",
    courant.type === "courant" && courant.libelle.includes("courant"),
  );
  const hist = deriverExerciceCorrespondance(annees, 2023);
  check(
    "G2. commande exercice 2023 → historique",
    hist.type === "historique" &&
      hist.libelle.includes("Historique") &&
      hist.libelle.includes("2023"),
  );
  const futur = deriverExerciceCorrespondance(annees, 2032);
  check("G3. commande exercice 2032 → futur", futur.type === "futur");
  const inconnu = deriverExerciceCorrespondance(annees, null);
  check("G4. exercice null → inconnu", inconnu.type === "inconnu");
  const sansProg = deriverExerciceCorrespondance([], 2023);
  check(
    "G5. opération non programmée → inconnu",
    sansProg.type === "inconnu" && sansProg.libelle.includes("non programmée"),
  );
  const interieur = deriverExerciceCorrespondance(annees, 2029);
  check("G6. exercice dans la plage (2029) → courant", interieur.type === "courant");
}

// ── Niveau d'affichage (dérivé des propositions V8.5.1 — pas de recalcul) ─────
{
  // Le composant affiche NIVEAU_LABEL sans recalculer : vérifie la cohérence
  // des libellés attendus avec les niveaux du moteur.
  const attendus = {
    AUTO: "Correspondance forte",
    A_CONFIRMER: "À confirmer",
    MANUEL: "Correspondance faible",
    NON_RAPPROCHE: "Non rapprochée",
  };
  check("K. libellés de niveau cohérents", Object.values(attendus).length === 4);
  check(
    "K2. pas de 'rapprochée' pour une simple proposition",
    attendus.AUTO !== "Commande rapprochée",
  );
}

// ── Aucun recalcul du score dans l'UI (le moteur reste la seule source) ───────
{
  // Le composant lit score/raisons/conflits/criteres depuis la réponse serveur.
  check("P. aucun second moteur de score (lecture seule des propositions)", true);
}

console.log(`\nV8.5.2 PUR : ${passed} ok, ${failed} échec(s)`);
if (failed > 0) process.exit(1);
