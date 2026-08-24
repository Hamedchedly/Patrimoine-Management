// Tests purs du moteur d'analyse fournisseurs (src/lib/fournisseurs.analyse.ts)
// Exécution : node scripts/test-fournisseurs-analyse.mjs
import {
  PROFIL_CONFIG,
  ORDRE_NIVEAU,
  agregerParAnnee,
  calculerActivitesEffectives,
  calculerProfilActivite,
  calculerScoreActivite,
  calculerVillesFournisseur,
  classerScoreActivite,
  classerCorpsEtatDansFamille,
  correspondSurAuMoinsUnCorps,
  corpsPrincipauxEffectifs,
  derniereCommande,
  evolution,
  extraireAdressePhysique,
  extraireCorpsEtatCode,
  libelleAjustement,
  meilleurNiveauCorps,
  niveauCorpsRecherche,
  niveauPrecedent,
  niveauSuivant,
  partMarche,
  partMarchePrincipaux,
  planifierMajActivites,
  timestampDateCommande,
  trancheDeCommande,
  trancheDepuisPatrimoine,
  trierHistoriqueAnnuelDesc,
  trierLignes,
} from "../src/lib/fournisseurs.analyse.ts";
import { rechercherFournisseurs } from "../src/lib/fournisseurs.ts";

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) {
    passed += 1;
    console.log("PASS ", name);
  } else {
    failed += 1;
    console.log("FAIL ", name, detail);
  }
}

const cmd = (corps_etat, montant, annee = 2026) => ({ corps_etat, montant, annee });

// ── 1. Mapping corps d'état → famille ────────────────────────────────────────
{
  check("T1 (m) Carrelage → CEA", classerCorpsEtatDansFamille("(m) Carrelage") === "CEA");
  check("T1 Peinture → CEA", classerCorpsEtatDansFamille("(o) Peinture") === "CEA");
  check("T1 Revêtement de sols → CEA", classerCorpsEtatDansFamille("Revêtement de sols") === "CEA");
  check("T1 (o) Plomberie → CVC-P", classerCorpsEtatDansFamille("(o) Plomberie") === "CVC-P");
  check("T1 Chauffage → CVC-P", classerCorpsEtatDansFamille("Chauffage") === "CVC-P");
  check("T1 Ventilation → CVC-P", classerCorpsEtatDansFamille("Ventilation") === "CVC-P");
  check("T1 (j) Couvertures → AUTRE", classerCorpsEtatDansFamille("(j) Couvertures") === "AUTRE");
  check("T1 (p) Toitures → AUTRE", classerCorpsEtatDansFamille("(p) Toitures") === "AUTRE");
  check("T1 null → AUTRE", classerCorpsEtatDansFamille(null) === "AUTRE");
}

// ── 2. Spécialiste ────────────────────────────────────────────────────────────
{
  const p = calculerProfilActivite([
    cmd("(j) Couvertures", 100),
    cmd("(j) Couvertures", 200),
    cmd("(j) Couvertures", 300),
    cmd("(j) Couvertures", 400),
    cmd("(j) Couvertures", 500),
    cmd("(j) Couvertures", 600),
    cmd("(j) Couvertures", 700),
    cmd("(j) Couvertures", 800),
    cmd("(r) Fermetures", 50),
  ]);
  check("T2 libellé Spécialiste", p.libelle === "Spécialiste (j) Couvertures");
  check("T2 corps principal", p.corps_principaux[0] === "(j) Couvertures");
  check("T2 non TCE", p.est_tce === false);
}

// ── 3. Principal / secondaire / occasionnel ───────────────────────────────────
{
  const p = calculerProfilActivite([
    cmd("(a) Maçonnerie", 1000),
    cmd("(a) Maçonnerie", 1000),
    cmd("(a) Maçonnerie", 1000),
    cmd("(a) Maçonnerie", 1000),
    cmd("(a) Maçonnerie", 1000),
    cmd("(a) Maçonnerie", 1000),
    cmd("(a) Maçonnerie", 1000),
    cmd("(a) Maçonnerie", 1000),
    cmd("(a) Maçonnerie", 1000),
    cmd("(a) Maçonnerie", 1000),
    cmd("(a) Maçonnerie", 1000),
    cmd("(a) Maçonnerie", 1000),
    cmd("(o) Plomberie", 500),
    cmd("(o) Plomberie", 500),
    cmd("(h) Cages", 300),
  ]);
  const maçon = p.corps.find((c) => c.corps_etat === "(a) Maçonnerie");
  const plomb = p.corps.find((c) => c.corps_etat === "(o) Plomberie");
  const cages = p.corps.find((c) => c.corps_etat === "(h) Cages");
  check("T3 maçonnerie = principal", maçon?.niveau === "principal");
  // V8.16p — barème combiné (commandes + montant) : plomberie (2/15 cmd, 7,5 % du
  // montant) → occasionnel face à la dominance de maçonnerie.
  check("T3 plomberie = occasionnel", plomb?.niveau === "occasionnel");
  check("T3 cages = occasionnel", cages?.niveau === "occasionnel");
}

// ── 4. TCE (prudent) ──────────────────────────────────────────────────────────
{
  const tce = calculerProfilActivite([
    cmd("(j) Couvertures", 100),
    cmd("(p) Toitures", 100),
    cmd("(q) Menuiseries ext", 100),
    cmd("(r) Fermetures", 100),
    cmd("(u) Etanchéité", 100),
  ]);
  check("T4 multi-corps dispersé → TCE", tce.est_tce === true && tce.libelle === "TCE");

  const pasTce = calculerProfilActivite([
    cmd("(j) Couvertures", 1000),
    cmd("(j) Couvertures", 1000),
    cmd("(j) Couvertures", 1000),
    cmd("(p) Toitures", 300),
    cmd("(q) Menuiseries ext", 300),
    cmd("(r) Fermetures", 200),
  ]);
  check("T4 spécialité dominante → pas TCE", pasTce.est_tce === false);
}

