/**
 * Source unique des chemins et libellés de navigation.
 *
 * Toute la navigation (barre globale, raccourcis de l'accueil, redirections)
 * doit passer par ces constantes afin d'éviter les divergences de libellés
 * (« Suivi devis » vs « Opérations », « Dashboard annuel » vs « Dashboard travaux »…).
 *
 * Après un renommage d'URL, il suffit de mettre à jour `ROUTES` ici.
 */

/** Chemins canoniques des routes de l'application. */
export const ROUTES = {
  accueil: "/",
  adresses: "/adresses",
  fournisseurs: "/fournisseurs",
  donnees: "/psp-validation",
  preparation: "/preparation-psp",
  pilotage: "/pilotage",
  suivi: "/suivi",
  dashboard: "/dashboard-travaux",
  importPatrimoine: "/import",
  importCmd: "/import-psp",
  importSuivi: "/import-travaux",
} as const;

/** Libellés canoniques affichés dans la navigation et les raccourcis. */
export const LABELS = {
  accueil: "Accueil",
  adresses: "Adresses",
  fournisseurs: "Fournisseurs",
  donnees: "Données CMD",
  preparation: "Préparation PSP",
  pilotage: "Pilotage",
  suivi: "Suivi devis",
  dashboard: "Dashboard annuel",
  importPatrimoine: "Import Patrimoine (ISIS)",
  importCmd: "Import Historique CMD",
  importSuivi: "Import Suivi budgétaire annuel",
} as const;
