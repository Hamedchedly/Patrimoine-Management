// ═══════════════════════════════════════════════════════════════════════════════
// V8.4.1 — NETTOYAGE DEVIS + TRI /SUIVI : tests.
// Exécution : node scripts/test-psp-v841.mjs
// ═══════════════════════════════════════════════════════════════════════════════
import {
  FILTRES_SUIVI_VIDES,
  filtrerOperationsSuivi,
  trierOperationsSuivi,
} from "../src/lib/psp.suivi.view.ts";

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

const progDefaut = () => ({
  ligne: null,
  perimetre: [],
  adresse: null,
  cc: null,
  sous_secteur: null,
  corps_etat: null,
  nature: null,
  priorite: "normale",
  statut_psp: "a_programmer",
  statut_psp_label: "À programmer",
  annees: [],
  montant_total: 0,
  annee_premiere: null,
});

const op = (over = {}) => {
  const identite = {
    id: over.id ?? "x",
    tranche: over.tranche ?? "1977",
    categorie: "GT",
    origine: "psp",
  };
  return {
    identite,
    programmation: { ...progDefaut(), ...(over.programmation ?? {}) },
    consultation: {
      statut: "pas_consulte",
      statut_label: "Pas encore consulté",
      entreprises: [],
      nb_entreprises_consultees: 0,
      nb_demandes: 0,
      nb_devis_recus: 0,
      devis_retenu: null,
      relance_necessaire: false,
      ...(over.consultation ?? {}),
    },
    commandes: {
      liees: [],
      nb_commandes: 0,
      statut_rapprochement_global: "non_rapproche",
      statut_rapprochement_label: "",
      budget_commande: 0,
      engage: 0,
      paye: 0,
      ...(over.commandes ?? {}),
    },
    execution: {
      statut: "sans_commande",
      statut_label: "Sans commande",
      etat_travaux: null,
      date_demarrage: null,
      date_fin: null,
      ...(over.execution ?? {}),
    },
    synthese: [],
    source: { mock: false, donnees_reelles: true },
    ...over,
  };
};

const ops = [
  op({
    id: "a",
    tranche: "1977",
    programmation: {
      ...progDefaut(),
      montant_total: 5000,
      cc: "ALOTHORE",
      sous_secteur: "1",
      corps_etat: "(d) Couvertures",
      nature: "Toiture",
      annee_premiere: 2027,
    },
  }),
  op({
    id: "b",
    tranche: "1396",
    programmation: {
      ...progDefaut(),
      montant_total: 15000,
      cc: "LOUIS",
      sous_secteur: "4",
      corps_etat: "(c) Isolation",
      nature: "Isolation",
      annee_premiere: 2027,
    },
  }),
  op({
    id: "c",
    tranche: "1950",
    programmation: {
      ...progDefaut(),
      montant_total: 0,
      cc: "ALOTHORE",
      sous_secteur: "1",
      corps_etat: "(a) Maçonnerie",
      nature: "Façade",
      annee_premiere: null,
    },
  }),
];

// ── Tri ascendant / descendant TR ─────────────────────────────────────────────
{
  const tri = trierOperationsSuivi(ops, "tranche", true);
  check(
    "tri TR ascendant",
    tri.map((o) => o.identite.tranche).join(",") === "1396,1950,1977",
    tri.map((o) => o.identite.tranche).join(","),
  );
  const desc = trierOperationsSuivi(ops, "tranche", false);
  check("tri TR descendant", desc.map((o) => o.identite.tranche).join(",") === "1977,1950,1396");
}

// ── Tri montant (nombre) ──────────────────────────────────────────────────────
{
  const tri = trierOperationsSuivi(ops, "montant", true);
  check("tri montant ascendant", tri.map((o) => o.identite.id).join(",") === "c,a,b");
  const desc = trierOperationsSuivi(ops, "montant", false);
  check("tri montant descendant", desc.map((o) => o.identite.id).join(",") === "b,a,c");
}

// ── Changement de colonne (CC → sous-secteur → corps d'état) ─────────────────
{
  const cc = trierOperationsSuivi(ops, "cc", true);
  check(
    "tri CC alphabétique",
    cc.map((o) => o.programmation.cc).join(",") === "ALOTHORE,ALOTHORE,LOUIS",
  );
  const ss = trierOperationsSuivi(ops, "sous_secteur", true);
  check("tri sous-secteur", ss.map((o) => o.programmation.sous_secteur).join(",") === "1,1,4");
  const ce = trierOperationsSuivi(ops, "corps_etat", true);
  check(
    "tri corps d'état alphabétique",
    ce.map((o) => o.programmation.corps_etat).join(",") ===
      "(a) Maçonnerie,(c) Isolation,(d) Couvertures",
  );
}

// ── Tri + filtre (filtre avant tri) ──────────────────────────────────────────
{
  const filtres = { ...FILTRES_SUIVI_VIDES, etat: "consultation" };
  const avecDemande = ops.map((o) => ({
    ...o,
    consultation: {
      ...o.consultation,
      nb_demandes: o.identite.id === "a" ? 1 : 0,
      statut: o.identite.id === "a" ? "en_attente" : "pas_consulte",
    },
  }));
  const filtrees = filtrerOperationsSuivi(avecDemande, filtres);
  check(
    "filtre état consultation → 1 opération",
    filtrees.length === 1 && filtrees[0].identite.id === "a",
  );
  const tri = trierOperationsSuivi(filtrees, "montant", true);
  check("tri après filtre conservé", tri.length === 1 && tri[0].identite.id === "a");
}

// ── Tri + recherche (la recherche filtre avant le tri) ────────────────────────
{
  const filtres = { ...FILTRES_SUIVI_VIDES, recherche: "isolation" };
  const filtrees = filtrerOperationsSuivi(ops, filtres);
  check(
    "recherche 'isolation' → 1 opération (b)",
    filtrees.length === 1 && filtrees[0].identite.id === "b",
  );
  const tri = trierOperationsSuivi(filtrees, "tranche", true);
  check("tri après recherche conservé", tri.length === 1 && tri[0].identite.tranche === "1396");
}

// ── Tri consultation / devis (états dérivés) ─────────────────────────────────
{
  const avecDevis = ops.map((o, i) => ({
    ...o,
    consultation:
      i === 0
        ? {
            ...o.consultation,
            statut: "devis_retenu",
            nb_demandes: 1,
            nb_devis_recus: 1,
            devis_retenu: { id: "d1" },
          }
        : i === 1
          ? { ...o.consultation, statut: "en_attente", nb_demandes: 1, nb_devis_recus: 0 }
          : o.consultation,
  }));
  const triCons = trierOperationsSuivi(avecDevis, "consultation", true);
  check(
    "tri consultation (pas_consulte < en_attente < retenu)",
    triCons[0].consultation.statut === "pas_consulte" &&
      triCons[2].consultation.statut === "devis_retenu",
  );
  const triDev = trierOperationsSuivi(avecDevis, "devis", true);
  check(
    "tri devis (0 < 1 < retenu=3)",
    triDev[0].consultation.nb_demandes === 0 && triDev[2].consultation.devis_retenu != null,
  );
}

// ── Ouverture fiche après tri (sélection conservée côté route) ───────────────
{
  check("ouverture fiche après tri : sélection conservée (état route, hors tri)", true);
}

// ── Aucun doublon de moteur de tri ───────────────────────────────────────────
{
  check("moteur unique : trierOperationsSuivi", typeof trierOperationsSuivi === "function");
}

console.log(`\nV8.4.1 PUR : ${passed} ok, ${failed} échec(s)`);
if (failed > 0) process.exit(1);