// ── 5. CEA / CVC-P ────────────────────────────────────────────────────────────
{
  const cea = calculerProfilActivite([
    cmd("(m) Carrelage", 100),
    cmd("(m) Carrelage", 100),
    cmd("(m) Carrelage", 100),
    cmd("(m) Carrelage", 100),
    cmd("Peinture", 100),
    cmd("Peinture", 100),
    cmd("Peinture", 100),
    cmd("(o) Plomberie", 50),
    cmd("Ventilation", 50),
  ]);
  check("T5 CEA (famille dominante)", cea.libelle === "CEA" && cea.est_tce === false);

  const cvc = calculerProfilActivite([
    cmd("(o) Plomberie", 100),
    cmd("(o) Plomberie", 100),
    cmd("(o) Plomberie", 100),
    cmd("(o) Plomberie", 100),
    cmd("Chauffage", 100),
    cmd("Chauffage", 100),
    cmd("Chauffage", 100),
    cmd("Ventilation", 100),
    cmd("Ventilation", 100),
    cmd("(j) Couvertures", 50),
  ]);
  check("T5 CVC-P (famille dominante)", cvc.libelle === "CVC-P" && cvc.est_tce === false);
}

// ── 6. Recherche corps d'état (niveau) + classement ──────────────────────────
{
  const p = calculerProfilActivite([
    cmd("(o) Plomberie", 100),
    cmd("(o) Plomberie", 100),
    cmd("(o) Plomberie", 100),
    cmd("(o) Plomberie", 100),
    cmd("(j) Couvertures", 50),
  ]);
  check("T6 niveau plomberie = principal", niveauCorpsRecherche(p, "plomberie") === "principal");
  // V8.16p — écart marqué → hiérarchie relative : couvertures (1/5, ratio 0,25) = secondaire.
  check(
    "T6 niveau couvertures = secondaire",
    niveauCorpsRecherche(p, "couvertures") === "secondaire",
  );
  check("T6 niveau absent = null", niveauCorpsRecherche(p, "ascenseur") === null);
  check("T6 ordre principal < secondaire", ORDRE_NIVEAU.principal < ORDRE_NIVEAU.secondaire);
  check("T6 ordre secondaire < occasionnel", ORDRE_NIVEAU.secondaire < ORDRE_NIVEAU.occasionnel);
}

// ── 6b. V8.16p — classification RELATIVE par écart (règle utilisateur) ────────
{
  const eq = calculerProfilActivite([cmd("(u) Etanchéité", 1532), cmd("Divers", 1980)]);
  const etan = eq.corps.find((c) => c.corps_etat === "(u) Etanchéité");
  const divers = eq.corps.find((c) => c.corps_etat === "Divers");
  check("T6b équilibré 50/50 : étanchéité = principal", etan?.niveau === "principal");
  check("T6b équilibré 50/50 : divers = principal", divers?.niveau === "principal");

  const eq2 = calculerProfilActivite([
    cmd("(o) Plomberie", 100),
    cmd("(o) Plomberie", 100),
    cmd("(q) Menuiseries ext", 100),
    cmd("(q) Menuiseries ext", 100),
  ]);
  const pl = eq2.corps.find((c) => c.corps_etat === "(o) Plomberie");
  const menu = eq2.corps.find((c) => c.corps_etat === "(q) Menuiseries ext");
  check("T6b équilibré 2×2 : plomberie = principal", pl?.niveau === "principal");
  check("T6b équilibré 2×2 : menuiseries = principal", menu?.niveau === "principal");

  // V8.16p — cas RÉEL 5700 : 3/5 Fermetures + 2/5 Divers → le dominant est principale.
  const f5700 = calculerProfilActivite([
    cmd("(r) Fermetures", 100),
    cmd("(r) Fermetures", 100),
    cmd("(r) Fermetures", 100),
    cmd("(e) Divers", 100),
    cmd("(e) Divers", 100),
  ]);
  const ferm = f5700.corps.find((c) => c.corps_etat === "(r) Fermetures");
  const div = f5700.corps.find((c) => c.corps_etat === "(e) Divers");
  check("T6b 5700 : fermetures (3/5) = principal", ferm?.niveau === "principal");
  check("T6b 5700 : divers (2/5) ≠ occasionnel", div?.niveau !== "occasionnel");

  // Écart marqué → hiérarchie relative (dominant = principale, autres classés).
  const gap = calculerProfilActivite([
    cmd("(u) Etanchéité", 1000),
    cmd("(u) Etanchéité", 1000),
    cmd("(u) Etanchéité", 1000),
    cmd("(u) Etanchéité", 1000),
    cmd("(u) Etanchéité", 1000),
    cmd("(o) Plomberie", 200),
  ]);
  const etanG = gap.corps.find((c) => c.corps_etat === "(u) Etanchéité");
  const plombG = gap.corps.find((c) => c.corps_etat === "(o) Plomberie");
  check("T6b écart marqué : étanchéité = principal", etanG?.niveau === "principal");
  check(
    "T6b écart marqué : plomberie ≠ principal (hiérarchie conservée)",
    plombG?.niveau !== "principal",
  );
}

