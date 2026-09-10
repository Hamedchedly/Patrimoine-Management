/**
 * Fournisseurs — Socle logique PUR (aucune dépendance Supabase / Vite / React).
 * Testable en Node (type stripping), comme psp.validation.ts.
 *
 * Le référentiel fournisseur est une couche d'ENRICHISSEMENT manuel :
 *   SOURCE (travaux_commandes, psp_import_rows, ISIS, Excel) → RELATION / ENRICHISSEMENT → AFFICHAGE
 * Les données sources restent STRICTEMENT immuables. Aucune écriture ici.
 */

/** Source d'un identifiant fournisseur (deux espaces distincts observés). */
export type SourceFournisseur = "travaux_commandes" | "psp_import_rows";

export interface Fournisseur {
  id: string;
  nom: string;
  adresse: string | null;
  complement_adresse: string | null;
  code_postal: string | null;
  ville: string | null;
  pays: string | null;
  site_web: string | null;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface FournisseurContact {
  id: string;
  fournisseur_id: string;
  nom: string;
  fonction: string | null;
  email: string | null;
  telephone: string | null;
  ordre: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface FournisseurAlias {
  id: string;
  fournisseur_id: string;
  source: SourceFournisseur;
  identifiant_source: string;
}

/** Ligne de liste (avec agrégats commandes + identifiants sources). */
export interface FournisseurRow extends Fournisseur {
  identifiants: string[];
  nb_commandes: number;
  total_engage: number;
  nb_commandes_historique: number;
  total_historique: number;
}

/** Commande liée à un fournisseur (suivi + Historique CMD + patrimoine). */
export interface CommandeFournisseur {
  id: string | null;
  numero_commande: string;
  date_commande: string | null;
  date_demarrage: string | null;
  annee: number | null;
  corps_etat: string | null;
  nature_travaux: string | null;
  /** Catégorie analytique du suivi annuel (GE / GT / CP / AC / HO…). */
  categorie: string | null;
  descriptif: string | null;
  tranche_code: string | null;
  batiment: string | null;
  entree: string | null;
  lot_code: string | null;
  adresse: string | null;
  patrimoine: string | null;
  patrimoine_ambigu: boolean;
  /** Ville canonique (même résolution que le Dashboard : adresse puis tranche). */
  ville: string | null;
  montant: number | null;
  montant_type: "engage" | "psp_montant_engage" | "aucun";
  etat: string | null;
  fournisseur_source_code: string | null;
}

export interface KpiFournisseur {
  total_commandes: number;
  total_montant: number;
  par_annee: { annee: string; commandes: number; montant: number }[];
  par_corps_etat: { corps_etat: string; commandes: number; montant: number }[];
  dernieres: CommandeFournisseur[];
}

/** Normalise un identifiant fournisseur (espaces retirés) — ne modifie jamais la source. */
export function normaliserCodeFournisseur(code: string | null | undefined): string {
  return (code ?? "").trim().replace(/\s+/g, "");
}
/** Tous les identifiants d'un fournisseur, issus UNIQUEMENT de `fournisseur_aliases`.
 * Le fournisseur est identifié par son UUID interne ; chaque source (travaux_commandes,
 * psp_import_rows / Historique CMD, futures sources) peut porter un identifiant différent
 * pointant vers le même fournisseur, sans modifier aucune donnée source.
 */
export function monterIdentifiantsFournisseur(aliases: FournisseurAlias[]): string[] {
  const set = new Set<string>();
  for (const a of aliases) {
    const idn = normaliserCodeFournisseur(a.identifiant_source);
    if (idn) set.add(idn);
  }
  return [...set];
}

/**
 * Ref ISIS = identifiant du suivi annuel (alias source 'travaux_commandes').
 * Jamais inventée : provient UNIQUEMENT de fournisseur_aliases.
 */
export function refIsisDepuisAliases(aliases: FournisseurAlias[]): string | null {
  const a = aliases.find((x) => x.source === "travaux_commandes");
  return normaliserCodeFournisseur(a?.identifiant_source) || null;
}

/**
 * Nom temporaire utilisé lors de la création d'une fiche depuis une Ref ISIS
 * (nom réel inconnu). Il n'est JAMAIS présenté comme le vrai nom de l'entreprise :
 * partout où un nom doit être affiché, `libelleEntreprise` le remplace par
 * « Entreprise non renseignée ».
 */
export const NOM_A_RENSEIGNER = "À renseigner";

/** Vrai si le nom stocké n'est pas un nom réel (placeholder de fiche non renseignée). */
export function estNomARenseigner(nom: string | null | undefined): boolean {
  const n = (nom ?? "").trim();
  return n === "" || n === NOM_A_RENSEIGNER || n.startsWith(`${NOM_A_RENSEIGNER} —`);
}

/** Nom à afficher : le vrai nom s'il est renseigné, sinon « Entreprise non renseignée ». */
export function libelleEntreprise(nom: string | null | undefined): string {
  return estNomARenseigner(nom) ? "Entreprise non renseignée" : (nom ?? "").trim();
}

/** Recherche par nom d'entreprise OU par code (canonique ou alias). */
export function rechercherFournisseurs<T extends { id: string; nom: string }>(
  fournisseurs: T[],
  aliasesParFournisseur: Map<string, FournisseurAlias[]>,
  query: string,
): T[] {
  const q = (query ?? "").trim().toLowerCase();
  if (!q) return fournisseurs;
  return fournisseurs.filter((f) => {
    if (f.nom.toLowerCase().includes(q)) return true;
    const ids = monterIdentifiantsFournisseur(aliasesParFournisseur.get(f.id) ?? []);
    return ids.some((code) => code.toLowerCase().includes(q));
  });
}

/**
 * Correspondance d'une recherche sur une ligne de liste (nom OU Ref ISIS OU alias).
 * La recherche Ref ISIS fonctionne même si le nom n'est pas encore renseigné.
 */
export function matchRechercheEntreprise(
  nom: string,
  refIsis: string | null,
  identifiants: string[],
  query: string,
): boolean {
  const q = (query ?? "").trim().toLowerCase();
  if (!q) return true;
  if (nom.toLowerCase().includes(q)) return true;
  if (refIsis && refIsis.toLowerCase().includes(q)) return true;
  return identifiants.some((code) => code.toLowerCase().includes(q));
}
/**
 * Filtre par corps d'état (SUIVI uniquement — jamais déduit de WNATURE).
 * `codesAyantCorps` = codes fournisseurs du suivi ayant au moins une commande
 * dont le corps d'état contient la recherche (résolu côté serveur sur
 * travaux_commandes.corps_etat, code + libellé conservés).
 */
export function filtrerParCorpsEtat(
  fournisseurs: FournisseurRow[],
  aliasesParFournisseur: Map<string, FournisseurAlias[]>,
  codesAyantCorps: Set<string>,
): FournisseurRow[] {
  if (codesAyantCorps.size === 0) return [];
  return fournisseurs.filter((f) => {
    const ids = monterIdentifiantsFournisseur(aliasesParFournisseur.get(f.id) ?? []);
    return ids.some((code) => codesAyantCorps.has(code));
  });
}

/**
 * Montant de référence d'une commande fournisseur.
 * PRIORITÉ : engage (suivi annuel) → repli psp_montant_engage (Historique CMD) → aucun.
 * Les deux ne sont jamais additionnés ni mélangés ; le type retenu est explicite.
 */
export function montantReference(
  engage: number | null | undefined,
  pspMontantEngage: number | null | undefined,
): { montant: number | null; type: "engage" | "psp_montant_engage" | "aucun" } {
  if (typeof engage === "number") return { montant: engage, type: "engage" };
  if (typeof pspMontantEngage === "number")
    return { montant: pspMontantEngage, type: "psp_montant_engage" };
  return { montant: null, type: "aucun" };
}

/** Agrégations KPI d'un fournisseur (montant de référence, jamais mélangé). */
export function calculerKpisFournisseur(commandes: CommandeFournisseur[]): KpiFournisseur {
  const total_commandes = commandes.length;
  const total_montant = commandes.reduce((s, c) => s + (c.montant ?? 0), 0);

  const parAnnee = new Map<string, { annee: string; commandes: number; montant: number }>();
  const parCorps = new Map<string, { corps_etat: string; commandes: number; montant: number }>();

  for (const c of commandes) {
    const annee = c.annee != null ? String(c.annee) : "Année non précisée";
    const a = parAnnee.get(annee) ?? { annee, commandes: 0, montant: 0 };
    a.commandes += 1;
    a.montant += c.montant ?? 0;
    parAnnee.set(annee, a);

    const corps = c.corps_etat ?? "Corps d'état non précisé";
    const k = parCorps.get(corps) ?? { corps_etat: corps, commandes: 0, montant: 0 };
    k.commandes += 1;
    k.montant += c.montant ?? 0;
    parCorps.set(corps, k);
  }

  const dernieres = [...commandes]
    .sort((a, b) => (b.date_commande ?? "").localeCompare(a.date_commande ?? ""))
    .slice(0, 20);

  return {
    total_commandes,
    total_montant,
    par_annee: [...parAnnee.values()].sort((a, b) => b.annee.localeCompare(a.annee)),
    par_corps_etat: [...parCorps.values()].sort((a, b) => b.montant - a.montant),
    dernieres,
  };
}

/** Ligne minimale d'une commande suivi pour la résolution fournisseur. */
export interface CommandeSuiviMin {
  id: string;
  numero_commande: string;
  numero_fournisseur: string | null;
}

/**
 * Plan de mise à jour des contacts d'un fournisseur (diff ADD / UPDATE / DELETE).
 * Fonction PUR (testable en Node) : les écritures réelles se font ensuite
 * uniquement dans `fournisseurs_contacts`, jamais dans les tables sources.
 */
export interface ContactSaisie {
  id?: string | null;
  nom: string;
  fonction?: string | null;
  email?: string | null;
  telephone?: string | null;
}

export interface PlanMajContacts {
  creer: ContactSaisie[];
  modifier: { id: string; contact: ContactSaisie }[];
  supprimer: FournisseurContact[];
}

export function planifierMajContacts(
  existants: FournisseurContact[],
  souhaite: ContactSaisie[],
): PlanMajContacts {
  const voulus = souhaite
    .map((c) => ({
      id: c.id && c.id.trim() ? c.id.trim() : null,
      nom: c.nom.trim(),
      fonction: c.fonction?.trim() || null,
      email: c.email?.trim() || null,
      telephone: c.telephone?.trim() || null,
    }))
    .filter((c) => c.nom !== "");
  const gardes = new Set(voulus.filter((c) => c.id).map((c) => c.id as string));
  return {
    creer: voulus.filter((c) => !c.id),
    modifier: voulus.filter((c) => c.id).map((c) => ({ id: c.id as string, contact: c })),
    supprimer: existants.filter((c) => !gardes.has(c.id)),
  };
}

/**
 * Résout, pour chaque commande, le fournisseur référencé (le cas échéant).
 * Deux espaces sont explorés sans les confondre :
 *  - suivi : numero_fournisseur (travaux_commandes) ;
 *  - Historique CMD : FRAN_NUM via pspFournisseurs[id] (psp_import_rows.fournisseur).
 * Retourne un map commandeId → { id, nom, identifiants }. Aucune écriture, aucun choix
 * arbitraire (correspondance exacte via fournisseur_aliases uniquement).
 */
export function resoudreFournisseursParCommande(
  commandes: CommandeSuiviMin[],
  pspFournisseurs: Record<string, string[]>,
  fournisseurs: Fournisseur[],
  aliases: FournisseurAlias[],
): Record<string, { id: string; nom: string; identifiants: string[] }> {
  const aliasesParFournisseur = new Map<string, FournisseurAlias[]>();
  for (const a of aliases) {
    const arr = aliasesParFournisseur.get(a.fournisseur_id) ?? [];
    arr.push(a);
    aliasesParFournisseur.set(a.fournisseur_id, arr);
  }
  const result: Record<string, { id: string; nom: string; identifiants: string[] }> = {};
  for (const c of commandes) {
    const suivi = normaliserCodeFournisseur(c.numero_fournisseur);
    const pspCodes = (pspFournisseurs[c.id] ?? []).map(normaliserCodeFournisseur).filter(Boolean);
    const hit = fournisseurs.find((f) => {
      const ids = monterIdentifiantsFournisseur(aliasesParFournisseur.get(f.id) ?? []);
      return (suivi !== "" && ids.includes(suivi)) || pspCodes.some((pc) => ids.includes(pc));
    });
    if (hit) {
      result[c.id] = {
        id: hit.id,
        nom: hit.nom,
        identifiants: monterIdentifiantsFournisseur(aliasesParFournisseur.get(hit.id) ?? []),
      };
    }
  }
  return result;
}

// ── Phase 4G : recherche « Corps d'état » + filtre État (helpers purs) ────────

/** Une valeur d'état est « plausible » si elle n'est pas un bruit purement numérique. */
export function estValeurEtatPlausible(v: string): boolean {
  const s = v.trim();
  if (!s) return false;
  if (/^-?\d+(?:[.,]\d+)?$/.test(s)) return false;
  return true;
}

/**
 * Première proposition pertinente pour la recherche « Corps d'état » (saisie + ENTER).
 * Recherche sur le libellé complet (le code est conservé en préfixe : « (j) Couvertures »).
 * Ne renvoie JAMAIS une proposition déjà sélectionnée → ENTER ne crée aucun doublon.
 */
export function premierePropositionCorpsEtat(
  recherche: string,
  options: string[],
  selected: string[],
): string | null {
  const q = recherche.trim().toLowerCase();
  if (!q) return null;
  const match = options
    .filter((o) => o.toLowerCase().includes(q))
    .sort((a, b) => a.localeCompare(b))
    .find((o) => !selected.includes(o));
  return match ?? null;
}
