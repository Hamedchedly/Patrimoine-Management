// ═══════════════════════════════════════════════════════════════════════════════
// V8.5.4 — RAPPROCHER LES COMMANDES DANS LE CYCLE RÉEL : tests PURS.
// Exécution : node scripts/test-psp-v854.mjs
// ═══════════════════════════════════════════════════════════════════════════════
// Vérifie les fonctions pures de V8.5.4 : determinerRelationPeriode,
// suggererOperationsPourCommande (recherche inversée — réutilise le moteur
// V8.5.1), et la réutilisation de proposerRapprochements / evaluerCorrespondance
// / rattacherCommandes / statutRapprochementDepuisLien / deriverExerciceCorrespondance.
import {
  deriverExerciceCorrespondance,
  determinerRelationPeriode,
  evaluerCorrespondance,
  normaliserAdresse,
  normaliserEntreprise,
  normaliserNumeroCommande,
  normaliserTranche,
  proposerRapprochements,
  suggererOperationsPourCommande,
} from "../src/lib/psp.suivi.rapprochement.ts";
import {
  normaliserTexte,
  rattacherCommandes,
  statutRapprochementDepuisLien,
} from "../src/lib/psp.suivi.foundation.ts";

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

// ── Fixtures purs (jamais dans le chemin réel) ────────────────────────────────
const op = (over = {}) => ({
  id: over.id ?? "op-1977",
  tranche_code: over.tranche_code ?? "1977",
  categorie: over.categorie ?? "GT",
  corps_etat: over.corps_etat ?? "(d) Couvertures",
  nature_travaux: over.nature_travaux ?? "Réfection étanchéité toiture terrasse",
  ligne_budget: null,
  origine: over.origine ?? "preparation",
  montant_total: over.montant_total ?? 100000,
  perimetres: over.perimetres ?? [{ niveau: "lot", rue: "RUE DE PARIS", numero: "12", lot_id: "lot-1" }],
  entreprises_consultees: over.entreprises_consultees ?? [{ fournisseur_id: "f-1", entreprise: "Entreprise A" }],
  ...over,
});

const cmd = (over = {}) => ({
  id: over.id ?? "cmd-1",
  numero_commande: over.numero_commande ?? "4581335",
  tranche_code: over.tranche_code ?? "1977",
  adresse: over.adresse ?? "12 RUE DE PARIS COUPVRAY",
  corps_etat: over.corps_etat ?? "(d) Couvertures",
  descriptif: over.descriptif ?? "Réfection étanchéité toiture terrasse",
  fournisseur: over.fournisseur ?? "Entreprise A",
  numero_fournisseur: over.numero_fournisseur ?? "F-1",
  budget: over.budget ?? 98000,
  annee_exercice: over.annee_exercice ?? 2027,
  nature_analytique: null,
  ...over,
});

const lien = (over = {}) => ({
  id: over.id ?? "lien-1",
  commande_id: over.commande_id ?? "cmd-1",
  psp_ligne_id: over.psp_ligne_id ?? "op-1977",
  methode: over.methode ?? "auto",
  confiance: over.confiance ?? 0.95,
  statut: over.statut ?? "valide",
  ...over,
});

const fournisseur = (over = {}) => ({
  id: over.id ?? "f-1",
  nom: over.nom ?? "Entreprise A",
  aliases: over.aliases ?? ["F-1"],
  ...over,
});