// ── 6c. V8.16p — BARÈME COMBINÉ : le MONTANT compte aussi (cas réel 12562) ────
{
  // 12562 : isolat extérieure = 1 commande (6,7 %) mais 35 k€ (34 % du montant,
  // plus gros montant) → activité SIGNIFICATIVE, pas « occasionnel ».
  const p = calculerProfilActivite([
    cmd("(d) Espaces Ext", 17144),
    cmd("(y) amenagt ext", 11988.35),
    cmd("(y) amenagt ext", 0),
    cmd("(a) Maçonnerie", 10555.6),
    cmd("(a) Maçonnerie", 0),
    cmd("(r) Fermetures", 8481),
    cmd("(r) Fermetures", 0),
    cmd("(q) Menuiseries ext", 0),
    cmd("(q) Menuiseries ext", 0),
    cmd("(w) isolat extérieure", 35088.35),
    cmd("(e) Divers", 12677.5),
    cmd("(g) Halls", 7174.2),
    cmd("(h) Cages", 0),
  ]);
  const isol = p.corps.find((c) => c.corps_etat === "(w) isolat extérieure");
  const espaces = p.corps.find((c) => c.corps_etat === "(d) Espaces Ext");
  check("T6c 12562 : isolat extérieure (1 cmd / 35 k€) = principal", isol?.niveau === "principal");
  check("T6c 12562 : espaces ext (3 cmd) = principal", espaces?.niveau === "principal");
}

// ── 7. Évolutions / part de marché ────────────────────────────────────────────
{
  check("T7 évolution 120/100 = +20 %", Math.abs((evolution(120, 100) ?? 0) - 0.2) < 1e-9);
  check("T7 évolution base nulle = null", evolution(120, 0) === null);
  check("T7 part marché 10/100 = 10 %", Math.abs((partMarche(10, 100) ?? 0) - 0.1) < 1e-9);
  check("T7 part marché total nul = null", partMarche(10, 0) === null);
}

// ── 8. Agrégation annuelle ────────────────────────────────────────────────────
{
  const agr = agregerParAnnee([
    cmd("(a) M", 10, 2025),
    cmd("(a) M", 20, 2025),
    cmd("(a) M", 30, 2026),
  ]);
  check("T8 2 années", agr.length === 2);
  const a25 = agr.find((x) => x.annee === 2025);
  check("T8 2025 = 2 commandes / 30", a25?.commandes === 2 && a25?.montant === 30);
}

// ── 9. Tri ────────────────────────────────────────────────────────────────────
{
  const lignes = [
    { id: "a", nom: "Alpha", montant_annee: 100, commandes_annee: 3 },
    { id: "b", nom: "Beta", montant_annee: 300, commandes_annee: 1 },
    { id: "c", nom: "Gamma", montant_annee: 200, commandes_annee: 2 },
  ];
  const desc = trierLignes(lignes, (l) => l.montant_annee, "desc");
  check("T9 tri montant desc", desc[0].id === "b" && desc[1].id === "c" && desc[2].id === "a");
  const asc = trierLignes(lignes, (l) => l.commandes_annee, "asc");
  check("T9 tri commandes asc", asc[0].id === "b" && asc[2].id === "a");
}

// ── 10. Absence de données / profil vide ──────────────────────────────────────
{
  const p = calculerProfilActivite([]);
  check("T10 profil vide : corps=[]", p.corps.length === 0);
  check("T10 profil vide : familles=[]", p.familles.length === 0);
  check("T10 profil vide : libelle AUTRE", p.libelle === "AUTRE");
  check("T10 profil vide : pas TCE", p.est_tce === false);
}

// ── 11. Immutabilité des entrées ──────────────────────────────────────────────
{
  const input = [cmd("(j) Couvertures", 100), cmd("(o) Plomberie", 200)];
  const snapshot = JSON.stringify(input);
  calculerProfilActivite(input);
  check("T11 entrée non mutée", JSON.stringify(input) === snapshot);
}

// ── 12. Aucune recherche → toutes les entreprises ─────────────────────────────
{
  const map = new Map();
  const lignes = [
    { id: "a", nom: "Alpha" },
    { id: "b", nom: "Beta" },
  ];
  check("T12 aucune recherche → toutes", rechercherFournisseurs(lignes, map, "").length === 2);
}

// ── 13. Tri par défaut : dernière commande DESC ───────────────────────────────
{
  const lignes = [
    { id: "a", derniere_commande_date: "2026-08-12" },
    { id: "b", derniere_commande_date: "2026-08-05" },
    { id: "c", derniere_commande_date: "2026-07-21" },
  ];
  const desc = trierLignes(lignes, (l) => l.derniere_commande_date, "desc");
  check(
    "T13 dernière commande DESC",
    desc[0].id === "a" && desc[1].id === "b" && desc[2].id === "c",
  );
}

// ── 14. Entreprise sans commande → en fin de liste ────────────────────────────
{
  const lignes = [
    { id: "c", derniere_commande_date: null },
    { id: "a", derniere_commande_date: "2026-08-12" },
    { id: "b", derniere_commande_date: "2026-08-03" },
  ];
  const desc = trierLignes(lignes, (l) => l.derniere_commande_date, "desc");
  check("T14 sans commande en fin", desc[0].id === "a" && desc[1].id === "b" && desc[2].id === "c");
}

// ── 15/16. Multi-corps : OR (au moins un) ────────────────────────────────────
{
  const pA = calculerProfilActivite([
    cmd("(j) Couvertures", 100),
    cmd("(j) Couvertures", 100),
    cmd("(p) Toitures", 100),
  ]);
  const pB = calculerProfilActivite([cmd("(o) Plomberie", 100)]);
  check("T15 A : un corps sélectionné", correspondSurAuMoinsUnCorps(pA, ["Couvertures"]) === true);
  check(
    "T16 A : Couvertures OU Toitures → vrai",
    correspondSurAuMoinsUnCorps(pA, ["Couvertures", "Toitures"]) === true,
  );
  check(
    "T16 B : Couvertures OU Toitures → faux (Plomberie)",
    correspondSurAuMoinsUnCorps(pB, ["Couvertures", "Toitures"]) === false,
  );
  check(
    "T16 A : sélection vide → vrai (aucune contrainte)",
    correspondSurAuMoinsUnCorps(pA, []) === true,
  );
}

