/**
 * Formatage d'affichage fr-FR — module PUR (testable en Node, aucune dépendance
 * React / Supabase). Les valeurs sources ne sont JAMAIS modifiées : seule la
 * mise en forme est centralisée, pour Dashboard Travaux, Fournisseurs, Fiche
 * commande partagée et cartes.
 */

/** Montants à 2 décimales (affichage uniquement — valeurs jamais modifiées). */
export function money2(value: unknown): string {
  return typeof value === "number"
    ? new Intl.NumberFormat("fr-FR", {
        style: "currency",
        currency: "EUR",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(value)
    : "—";
}

/** Montants arrondis à l'euro (affichage uniquement — valeurs jamais modifiées). */
export function money0(value: unknown): string {
  return typeof value === "number"
    ? new Intl.NumberFormat("fr-FR", {
        style: "currency",
        currency: "EUR",
        maximumFractionDigits: 0,
      }).format(value)
    : "—";
}

/** Alias typé pour les composants cartes (exige un nombre, format 2 décimales). */
export const moneyCents = (v: number): string => money2(v);

/** Pourcentage ratio → « 12,3 % » (null → « — »). */
export const pct = (v: number | null | undefined): string =>
  v == null ? "—" : `${(v * 100).toFixed(1)} %`;

/**
 * Évolution ratio → « +12 % » / « -8 % » / « 0 % ».
 * Règle métier (Phase 4H) : une évolution nulle reste neutre, sans signe ;
 * null → « — ». Jamais de couleur ici (les couleurs sont gérées par EvoCell).
 */
export const evo = (v: number | null | undefined): string =>
  v == null ? "—" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(0)} %`;