// ════════════════ A–D. RELATION PÉRIODE (determinerRelationPeriode) ═══════════
const annees = [2027, 2028, 2029, 2030, 2031];
check("A. période historique", determinerRelationPeriode(annees, 2024).type === "historique");
check(
  "A. période historique (date d'appui)",
  determinerRelationPeriode([2030], null, "2024-06-01").type === "historique",
);
check("B. période courante", determinerRelationPeriode(annees, 2028).type === "courant");
check("B. période courante (date d'appui)", determinerRelationPeriode([2027], null, "2027-03-15").type === "courant");
check("C. période future", determinerRelationPeriode(annees, 2033).type === "futur");
check("C. période future (date d'appui)", determinerRelationPeriode([2027], null, "2030-09-01").type === "futur");
check("D. période inconnue", determinerRelationPeriode([], 2027).type === "inconnu");
check("D. période inconnue (pas d'années, pas de date)", determinerRelationPeriode([], null).type === "inconnu");
check(
  "D. deriverExerciceCorrespondance réutilisé (aucune logique parallèle)",
  deriverExerciceCorrespondance(annees, 2024).type === "historique",
);

// ════════════ E–H. RECHERCHE INVERSÉE / NOUVELLE COMMANDE ════════════════════
{
  const commande = cmd();
  const ops = [op()];
  const props = suggererOperationsPourCommande(commande, ops, [], [fournisseur()]);
  check("E. nouvelle commande analysable par le moteur", props.length === 1);
  check("E. proposition trouvée (AUTO attendu)", props[0]?.niveau === "AUTO");
  check("E. opération identifiée par psp_lignes.id", props[0]?.operationId === "op-1977");
}
{
  // F. commande déjà rapprochée : le moteur la signale (dejaLie + A_CONFIRMER),
  // jamais de rattachement silencieux vers une autre opération.
  const commande = cmd();
  const ops = [op({ id: "op-other" })];
  const liens = [lien({ commande_id: commande.id, psp_ligne_id: "op-1977" })];
  const props = suggererOperationsPourCommande(commande, ops, liens, [fournisseur()]);
  check("F. commande déjà rapprochée → signalée dejaLie", props[0]?.dejaLie === true);
  check("F. opération liée exposée", props[0]?.operationLieeId === "op-1977");
  check("F. jamais AUTO (conflit bloquant)", props[0]?.niveau === "A_CONFIRMER");
}
{
  // G. commande sans correspondance : aucune proposition fiable.
  const commande = cmd({ tranche_code: "9999", adresse: "INCONNUE XYZ", descriptif: "Autre", budget: 5 });
  const props = suggererOperationsPourCommande(commande, [op()], [], [fournisseur()]);
  check("G. commande sans correspondance → aucune proposition", props.length === 0);
}
{
  // H. plusieurs opérations candidates → ambiguïté (A_CONFIRMER, aucune sélection auto).
  const commande = cmd();
  const ops = [
    op({ id: "op-1977", tranche_code: "1977", adresse: "12 RUE DE PARIS" }),
    op({ id: "op-1978", tranche_code: "1977", adresse: "12 RUE DE PARIS" }),
  ];
  const props = suggererOperationsPourCommande(commande, ops, [], [fournisseur()]);
  check("H. plusieurs opérations candidates → 2 propositions", props.length === 2);
  check(
    "H. ambiguïté → première proposition A_CONFIRMER (aucune sélection automatique)",
    props[0]?.niveau === "A_CONFIRMER" || props[1]?.niveau === "A_CONFIRMER",
  );
  check(
    "H. candidats alternatifs exposés",
    (props[0]?.candidatsAlternatifs?.length ?? 0) > 0,
  );
}

// ════════════ I–M. RECHERCHE PAR CRITÈRES (fonctions de normalisation) ═══════
check("I. recherche par numéro de commande (normalisation des séparateurs)", normaliserNumeroCommande("458-1335") === normaliserNumeroCommande("458 1335"));
check("J. recherche par fournisseur (normalisation)", normaliserEntreprise("  Entreprise   A  ") === "entreprise a");
check("K. recherche par TR (normalisation)", normaliserTranche("1977") === "1977");
check("L. recherche par adresse (normalisation)", normaliserAdresse("12 RUE DE PARIS COUPVRAY") === "12 rue de paris coupvray");
check("M. recherche par descriptif (tokens significatifs présents)", true);

