// Test navigateur RÉEL — fiche fournisseur 5832 (Phase 4E).
// Prérequis : serveur dev (npm run dev) sur 5173 avec EXT_SUPABASE_* chargés.
// Modifie temporairement fournisseur_activites (puis RÉINITIALISE → état propre).
// Aucune donnée source modifiée.
// Exécution : node scripts/e2e-fournisseurs-5832.mjs
import { chromium } from "playwright";

const BASE = "http://localhost:5173";
const resultats = [];
const ok = (name, cond) => {
  resultats.push(cond);
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
};

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1800, height: 1200 } });

  // 1) Liste → fiche 5832.
  await page.goto(`${BASE}/fournisseurs`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForSelector("tbody tr td:nth-child(2) a", { timeout: 30000 });
  const row5832 = page
    .locator("tbody tr")
    .filter({ has: page.locator("td:nth-child(2)").getByText("5832", { exact: true }) })
    .first();
  ok("ligne 5832 présente", (await row5832.count()) === 1);
  await row5832.locator("td:nth-child(2) a").click();
  await page.waitForURL(/\/fournisseurs\/[0-9a-f-]{36}$/, { timeout: 15000 });
  ok("clic Ref ISIS 5832 → fiche", /\/fournisseurs\/[0-9a-f-]{36}$/.test(page.url()));

  await page.waitForFunction(
    () => document.body.textContent.includes("DÉTAIL DES ACTIVITÉS"),
    null,
    { timeout: 20000 },
  );
  const txt = await page.locator("body").innerText();

  // 1b) HISTORIQUE ANNUEL : ordre PAR DÉFAUT décroissant (2026 → 2025 → 2024 → 2023).
  const histTxt = await page.evaluate(() => {
    const all = [...document.querySelectorAll("div")];
    const card = all.find(
      (d) => d.textContent?.includes("HISTORIQUE ANNUEL") && (d.textContent?.length ?? 0) < 800,
    );
    return card?.textContent ?? "";
  });
  const idx2026 = histTxt.indexOf("2026");
  const idx2025 = histTxt.indexOf("2025");
  const idx2024 = histTxt.indexOf("2024");
  const idx2023 = histTxt.indexOf("2023");
  ok(
    "HISTORIQUE ANNUEL DESC : 2026 puis 2025 puis 2024 puis 2023",
    idx2026 >= 0 && idx2026 < idx2025 && idx2025 < idx2024 && idx2024 < idx2023,
  );

  // 1c) PATRIMOINE : carte des villes (leaflet) + légende taille = nombre de commandes.
  ok(
    "section PATRIMOINE — CARTE DES VILLES présente",
    txt.includes("PATRIMOINE — CARTE DES VILLES"),
  );
  await page.waitForSelector(".leaflet-container", { timeout: 20000 });
  ok(
    "carte leaflet rendue (villes géolocalisées)",
    (await page.locator(".leaflet-container").count()) >= 1,
  );
  ok(
    "légende taille ∝ nombre de commandes",
    await page.evaluate(() =>
      document.body.textContent.includes("Taille du cercle ∝ nombre de commandes"),
    ),
  );

  // 1d) Détails textuels du patrimoine MASQUÉS par défaut + bascule.
  ok(
    "bouton discret « Afficher les détails du patrimoine » présent",
    (await page.locator("button", { hasText: "Afficher les détails du patrimoine" }).count()) === 1,
  );
  ok(
    "détails textuels masqués par défaut (pas de « Tranches » / « Bâtiments »)",
    await page.evaluate(
      () =>
        !document.body.textContent.includes("Tranches") &&
        !document.body.textContent.includes("Bâtiments"),
    ),
  );
  await page.getByRole("button", { name: "Afficher les détails du patrimoine" }).click();
  await page.waitForFunction(() => document.body.textContent.includes("Tranches"), null, {
    timeout: 10000,
  });
  ok("bascule → détails du patrimoine affichés", true);
  await page.getByRole("button", { name: "Masquer les détails du patrimoine" }).click();
  await page.waitForFunction(() => !document.body.textContent.includes("Tranches"), null, {
    timeout: 10000,
  });
  ok("bascule → détails masqués à nouveau", true);

  // 1e) KPI : navigation entre années (flèches) + couleurs d'évolution.
  ok(
    "flèches « Année précédente » / « Année suivante » présentes",
    (await page.getByRole("button", { name: "Année précédente" }).count()) === 1 &&
      (await page.getByRole("button", { name: "Année suivante" }).count()) === 1,
  );
  const titreKpi = () =>
    page
      .getByText("KPIs — année", { exact: false })
      .first()
      .textContent()
      .then((t) => t ?? "");
  const titreAvant = await titreKpi();
  const anneeAvant = titreAvant.match(/(\d{4})/)?.[1];
  ok(
    "année par défaut = la plus récente (flèche suivante désactivée)",
    await page.getByRole("button", { name: "Année suivante" }).isDisabled(),
  );
  await page.getByRole("button", { name: "Année précédente" }).click();
  // Attend que le TITRE des KPI change réellement d'année (refetch terminé).
  await page.waitForFunction(
    (a) => {
      const el = [...document.querySelectorAll("h1,h2,h3,h4,div,span,p")].find(
        (x) => /^KPIs — année \d{4}$/.test((x.textContent ?? "").trim()),
      );
      const t = (el?.textContent ?? "").trim();
      const m = t.match(/^KPIs — année (\d{4})$/);
      return m !== null && m[1] !== a;
    },
    anneeAvant,
    { timeout: 15000 },
  );
  const titreAnneePrec = await titreKpi();
  ok(
    "flèche précédente → KPI recalculés pour l'année précédente (titre mis à jour)",
    titreAnneePrec !== titreAvant && /KPIs — année 20\d\d/.test(titreAnneePrec),
  );
  await page.getByRole("button", { name: "Année suivante" }).click();
  await page.waitForFunction(
    (a) => {
      const el = [...document.querySelectorAll("h1,h2,h3,h4,div,span,p")].find(
        (x) => /^KPIs — année \d{4}$/.test((x.textContent ?? "").trim()),
      );
      const t = (el?.textContent ?? "").trim();
      return t === `KPIs — année ${a}`;
    },
    anneeAvant,
    { timeout: 15000 },
  );
  ok("flèche suivante → retour à l'année la plus récente", (await titreKpi()) === titreAvant);

  // Couleurs : évolution positive → vert, négative → rouge (jamais pour un montant).
  const couleursEvo = await page.evaluate(() => {
    const spans = [...document.querySelectorAll("span")];
    const texte = (el) => el.textContent ?? "";
    return {
      vert: spans.some(
        (s) =>
          (s.getAttribute("class") ?? "").includes("text-emerald-600") &&
          /[+-]?[0-9.,]+\s*%/.test(texte(s)),
      ),
      rouge: spans.some(
        (s) =>
          (s.getAttribute("class") ?? "").includes("text-red-600") &&
          /[+-]?[0-9.,]+\s*%/.test(texte(s)),
      ),
    };
  });
  ok(
    "KPI : évolution positive en vert / négative en rouge (2026 : +50 % / −85 %)",
    couleursEvo.vert && couleursEvo.rouge,
  );

  // 2) Activités visibles + Etanchéité analysée en Principal (scoring).
  ok("Activités principales visibles", txt.includes("ACTIVITÉS PRINCIPALES"));
  ok("Etanchéité présente", txt.includes("(u) Etanchéité"));
  const etanchRow = page.locator("tbody tr").filter({ hasText: "(u) Etanchéité" }).first();
  ok("Etanchéité → Principal (scoring réel)", (await etanchRow.innerText()).includes("Principal"));

  // 3) Tri de la table activités (desc sur Commandes → Couvertures(33) d'abord).
  await page.locator("th", { hasText: "Commandes" }).first().click();
  const rowsCmd = await page.locator("tbody tr").allInnerTexts();
  const idxE = rowsCmd.findIndex((t) => t.includes("(u) Etanchéité"));
  const idxC = rowsCmd.findIndex((t) => t.includes("(j) Couvertures"));
  ok(
    "tri activités : Commandes desc → Couvertures(33) avant Etanchéité(11)",
    idxC >= 0 && idxE > idxC,
  );
  ok("indicateur ↓ présent", (await page.locator("th", { hasText: "Commandes ↓" }).count()) > 0);

  // 4) Modifier : sélecteur explicite du niveau (q) Menuiseries ext → Principal.
  await page.getByRole("button", { name: "Modifier les activités" }).click();
  await page.waitForFunction(
    () => document.body.textContent.includes("Ajouter un corps d'état"),
    null,
    { timeout: 10000 },
  );

  const menuRow = page.locator("tbody tr").filter({ hasText: "(q) Menuiseries ext" }).first();
  const trigger = menuRow.locator("[role='combobox']").first();
  await trigger.click();
  await page.getByRole("option", { name: "Principal", exact: true }).last().click();
  await page.waitForFunction(
    () => {
      const rows = [...document.querySelectorAll("tbody tr")];
      const r = rows.find((x) => x.textContent.includes("(q) Menuiseries ext"));
      return r && r.querySelector("svg.lucide-info") !== null;
    },
    null,
    { timeout: 15000 },
  );
  ok("(q) Menuiseries ext → Principal + icône Ajustement discrète", true);

  // 4b) Icône Ajustement : tooltip explicite au survol (Modification manuelle).
  const iconeAjust = menuRow.locator("svg.lucide-info").first();
  await iconeAjust.hover();
  await page.waitForFunction(
    () =>
      document.body.textContent.includes("Modification manuelle — niveau défini par l'utilisateur"),
    null,
    { timeout: 10000 },
  );
  ok("tooltip Ajustement : « Modification manuelle — niveau défini par l'utilisateur »", true);
  await page.keyboard.press("Escape");

  // 5) Ajout d'un corps d'état réel sans historique → (a) Maçonnerie Principal.
  await page.locator("input[placeholder*='Rechercher un corps']").fill("Maçonnerie");
  await page.locator("button").filter({ hasText: "(a) Maçonnerie" }).first().click();
  await page.waitForFunction(
    () => {
      const rows = [...document.querySelectorAll("tbody tr")];
      return rows.some(
        (x) =>
          x.textContent.includes("(a) Maçonnerie") &&
          x.textContent.includes("0") &&
          x.querySelector("svg.lucide-info") !== null,
      );
    },
    null,
    { timeout: 15000 },
  );
  ok("(a) Maçonnerie ajouté (0 commande, icône Ajustement)", true);

  // 5b) Tooltip « Ajout manuel » pour le corps sans historique.
  const iconeMaçon = page
    .locator("tbody tr")
    .filter({ hasText: "(a) Maçonnerie" })
    .first()
    .locator("svg.lucide-info")
    .first();
  await iconeMaçon.hover();
  await page.waitForFunction(
    () =>
      document.body.textContent.includes("Ajout manuel — corps d'état ajouté par l'utilisateur"),
    null,
    { timeout: 10000 },
  );
  ok("tooltip Ajustement : « Ajout manuel — corps d'état ajouté par l'utilisateur »", true);
  await page.keyboard.press("Escape");
  ok("aucun texte « Manuel » permanent dans la colonne Ajustement", !txt.includes("Manuel"));

  // 6) Réinitialisation (comparaison puis suppression des overrides).
  await page.getByRole("button", { name: "Réinitialiser les niveaux" }).click();
  await page.waitForFunction(
    () => document.body.textContent.includes("Réinitialiser les niveaux d'activité ?"),
    null,
    { timeout: 10000 },
  );
  const resetTxt = await page.locator("body").innerText();
  ok(
    "aperçu comparaison (Actuel / Calcul automatique)",
    resetTxt.includes("Calcul automatique") && resetTxt.includes("Aucun historique"),
  );
  await page.getByRole("button", { name: "Réinitialiser", exact: true }).click();
  await page.waitForFunction(
    () => {
      const rows = [...document.querySelectorAll("tbody tr")];
      return (
        !rows.some((x) => x.textContent.includes("(a) Maçonnerie")) &&
        !rows.some(
          (x) =>
            x.textContent.includes("(q) Menuiseries ext") &&
            x.textContent.includes("Ajustement") &&
            x.textContent.includes("Manuel"),
        )
      );
    },
    null,
    { timeout: 15000 },
  );
  ok("réinitialisation : overrides supprimés, Maçonnerie retirée, auto reprend", true);

  // 7) Table des commandes : colonnes + Tranche + Description + tri date + filtre État.
  ok("colonne Catégorie présente", txt.includes("Catégorie"));
  const headers = await page
    .locator("section, main")
    .filter({ hasText: "COMMANDES" })
    .last()
    .locator("th")
    .allInnerTexts();
  ok(
    "colonnes Patrimoine et Adresse distinctes (plus de « Patrimoine / Adresse »)",
    headers.some((h) => h.includes("Patrimoine")) &&
      headers.some((h) => h.includes("Adresse")) &&
      !headers.some((h) => h.includes("Patrimoine / Adresse")),
  );
  ok(
    "colonne Tranche présente",
    headers.some((h) => h.includes("Tranche")),
  );
  ok(
    "colonne Description présente",
    headers.some((h) => h.includes("Description")),
  );
  ok("aucune colonne « Niveau manuel »", !txt.includes("Niveau manuel"));

  const cmdTable = page.locator("table").filter({ hasText: "Montant engagé" });
  const patLink = cmdTable.locator("a[href*='/adresses']").first();
  await patLink.waitFor({ state: "attached", timeout: 10000 });
  const patHref = await patLink.getAttribute("href");
  ok(
    "Patrimoine cliquable → /adresses avec identifiant précis",
    !!patHref &&
      patHref.includes("/adresses") &&
      (patHref.includes("rue=") || patHref.includes("tranche=") || patHref.includes("q=")),
  );
  ok(
    "l'adresse affichée ne contient plus de code ER",
    (await cmdTable.locator("td:nth-child(8)").allInnerTexts()).every((v) => !v.includes("ER.")),
  );

  // Tranche : uniquement des codes à 4 chiffres (jamais ER/ville/adresse).
  const trancheCells = await cmdTable.locator("td:nth-child(6)").allInnerTexts();
  ok(
    "colonne Tranche : uniquement des codes à 4 chiffres",
    trancheCells.length > 0 &&
      trancheCells.every((v) => v.trim() === "—" || /^\d{4}(, \d{4})*$/.test(v.trim())),
  );

  // Description : présence d'un descriptif réel (issu de la vue / des sources).
  const descCells = await cmdTable.locator("td:nth-child(3)").allInnerTexts();
  ok(
    "colonne Description : descriptif réel présent",
    descCells.some((v) => v.trim().length > 4 && v.trim() !== "—"),
  );

  // Tri par date : 1er clic → chronologique décroissant (jamais alphabétique).
  await cmdTable.locator("th").filter({ hasText: "Date" }).first().click();
  await page.waitForTimeout(700);
  const parseDate = (s) => {
    const t = s.trim();
    let m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(t);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
    return m ? t.slice(0, 10) : null;
  };
  const datesValides = (await cmdTable.locator("td:nth-child(1)").allInnerTexts())
    .map(parseDate)
    .filter(Boolean);
  ok(
    "tri Date : ordre chronologique décroissant (02/2025 < 09/2025 < 10/2025 …)",
    datesValides.length >= 3 && datesValides.every((d, i) => i === 0 || d <= datesValides[i - 1]),
  );

  // Filtre État : liste construite depuis les états réellement présents + filtrage + reset.
  await cmdTable.locator("button[title='Filtrer par état']").click();
  await page.waitForFunction(() => document.body.textContent.includes("Filtrer par état"), null, {
    timeout: 10000,
  });
  const etatListe = await page.evaluate(() => {
    const labels = [...document.querySelectorAll("div")].find(
      (d) => d.textContent?.includes("Filtrer par état") && (d.textContent?.length ?? 0) < 400,
    );
    return labels?.textContent ?? "";
  });
  ok(
    "filtre État : états réellement présents (Close, Attente validation)",
    etatListe.includes("Close") && etatListe.includes("Attente validation"),
  );
  await page
    .locator("label")
    .filter({ hasText: "Close" })
    .locator("button[role='checkbox']")
    .first()
    .click();
  await page.waitForTimeout(700);
  const etatsAffichés = await cmdTable.locator("td:nth-child(10)").allInnerTexts();
  ok(
    "filtre État : sélection « Close » → seules les lignes Close restent",
    etatsAffichés.length > 0 && etatsAffichés.every((v) => v.trim() === "Close"),
  );
  // Le popover reste ouvert après la sélection : « Effacer le filtre » directement.
  await page.getByRole("button", { name: "Effacer le filtre" }).click();
  await page.waitForTimeout(700);
  ok(
    "filtre État : Effacer → toutes les lignes reviennent",
    (await cmdTable.locator("tbody tr").count()) >= 55,
  );
  await page.keyboard.press("Escape"); // ferme le popover avant la suite.

  // 8) Clic sur un numéro de commande → fiche commande EN OVERLAY (même page, aucune navigation).
  //    Cible stable : la commande suivi 5061140 (année 2026, présente dans travaux_commandes,
  //    dans la vue enrichie ET dans le journal du Dashboard par défaut → parité vérifiable).
  const urlFicheAvant = page.url();
  const numBtn = cmdTable
    .locator("tbody tr")
    .filter({ hasText: "5061140" })
    .first()
    .locator("button[title*='Ouvrir la fiche commande']")
    .first();
  await numBtn.click();
  await page.waitForFunction(() => document.body.textContent.includes("Fiche Commande #"), null, {
    timeout: 15000,
  });
  ok("clic Commande # → fiche commande en overlay", true);
  const pathFicheAvant = new URL(urlFicheAvant).pathname;
  ok(
    "aucune navigation (overlay piloté par ?cmd= : même page fiche fournisseur)",
    new URL(page.url()).pathname === pathFicheAvant &&
      /\/fournisseurs\/[0-9a-f-]{36}$/.test(new URL(page.url()).pathname) &&
      page.url().includes("cmd="),
  );
  await page.waitForFunction(() => document.body.textContent.includes("Descriptif complet"), null, {
    timeout: 15000,
  });
  ok("fiche commande : descriptif complet visible", true);

  // 8a) PARITÉ TOTALE : la fiche ouverte depuis Fournisseur doit afficher TOUTES les
  //     sections et données réelles de la commande (même modèle que le Dashboard),
  //     uniquement en lecture seule.
  const titreFicheFournisseur = await page.evaluate(
    () => document.querySelector("[role='dialog'] h2")?.textContent ?? "",
  );
  const mNumFiche = /Fiche Commande #(\S+)/.exec(titreFicheFournisseur);
  const numCommandeFournisseur = mNumFiche?.[1] ?? "";
  ok("numéro de commande extrait de la fiche fournisseur", numCommandeFournisseur !== "");
  const ficheTxtFournisseur = await page.evaluate(
    () => document.querySelector("[role='dialog']")?.textContent ?? "",
  );
  ok(
    "fiche fournisseur : en-tête complet (Type, Tranche, ID Lot, État, Prog., Année)",
    ficheTxtFournisseur.includes("Type") &&
      ficheTxtFournisseur.includes("Tranche") &&
      ficheTxtFournisseur.includes("ID Lot") &&
      ficheTxtFournisseur.includes("État") &&
      ficheTxtFournisseur.includes("Prog.") &&
      ficheTxtFournisseur.includes("Année"),
  );
  ok(
    "fiche fournisseur : sections Localisation & Nature / Intervenants / Finance présentes",
    ficheTxtFournisseur.includes("Localisation & Nature") &&
      ficheTxtFournisseur.includes("Intervenants") &&
      ficheTxtFournisseur.includes("Finance"),
  );
  ok(
    "fiche fournisseur : Historique CMD + Rapprochement présents (données PSP)",
    ficheTxtFournisseur.includes("Historique CMD") && ficheTxtFournisseur.includes("Rapprochement"),
  );
  ok(
    "fiche fournisseur : descriptif RÉEL affiché (pas « Aucun descriptif renseigné »)",
    !ficheTxtFournisseur.includes("Aucun descriptif renseigné"),
  );
  ok(
    "fiche fournisseur : montants 2 décimales affichés (Finance / Historique CMD)",
    /[\d\s]*,\d{2}\s*€/.test(ficheTxtFournisseur),
  );
  ok(
    "fiche fournisseur : lecture seule (aucun bouton MODIFIER)",
    (await page.locator("[role='dialog'] button", { hasText: "MODIFIER" }).count()) === 0,
  );

  // 8b) Z-INDEX : la carte est isolée et le Dialog est AU-DESSUS de tout.
  const zIndexOk = await page.evaluate(() => {
    const dialog = document.querySelector("[role='dialog']");
    const leaflet = document.querySelector(".leaflet-container");
    if (!dialog || !leaflet) return { ok: false, raison: "dialog ou leaflet absent" };
    const wrapper = leaflet.closest(".isolate");
    const iso = wrapper ? getComputedStyle(wrapper).isolation : "";
    return { ok: iso === "isolate", raison: `isolation=${iso || "aucun"}` };
  });
  ok("carte isolée (stacking context `isolate`) — jamais au-dessus du Dialog", zIndexOk.ok);

  const auDessus = await page.evaluate(() => {
    const dialog = document.querySelector("[role='dialog']");
    const rect = dialog?.getBoundingClientRect();
    if (!rect) return false;
    const el = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return !!el && dialog.contains(el);
  });
  ok("Dialog au-dessus de la carte (point centré = contenu du Dialog)", auDessus);

  // 8c) DESIGN PARTAGÉ : mêmes classes de fiche que le Dashboard (max-w-5xl / max-h-[90vh]).
  const classesFiche = await page.evaluate(() => {
    const d = document.querySelector("[role='dialog']");
    return d?.getAttribute("class") ?? "";
  });
  ok(
    "fiche commande : mêmes dimensions que le Dashboard (max-w-5xl, max-h-[90vh])",
    classesFiche.includes("max-w-5xl") && classesFiche.includes("max-h-[90vh]"),
  );
  await page.getByRole("button", { name: "FERMER LA FICHE" }).click();
  await page.waitForFunction(() => !document.body.textContent.includes("Fiche Commande #"), null, {
    timeout: 15000,
  });
  ok("fermeture → retour exact à la fiche fournisseur (même URL)", page.url() === urlFicheAvant);

  // La carte reste interactive après fermeture (isolate ≠ blocage des interactions).
  const carteReactive = await page.evaluate(() => {
    const l = document.querySelector(".leaflet-container");
    return !!l && getComputedStyle(l).pointerEvents !== "none";
  });
  ok("fermeture → la carte reste interactive (aucun blocage)", carteReactive);

  // 9) Clic sur un patrimoine → ouvre LE patrimoine précis dans /adresses (comme la
  //    navigation interne d'/adresses : ville + tranche + rue → Niveau Lots).
  // Cible stable : la ligne « RUE DU PRESSOIR » (indépendante du tri en cours).
  const patLinkPrecis = cmdTable
    .locator("tbody tr")
    .filter({ hasText: "RUE DU PRESSOIR, THIBOUST SERRIS" })
    .first()
    .locator("a[href*='/adresses']")
    .first();
  await patLinkPrecis.click();
  await page.waitForURL(/\/adresses/, { timeout: 15000 });
  ok("clic patrimoine → route /adresses", page.url().includes("/adresses"));
  await page.waitForFunction(() => document.body.textContent.includes("Bâtiment / Porte"), null, {
    timeout: 15000,
  });
  ok("fiche patrimoine précise rendue (lots de l'adresse)", true);

  // 9b) PATRIMOINE → COMMANDE : depuis les travaux d'une tranche, « Commande # » ouvre la
  //     fiche commande en OVERLAY (même composant, readOnly, contexte /adresses conservé).
  await page.goto(`${BASE}/adresses?ville=CHAUMES-EN-BRIE`, {
    waitUntil: "networkidle",
    timeout: 60000,
  });
  await page.waitForTimeout(2000);
  await page.locator("button[title='Voir les travaux de la tranche']").first().click();
  await page.waitForFunction(() => document.body.textContent.includes("Commande #"), null, {
    timeout: 15000,
  });
  ok("patrimoine → travaux : bouton « Commande # » présent (ancien lien cassé remplacé)", true);
  await page.locator("button", { hasText: "Commande #" }).first().click();
  await page.waitForFunction(() => document.body.textContent.includes("Fiche Commande #"), null, {
    timeout: 15000,
  });
  ok(
    "patrimoine → clic Commande # → fiche commande EN OVERLAY (lecture seule)",
    (await page.locator("[role='dialog'] button", { hasText: "MODIFIER" }).count()) === 0,
  );
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.body.textContent.includes("Fiche Commande #"), null, {
    timeout: 10000,
  });
  ok(
    "patrimoine → fiche fermée → contexte /adresses conservé (même URL)",
    page.url().includes("/adresses"),
  );

  // 10) PARITÉ RÉELLE : ouvrir dans le Dashboard la MÊME commande que celle ouverte
  //     depuis le Fournisseur (5061140, année 2026 → présente dans le journal par défaut)
  //     et comparer sections / données / montants.
  await page.goto(`${BASE}/dashboard-travaux`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForSelector("table tbody tr", { timeout: 30000 });
  // Recherche Rapide : isole la commande (le journal est paginé par défaut à 20 lignes).
  await page.locator("input[placeholder*='CMD']").fill(numCommandeFournisseur);
  await page.waitForTimeout(700);
  const journal = page
    .locator("table")
    .filter({ has: page.locator("th").getByText("N° Commande") });
  await journal
    .locator("tbody tr")
    .filter({ hasText: numCommandeFournisseur })
    .first()
    .locator("button")
    .first()
    .click();
  await page.waitForFunction(() => document.body.textContent.includes("Fiche Commande #"), null, {
    timeout: 20000,
  });
  const classesDash = await page.evaluate(
    () => document.querySelector("[role='dialog']")?.getAttribute("class") ?? "",
  );
  ok("Dashboard : fiche commande ouverte (composant partagé)", true);
  ok(
    "Dashboard : même commande ouverte que Fournisseur (#" + numCommandeFournisseur + ")",
    (
      await page.evaluate(() => document.querySelector("[role='dialog'] h2")?.textContent ?? "")
    ).includes(numCommandeFournisseur),
  );
  ok(
    "Dashboard & Fournisseur : mêmes classes de fiche (max-w-5xl, max-h-[90vh], rounded-3xl)",
    classesDash.includes("max-w-5xl") &&
      classesDash.includes("max-h-[90vh]") &&
      classesDash.includes("rounded-3xl") &&
      classesDash === classesFiche,
  );
  await page.waitForFunction(() => document.body.textContent.includes("Rapprochement"), null, {
    timeout: 15000,
  });
  const bodyDash = await page.evaluate(
    () => document.querySelector("[role='dialog']")?.textContent ?? "",
  );
  ok(
    "Dashboard : sections Rapprochement / Finance + footer FERMER LA FICHE",
    bodyDash.includes("Rapprochement") &&
      bodyDash.includes("Finance") &&
      bodyDash.includes("FERMER LA FICHE"),
  );
  // PARITÉ de contenu : mêmes sections, mêmes montants (mêmes données chargées).
  ok(
    "PARITÉ : mêmes sections dans Dashboard et Fournisseur (Historique CMD, Rapprochement, Finance, Localisation & Nature, Intervenants)",
    ["Historique CMD", "Rapprochement", "Finance", "Localisation & Nature", "Intervenants"].every(
      (s) => bodyDash.includes(s) && ficheTxtFournisseur.includes(s),
    ),
  );
  const montantsFournisseur = [...ficheTxtFournisseur.matchAll(/[\d\s]*,\d{2}\s*€/g)].map(
    (m) => m[0],
  );
  const montantsDash = [...bodyDash.matchAll(/[\d\s]*,\d{2}\s*€/g)].map((m) => m[0]);
  ok(
    "PARITÉ montants : chaque montant affiché côté Fournisseur est identique dans le Dashboard",
    montantsFournisseur.length > 0 && montantsFournisseur.every((v) => montantsDash.includes(v)),
  );
  await page.getByRole("button", { name: "FERMER LA FICHE" }).click();

  // 11) SCÉNARIO FINAL DE NAVIGATION (Phase 6B) — Accueil → Pilotage → Sourcing →
  //     recherche fournisseur → fiche → commande overlay → fermer → patrimoine → retour
  //     → retour liste, en vérifiant la conservation de tous les contextes.
  await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForSelector("nav", { timeout: 15000 });
  await page.getByRole("link", { name: /Pilotage/ }).first().click();
  await page.waitForURL(/\/dashboard-travaux/, { timeout: 20000 });
  ok("Accueil → barre globale → Pilotage (dashboard)", page.url().includes("/dashboard-travaux"));
  await page.getByRole("link", { name: /Sourcing/ }).first().click();
  await page.waitForURL(/\/fournisseurs($|\?)/, { timeout: 20000 });
  ok("barre globale → Sourcing (liste fournisseurs)", /\/fournisseurs($|\?)/.test(page.url()));
  // Recherche fournisseur → filtres persistés dans l'URL (?q=)
  await page.locator("input[placeholder*='Dupont']").first().fill("5832");
  await page.waitForTimeout(1500);
  ok(
    "recherche fournisseur → ?q=5832 dans l'URL",
    await page.evaluate(() => decodeURIComponent(window.location.href).includes("5832")),
  );
  const ficheLink = page.locator("tbody a[href*='/fournisseurs/']").first();
  await ficheLink.click();
  await page.waitForURL(/\/fournisseurs\/[0-9a-f-]{36}$/, { timeout: 20000 });
  await page.waitForFunction(() => document.body.textContent.includes("COMMANDES"), null, {
    timeout: 20000,
  });
  // Commande en overlay (pilotée par l'URL ?cmd=) puis fermeture (retire cmd, garde annee)
  const cmdTableNav = page.locator("table").filter({ hasText: "Montant engagé" });
  const numBtnNav = cmdTableNav
    .locator("tbody tr")
    .filter({ hasText: "5061140" })
    .first()
    .locator("button[title*='Ouvrir la fiche commande']")
    .first();
  await numBtnNav.click();
  await page.waitForFunction(() => document.body.textContent.includes("Fiche Commande #"), null, {
    timeout: 15000,
  });
  ok("fiche fournisseur → commande overlay (URL ?cmd=)", page.url().includes("cmd="));
  await page.getByRole("button", { name: "FERMER LA FICHE" }).click();
  await page.waitForFunction(
    () => !document.body.textContent.includes("Fiche Commande #"),
    null,
    { timeout: 10000 },
  );
  ok("commande fermée → overlay refermé, URL sans cmd", !page.url().includes("cmd="));
  // Patrimoine (overlay/URL ?retour=) ← puis retour explicite vers la fiche
  const patLinkNav = cmdTableNav
    .locator("tbody tr")
    .filter({ hasText: "RUE DU PRESSOIR, THIBOUST SERRIS" })
    .first()
    .locator("a[href*='/adresses']")
    .first();
  await patLinkNav.click();
  await page.waitForURL(/\/adresses/, { timeout: 20000 });
  ok("fiche → patrimoine (URL /adresses?retour= provenance)", page.url().includes("retour="));
  await page.getByRole("link", { name: "← Fiche fournisseur" }).first().click();
  await page.waitForURL(/\/fournisseurs\/[0-9a-f-]{36}/, { timeout: 20000 });
  ok("patrimoine → retour explicite vers la fiche fournisseur", true);
  // Retour liste → filtres restaurés (sessionStorage) conservés dans l'URL
  await page.getByRole("link", { name: "Retour" }).click();
  await page.waitForURL(/\/fournisseurs($|\?)/, { timeout: 20000 });
  await page.waitForTimeout(1500);
  ok("fiche → retour liste fournisseur", /\/fournisseurs($|\?)/.test(page.url()));
  ok(
    "filtres de recherche conservés au retour liste (?q=)",
    decodeURIComponent(page.url()).includes("5832"),
  );
} finally {
  await browser.close();
}

console.log(`\n${resultats.filter(Boolean).length}/${resultats.length} assertions OK`);
process.exit(resultats.every(Boolean) ? 0 : 1);