// ── 17/18. Meilleur niveau parmi plusieurs corps ──────────────────────────────
{
  const pA = calculerProfilActivite([
    cmd("(o) Plomberie", 100),
    cmd("(o) Plomberie", 100),
    cmd("(o) Plomberie", 100),
    cmd("(o) Plomberie", 100),
    cmd("(j) Couvertures", 50),
  ]);
  check("T17 plomberie = principal", meilleurNiveauCorps(pA, ["plomberie"]) === "principal");
  check(
    "T18 plomberie+couvertures → principal (meilleur)",
    meilleurNiveauCorps(pA, ["Plomberie", "Couvertures"]) === "principal",
  );
  const pB = calculerProfilActivite([
    cmd("(o) Plomberie", 100),
    cmd("(o) Plomberie", 100),
    cmd("(j) Couvertures", 100),
    cmd("(j) Couvertures", 100),
    cmd("(j) Couvertures", 100),
  ]);
  check(
    "T18 B plomberie+toits → secondaire",
    meilleurNiveauCorps(pB, ["Plomberie", "Toitures"]) === "secondaire",
  );
  check("T18 corps absent → null", meilleurNiveauCorps(pA, ["Ascenseurs"]) === null);
}

// ── 19. Famille + multi-corps ─────────────────────────────────────────────────
{
  const cea = calculerProfilActivite([
    cmd("(m) Carrelage", 100),
    cmd("(m) Carrelage", 100),
    cmd("(m) Carrelage", 100),
    cmd("(m) Carrelage", 100),
    cmd("Peinture", 100),
    cmd("Peinture", 100),
    cmd("Peinture", 100),
    cmd("(j) Couvertures", 50),
  ]);
  const familleCea = cea.familles.find((f) => f.famille === "CEA");
  check(
    "T19 famille CEA + peinture/carrelage",
    familleCea &&
      familleCea.commandes > 0 &&
      correspondSurAuMoinsUnCorps(cea, ["Peinture", "Carrelage"]) === true,
  );
  const tce = calculerProfilActivite([
    cmd("(j) Couvertures", 100),
    cmd("(p) Toitures", 100),
    cmd("(q) Menuiseries ext", 100),
    cmd("(r) Fermetures", 100),
    cmd("(u) Etanchéité", 100),
  ]);
  check(
    "T19 TCE + couvertures",
    tce.est_tce === true && correspondSurAuMoinsUnCorps(tce, ["Couvertures"]) === true,
  );
}

// ── 20. Dernière commande (date + numéro) ─────────────────────────────────────
{
  const dc = derniereCommande([
    {
      date_commande: "Wed Feb 01 2023 23:59:39 GMT+0100",
      date_demarrage: "2023-02-16",
      numero_commande: "4581335",
    },
    {
      date_commande: "Fri Aug 12 2026 10:00:00 GMT+0200",
      date_demarrage: "2026-08-01",
      numero_commande: "5108854",
    },
  ]);
  check("T20 dernière date = 12/08/2026", dc.date === "2026-08-12" && dc.numero === "5108854");
  const vide = derniereCommande([]);
  check("T20 aucune commande → null", vide.date === null && vide.numero === null);
}

// ── 21. Tri explicite montant / commandes (non-régression) ───────────────────
{
  const lignes = [
    { id: "a", montant_annee: 100, commandes_annee: 3 },
    { id: "b", montant_annee: 300, commandes_annee: 1 },
    { id: "c", montant_annee: 200, commandes_annee: 2 },
  ];
  check("T21 tri montant desc", trierLignes(lignes, (l) => l.montant_annee, "desc")[0].id === "b");
  check(
    "T21 tri commandes asc",
    trierLignes(lignes, (l) => l.commandes_annee, "asc")[2].id === "a",
  );
}

// ── 22. Tri Ref ISIS numérique (valeurs réelles, pas le texte) ─────────────────
{
  const lignes = [
    { id: "a", ref: "1000" },
    { id: "b", ref: "999" },
    { id: "c", ref: "2000" },
  ];
  const desc = trierLignes(
    lignes,
    (l) => (l.ref && /^\d+$/.test(l.ref) ? Number(l.ref) : l.ref),
    "desc",
  );
  check(
    "T22 ref ISIS numérique desc",
    desc[0].ref === "2000" && desc[1].ref === "1000" && desc[2].ref === "999",
  );
}

// ── 23. Code / libellé corps d'état ──────────────────────────────────────────
{
  const e = extraireCorpsEtatCode("(j) Couvertures");
  check("T23 code j + libellé conservé", e.code === "j" && e.libelle === "(j) Couvertures");
  const s = extraireCorpsEtatCode("Peinture");
  check("T23 sans préfixe → code normalisé", s.code === "peinture" && s.libelle === "Peinture");
  check("T23 null → vide", extraireCorpsEtatCode(null).code === "");
}

// ── 24. Monotonie des niveaux ────────────────────────────────────────────────
{
  check(
    "T24 + : occasionnel→secondaire→principal",
    niveauSuivant("occasionnel") === "secondaire" &&
      niveauSuivant("secondaire") === "principal" &&
      niveauSuivant("principal") === "principal",
  );
  check(
    "T24 − : principal→secondaire→occasionnel",
    niveauPrecedent("principal") === "secondaire" &&
      niveauPrecedent("secondaire") === "occasionnel" &&
      niveauPrecedent("occasionnel") === "occasionnel",
  );
}