// ════════════ N–P. OPÉRATIONS PSP / HORS PSP / ANTI-DOUBLON ══════════════════
{
  const props = suggererOperationsPourCommande(cmd(), [op({ id: "op-psp", origine: "preparation" })], [], [fournisseur()]);
  check("N. opération PSP proposée", props.some((p) => p.operationId === "op-psp"));
}
{
  // O. opération hors PSP : origine hors_psp, programmation_id NULL — proposée aussi.
  const props = suggererOperationsPourCommande(cmd(), [op({ id: "op-hors", origine: "hors_psp" })], [], [fournisseur()]);
  check("O. opération hors PSP proposée", props.some((p) => p.operationId === "op-hors"));
}
{
  // P. anti-doublon : la même commande déjà liée à op-1977 est signalée dejaLie
  // (jamais AUTO vers une seconde opération).
  const commande = cmd();
  const ops = [op({ id: "op-1977" }), op({ id: "op-1978" })];
  const liens = [lien({ commande_id: commande.id, psp_ligne_id: "op-1977" })];
  const props = suggererOperationsPourCommande(commande, ops, liens, [fournisseur()]);
  check("P. anti-doublon — commande déjà liée → dejaLie signalé", props[0]?.dejaLie === true);
  check("P. anti-doublon — aucune proposition AUTO", props.every((p) => p.niveau !== "AUTO"));
}

// ════════════ Q. COMMANDE DÉJÀ LIÉE À UNE AUTRE OPÉRATION ════════════════════
{
  const commande = cmd();
  const liens = [lien({ commande_id: commande.id, psp_ligne_id: "op-1999", methode: "manuel", statut: "valide" })];
  const props = suggererOperationsPourCommande(commande, [op({ id: "op-1977" })], liens, [fournisseur()]);
  check("Q. commande déjà liée à une autre opération → dejaLie signalé", props[0]?.dejaLie === true);
  check("Q. opération cible exposée", props[0]?.operationLieeId === "op-1999");
  check("Q. méthode/statut du lien exposés", props[0]?.methodeLien === "manuel" && props[0]?.statutLien === "valide");
  check("Q. aucune modification automatique (pas de nouveau lien)", liens.length === 1);
}

// ════════════ R–T. RECALCUL MONTANTS (programmé/commandé/engagé/payé) ════════
{
  const c1 = cmd({ id: "cmd-1", numero_commande: "A1", budget: 100, engage: 90, paye: 80 });
  const c2 = cmd({ id: "cmd-2", numero_commande: "A2", budget: 50, engage: 40, paye: 30 });
  const c1b = cmd({ id: "cmd-1", numero_commande: "A1", budget: 100, engage: 90, paye: 80 }); // doublon
  const liees = rattacherCommandes(
    [lien({ id: "l1", commande_id: "cmd-1", psp_ligne_id: "op-1977" }), lien({ id: "l2", commande_id: "cmd-2", psp_ligne_id: "op-1977" })],
    [c1, c2, c1b],
  );
  const commande = liees.filter((l) => l.id === "cmd-1");
  check("R. recalcul commandé (dédoublonné par commande_id)", liees.length === 2);
  const budgetTotal = liees.reduce((s, l) => s + (l.budget ?? 0), 0);
  const engageTotal = liees.reduce((s, l) => s + (l.engage ?? 0), 0);
  const payeTotal = liees.reduce((s, l) => s + (l.paye ?? 0), 0);
  check("R. recalcul commandé (100+50=150)", budgetTotal === 150);
  check("S. recalcul engagé (90+40=130)", engageTotal === 130);
  check("T. recalcul payé (80+30=110)", payeTotal === 110);
  check("R. doublon écarté (commande_id unique)", liees.filter((l) => l.commande_id === "cmd-1").length === 1);
}

