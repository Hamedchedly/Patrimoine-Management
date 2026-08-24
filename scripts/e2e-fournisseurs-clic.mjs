// Test navigateur RÉEL du clic « nom » et « Ref ISIS » sur la page Fournisseurs.
// Prérequis : serveur dev lancé (npm run dev) avec EXT_SUPABASE_* chargés, sur le port 5173.
// Exécution : node scripts/e2e-fournisseurs-clic.mjs
import { chromium } from "playwright";

const BASE = "http://localhost:5173";
const resultats = [];
const ok = (name, cond) => {
  resultats.push(cond);
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
};

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

  // 1) Ouvre la liste et attend les lignes.
  await page.goto(`${BASE}/fournisseurs`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForSelector("table tbody tr", { timeout: 30000 });

  // 1b) Recherche « Corps d'état » : saisie directe + ENTER (multi-sélection, sans doublon).
  const corpsInput = page.locator('input[aria-label="Rechercher un corps d\'état"]');
  await corpsInput.fill("plomberie");
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () => [...document.querySelectorAll("span")].some((s) => s.textContent === "(o) Plomberie"),
    null,
    { timeout: 10000 },
  );
  ok("saisie « plomberie » + ENTER → première proposition sélectionnée", true);

  await corpsInput.fill("toiture");
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("button")].filter((b) =>
        (b.getAttribute("aria-label") ?? "").startsWith("Retirer "),
      ).length === 2,
    null,
    { timeout: 10000 },
  );
  ok("« toiture » + ENTER → ajouté (plomberie conservé)", true);

  await corpsInput.fill("toiture");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(800);
  const nbBadges = await page.evaluate(
    () =>
      [...document.querySelectorAll("button")].filter((b) =>
        (b.getAttribute("aria-label") ?? "").startsWith("Retirer "),
      ).length,
  );
  ok("ENTER sur une sélection déjà active → aucun doublon", nbBadges === 2);

  // Badges × fonctionnels + remise à zéro du filtre avant la suite.
  await page.locator("button[aria-label='Retirer (o) Plomberie']").click();
  await page.locator("button[aria-label='Retirer (p) Toitures']").click();
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("button")].filter((b) =>
        (b.getAttribute("aria-label") ?? "").startsWith("Retirer "),
      ).length === 0,
    null,
    { timeout: 10000 },
  );
  ok("badges × fonctionnels (sélections retirées)", true);

  // 2) Extraire les hrefs des cellules Ref ISIS (col 1) et Entreprise (col 2).
  const lignes = await page.$$eval("table tbody tr", (rows) =>
    rows
      .map((r) => {
        const cells = r.querySelectorAll("td");
        if (cells.length < 3) return null;
        const ref = cells[1].querySelector("a")?.getAttribute("href") ?? null;
        const nom = cells[2].querySelector("a")?.getAttribute("href") ?? null;
        return { ref, nom };
      })
      .filter((x) => x && (x.ref || x.nom)),
  );
  ok("lignes avec liens présentes", lignes.length > 0);

  const cible = lignes.find((l) => l.nom && l.ref);
  ok("une ligne possède à la fois nom + Ref ISIS cliquables", !!cible);

  if (!cible) {
    console.log("Aucune ligne exploitable — abandon du test de navigation.");
    process.exit(1);
  }

  // 3) Clic sur le NOM → fiche fournisseur.
  await page.locator("table tbody tr").first().locator("td:nth-child(3) a").first().click();
  await page.waitForURL(/\/fournisseurs\/[0-9a-f-]{36}$/, { timeout: 15000 });
  ok("clic NOM → /fournisseurs/<uuid>", /\/fournisseurs\/[0-9a-f-]{36}$/.test(page.url()));
  await page.waitForSelector("h1", { timeout: 10000 });
  ok("fiche chargée (h1 présent)", (await page.locator("h1").textContent()).length > 0);

  // 4) Retour liste, clic sur Ref ISIS → même fiche.
  await page.goto(`${BASE}/fournisseurs`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForSelector("table tbody tr", { timeout: 30000 });
  await page.locator("table tbody tr").first().locator("td:nth-child(2) a").first().click();
  await page.waitForURL(/\/fournisseurs\/[0-9a-f-]{36}$/, { timeout: 15000 });
  ok("clic Ref ISIS → /fournisseurs/<uuid>", /\/fournisseurs\/[0-9a-f-]{36}$/.test(page.url()));
  await page.waitForSelector("h1", { timeout: 10000 });
  ok("fiche Ref ISIS chargée", (await page.locator("h1").textContent()).length > 0);

  // 5) Vérifie que la fiche contient bien la section ACTIVITÉS (après chargement client).
  await page.waitForFunction(
    () => document.body.textContent.includes("DÉTAIL DES ACTIVITÉS"),
    null,
    { timeout: 20000 },
  );
  ok("fiche : section DÉTAIL DES ACTIVITÉS présente", true);
  const h1 = (await page.locator("h1").textContent()) ?? "";
  ok("fiche : nom réel affiché (pas de placeholder)", h1 !== "Fournisseur");
} finally {
  await browser.close();
}

console.log(`\n${resultats.filter(Boolean).length}/${resultats.length} assertions OK`);
process.exit(resultats.every(Boolean) ? 0 : 1);