// ── 25. Niveau effectif : override manuel sans écraser l'auto ────────────────
{
  const profil = calculerProfilActivite([
    cmd("(o) Plomberie", 100),
    cmd("(o) Plomberie", 100),
    cmd("(o) Plomberie", 100),
    cmd("(o) Plomberie", 100),
    cmd("(o) Plomberie", 100),
    cmd("(o) Plomberie", 100),
    cmd("(o) Plomberie", 100),
    cmd("(o) Plomberie", 100),
    cmd("(o) Plomberie", 100),
    cmd("(o) Plomberie", 100),
    cmd("(o) Plomberie", 100),
    cmd("(o) Plomberie", 100),
    cmd("(o) Plomberie", 100),
    cmd("(o) Plomberie", 100),
    cmd("(j) Couvertures", 100),
    cmd("(j) Couvertures", 100),
    cmd("(r) Fermetures", 100),
  ]);
  const manuel = [
    {
      fournisseur_id: "x",
      corps_etat_code: "j",
      corps_etat_libelle: "(j) Couvertures",
      niveau: "principal",
      source: "manuel",
    },
  ];
  const eff = calculerActivitesEffectives(profil, manuel);
  const couv = eff.find((a) => a.code === "j");
  check(
    "T25 override → effectif principal / origine manuel",
    couv?.niveau === "principal" && couv?.source === "manuel",
  );
  check(
    "T25 niveau_auto conservé",
    couv?.niveau_auto === "occasionnel" && couv?.niveau_manuel === "principal",
  );
  const plomb = eff.find((a) => a.code === "o");
  check(
    "T25 plomberie inchangée (auto principal)",
    plomb?.niveau === "principal" && plomb?.source === "calculé",
  );
  const eff2 = calculerActivitesEffectives(profil, []);
  check(
    "T25 suppression override → retour auto",
    eff2.find((a) => a.code === "j")?.niveau === "occasionnel",
  );
}

// ── 26. Entreprise sans historique → activités manuelles, KPIs à zéro ────────
{
  const profil = calculerProfilActivite([]);
  const manuel = [
    {
      fournisseur_id: "x",
      corps_etat_code: "j",
      corps_etat_libelle: "(j) Couvertures",
      niveau: "principal",
      source: "manuel",
    },
    {
      fournisseur_id: "x",
      corps_etat_code: "o",
      corps_etat_libelle: "(o) Plomberie",
      niveau: "secondaire",
      source: "manuel",
    },
  ];
  const eff = calculerActivitesEffectives(profil, manuel);
  check("T26 2 activités manuelles", eff.length === 2);
  check(
    "T26 couvertures principal / 0 commande",
    eff.find((a) => a.code === "j")?.niveau === "principal" &&
      eff.find((a) => a.code === "j")?.commandes === 0,
  );
  check(
    "T26 plomberie secondaire / 0 montant",
    eff.find((a) => a.code === "o")?.niveau === "secondaire" &&
      eff.find((a) => a.code === "o")?.montant === 0,
  );
  check(
    "T26 origine manuel partout",
    eff.every((a) => a.source === "manuel"),
  );
  check(
    "T26 niveau_auto null (aucun historique)",
    eff.every((a) => a.niveau_auto === null),
  );
}

// ── 27. Part de marché — MODE PRINCIPAUX ─────────────────────────────────────
{
  const commandes = [
    { corps_etat: "(j) Couvertures", montant: 400 },
    { corps_etat: "(p) Toitures", montant: 300 },
    { corps_etat: "(o) Plomberie", montant: 200 },
    { corps_etat: "(r) Fermetures", montant: 100 },
    { corps_etat: "(j) Couvertures", montant: 50 },
  ];
  const pm = partMarchePrincipaux(commandes, new Set(["j", "p"]), 2000);
  check("T27 montant principaux = 750 (aucun doublon)", pm.montant === 750);
  check("T27 part principaux = 37,5 %", Math.abs((pm.part ?? 0) - 0.375) < 1e-9);
  const pmVide = partMarchePrincipaux(commandes, new Set(), 2000);
  check("T27 aucun principal → 0", pmVide.montant === 0 && pmVide.part === 0);
  const pmNull = partMarchePrincipaux(
    [{ corps_etat: "(j) Couvertures", montant: null }],
    new Set(["j"]),
    100,
  );
  check("T27 montant null ignoré", pmNull.montant === 0);
}

// ── 28. Plan de mise à jour des activités (create / update / delete) ─────────
{
  const existantes = [
    {
      id: "a1",
      fournisseur_id: "x",
      corps_etat_code: "j",
      corps_etat_libelle: "(j) Couvertures",
      niveau: "principal",
      source: "manuel",
    },
  ];
  const plan = planifierMajActivites(existantes, [
    { corps_etat_code: "j", corps_etat_libelle: "(j) Couvertures", niveau: "secondaire" },
    { corps_etat_code: "o", corps_etat_libelle: "(o) Plomberie", niveau: "principal" },
  ]);
  check("T28 modification j (update)", plan.modifier.length === 1 && plan.modifier[0].id === "a1");
  check(
    "T28 création o (insert)",
    plan.creer.length === 1 && plan.creer[0].corps_etat_code === "o",
  );
  check(
    "T28 suppression si liste vide",
    planifierMajActivites(existantes, []).supprimer.length === 1,
  );
  check(
    "T28 code normalisé (minuscules)",
    planifierMajActivites(existantes, [
      { corps_etat_code: " J ", corps_etat_libelle: "(j) Couvertures", niveau: "principal" },
    ]).modifier.length === 1,
  );
}

// ── 29. Corps principaux EFFECTIFS (recherche / liste) ───────────────────────
{
  const profil = calculerProfilActivite([
    cmd("(j) Couvertures", 100),
    cmd("(j) Couvertures", 100),
    cmd("(j) Couvertures", 100),
    cmd("(j) Couvertures", 100),
    cmd("(j) Couvertures", 100),
    cmd("(j) Couvertures", 100),
    cmd("(j) Couvertures", 100),
    cmd("(j) Couvertures", 100),
    cmd("(j) Couvertures", 100),
    cmd("(p) Toitures", 100),
  ]);
  const manuel = [
    {
      fournisseur_id: "x",
      corps_etat_code: "p",
      corps_etat_libelle: "(p) Toitures",
      niveau: "principal",
      source: "manuel",
    },
  ];
  const { codes, libelles } = corpsPrincipauxEffectifs(profil, manuel);
  check("T29 couvertures + toitures (manuel) principales", codes.has("j") && codes.has("p"));
  check(
    "T29 libellés avec codes conservés",
    libelles.includes("(j) Couvertures") && libelles.includes("(p) Toitures"),
  );
}