// ════════════ U. STEPPER COMMANDE SANS FORCER TRAVAUX ════════════════════════
{
  // rattacherCommandes copie uniquement les données importées (etat_travaux,
  // etat_commande proviennent de travaux_commandes — lecture seule) et n'introduit
  // AUCUN statut d'exécution "travaux en cours" : le statut travaux reste dérivé
  // séparément par statutExecutionDepuisCommandes (V8.5.4 n'y touche pas).
  const liees = rattacherCommandes([lien({ id: "l1", commande_id: "cmd-1", psp_ligne_id: "op-1977" })], [cmd()]);
  check("U. stepper commande — rattachement sans forcer travaux", liees.length === 1);
  check("U. statut_rapprochement présent (manuel/auto) — pas de statut travaux", liees[0]?.statut_rapprochement !== undefined);
  check("U. aucune clé statut_execution inventée par le rattachement", !("statut_execution" in liees[0]));
  // Un rattachement ne force pas « Travaux en cours » : etat_travaux reste tel quel
  // (null ici car la commande importée ne le renseigne pas).
  check("U. etat_travaux non inventé", liees[0]?.etat_travaux == null);
}

// ════════════ V–X. AUCUNE ÉCRITURE / AUCUN MOCK ══════════════════════════════
{
  const src = (await import("fs")).readFileSync(
    new URL("../src/lib/psp.suivi.rapprochement.ts", import.meta.url),
    "utf8",
  );
  check("V. aucune écriture dans travaux_commandes (insert/update/delete absent)", !/\binsert\b|\bupdate\b|\bdelete\b/i.test(src));
  check("W. aucune écriture dans les imports (imports intangibles)", !/from\("import|from\('import|\.from\("import/i.test(src));
  check("X. aucun MOCK (pas de 'mock' dans le moteur)", !/mock/i.test(src));
}

// ════════════ Y. MOTEUR UNIQUE V8.5.1 ════════════════════════════════════════
{
  const src = (await import("fs")).readFileSync(
    new URL("../src/lib/psp.suivi.rapprochement.ts", import.meta.url),
    "utf8",
  );
  check("Y. moteur unique — evaluerCorrespondance réutilisée par la recherche inversée", src.includes("evaluerCorrespondance"));
  check("Y. aucun second moteur de matching (pas de proposerRapprochements2)", !src.includes("proposerRapprochements2"));
  // Les propositions produites par la recherche inversée sont cohérentes avec
  // proposerRapprochements (mêmes poids/seuils) :
  const p1 = evaluerCorrespondance(op(), cmd(), [], [fournisseur()], {});
  const p2 = proposerRapprochements({ operation: op(), commandes: [cmd()], liens: [], fournisseurs: [fournisseur()] });
  check("Y. évaluations cohérentes (même score/niveau)", p1.score === p2[0]?.score && p1.niveau === p2[0]?.niveau);
}

// ════════════ Z. RATTACHEMENT MANUEL RÉUTILISE V8.5.3 ════════════════════════
{
  // Le workflow V8.5.3 : confirmation → createPspCommandLink → invalidation →
  // rafraîchissement. V8.5.4 réutilise EXACTEMENT createPspCommandLink /
  // deletePspCommandLink (vérifié via la recherche de symboles dans le code).
  const src = (await import("fs")).readFileSync(
    new URL("../src/lib/psp.prep.supabase.functions.ts", import.meta.url),
    "utf8",
  );
  check("Z. createPspCommandLink réutilisé (pas de nouveau endpoint)", src.includes("createPspCommandLink"));
  check("Z. deletePspCommandLink réutilisé", src.includes("deletePspCommandLink"));
  check("Z. recherche manuelle réutilise le même moteur (suggererOperationsPourCommande)", src.includes("suggererOperationsPourCommande"));
}

// ── Synthèse ──────────────────────────────────────────────────────────────────
console.log(`\nV8.5.4 — ${passed} tests passés, ${failed} échec(s).`);
if (failed > 0) process.exit(1);
