// Tests Dashboard Travaux — état métier, « Pas réalisé » et filtre État (logique pure)
// Exécution : node scripts/test-dashboard-travaux.mjs
import {
  isPasRealise,
  etatMetier,
  ETATS_METIER,
  exerciceCourant,
  formatDateImportFr,
  getAlertesCommande,
  getDernierImportExercice,
  matchesAnnee,
  repartitionCommandesParSecteur,
  resyncImportErrors,
  buildDataVilles,
  secteurDe,
  sliderYearDomain,
  matchVille,
  villeDepuisAdresse,
  villeDeCommande,
  visibleArchivage,
  visibleParPerimetre,
  yearRangeInitial,
} from "../src/lib/travaux/index.ts";

let passed = 0;
let failed = 0;

function assert(name, cond, detail = "") {
  if (cond) {
    passed += 1;
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const EX = 2026;
const cmd = (annee, paye, etatTravaux = null, etatCommande = null, engage = undefined) => ({
  annee_exercice: annee,
  paye,
  etat_travaux: etatTravaux,
  etat_commande: etatCommande,
  engage,
});

// ---- 1-6 : règle « Pas réalisé » ----
assert("1  2026 + paye=0      → false", isPasRealise(cmd(2026, 0), EX) === false);
assert("2  2026 + paye=NULL   → false", isPasRealise(cmd(2026, null), EX) === false);
assert("3  2025 + paye=0      → true", isPasRealise(cmd(2025, 0), EX) === true);
assert("4  2025 + paye=NULL   → true", isPasRealise(cmd(2025, null), EX) === true);
assert("5  2024 + paye=0      → true", isPasRealise(cmd(2024, 0), EX) === true);
assert("6  2024 + paye=NULL   → true", isPasRealise(cmd(2024, null), EX) === true);

// ---- 7 : paye > 0 → jamais ----
assert("7  paye>0 (2025)      → false", isPasRealise(cmd(2025, 500), EX) === false);
assert("7b paye>0 (2026)      → false", isPasRealise(cmd(2026, 500), EX) === false);

// ---- 8 : report 2025 → 2026 (annee=2026) paye=0 → false ----
assert("8  report 2026 paye=0 → false", isPasRealise(cmd(2026, 0), EX) === false);

// ---- 9 : exerciceCourant injectable ----
assert(
  "9  exerciceCourant(2027-03-01) → 2027",
  exerciceCourant(new Date("2027-03-01T00:00:00Z")) === 2027,
);

// ---- 10 : annee NULL / undefined → false ----
assert("10 annee NULL          → false", isPasRealise(cmd(null, 0), EX) === false);
assert("10b annee undefined    → false", isPasRealise(cmd(undefined, 0), EX) === false);

// ---- 11 : année future + paye 0 → false ----
assert("11 2030 + paye=0       → false", isPasRealise(cmd(2030, 0), EX) === false);

// ---- 12 : valeurs parasites (dates/montants) exclues ----
assert("12c '2235.32' hors whitelist", !ETATS_METIER.includes("2235.32"));
assert("12d '19.05.2025' hors whitelist", !ETATS_METIER.includes("19.05.2025"));

// =====================================================================
// etatMetier — spécification métier définitive (T1 à T15)
// =====================================================================
// T1 : « Terminés » explicite prioritaire sur les montants (engage=5000, paye=0)
assert(
  "T1 2026 engage=5000 paye=0 Terminés → Terminés",
  etatMetier(cmd(2026, 0, "Terminés", null, 5000), EX) === "Terminés",
);
// T2 : « Terminés » explicite + paye NULL
assert(
  "T2 2026 engage=5000 paye=NULL Terminés → Terminés",
  etatMetier(cmd(2026, null, "Terminés", null, 5000), EX) === "Terminés",
);
// T3 : engagement sans état → En cours
assert(
  "T3 2026 engage=5000 paye=0 état vide → En cours",
  etatMetier(cmd(2026, 0, null, null, 5000), EX) === "En cours",
);
// T4 : engagement + paiement partiel → En cours (règle paye != engage abandonnée)
assert(
  "T4 2026 engage=5000 paye=2000 état vide → En cours",
  etatMetier(cmd(2026, 2000, null, null, 5000), EX) === "En cours",
);
// T5 : engagement soldé → En cours (engage != 0, non explicitement terminé)
assert(
  "T5 2026 engage=5000 paye=5000 état vide → En cours",
  etatMetier(cmd(2026, 5000, null, null, 5000), EX) === "En cours",
);
// T6 : exercice courant sans engagement ni état → Sans état (plus auto « En cours »)
assert(
  "T6 2026 engage=0 paye=0 état vide → Sans état",
  etatMetier(cmd(2026, 0, null, null, 0), EX) === "Sans état",
);
// T7 : exercice courant sans engagement ni état → Sans état
assert(
  "T7 2026 engage=NULL paye=NULL état vide → Sans état",
  etatMetier(cmd(2026, null, null, null, null), EX) === "Sans état",
);
// T8 : exercice clôturé + aucun engagement/paiement → Pas réalisé
assert(
  "T8 2025 engage=0 paye=0 état vide → Pas réalisé",
  etatMetier(cmd(2025, 0, null, null, 0), EX) === "Pas réalisé",
);
// T9 : exercice clôturé + engagement/paiement NULL → Pas réalisé
assert(
  "T9 2025 engage=NULL paye=NULL état vide → Pas réalisé",
  etatMetier(cmd(2025, null, null, null, null), EX) === "Pas réalisé",
);
// T10 : engagement sur exercice clôturé → En cours (et non Pas réalisé)
assert(
  "T10 2025 engage=5000 paye=0 état vide → En cours",
  etatMetier(cmd(2025, 0, null, null, 5000), EX) === "En cours",
);
// T11 : « Planifiés » normalisé vers « En cours »
assert(
  "T11 2026 engage=5000 paye=0 Planifiés → En cours",
  etatMetier(cmd(2026, 0, "Planifiés", null, 5000), EX) === "En cours",
);
// T12 : état explicite « En cours » conservé
assert(
  "T12 2026 engage=5000 paye=0 En cours → En cours",
  etatMetier(cmd(2026, 0, "En cours", null, 5000), EX) === "En cours",
);
// T13 : « Planifiés » sans engagement → En cours (état explicite prime sur les montants)
assert(
  "T13 2026 engage=0 paye=0 Planifiés → En cours",
  etatMetier(cmd(2026, 0, "Planifiés", null, 0), EX) === "En cours",
);
// T14 : « Terminés » sur exercice clôturé → Terminés
assert(
  "T14 2025 engage=5000 paye=0 Terminés → Terminés",
  etatMetier(cmd(2025, 0, "Terminés", null, 5000), EX) === "Terminés",
);
// T15 : « Attente validation » sans engagement → Attente validation
assert(
  "T15 2025 engage=0 paye=0 Attente validation → Attente validation",
  etatMetier(cmd(2025, 0, "Attente validation", null, 0), EX) === "Attente validation",
);

// ---- États explicites restants / normalisations ----
assert("Annulée → Annulée", etatMetier(cmd(2026, 100, null, "Annulée", 5000), EX) === "Annulée");
assert(
  "Close = clôturée → Terminés",
  etatMetier(cmd(2026, 100, null, "Close", 5000), EX) === "Terminés",
);
assert(
  "Close + Terminés → Terminés",
  etatMetier(cmd(2025, 0, "Terminés", "Close", 0), EX) === "Terminés",
);

// ---- « Planifiés » / « Close » ne sont plus des états distincts ----
assert("Planifiés hors ETATS_METIER", !ETATS_METIER.includes("Planifiés"));
assert("Close hors ETATS_METIER", !ETATS_METIER.includes("Close"));

// ---- KPI « terminées » : source unique = etatMetier (Close normalisé vers Terminés) ----
const terminées = (rows) =>
  rows.filter((r) => ["Terminés", "Close"].includes(etatMetier(r, EX))).length;
const jeu22 = Array.from({ length: 20 }, () => cmd(2026, 100, "Terminés", null, 5000))
  .concat(Array.from({ length: 2 }, () => cmd(2026, 100, null, "Close", 5000)))
  .concat([cmd(2025, 0, null, null, 0)]);
assert("22 terminées (Terminés + Close normalisés)", terminées(jeu22) === 22);

// ---- Options du filtre État (équivalent dashboard etatOptions) ----
const buildEtatOptions = (commandes, exercice) => {
  const found = new Set(commandes.map((c) => etatMetier(c, exercice)));
  return ETATS_METIER.filter((s) => found.has(s));
};
const sample = [
  cmd(2026, 0, "Terminés", null, 5000),
  cmd(2026, 0, null, "Close", 5000), // normalisé Terminés
  cmd(2026, 0, "Planifiés", null, 0), // normalisé En cours
  cmd(2025, 0, null, null, 0), // Pas réalisé
  cmd(2026, 0, null, null, 0), // Sans état
  cmd(2026, 2000, null, null, 5000), // En cours (engagement)
  cmd(2026, 0, "Attente validation", null, 0),
  cmd(2026, 0, null, "Annulée", 0),
  cmd(2026, 100, null, "2235.32", 0), // parasite
  cmd(2026, 100, "19.05.2025", null, 0), // parasite
];
const opts = buildEtatOptions(sample, EX);
assert("options contient Terminés", opts.includes("Terminés"));
assert("options contient Attente validation", opts.includes("Attente validation"));
assert("options contient Annulée", opts.includes("Annulée"));
assert("options contient En cours", opts.includes("En cours"));
assert("options contient Pas réalisé", opts.includes("Pas réalisé"));
assert("options contient Sans état", opts.includes("Sans état"));
assert("options : Planifiés jamais proposé", !opts.includes("Planifiés"));
assert("options : Close jamais proposé", !opts.includes("Close"));
assert("options : aucun montant/date parasite", !opts.some((o) => /[0-9]/.test(o)));

// ---- Inclusion archivage / Pas réalisé (visibleArchivage) ----
const baseCmd = (annee, actif, extra = {}) => ({
  id: `${annee}-${Math.random()}`,
  actif,
  annee_exercice: annee,
  paye: 0,
  ...extra,
});
const jeu = [
  ...Array.from({ length: 50 }, () => baseCmd(2026, true)),
  ...Array.from({ length: 138 }, () => baseCmd(2025, false)),
];
const activesOnly = jeu.filter((r) =>
  visibleArchivage(r, { includeArchived: false, selectedEtats: [], exercice: EX }),
);
const allIncl = jeu.filter((r) =>
  visibleArchivage(r, { includeArchived: true, selectedEtats: [], exercice: EX }),
);
assert("aucun filtre + includeArchived=false → seules les actives", activesOnly.length === 50);
assert("aucun filtre + includeArchived=true → actives + archivées", allIncl.length === 188);
const avecPasRealise = jeu.filter((r) =>
  visibleArchivage(r, { includeArchived: false, selectedEtats: ["Pas réalisé"], exercice: EX }),
);
// 50 actives + les archivées 2025 (paye 0) « Pas réalisé »
assert(
  "Pas réalisé + includeArchived=false → archivées Pas réalisé accessibles",
  avecPasRealise.length === 50 + 138,
);
const nonPR = [
  baseCmd(2026, false, { paye: 500 }), // archivée non pas-réalisée
  baseCmd(2026, true), // active
];
const avecNonPR = nonPR.filter((r) =>
  visibleArchivage(r, { includeArchived: false, selectedEtats: ["Pas réalisé"], exercice: EX }),
);
assert("Pas réalisé n'inclut pas une archivée non pas-réalisée", avecNonPR.length === 1);
// compteur dynamique (jamais codé en dur)
assert("compteur total dynamique (188 = 50 + 138)", allIncl.length === 50 + 138);

// =====================================================================
// Répartition par secteur = NOMBRE de commandes (jamais une somme engage)
// =====================================================================
const cpRows = Array.from({ length: 15 }, (_, i) => ({
  numero_commande: `CP-${i}`,
  corps_etat: "(o) Plomberie",
  engage: -500,
  annee_exercice: 2026,
}));
const gtRows = [{ numero_commande: "GT-1", corps_etat: "(e) Divers", engage: 1000 }];
const repartition = repartitionCommandesParSecteur([...cpRows, ...gtRows]);
assert(
  "T1 CP = 15 commandes malgré engage négatif",
  repartition.find((d) => d.name === "CP")?.value === 15,
);
assert(
  "T1b CP conserve un montant engage négatif mais compte les commandes",
  repartition.find((d) => d.name === "CP")?.value === 15,
);
assert("T2 secteur sans commande absent", !repartition.some((d) => d.name === "GE"));
assert(
  "T3 CP engage = -7500 (négatif conservé, sans Math.abs)",
  repartition.find((d) => d.name === "CP")?.engage === -7500,
);
assert("T3b GT engage = 1000", repartition.find((d) => d.name === "GT")?.engage === 1000);
assert(
  "T3c value = nombre de commandes (jamais une somme engage)",
  repartition.find((d) => d.name === "CP")?.value === 15 &&
    repartition.find((d) => d.name === "CP")?.engage === -7500,
);

// =====================================================================
// Carte des investissements — villeDeCommande + buildDataVilles
// =====================================================================
const villesGeo = [
  { ville: "MEAUX", lat: 48.95, lng: 2.88, n: 2 },
  { ville: "SERRIS", lat: 48.85, lng: 2.79, n: 1 },
  { ville: "CHESSY", lat: 48.88, lng: 2.72, n: 1 },
  { ville: "COUPVRAY", lat: 48.89, lng: 2.79, n: 1 },
  { ville: "NANDY", lat: 48.58, lng: 2.56, n: 1 },
  { ville: "SOUPPES-SUR-LOING", lat: 48.19, lng: 2.74, n: 1 },
  { ville: "PARIS 20", lat: 48.87, lng: 2.4, n: 1 },
  { ville: "LOGNES", lat: 48.84, lng: 2.63, n: 1 },
  { ville: "VILLE A", lat: 47.0, lng: 1.0, n: 1 },
];
const tranches = [
  { code: "1396", localite: "CHESSY" },
  { code: "1400", localite: "SERRIS" },
  { code: "1401", localite: "SERRIS" },
  { code: "1402", localite: "SERRIS" },
  { code: "LOGNES-T", localite: "LOGNES" },
  { code: "NANDY-T", localite: "NANDY" },
  { code: "COUPVRAY-T", localite: "COUPVRAY" },
  { code: "PARIS-T", localite: "PARIS 20" },
  { code: "SOUPPES-T", localite: "SOUPPES-SUR-LOING" },
];
const cmdVille = (num, tranche, adresse, engage = 0, paye = 0) => ({
  numero_commande: num,
  tranche_code: tranche,
  adresse,
  engage,
  paye,
});

// T1 : tranche 1396 → CHESSY (fallback tranche quand l'adresse ne contient pas de ville)
assert(
  "T1 tranche 1396 → CHESSY",
  villeDeCommande(cmdVille("1", "1396", "RUE X"), tranches, villesGeo) === "CHESSY",
);

// T2 : tranches 1400 + 1401 + 1402 → une seule ville SERRIS
const rSerris = buildDataVilles(
  [
    cmdVille("a", "1400", "RUE X", 100, 50),
    cmdVille("b", "1401", "RUE Y", 200),
    cmdVille("c", "1402", "RUE Z", 300),
  ],
  tranches,
  villesGeo,
);
assert(
  "T2 tranches 1400/1401/1402 → une seule ville SERRIS (3 commandes)",
  rSerris.dataVilles.length === 1 &&
    rSerris.dataVilles[0].ville === "SERRIS" &&
    rSerris.dataVilles[0].count === 3 &&
    rSerris.dataVilles[0].value === 600,
);

// T3 : SERRIS 34 commandes / engage 140543.01
const serris34 = Array.from({ length: 34 }, (_, i) =>
  cmdVille(
    `SERRIS-${i}`,
    i % 3 === 0 ? "1400" : i % 3 === 1 ? "1401" : "1402",
    "RUE DU PRESSOIR SERRIS",
    i === 0 ? 8543.01 : 4000,
    i === 0 ? 2000 : 1000,
  ),
);
const rSerris34 = buildDataVilles(serris34, tranches, villesGeo);
assert(
  "T3 SERRIS 34 commandes / engage 140543.01",
  rSerris34.dataVilles.some((d) => d.ville === "SERRIS" && d.count === 34 && d.value === 140543.01),
);
assert(
  "T3b SERRIS paye agrégé (2000 + 33×1000)",
  rSerris34.dataVilles.some((d) => d.ville === "SERRIS" && d.paye === 2000 + 33 * 1000),
);

// T4 : LOGNES engage négatif → ville conservée (count > 0, jamais engage > 0)
const rLog = buildDataVilles(
  [cmdVille("L1", "LOGNES-T", "RUE", -9793.3, 9793.3)],
  tranches,
  villesGeo,
);
assert(
  "T4 LOGNES 1 commande engage -9793.3 conservée",
  rLog.dataVilles.some((d) => d.ville === "LOGNES" && d.count === 1 && d.value === -9793.3),
);

// T5-T8 : formats réels d'adresses d'import (commandes sans tranche)
assert(
  "T5 61 PLACE DES CHÊNES, NANDY - ER.37062 → NANDY",
  villeDeCommande(
    cmdVille("4887311", null, "61 PLACE DES CHÊNES, NANDY - ER.37062"),
    tranches,
    villesGeo,
  ) === "NANDY",
);
assert(
  "T6 109 ALLEE DE LA PYRAMIDE - NANDY → NANDY",
  villeDeCommande(
    cmdVille("4614994", null, "109 ALLEE DE LA PYRAMIDE - NANDY"),
    tranches,
    villesGeo,
  ) === "NANDY",
);
assert(
  "T7 RESIDENCE DE LA TREILLE, SOUPPES-SUR-LOING → SOUPPES-SUR-LOING",
  villeDeCommande(
    cmdVille("4823700", null, "RESIDENCE DE LA TREILLE, SOUPPES-SUR-LOING"),
    tranches,
    villesGeo,
  ) === "SOUPPES-SUR-LOING",
);
assert(
  "T8 SOUPPES SUR LOING (sans tiret) → SOUPPES-SUR-LOING",
  villeDeCommande(
    cmdVille("4754138", null, "RESIDENCE LA FONTAINE DE LA TREILLE - SOUPPES SUR LOING"),
    tranches,
    villesGeo,
  ) === "SOUPPES-SUR-LOING",
);

// T9 : priorité adresse d'import (VILLE A ≠ tranche VILLE B)
const tranchesT9 = [
  ...tranches.filter((t) => t.code !== "PARIS-T"),
  { code: "PARIS-T", localite: "VILLE B" },
];
assert(
  "T9 adresse import prime sur tranche (VILLE A)",
  villeDeCommande(cmdVille("x", "PARIS-T", "RUE TEST, VILLE A"), tranchesT9, villesGeo) ===
    "VILLE A",
);

// T10 : fallback tranche quand l'adresse ne permet pas de détecter une ville
assert(
  "T10 adresse sans ville → tranche SERRIS",
  villeDeCommande(cmdVille("y", "1400", "RUE TEST"), tranches, villesGeo) === "SERRIS",
);

// T11 : faux positif PARIS — « 3 RUE DE PARIS - COUPVRAY » → COUPVRAY, jamais PARIS
assert(
  "T11 3 RUE DE PARIS - COUPVRAY → COUPVRAY",
  villeDeCommande(cmdVille("z", "COUPVRAY-T", "3 RUE DE PARIS - COUPVRAY"), tranches, villesGeo) ===
    "COUPVRAY",
);
assert(
  "T11b jamais PARIS 20",
  villeDeCommande(cmdVille("z", "COUPVRAY-T", "3 RUE DE PARIS - COUPVRAY"), tranches, villesGeo) !==
    "PARIS 20",
);

// T12 : PARIS 20 ARR → PARIS 20
assert(
  "T12 PARIS 20 ARR → PARIS 20",
  villeDeCommande(
    cmdVille("5046501", null, "73 AVENUE GAMBETTA, PARIS 20 ARR"),
    tranches,
    villesGeo,
  ) === "PARIS 20",
);

// T13 : agrégation multi-villes (count / engage / paye)
const r13 = buildDataVilles(
  [
    cmdVille("M1", "1396", "RUE", 1000, 400),
    cmdVille("M2", "1396", "RUE", 2000),
    cmdVille("M3", "LOGNES-T", "RUE", -9793.3, 9793.3),
  ],
  tranches,
  villesGeo,
);
assert(
  "T13 CHESSY count 2 / engage 3000 / paye 400",
  r13.dataVilles.some(
    (d) => d.ville === "CHESSY" && d.count === 2 && d.value === 3000 && d.paye === 400,
  ),
);
assert(
  "T13b LOGNES count 1 / engage -9793.3 / paye 9793.3",
  r13.dataVilles.some(
    (d) => d.ville === "LOGNES" && d.count === 1 && d.value === -9793.3 && d.paye === 9793.3,
  ),
);

// T14 : ville absente de villes_geo → nonLocalisees += 1, les autres villes restent
const tranchesT14 = [...tranches, { code: "AVON-T", localite: "AVON" }];
const r14 = buildDataVilles(
  [cmdVille("14a", "AVON-T", "RUE", 500), cmdVille("14b", "1396", "RUE", 100)],
  tranchesT14,
  villesGeo,
);
assert("T14 ville absente de villes_geo → nonLocalisees 1", r14.nonLocalisees === 1);
assert(
  "T14b CHESSY reste visible",
  r14.dataVilles.some((d) => d.ville === "CHESSY" && d.count === 1),
);

// T15 : villes_geo vide → toutes les villes résolues comptées non localisées
const r15 = buildDataVilles(
  [cmdVille("15a", "1400", "RUE"), cmdVille("15b", "1401", "RUE")],
  tranches,
  [],
);
assert(
  "T15 villes_geo vide → 1 ville distincte non localisée",
  r15.dataVilles.length === 0 && r15.nonLocalisees === 1,
);

// T16 : aucun filtered → dataVilles [] / nonLocalisees 0
const r16 = buildDataVilles([], tranches, villesGeo);
assert(
  "T16 filtered vide → dataVilles [] / nonLocalisees 0",
  r16.dataVilles.length === 0 && r16.nonLocalisees === 0,
);

// T17 : filtre Ville ≡ carte (même ville canonique villeDeCommande)
const dataset17 = [
  cmdVille("17a", "1400", "RUE", 100),
  cmdVille("17b", "1396", "RUE", 200),
  cmdVille("17c", null, "109 ALLEE DE LA PYRAMIDE - NANDY", 300),
];
const villes17 = dataset17.map((c) => villeDeCommande(c, tranches, villesGeo));
const filteredSerris = dataset17.filter((_, i) => villes17[i] === "SERRIS");
const r17 = buildDataVilles(dataset17, tranches, villesGeo);
const mapSerris = r17.dataVilles.find((d) => d.ville === "SERRIS");
assert(
  "T17 filtre SERRIS = carte SERRIS (1 commande)",
  filteredSerris.length === 1 && mapSerris?.count === filteredSerris.length,
);

// T18 : régression états — mapping inchangé (Terminés / En cours / Pas réalisé)
const regrEtats = [
  ...Array.from({ length: 22 }, () => cmd(2026, 0, "Terminés", null, 5000)),
  ...Array.from({ length: 28 }, () => cmd(2026, 0, null, null, 5000)),
  ...Array.from({ length: 7 }, () => cmd(2025, 0, null, null, 0)),
];
const countE = (rows, e) => rows.filter((r) => etatMetier(r, EX) === e).length;
assert("T18 Terminés = 22", countE(regrEtats, "Terminés") === 22);
assert("T18 En cours = 28", countE(regrEtats, "En cours") === 28);
assert("T18 Pas réalisé = 7", countE(regrEtats, "Pas réalisé") === 7);

// T19 : régression secteurs — donut = NOMBRE de commandes (jamais des euros)
const regrSecteurs = [
  ...Array.from({ length: 21 }, () => ({
    numero_commande: "GT",
    corps_etat: "(e) Divers",
    engage: 100,
  })),
  ...Array.from({ length: 14 }, () => ({
    numero_commande: "GE",
    corps_etat: "(e) Electricite",
    engage: 200,
  })),
  ...Array.from({ length: 15 }, () => ({
    numero_commande: "CP",
    corps_etat: "(o) Plomberie",
    engage: -500,
  })),
];
const rs = repartitionCommandesParSecteur(regrSecteurs);
assert("T19 GT = 21 commandes", rs.find((d) => d.name === "GT")?.value === 21);
assert("T19 GE = 14 commandes", rs.find((d) => d.name === "GE")?.value === 14);
assert("T19 CP = 15 commandes", rs.find((d) => d.name === "CP")?.value === 15);
assert(
  "T19b valeur = count, engage = somme (pas d'euros dans value)",
  rs.find((d) => d.name === "GT")?.value === 21 && rs.find((d) => d.name === "GT")?.engage === 2100,
);

// T20 : tooltip secteur — nombre de commandes + montant engagé (négatifs conservés)
assert(
  "T20 CP engage = -7500 (négatif, sans Math.abs)",
  rs.find((d) => d.name === "CP")?.engage === 15 * -500,
);
assert(
  "T20b GT count 21 / engage 2100",
  rs.find((d) => d.name === "GT")?.value === 21 && rs.find((d) => d.name === "GT")?.engage === 2100,
);

// Anciens scénarios carte (nouvelle signature buildDataVilles)
const cPos = [{ numero_commande: "1", adresse: "2 RUE BERTRAND FLORNOY, MEAUX", engage: 5000 }];
const cNeg = [{ numero_commande: "2", adresse: "3 RUE X, MEAUX", engage: -2000 }];
const cNonGeo = [{ numero_commande: "3", adresse: "4 RUE Y, VILLEINCONNUE", engage: 9000 }];
const r1 = buildDataVilles([...cPos, ...cNeg, ...cNonGeo], [], villesGeo);
assert(
  "MAP T3 ville engage positif apparaît",
  r1.dataVilles.some((d) => d.ville === "MEAUX" && d.value === 3000 && d.count === 2),
);
const r2 = buildDataVilles(
  [{ numero_commande: "4", adresse: "5 RUE Z, SERRIS", engage: -100 }],
  [],
  villesGeo,
);
assert(
  "MAP T4 ville somme engage négative conservée (count>0)",
  r2.dataVilles.some((d) => d.ville === "SERRIS" && d.count === 1 && d.value === -100),
);
assert("MAP T5 commande sans ville détectable → nonLocalisees", r1.nonLocalisees === 1);
assert(
  "MAP T6 autres villes restent visibles malgré une ville non localisée",
  r1.dataVilles.length >= 1 && r1.dataVilles[0].ville === "MEAUX",
);
assert(
  "T6c secteurDe classifie CP via corps_etat",
  secteurDe({ corps_etat: "(o) Plomberie" }) === "CP",
);
assert(
  "T6d villeDepuisAdresse extrait la ville",
  villeDepuisAdresse("2 RUE BERTRAND FLORNOY, MEAUX") === "MEAUX",
);
assert(
  "T6e matchVille correspond par sous-chaîne",
  matchVille("CHESSY PLACE DES CORNILLES", [{ ville: "CHESSY", lat: 1, lng: 2 }])?.ville ===
    "CHESSY",
);

// =====================================================================
// Slider années + filtre secteur — domaine vs sélection (T1 → T12)
// =====================================================================
const ANNEES = [2023, 2024, 2025, 2026, 2030];

// T1 : le domaine du slider couvre toutes les années réelles (jamais réduit)
const dom = sliderYearDomain(ANNEES);
assert("T1 domaine couvre 2023 → 2030", dom[0] <= 2023 && dom[1] >= 2030);
assert("T1b domaine élargi [2022, 2031]", JSON.stringify(dom) === JSON.stringify([2022, 2031]));

// T2 : sélection initiale = exercice courant uniquement (jamais tout le domaine)
assert("T2 exercice courant = 2026", exerciceCourant() === 2026);
assert(
  "T2b sélection initiale [2026, 2026]",
  JSON.stringify(yearRangeInitial(2026)) === JSON.stringify([2026, 2026]),
);

const rowAnnee = (a) => ({ numero_commande: `A${a}`, annee_exercice: a });
// T3 : [2024, 2026] → 2024 + 2025 + 2026
assert(
  "T3 [2024,2026] → 2024/2025/2026 (et ni 2023 ni 2030)",
  [2024, 2025, 2026].every((a) => matchesAnnee(rowAnnee(a), [2024, 2026])) &&
    !matchesAnnee(rowAnnee(2023), [2024, 2026]) &&
    !matchesAnnee(rowAnnee(2030), [2024, 2026]),
);
// T4 : [2024, 2025] → 2024 + 2025
assert(
  "T4 [2024,2025] → 2024/2025 (et pas 2026)",
  matchesAnnee(rowAnnee(2024), [2024, 2025]) &&
    matchesAnnee(rowAnnee(2025), [2024, 2025]) &&
    !matchesAnnee(rowAnnee(2026), [2024, 2025]),
);
// T5 : [2023, 2030] → toutes les années disponibles
assert(
  "T5 [2023,2030] → toutes les années",
  ANNEES.every((a) => matchesAnnee(rowAnnee(a), [2023, 2030])),
);
// T6 : [2030, 2030] → uniquement 2030
assert(
  "T6 [2030,2030] → 2030 seul",
  matchesAnnee(rowAnnee(2030), [2030, 2030]) && !matchesAnnee(rowAnnee(2026), [2030, 2030]),
);
// T7 : aucune année ne disparaît du domaine parce que le défaut est 2026
assert(
  "T7 domaine complet malgré défaut 2026",
  (() => {
    const init = yearRangeInitial(2026);
    return init[0] === 2026 && init[1] === 2026 && dom[0] <= 2023 && dom[1] >= 2030;
  })(),
);

// T8-T10 : SERRIS 2025 GE + SERRIS 2026 CP selon l'intervalle d'années
const serrisGE2025 = {
  numero_commande: "S-GE-2025",
  tranche_code: "1401",
  adresse: "RUE DU PRESSOIR SERRIS",
  annee_exercice: 2025,
  corps_etat: "(g) Halls",
  actif: true,
  engage: 100,
};
const serrisCP2026 = {
  numero_commande: "S-CP-2026",
  tranche_code: "1401",
  adresse: "RUE DU PRESSOIR SERRIS",
  annee_exercice: 2026,
  corps_etat: "(o) Plomberie",
  actif: true,
  engage: 200,
};
assert(
  "T8 [2026,2026] → seule la commande 2026",
  !matchesAnnee(serrisGE2025, [2026, 2026]) && matchesAnnee(serrisCP2026, [2026, 2026]),
);
assert(
  "T9 [2025,2026] → les deux apparaissent",
  matchesAnnee(serrisGE2025, [2025, 2026]) && matchesAnnee(serrisCP2026, [2025, 2026]),
);
assert(
  "T10 [2023,2030] → les deux apparaissent",
  matchesAnnee(serrisGE2025, [2023, 2030]) && matchesAnnee(serrisCP2026, [2023, 2030]),
);

// Test critique : (g) Halls → GE, (o) Plomberie → CP
assert("CRITIQUE (g) Halls → GE", secteurDe({ corps_etat: "(g) Halls" }) === "GE");
assert("CRITIQUE (o) Plomberie → CP", secteurDe({ corps_etat: "(o) Plomberie" }) === "CP");

// T11 : Ville = SERRIS + Secteur = GE → uniquement les GE de SERRIS
const isSerris = (r) => villeDeCommande(r, tranches, villesGeo) === "SERRIS";
const jeuSerris = [
  { ...serrisGE2025, numero_commande: "S-GE-1" },
  { ...serrisCP2026, numero_commande: "S-CP-1" },
  {
    numero_commande: "S-GT-1",
    tranche_code: "1401",
    adresse: "RUE DU PRESSOIR SERRIS",
    annee_exercice: 2026,
    corps_etat: "(e) Divers",
    actif: true,
  },
  {
    numero_commande: "CH-GT-1",
    tranche_code: "1396",
    adresse: "RUE CHESSY",
    annee_exercice: 2026,
    corps_etat: "(e) Divers",
    actif: true,
  },
];
const geSerris = jeuSerris.filter((r) => isSerris(r) && secteurDe(r) === "GE");
assert(
  "T11 Ville=SERRIS + Secteur=GE → 1 commande (S-GE-1)",
  geSerris.length === 1 && geSerris[0].numero_commande === "S-GE-1",
);
assert(
  "T11b le CP de SERRIS est exclu du filtre GE",
  !jeuSerris.some((r) => r.numero_commande === "S-CP-1" && isSerris(r) && secteurDe(r) === "GE"),
);

// T12 : Ville = SERRIS → GT + GE + CP conservés
const serrisTous = jeuSerris.filter((r) => isSerris(r));
const distSerris = {};
serrisTous.forEach((r) => {
  distSerris[secteurDe(r)] = (distSerris[secteurDe(r)] || 0) + 1;
});
assert(
  "T12 Ville=SERRIS → GT/GE/CP présents",
  distSerris["GT"] === 1 && distSerris["GE"] === 1 && distSerris["CP"] === 1,
);
assert(
  "T12b la commande CHESSY n'est pas dans la vue SERRIS",
  !jeuSerris.some((r) => r.numero_commande === "CH-GT-1" && isSerris(r)),
);

// =====================================================================
// Périmètre temporel + archivage — l'année du slider prime sur l'exclusion d'archivage
// =====================================================================
const realShape = [
  ...Array.from({ length: 64 }, (_, i) => ({
    numero_commande: `a23-${i}`,
    annee_exercice: 2023,
    actif: false,
  })),
  ...Array.from({ length: 46 }, (_, i) => ({
    numero_commande: `a24-${i}`,
    annee_exercice: 2024,
    actif: false,
  })),
  ...Array.from({ length: 28 }, (_, i) => ({
    numero_commande: `a25-${i}`,
    annee_exercice: 2025,
    actif: false,
  })),
  ...Array.from({ length: 49 }, (_, i) => ({
    numero_commande: `a26-${i}`,
    annee_exercice: 2026,
    actif: true,
  })),
  { numero_commande: "a30-0", annee_exercice: 2030, actif: true },
];
assert("P0 188 commandes (64+46+28+49+1)", realShape.length === 188);
const perimetre = (rows, yr) =>
  rows.filter(
    (r) =>
      visibleParPerimetre(r, {
        includeArchived: false,
        selectedEtats: [],
        yearRange: yr,
        exercice: EX,
      }) && matchesAnnee(r, yr), // pipeline réel : visibleCommandes ∩ filtre année (filtered)
  ).length;
const annees = (yr) =>
  [...new Set(realShape.filter((r) => matchesAnnee(r, yr)).map((r) => r.annee_exercice))].sort(
    (a, b) => a - b,
  );

assert(
  "T1 [2026,2026] → années {2026}",
  JSON.stringify(annees([2026, 2026])) === JSON.stringify([2026]),
);
assert(
  "T2 [2025,2026] → années {2025,2026}",
  JSON.stringify(annees([2025, 2026])) === JSON.stringify([2025, 2026]),
);
assert(
  "T3 [2024,2025] → années {2024,2025}",
  JSON.stringify(annees([2024, 2025])) === JSON.stringify([2024, 2025]),
);
assert(
  "T4 [2023,2026] → années {2023,2024,2025,2026}",
  JSON.stringify(annees([2023, 2026])) === JSON.stringify([2023, 2024, 2025, 2026]),
);
assert(
  "T5 [2026,2030] → années {2026,2030}",
  JSON.stringify(annees([2026, 2030])) === JSON.stringify([2026, 2030]),
);
assert(
  "T6 [2023,2030] → toutes les années",
  JSON.stringify(annees([2023, 2030])) === JSON.stringify([2023, 2024, 2025, 2026, 2030]),
);

// Périmètres bruts (avant filtres état/secteur/ville)
assert("P1 [2026,2026] → 49", perimetre(realShape, [2026, 2026]) === 49);
assert(
  "P2 [2025,2026] → 77 (28 archivées 2025 + 49 actives 2026)",
  perimetre(realShape, [2025, 2026]) === 77,
);
assert("P3 [2024,2025] → 74 (46 + 28)", perimetre(realShape, [2024, 2025]) === 74);
assert("P4 [2023,2026] → 187 (64+46+28+49)", perimetre(realShape, [2023, 2026]) === 187);
assert("P5 [2026,2030] → 50 (49+1)", perimetre(realShape, [2026, 2030]) === 50);
assert("P6 [2023,2030] → 188", perimetre(realShape, [2023, 2030]) === 188);

// T7/T8 : archivées incluses quand leur année est dans le slider
assert(
  "T7 archivées 2025 présentes dans [2025,2026]",
  realShape
    .filter((r) => r.annee_exercice === 2025 && !r.actif)
    .every((r) =>
      visibleParPerimetre(r, {
        includeArchived: false,
        selectedEtats: [],
        yearRange: [2025, 2026],
        exercice: EX,
      }),
    ),
);
assert(
  "T8 archivées 2024 présentes dans [2024,2025]",
  realShape
    .filter((r) => r.annee_exercice === 2024 && !r.actif)
    .every((r) =>
      visibleParPerimetre(r, {
        includeArchived: false,
        selectedEtats: [],
        yearRange: [2024, 2025],
        exercice: EX,
      }),
    ),
);

// T9 : défaut [2026,2026]
assert(
  "T9 défaut [2026,2026]",
  JSON.stringify(yearRangeInitial(exerciceCourant())) === JSON.stringify([2026, 2026]),
);

// T10-T13 : régressions — états, secteurs, ville, carte inchangés
assert(
  "T10 etatMetier inchangé",
  etatMetier({ annee_exercice: 2025, engage: 0, paye: 0 }, EX) === "Pas réalisé" &&
    etatMetier({ annee_exercice: 2026, engage: 5000, paye: 0 }, EX) === "En cours",
);
assert(
  "T11 secteurDe inchangé",
  secteurDe({ corps_etat: "(g) Halls" }) === "GE" &&
    secteurDe({ corps_etat: "(o) Plomberie" }) === "CP",
);
assert(
  "T12 villeDeCommande inchangé",
  villeDeCommande({ tranche_code: "1396", adresse: "RUE X" }, tranches, villesGeo) === "CHESSY",
);
assert(
  "T13 buildDataVilles inchangé",
  rSerris.dataVilles.some((d) => d.ville === "SERRIS" && d.count === 3 && d.value === 600),
);

// =====================================================================
// Alertes qualité de données — colonne ACT. (getAlertesCommande)
// =====================================================================
// Normalisation des espaces (Intl fr-FR utilise des espaces insécables étroites U+202F / U+00A0).
const espacesNorm = (s) => s.replace(/\s+/g, " ");
// T1 : engagement négatif → alerte (signe et valeur conservés)
const alertesNeg = getAlertesCommande({ engage: -2641.38 });
assert(
  "T1 engage -2641.38 → alerte « Engagé négatif : -2 641,38 € »",
  alertesNeg.some(
    (a) => a.startsWith("⚠️ Engagé négatif") && espacesNorm(a).includes("-2 641,38 €"),
  ),
);
// T2 : engagement positif → aucune alerte négative
assert(
  "T2 engage +2641.38 → aucune alerte négative",
  getAlertesCommande({ engage: 2641.38 }).every((a) => !a.startsWith("⚠️ Engagé négatif")),
);
// T3 : etat_commande strictement numérique → alerte état commande
assert(
  "T3 etat_commande « 2641.38 » → alerte état commande",
  getAlertesCommande({ etat_commande: "2641.38" }).some(
    (a) => a.startsWith("❌ État commande incohérent") && espacesNorm(a).includes("2 641,38"),
  ),
);
// T4 : etat_commande libellé → aucune alerte de type numérique
assert(
  "T4 etat_commande « En cours » → aucune alerte numérique",
  getAlertesCommande({ etat_commande: "En cours" }).every(
    (a) => !a.startsWith("❌ État commande incohérent"),
  ),
);
// T5 : etat_travaux ressemblant à une date → alerte état travaux
assert(
  "T5 etat_travaux « 09.09.2024 » → alerte état travaux",
  getAlertesCommande({ etat_travaux: "09.09.2024" }).some(
    (a) => a.startsWith("❌ État travaux incohérent") && a.includes("09.09.2024"),
  ),
);
// T6 : etat_travaux état → aucune alerte
assert(
  "T6 etat_travaux « Terminé » → aucune alerte",
  getAlertesCommande({ etat_travaux: "Terminé" }).length === 0,
);
// T7 : plusieurs anomalies → toutes les alertes présentes (aucune remplacée)
const alertesMulti = getAlertesCommande({
  engage: -2641.38,
  etat_commande: "2641.38",
  etat_travaux: "09.09.2024",
});
assert(
  "T7 multi-anomalies → 3 alertes présentes",
  alertesMulti.length === 3 &&
    alertesMulti.some((a) => a.startsWith("⚠️ Engagé négatif")) &&
    alertesMulti.some((a) => a.startsWith("❌ État commande incohérent")) &&
    alertesMulti.some((a) => a.startsWith("❌ État travaux incohérent")),
);
// T8 : commande saine → ACT. vide (aucun faux positif)
assert(
  "T8 commande saine → aucune alerte",
  getAlertesCommande({
    numero_commande: "SAINE",
    engage: 100,
    paye: 50,
    etat_commande: "En cours",
    etat_travaux: "Terminé",
    date_demarrage: "2026-01-01",
    budget: 1000,
  }).length === 0,
);
// T9 : doublon (conflit historique) + anomalie → les deux signalés (indicateur conflit conservé)
const rowDoublon = {
  numero_commande: "D1",
  engage: -1000,
  etat_commande: "1000",
  etat_travaux: "01.01.2025",
};
const hasConflit = true; // historyMap → entrée « conflit » non résolue (logique existante inchangée)
assert(
  "T9 doublon + anomalies → anomalies complètes (3) et conflit conservé",
  getAlertesCommande(rowDoublon).length === 3 && hasConflit === true,
);
// T10 : les valeurs originales ne sont jamais modifiées
const rowOrig = {
  numero_commande: "R1",
  engage: -2641.38,
  etat_commande: "2641.38",
  etat_travaux: "09.09.2024",
};
const snapshot = JSON.stringify(rowOrig);
getAlertesCommande(rowOrig);
assert("T10 valeurs originales inchangées", JSON.stringify(rowOrig) === snapshot);

// =====================================================================
// Dernier import de l'exercice courant — getDernierImportExercice
// =====================================================================
const imp = (annee, date) => ({ annee_exercice: annee, demarre_at: date });
// T1 : import 2025 plus récent globalement, mais dernier import 2026 → 11/08/2026 09:42
const t1 = getDernierImportExercice(
  [imp(2025, "2026-08-10T15:00:00Z"), imp(2026, "2026-08-11T09:42:00Z")],
  2026,
);
assert("T1 dernier import 2026 = 11/08/2026 09:42", t1?.demarre_at === "2026-08-11T09:42:00Z");
// T2 : deux imports 2026 → le plus récent
const t2 = getDernierImportExercice(
  [imp(2026, "2026-08-10T15:00:00Z"), imp(2026, "2026-08-11T09:42:00Z")],
  2026,
);
assert("T2 deux imports 2026 → le plus récent", t2?.demarre_at === "2026-08-11T09:42:00Z");
// T3 : import 2025 APRÈS l'import 2026 → la date 2026 reste inchangée
const t3 = getDernierImportExercice(
  [imp(2025, "2026-08-11T10:00:00Z"), imp(2026, "2026-08-10T15:00:00Z")],
  2026,
);
assert(
  "T3 import 2025 après 2026 → date 2026 conservée (10/08)",
  t3?.demarre_at === "2026-08-10T15:00:00Z",
);
// T4 : aucun import 2026 → null
assert(
  "T4 aucun import 2026 → null",
  getDernierImportExercice([imp(2025, "2026-08-11T10:00:00Z")], 2026) === null,
);
// T5 : un seul import 2026 → sa date
const t5 = getDernierImportExercice([imp(2026, "2026-08-11T09:42:00Z")], 2026);
assert("T5 un seul import 2026 → sa date", t5?.demarre_at === "2026-08-11T09:42:00Z");
// T6 : plusieurs imports 2026 → uniquement le plus récent
const t6 = getDernierImportExercice(
  [
    imp(2026, "2026-08-01T08:00:00Z"),
    imp(2026, "2026-08-11T09:42:00Z"),
    imp(2026, "2026-08-05T12:00:00Z"),
  ],
  2026,
);
assert("T6 plusieurs imports 2026 → le plus récent", t6?.demarre_at === "2026-08-11T09:42:00Z");
// T7 : le helper ne modifie pas les imports (dont erreurs) — compteur inchangé avant/après
const importeErreurs = { annee_exercice: 2026, demarre_at: "2026-08-11T09:42:00Z", erreurs: 8 };
const snap7 = JSON.stringify(importeErreurs);
getDernierImportExercice([importeErreurs], 2026);
assert("T7 erreurs inchangées par le helper", JSON.stringify(importeErreurs) === snap7);
// T8 : format fr-FR Europe/Paris (23:25 UTC → 01:25 le lendemain à Paris, UTC+2 en août)
assert(
  "T8 format fr-FR Europe/Paris « DD/MM/YYYY à HH:mm »",
  formatDateImportFr("2026-08-10T23:25:00.000+00:00") === "11/08/2026 à 01:25",
);

// =====================================================================
// Réévaluation de l'alerte « Analyse des Erreurs d'Import » — resyncImportErrors
// (cas de test fonctionnels A → E du bouton « ACTUALISER »)
// =====================================================================
const ipt = (
  id,
  erreurs,
  fichier = `fichier-${id}.xlsx`,
  demarre_at = "2026-08-11T09:42:00Z",
  annee_exercice = 2026,
) => ({
  id,
  erreurs,
  fichier,
  demarre_at,
  lignes: 10,
  creees: 10,
  modifiees: 0,
  doublons: 0,
  archivees: 0,
  statut: "termine",
  termine_at: null,
  annee_exercice,
});
const EX2026 = 2026;
// R0 : pas d'alerte ouverte → rien à réévaluer (aucun état à fermer)
assert("R0 alerte fermée → reste fermée", resyncImportErrors(null, [ipt("X", 8)], EX2026) === null);
// R1 (cas A) : l'import affiché a été SUPPRIMÉ de Supabase et le suivant n'a pas d'erreurs
// → l'alerte disparaît (le fichier supprimé ne peut plus être affiché)
assert(
  "R1 import supprimé + suivant sans erreurs → alerte fermée",
  resyncImportErrors(ipt("TEST", 3), [ipt("NEXT", 0)], EX2026) === null,
);
// R2 (cas A) : l'import affiché a été supprimé mais le suivant a des erreurs → l'alerte
// reflète l'import le plus récent de l'exercice (jamais l'ancien supprimé)
const rA2 = resyncImportErrors(ipt("TEST", 3), [ipt("NEXT", 5)], EX2026);
assert(
  "R2 import supprimé + suivant avec erreurs → alerte sur le suivant",
  rA2?.id === "NEXT" && rA2?.erreurs === 5,
);
// R3 (cas B) : même import toujours présent, erreurs > 0 → l'alerte reste avec le nombre réel
const rB3 = resyncImportErrors(ipt("X", 8), [ipt("X", 9)], EX2026);
assert(
  "R3 erreurs > 0 → alerte conservée avec le nombre réel",
  rB3?.id === "X" && rB3?.erreurs === 9,
);
// R4 (cas C) : même import, erreurs corrigées à 0 → l'alerte disparaît
assert(
  "R4 erreurs corrigées (0) → alerte fermée",
  resyncImportErrors(ipt("X", 8), [ipt("X", 0)], EX2026) === null,
);
// R5 (cas D) : nouvel import avec erreurs → l'alerte reflète UNIQUEMENT le nouvel import
const rD5 = resyncImportErrors(ipt("ANCIEN", 8), [ipt("NOUVEAU", 2)], EX2026);
assert(
  "R5 nouvel import avec erreurs → alerte sur le nouvel import",
  rD5?.id === "NOUVEAU" && rD5?.erreurs === 2,
);
// R6 (cas D) : nouvel import SANS erreurs → pas d'alerte
assert(
  "R6 nouvel import sans erreurs → alerte fermée",
  resyncImportErrors(ipt("ANCIEN", 8), [ipt("NOUVEAU", 0)], EX2026) === null,
);
// R7 (cas E) : rien n'a changé → l'alerte reste (aucune fermeture artificielle)
const rE7 = resyncImportErrors(ipt("X", 8), [ipt("X", 8)], EX2026);
assert("R7 rien n'a changé → alerte conservée", rE7?.id === "X" && rE7?.erreurs === 8);
// R8 : plus aucun import dans Supabase → l'alerte disparaît
assert(
  "R8 plus aucun import → alerte fermée",
  resyncImportErrors(ipt("X", 8), [], EX2026) === null,
);
// R9 : le helper est pur — il ne modifie jamais l'objet passé ni la liste
const prevPur = ipt("X", 8);
const listPur = [ipt("X", 8)];
const snapPur = JSON.stringify([prevPur, listPur]);
resyncImportErrors(prevPur, listPur, EX2026);
assert("R9 helper pur (aucune mutation)", JSON.stringify([prevPur, listPur]) === snapPur);

// =====================================================================
// Respect de l'EXERCICE consulté — resyncImportErrors (param `exercice`)
// =====================================================================
// S1 : import 2026 (erreurs) + import 2030 (erreurs) ; l'import 2030 est même LE PLUS
// RÉCENT (imports[0]) → exercice consulté 2026 → seule l'erreur 2026 est prise en compte
const s1 = resyncImportErrors(
  ipt("A26", 3, "f-2026.xlsx", "2026-08-10T09:00:00Z", 2026),
  [
    ipt("A30", 5, "f-2030.xlsx", "2030-01-15T09:00:00Z", 2030),
    ipt("A26", 3, "f-2026.xlsx", "2026-08-10T09:00:00Z", 2026),
  ],
  2026,
);
assert(
  "S1 exercice 2026 → seule l'erreur 2026 prise en compte (jamais l'import 2030)",
  s1?.id === "A26" && s1?.erreurs === 3,
);
// S2 : exercice consulté 2030 → seule l'erreur 2030 est prise en compte
const s2 = resyncImportErrors(
  ipt("A26", 3, "f-2026.xlsx", "2026-08-10T09:00:00Z", 2026),
  [
    ipt("A30", 5, "f-2030.xlsx", "2030-01-15T09:00:00Z", 2030),
    ipt("A26", 3, "f-2026.xlsx", "2026-08-10T09:00:00Z", 2026),
  ],
  2030,
);
assert(
  "S2 exercice 2030 → seule l'erreur 2030 prise en compte",
  s2?.id === "A30" && s2?.erreurs === 5,
);
// S3 : l'import de l'exercice sélectionné a été SUPPRIMÉ → alerte supprimée, même si un
// import d'un autre exercice (2030) a des erreurs
assert(
  "S3 suppression import de l'exercice sélectionné → alerte fermée",
  resyncImportErrors(
    ipt("A26", 3, "f-2026.xlsx", "2026-08-10T09:00:00Z", 2026),
    [ipt("A30", 5, "f-2030.xlsx", "2030-01-15T09:00:00Z", 2030)],
    2026,
  ) === null,
);
// S4 : aucun import pour l'exercice sélectionné → alerte supprimée
assert(
  "S4 aucun import pour l'exercice sélectionné → alerte fermée",
  resyncImportErrors(
    ipt("A26", 3, "f-2026.xlsx", "2026-08-10T09:00:00Z", 2026),
    [ipt("A30", 0, "f-2030.xlsx", "2030-01-15T09:00:00Z", 2030)],
    2026,
  ) === null,
);

// =====================================================================
// Filtre « ACT. » du journal — anomalies OU conflit/doublon (même logique que filteredJournal)
// =====================================================================
const filtreAct = (rows, actif, conflits) =>
  actif ? rows.filter((r) => getAlertesCommande(r).length > 0 || conflits.has(r.id)) : rows;
const conflits = new Set(["C-DOUBLON"]);
const saine = { id: "C-SAINE", engage: 100, etat_commande: "En cours", etat_travaux: "Terminé" };
const neg = { id: "C-NEG", engage: -2641.38 };
const num = { id: "C-NUM", etat_commande: "2641.38" };
const date = { id: "C-DATE", etat_travaux: "09.09.2024" };
const doublon = { id: "C-DOUBLON", engage: 100, etat_commande: "En cours" };
const multi = { id: "C-MULTI", engage: -2000, etat_commande: "2000", etat_travaux: "01.01.2025" };
const rowsAct = [saine, neg, num, date, doublon, multi];
assert("ACT par défaut → toutes les lignes", filtreAct(rowsAct, false, conflits).length === 6);
const activesAct = filtreAct(rowsAct, true, conflits);
assert("ACT commande sans anomalie → exclue", !activesAct.some((r) => r.id === "C-SAINE"));
assert(
  "ACT engagement négatif → incluse",
  activesAct.some((r) => r.id === "C-NEG"),
);
assert(
  "ACT état numérique incohérent → incluse",
  activesAct.some((r) => r.id === "C-NUM"),
);
assert(
  "ACT date dans etat_travaux → incluse",
  activesAct.some((r) => r.id === "C-DATE"),
);
assert(
  "ACT conflit/doublon → incluse",
  activesAct.some((r) => r.id === "C-DOUBLON"),
);
assert(
  "ACT plusieurs anomalies → une seule ligne",
  activesAct.filter((r) => r.id === "C-MULTI").length === 1,
);
assert(
  "ACT désactivé → retour à l'ensemble initial",
  filtreAct(rowsAct, false, conflits).length === 6,
);

// ACT combiné avec Année / État / Ville (mêmes helpers que le dashboard)
const actCombo = [
  {
    id: "A",
    annee_exercice: 2026,
    tranche_code: "1401",
    adresse: "RUE SERRIS",
    corps_etat: "(o) Plomberie",
    actif: true,
    engage: -500,
    etat_commande: "500",
  },
  {
    id: "B",
    annee_exercice: 2026,
    tranche_code: "1401",
    adresse: "RUE SERRIS",
    corps_etat: "(g) Halls",
    actif: true,
    engage: 100,
  },
  {
    id: "C",
    annee_exercice: 2025,
    tranche_code: "1396",
    adresse: "RUE CHESSY",
    corps_etat: "(e) Divers",
    actif: false,
    engage: -100,
  },
];
const filtreActCombo = (rows, { annee, etats, villes, actif }) =>
  rows.filter(
    (r) =>
      matchesAnnee(r, annee) &&
      (etats.length === 0 || etats.includes(etatMetier(r, EX))) &&
      (villes.length === 0 || villes.includes(villeDeCommande(r, tranches, villesGeo))) &&
      (actif ? getAlertesCommande(r).length > 0 || conflits.has(r.id) : true),
  );
const rAct2026 = filtreActCombo(actCombo, {
  annee: [2026, 2026],
  etats: [],
  villes: [],
  actif: true,
});
assert(
  "ACT + Année [2026,2026] → uniquement la ligne 2026 avec anomalie",
  rAct2026.length === 1 && rAct2026[0].id === "A",
);
const rActSerris = filtreActCombo(actCombo, {
  annee: [2023, 2030],
  etats: [],
  villes: ["SERRIS"],
  actif: true,
});
assert(
  "ACT + Ville SERRIS → uniquement les anomalies de SERRIS",
  rActSerris.length === 1 && rActSerris[0].id === "A",
);
const rActEtat = filtreActCombo(actCombo, {
  annee: [2023, 2030],
  etats: ["En cours"],
  villes: [],
  actif: true,
});
assert("ACT + État En cours → anomalies En cours (A et C)", rActEtat.length === 2);
const rActOff = filtreActCombo(actCombo, {
  annee: [2023, 2030],
  etats: [],
  villes: ["SERRIS"],
  actif: false,
});
assert(
  "ACT désactivé + Ville SERRIS → A et B (SERRIS)",
  rActOff.length === 2 && rActOff.some((r) => r.id === "B"),
);

console.log("\n==========================================");
console.log(`Résultat : ${passed} PASS, ${failed} FAIL`);
console.log("==========================================");
process.exit(failed > 0 ? 1 : 0);