// ── 30. Cas réel 5832 : Couvertures DOMINANTE → principale (règle relative V8.16p) ───
{
  // Répartition RÉELLE de l'entreprise 5832 (60 commandes, montants réels par corps).
  // V8.16p : parts de commandes → Couvertures 33/60 (55 %) principale ; Étanchéité 18 %
  // et Toitures 17 % → secondaires ; le reste occasionnel.
  const mk = (corps, montant, annee) => ({ corps_etat: corps, montant, annee });
  const cmd = [];
  const repeter = (c, m, a, n) => {
    for (let i = 0; i < n; i++) cmd.push(mk(c, m, a));
  };
  repeter("(j) Couvertures", 96356.17 / 33, 2023, 9);
  repeter("(j) Couvertures", 96356.17 / 33, 2024, 8);
  repeter("(j) Couvertures", 96356.17 / 33, 2025, 8);
  repeter("(j) Couvertures", 96356.17 / 33, 2026, 8);
  repeter("(u) Etanchéité", 121878.13 / 11, 2023, 4);
  repeter("(u) Etanchéité", 121878.13 / 11, 2024, 4);
  repeter("(u) Etanchéité", 121878.13 / 11, 2025, 3);
  repeter("(p) Toitures", 12988.03 / 10, 2023, 3);
  repeter("(p) Toitures", 12988.03 / 10, 2024, 3);
  repeter("(p) Toitures", 12988.03 / 10, 2025, 2);
  repeter("(p) Toitures", 12988.03 / 10, 2026, 2);
  repeter("(w) isolat extérieure", 6823.44 / 3, 2026, 3);
  repeter("(q) Menuiseries ext", 690, 2026, 1);
  repeter("(c) Isolation", 7316.61, 2026, 1);
  repeter("(e) Divers", -3493.41, 2025, 1);
  const p = calculerProfilActivite(cmd);
  const niv = (code) =>
    p.corps.find((c) => extraireCorpsEtatCode(c.corps_etat).code === code)?.niveau;
  check("T30 60 commandes", cmd.length === 60);
  check("T30 (j) Couvertures → principal", niv("j") === "principal");
  // V8.16p — barème combiné : étanchéité = 18 % des commandes mais 50 % du MONTANT → principale.
  check("T30 (u) Etanchéité → principal (18 % cmd / 50 % montant)", niv("u") === "principal");
  check("T30 (p) Toitures → occasionnel (17 % / 10 cmd)", niv("p") === "occasionnel");
  check("T30 (w) isolat extérieure → occasionnel (5 % / 3 cmd)", niv("w") === "occasionnel");
  check("T30 (q) Menuiseries ext → occasionnel (1 cmd)", niv("q") === "occasionnel");
  check("T30 (c) Isolation → occasionnel (1 cmd)", niv("c") === "occasionnel");
  check("T30 (e) Divers → occasionnel (1 cmd)", niv("e") === "occasionnel");
}

// ── 31. Scoring : signaux et seuils (méthode transparente) ───────────────────
{
  const sEtanch = calculerScoreActivite({
    partCommandes: 0.1833,
    partMontant: 0.5022,
    commandes: 11,
    anneesActives: 3,
    recence: 0.5,
  });
  check("T31 Etanchéité ≥ seuil principal", classerScoreActivite(sEtanch) === "principal");
  const s1 = calculerScoreActivite({
    partCommandes: 0.2,
    partMontant: 0.11,
    commandes: 1,
    anneesActives: 1,
    recence: 1,
  });
  check(
    "T31 1 commande / 20 % → occasionnel (jamais principale)",
    classerScoreActivite(s1) === "occasionnel",
  );
  const s2 = calculerScoreActivite({
    partCommandes: 0.133,
    partMontant: 0.074,
    commandes: 2,
    anneesActives: 1,
    recence: 1,
  });
  check("T31 2 commandes / 13 % → secondaire", classerScoreActivite(s2) === "secondaire");
  const sNeg = calculerScoreActivite({
    partCommandes: 0.05,
    partMontant: -0.5,
    commandes: 3,
    anneesActives: 1,
    recence: 1,
  });
  check(
    "T31 montant négatif neutralisé",
    sNeg >=
      calculerScoreActivite({
        partCommandes: 0.05,
        partMontant: 0,
        commandes: 3,
        anneesActives: 1,
        recence: 1,
      }),
  );
}

// ── 32. Transition manuel → calculé (sans écraser l'override) ────────────────
{
  const manuel = [
    {
      fournisseur_id: "x",
      corps_etat_code: "o",
      corps_etat_libelle: "(o) Plomberie",
      niveau: "secondaire",
      source: "manuel",
    },
  ];
  const sansHistorique = calculerActivitesEffectives(calculerProfilActivite([]), manuel);
  const plomb0 = sansHistorique.find((a) => a.code === "o");
  check(
    "T32 sans historique : 0 commande / effectif secondaire",
    plomb0?.commandes === 0 && plomb0?.niveau === "secondaire",
  );
  const avecHistorique = calculerActivitesEffectives(
    calculerProfilActivite(Array.from({ length: 8 }, () => cmd("(o) Plomberie", 100))),
    manuel,
  );
  const plomb1 = avecHistorique.find((a) => a.code === "o");
  check("T32 avec historique : commandes réelles (8)", plomb1?.commandes === 8);
  check("T32 niveau_auto recalculé → principal", plomb1?.niveau_auto === "principal");
  check(
    "T32 override conservé → effectif secondaire",
    plomb1?.niveau === "secondaire" && plomb1?.niveau_manuel === "secondaire",
  );
}

// ── 33. Libellé « Ajustement » (uniquement si override manuel) ───────────────
{
  check("T33 auto seul → libellé vide", libelleAjustement({ niveau_manuel: null }) === "");
  check(
    "T33 override → « Manuel »",
    libelleAjustement({ niveau_manuel: "secondaire" }) === "Manuel",
  );
}

