/**
 * V8.20 — Capture d'écran (html-to-image).
 * Isolée dans son propre module pour :
 *  · un import STATIQUE d'`html-to-image` (les imports dynamiques de dépendances
 *    optimisées échouent sous Vite — « Failed to fetch dynamically imported module ») ;
 *  · être chargée paresseusement (chunk séparé, aucune évaluation navigateur au SSR).
 * html-to-image rasterise via SVG <foreignObject> → supporte les couleurs modernes
 * (oklch de Tailwind 4) là où html2canvas échouait.
 *
 * Robustesse : on exclut du cliché les éléments qui feraient HANGER ou échouer la
 * capture (carte Leaflet + ses tuiles/images externes, canvas, iframes, CSS externes
 * type Google Fonts) ; on saute l'embarquement des polices (cross-origin) et on borne
 * la capture à 8 s (repli → null = contexte texte seul).
 */
import { toPng } from "html-to-image";

const DELAI_MAX_CAPTURE_MS = 8_000;

/** Exclut les sous-arbres/éléments non capturables ou superflus. */
const horsChamp = (node: Node): boolean => {
  if (!(node instanceof HTMLElement)) return true; // conserver texte etc.
  // Bouton flottant « Signaler » lui-même.
  if (node.dataset?.["bugReport"] === "true") return false;
  // Carte Leaflet et tout ce qui est dans un conteneur de carte.
  if (node.classList?.contains("leaflet-container")) return false;
  if (node.closest?.(".leaflet-container")) return false;
  // Médias dont la source est EXTERNE (tuiles, images, canvas, iframes) → hors champ
  // (CORS / fetch sans timeout → capture qui ne se termine pas).
  if (
    node.tagName === "IMG" ||
    node.tagName === "CANVAS" ||
    node.tagName === "IFRAME" ||
    node.tagName === "VIDEO" ||
    node.tagName === "AUDIO"
  ) {
    const src =
      (node as HTMLImageElement).src ||
      (node as HTMLIFrameElement).src ||
      (node as HTMLVideoElement).src ||
      "";
    if (src && !src.startsWith("data:")) return false;
  }
  // Feuilles de style EXTERNES (ex. Google Fonts) → hors champ (lecture CORS impossible).
  if (node.tagName === "LINK") {
    const href = (node as HTMLLinkElement).href || "";
    if (href && !href.startsWith(window.location.origin)) return false;
  }
  return true;
};

export const capturePage = async (): Promise<string | null> => {
  try {
    const capture = toPng(document.body, {
      pixelRatio: 0.6,
      backgroundColor: "#ffffff",
      cacheBust: false,
      skipFonts: true,
      filter: (node) => horsChamp(node),
    });
    // Garde-fou : ne jamais bloquer le formulaire plus que nécessaire.
    const minuteur = new Promise<string | null>((resolve) => {
      window.setTimeout(() => resolve(null), DELAI_MAX_CAPTURE_MS);
    });
    return await Promise.race([capture, minuteur]);
  } catch (e) {
    console.error("[bug.capture] toPng", e);
    return null;
  }
};
