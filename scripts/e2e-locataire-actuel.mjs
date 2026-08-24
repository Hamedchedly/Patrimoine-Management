// E2E réel — Phase 7A : locataire actuel + fiche logement deep-linkable.
// Prérequis : serveur dev (npm run dev) sur 5173 avec EXT_SUPABASE_* chargés.
// Cas réel : /adresses?lot=ER.26092 → locataire actuel = HAKIM GUENNOUF.
// Lecture seule : aucun INSERT/UPDATE/DELETE, aucune donnée modifiée.
// Exécution : node scripts/e2e-locataire-actuel.mjs
import { chromium } from "playwright";

const BASE = "http://localhost:5173";
const resultats = [];
const ok = (name, cond, detail = "") => {
  resultats.push(cond);
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail && !cond ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });

  // Point de départ : /adresses (entrée d'historique pour le test Back).
  await page.goto(`${BASE}/adresses`, { waitUntil: "networkidle", timeout: 90000 });
  ok("préparation : /adresses chargé", page.url().startsWith(`${BASE}/adresses`));

  // 1) Deep-link direct : la fiche logement doit s'ouvrir automatiquement.
  await page.goto(`${BASE}/adresses?lot=ER.26092`, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForFunction(() => document.body.textContent.includes("Fiche logement"), null, {
    timeout: 30000,
  });
  ok("1. /adresses?lot=ER.26092 → fiche logement ouverte", true);

  // Section « Locataire actuel » présente dans la fiche logement.
  const ficheLogementTxt = await page.evaluate(() => {
    const dlg = [...document.querySelectorAll("[role=dialog]")].find((d) =>
      d.textContent?.includes("Fiche logement"),
    );
    return dlg?.textContent ?? "";
  });
  ok("2. locataire actuel affiché = HAKIM GUENNOUF", ficheLogementTxt.includes("HAKIM GUENNOUF"));
  ok(
    "3. ZACHARIE ETIENNE n'est PAS le locataire actuel",
    !ficheLogementTxt.includes("MR. ETIENNE ZACHARIE") &&
      !ficheLogementTxt.includes("ZACHARIE ETIENNE"),
  );

  // 5) Clic sur le nom du locataire actuel → FicheLocataire.
  await page.getByRole("button", { name: "HAKIM GUENNOUF", exact: true }).click();
  await page.waitForFunction(
    () => {
      const dlg = [...document.querySelectorAll("[role=dialog]")].find((d) =>
        d.textContent?.includes("Occupants enregistrés"),
      );
      return !!dlg;
    },
    null,
    { timeout: 20000 },
  );
  ok("5. clic HAKIM GUENNOUF → FicheLocataire ouverte", true);

  // 4 + 6) La fiche locataire correspond au bon occupant : titre + liste des occupants.
  const ficheLocataireTxt = await page.evaluate(() => {
    const dlg = [...document.querySelectorAll("[role=dialog]")].find((d) =>
      d.textContent?.includes("Occupants enregistrés"),
    );
    return dlg?.textContent ?? "";
  });
  ok(
    "6. fiche locataire = HAKIM GUENNOUF (titre + Entré le 21/02/2022)",
    ficheLocataireTxt.includes("HAKIM GUENNOUF") && ficheLocataireTxt.includes("21/02/2022"),
  );
  ok(
    "4. HAKIM GUENNOUF présent parmi les occupants enregistrés",
    ficheLocataireTxt.includes("HAKIM GUENNOUF"),
  );
  ok(
    "4b. liste occupants complète (GUENNOUF, ETIENNE, SALHI, TOUSSAINT)",
    ["HAKIM GUENNOUF", "ZACHARIE ETIENNE", "KHALED SALHI", "LAETITIA TOUSSAINT"].every((n) =>
      ficheLocataireTxt.includes(n),
    ),
  );

  // 7) Fermeture de la FicheLocataire (Échap) → retour à la fiche logement.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);
  const apresFermetureLocataire = await page.evaluate(() => {
    const dlg = [...document.querySelectorAll("[role=dialog]")].find((d) =>
      d.textContent?.includes("Fiche logement"),
    );
    return dlg?.textContent ?? "";
  });
  ok(
    "7. fermeture FicheLocataire → retour à la fiche logement",
    apresFermetureLocataire.includes("Fiche logement") &&
      apresFermetureLocataire.includes("HAKIM GUENNOUF"),
  );

  // 8) Back → la fiche logement se ferme (retrait de ?lot=).
  await page.goBack({ waitUntil: "networkidle", timeout: 60000 });
  await page.waitForURL(/\/adresses(\?.*)?$/, { timeout: 20000 });
  const urlApresBack = new URL(page.url());
  ok("8. Back → ?lot= retiré de l'URL (fiche fermée)", !urlApresBack.searchParams.has("lot"));
  const ficheLogementFermee = await page.evaluate(() =>
    [...document.querySelectorAll("[role=dialog]")].every(
      (d) => !d.textContent?.includes("Fiche logement"),
    ),
  );
  ok("8b. la fiche logement est fermée après Back", ficheLogementFermee);

  // 9) Aucune navigation vers Dashboard ou Accueil.
  ok(
    "9. URL reste sur /adresses (ni Dashboard ni Accueil)",
    page.url().startsWith(`${BASE}/adresses`),
  );
} finally {
  await browser.close();
}

const fails = resultats.filter((r) => !r).length;
console.log(`\n${resultats.length - fails}/${resultats.length} assertions OK`);
process.exit(fails > 0 ? 1 : 0);