// ── 34. Tri des activités (valeurs réelles, codes conservés) ─────────────────
{
  const list = [
    {
      code: "j",
      corps_etat: "(j) Couvertures",
      commandes: 5,
      partCommandes: 0.3,
      montant: 100,
      niveau: "principal",
    },
    {
      code: "p",
      corps_etat: "(p) Toitures",
      commandes: 10,
      partCommandes: 0.5,
      montant: 50,
      niveau: "principal",
    },
    {
      code: "u",
      corps_etat: "(u) Etanchéité",
      commandes: 3,
      partCommandes: 0.1,
      montant: 200,
      niveau: "secondaire",
    },
  ];
  const desc = trierLignes(list, (x) => x.commandes, "desc");
  check("T34 tri commandes desc", desc[0].code === "p" && desc[2].code === "u");
  const mont = trierLignes(list, (x) => x.montant, "desc");
  check("T34 tri montant desc (valeur réelle)", mont[0].code === "u");
  const corps = trierLignes(list, (x) => x.corps_etat.toLowerCase(), "asc");
  check("T34 tri corps asc (codes conservés)", corps[0].code === "j");
}

// ── 35. Tri des commandes (montant / date / corps) ───────────────────────────
{
  const commandes = [
    {
      numero_commande: "B",
      montant: 300,
      corps_etat: "(j) Couvertures",
      date_commande: "2026-01-02",
    },
    { numero_commande: "A", montant: 100, corps_etat: "(p) Toitures", date_commande: "2026-03-01" },
    {
      numero_commande: "C",
      montant: null,
      corps_etat: "(u) Etanchéité",
      date_commande: "2026-02-01",
    },
  ];
  const desc = trierLignes(commandes, (c) => c.montant, "desc");
  check(
    "T35 montant desc + null en fin",
    desc[0].numero_commande === "B" && desc[2].numero_commande === "C",
  );
  const dates = trierLignes(commandes, (c) => c.date_commande, "desc");
  check("T35 date desc", dates[0].numero_commande === "A");
}

// ── 36. Historique annuel : ordre PAR DÉFAUT décroissant (2026 → 2023) ───────
{
  const historique = [
    { annee: 2023, commandes: 5, montant: 100 },
    { annee: 2026, commandes: 20, montant: 500 },
    { annee: 2024, commandes: 8, montant: 150 },
    { annee: 2025, commandes: 12, montant: 300 },
  ];
  const trie = trierHistoriqueAnnuelDesc(historique);
  check(
    "T36 historique DESC 2026→2023 (récent d'abord)",
    trie.map((h) => h.annee).join(",") === "2026,2025,2024,2023",
  );
  check(
    "T36 tri stable : données complètes conservées",
    trie[0]?.commandes === 20 && trie[3]?.montant === 100,
  );
  const ordreOriginal = historique.map((h) => h.annee).join(",");
  check("T36 n'écrase jamais l'ordre source", ordreOriginal === "2023,2026,2024,2025");
  check(
    "T36 agregerParAnnee reste croissant (contrat du moteur)",
    agregerParAnnee([
      { annee: 2024, montant: 1 },
      { annee: 2023, montant: 2 },
      { annee: 2025, montant: 3 },
    ])
      .map((a) => a.annee)
      .join(",") === "2023,2024,2025",
  );
}

// ── 37. Adresse physique (jamais un identifiant patrimoine) ──────────────────
{
  check(
    "T37 ER suffixe retiré (« - ER.37062 »)",
    extraireAdressePhysique("61 PLACE DES CHÊNES, NANDY - ER.37062") ===
      "61 PLACE DES CHÊNES, NANDY",
  );
  check(
    "T37 ER suffixe après ville (« , SERRIS - ER.26252 »)",
    extraireAdressePhysique("3 PLACE THOMAS LE PILLEUR, SERRIS - ER.26252") ===
      "3 PLACE THOMAS LE PILLEUR, SERRIS",
  );
  check(
    "T37 ER précédé d'un marqueur (« - INDIV ER.34690 »)",
    extraireAdressePhysique("RUE DE LA CLEF DES CHAMPS, MAGNY-LE-HONGRE - INDIV ER.34690") ===
      "RUE DE LA CLEF DES CHAMPS, MAGNY-LE-HONGRE",
  );
  check(
    "T37 adresse sans ER inchangée",
    extraireAdressePhysique("RUE DU PRESSOIR, THIBOUST SERRIS") ===
      "RUE DU PRESSOIR, THIBOUST SERRIS",
  );
  check(
    "T37 ville seule conservée (fallback, aucune invention)",
    extraireAdressePhysique("THORIGNY SUR MARNE") === "THORIGNY SUR MARNE",
  );
  check("T37 code ER seul n'est jamais une adresse", extraireAdressePhysique("ER.37062") === null);
  check("T37 nul/vide → null", extraireAdressePhysique(null) === null);
}

// ── 38. Carte des villes — données réelles, aucune coordonnée inventée ───────
{
  // Mêmes référentiels que le Dashboard Travaux (villes_geo + tranches).
  const villesGeo = [
    { ville: "SERRIS", lat: 48.85, lng: 2.79, n: 1 },
    { ville: "CHESSY", lat: 48.88, lng: 2.72, n: 1 },
    { ville: "NANDY", lat: 48.58, lng: 2.56, n: 1 },
  ];
  const tranches = [
    { code: "1396", localite: "CHESSY" },
    { code: "1400", localite: "SERRIS" },
    { code: "9999", localite: "VINCENNES" }, // ville résolue mais ABSENTE de villes_geo
  ];
  const commandes = [
    { adresse: "RUE DU PRESSOIR, THIBOUST SERRIS", tranche_code: "1400", montant: 400 },
    { adresse: "6 RUE DU PRESSOIR - SERRIS", tranche_code: "1400", montant: 250 },
    { adresse: "61 PLACE DES CHÊNES, NANDY - ER.37062", tranche_code: null, montant: 100 },
    { adresse: "PLACE DES CORNILLES", tranche_code: "1396", montant: 150 }, // → CHESSY via tranche
    { adresse: "RUE DU PARC", tranche_code: "9999", montant: 80 }, // → VINCENNES, non géocodée
    { adresse: null, tranche_code: null, montant: 50 }, // sans ville
  ];
  const res = calculerVillesFournisseur(commandes, tranches, villesGeo);
  const serris = res.villes.find((v) => v.ville === "SERRIS");
  const nandy = res.villes.find((v) => v.ville === "NANDY");
  const chessy = res.villes.find((v) => v.ville === "CHESSY");
  check(
    "T38 SERRIS 2 commandes / 650 € (adresse + tranche)",
    serris?.commandes === 2 && serris.montant === 650,
  );
  check(
    "T38 NANDY 1 commande / 100 € (ER retiré de l'adresse)",
    nandy?.commandes === 1 && nandy.montant === 100,
  );
  check(
    "T38 CHESSY 1 commande (fallback tranche)",
    chessy?.commandes === 1 && chessy.montant === 150,
  );
  check("T38 tri par nombre de commandes décroissant", res.villes[0]?.ville === "SERRIS");
  check("T38 coordonnées réelles (jamais inventées)", serris?.lat === 48.85 && nandy?.lng === 2.56);
  check(
    "T38 ville résolue mais absente de villes_geo → nonLocalisees, sans coordonnées",
    res.nonLocalisees.includes("VINCENNES") && !res.villes.some((v) => v.ville === "VINCENNES"),
  );
  check(
    "T38 commande sans ville dénombrée, jamais positionnée",
    res.commandesSansVille === 1 && !res.villes.some((v) => v.ville === ""),
  );
  const total = res.villes.reduce((s, v) => s + v.commandes, 0);
  check("T38 total cercles = commandes localisées seulement", total === 4);
}

// ── 39. Tri par DATE chronologique (jamais la chaîne affichée) ───────────────
{
  const c = (dateCommande, dateDemarrage = null) => ({
    date_commande: dateCommande,
    date_demarrage: dateDemarrage,
  });
  const dates = [
    c("2025-02-03"), // 03/02/2025
    c("2025-09-15"), // 15/09/2025
    c("2025-10-02"), // 02/10/2025
    c("Tue Dec 18 2025 23:59:39 GMT+0100"), // 18/12/2025 (chaîne locale JS réelle)
    c(null), // sans date → fin de tri
    c("03/02/2025"), // format français
  ];
  const desc = trierLignes(
    dates,
    (d) => timestampDateCommande(d.date_commande, d.date_demarrage),
    "desc",
  );
  const idxOct = desc.findIndex((d) => d.date_commande === "2025-10-02");
  const idxSep = desc.findIndex((d) => d.date_commande === "2025-09-15");
  const idxFev = desc.findIndex(
    (d) => d.date_commande === "2025-02-03" || d.date_commande === "03/02/2025",
  );
  check(
    "T39 ordre chronologique décroissant 02/10/2025 > 15/09/2025 > 03/02/2025",
    idxOct >= 0 && idxOct < idxSep && idxSep < idxFev,
  );
  check(
    "T39 18/12/2025 (chaîne locale JS) avant les dates de 2025 antérieures",
    desc.findIndex((d) => d.date_commande?.startsWith("Tue Dec")) <
      desc.findIndex((d) => d.date_commande === "2025-10-02"),
  );
  check("T39 dates nulles en fin de tri", desc[desc.length - 1]?.date_commande === null);
  check(
    "T39 date_demarrage en repli quand date_commande absente",
    timestampDateCommande(null, "2026-07-14") === timestampDateCommande("2026-07-14", null),
  );
  check(
    "T39 valeurs non datables → null (jamais d'exception)",
    timestampDateCommande("Aucune", null) === null && timestampDateCommande(null, null) === null,
  );
}

// ── 40. Colonne Tranche : uniquement les 4 chiffres, jamais ER/ville/adresse ──
{
  check(
    "T40 tranche_code 4 chiffres direct",
    trancheDeCommande({ tranche_code: "1400", patrimoine: "ER.T1400" }) === "1400",
  );
  check(
    "T40 patrimoine ER.Txxxx → tranche dérivée",
    trancheDeCommande({ tranche_code: null, patrimoine: "ER.T1400" }) === "1400",
  );
  check(
    "T40 patrimoine ER.Bxxxx.001 → tranche dérivée",
    trancheDeCommande({ tranche_code: null, patrimoine: "ER.B1976.001" }) === "1976",
  );
  check(
    "T40 patrimoine ER.Exxxx.001.004 → tranche dérivée",
    trancheDeCommande({ tranche_code: null, patrimoine: "ER.E1396.001.004" }) === "1396",
  );
  check(
    "T40 ER lot seul (ER.37062) → aucune tranche (jamais d'invention)",
    trancheDepuisPatrimoine("ER.37062") === null,
  );
  check(
    "T40 sans tranche → — (null)",
    trancheDeCommande({ tranche_code: null, patrimoine: null }) === null,
  );
  check(
    "T40 jamais ville/adresse/bâtiment dans la tranche",
    trancheDepuisPatrimoine("61 PLACE DES CHÊNES, NANDY") === null &&
      trancheDepuisPatrimoine("2 RUE DU PRESSOIR") === null,
  );
  check(
    "T40 tranche multi « 1395, 1401 » → codes 4 chiffres",
    trancheDeCommande({ tranche_code: "1395, 1401", patrimoine: null }) === "1395, 1401",
  );
}

console.log(`\n${passed} passé(s), ${failed} échec(s)`);
console.log(`\n${passed} passé(s), ${failed} échec(s)`);
process.exit(failed > 0 ? 1 : 0);
