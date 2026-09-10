/**
 * Fournisseurs — Moteur d'analyse métier (module PUR, testable en Node).
 *
 * Couche analytique DÉRIVÉE : familles métier (CEA / CVC-P / TCE / AUTRE),
 * profil d'activité (principal / secondaire / occasionnel), part de marché,
 * évolutions. Aucune écriture : les corps d'état / lots / montants sont TOUJOURS
 * calculés depuis les commandes liées, jamais stockés sur le fournisseur.
 * Le corps d'état réel reste conservé et affichable (code en préfixe).
 */

import { matchVille, villeDeCommande, type TrancheGeo, type VilleGeoPure } from "../travaux/index.ts";

export type FamilleMetier = "CEA" | "CVC-P" | "TCE" | "AUTRE";
export type ProfilNiveau = "principal" | "secondaire" | "occasionnel";

// ── Mapping corps d'état → famille (centralisé, facilement modifiable) ────────
// CEA = peinture, revêtements sols/murs, embellissements, finitions…
export const TERMES_CEA = [
  "peinture",
  "revetement",
  "faienc",
  "carrelage",
  "embellis",
  "finition",
  "enduit",
  "toile de verre",
] as const;

// CVC-P = plomberie, chauffage, ventilation, corps directement rattachables…
export const TERMES_CVC_P = [
  "plomberie",
  "chauffage",
  "ventilation",
  "cvc",
  "sanitaire",
  "climatis",
  "chaudiere",
] as const;

const normaliserTexte = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

/**
 * Extrait le code et le libellé d'un corps d'état réel du suivi annuel.
 * Exemple : "(j) Couvertures" → { code: "j", libelle: "(j) Couvertures" }.
 * Si aucun préfixe codé : code = libellé normalisé (jamais inventé, déterministe).
 */
export function extraireCorpsEtatCode(corpsEtat: string | null | undefined): {
  code: string;
  libelle: string;
} {
  const brut = (corpsEtat ?? "").trim();
  if (!brut) return { code: "", libelle: "" };
  const m = /^\(\s*([^)]+?)\s*\)\s*(.*)$/.exec(brut);
  if (m) {
    const code = (m[1] ?? "").trim().toLowerCase();
    return { code, libelle: brut };
  }
  return { code: normaliserTexte(brut), libelle: brut };
}

/**
 * Monotonie des niveaux : occasionnel → secondaire → principal (jamais au-delà),
 * et principal → secondaire → occasionnel (jamais en-dessous d'occasionnel).
 */
export function niveauSuivant(niveau: ProfilNiveau): ProfilNiveau {
  if (niveau === "occasionnel") return "secondaire";
  return "principal";
}
export function niveauPrecedent(niveau: ProfilNiveau): ProfilNiveau {
  if (niveau === "principal") return "secondaire";
  return "occasionnel";
}

/**
 * Classe un corps d'état (libellé complet, code conservé) dans une famille.
 * La classification est analytique : elle ne remplace JAMAIS le corps d'état réel.
 */
export function classerCorpsEtatDansFamille(corpsEtat: string | null | undefined): FamilleMetier {
  const t = normaliserTexte(corpsEtat ?? "");
  if (TERMES_CVC_P.some((k) => t.includes(k))) return "CVC-P";
  if (TERMES_CEA.some((k) => t.includes(k))) return "CEA";
  return "AUTRE";
}

// ── Seuils de classification (centralisés, modifiables après test) ────────────
export const PROFIL_CONFIG = {
  /** TCE : au moins ce nombre de corps d'état distincts. */
  tceMinCorps: 4,
  /** TCE : le corps le plus commandé doit rester sous cette part (dispersion). */
  tceSeuilPartDominante: 0.35,
  /** TCE : aucune famille ne doit dépasser cette part (pas de spécialisation). */
  tceSeuilFamilleDominante: 0.6,
  /** Libellé « Spécialiste X » si le 1er corps atteint cette part. */
  specialisteSeuilPart: 0.5,
  /**
   * Scoring des niveaux d'activité (méthode transparente et documentée).
   *
   * score(corps) =
   *   20 × partCommandes        — part du nombre de commandes de l'entreprise
   * + 50 × min(cmd / 10, 1)     — nombre ABSOLU de commandes (plafonné à 10, signal dominant)
   * + 20 × min(années / 4, 1)   — récurrence pluriannuelle (exercices distincts)
   * +  5 × récence              — 1 si actif sur l'exercice le plus récent, 0,5 l'avant-dernier, sinon 0
   * + 12 × max(partMontant, 0)  — signal secondaire du montant engagé (jamais négatif)
   * +  5 × min(partCommandes/0,5, 1) — concentration de l'activité sur ce corps
   *
   * Une grosse part sur très peu de commandes ne suffit pas (une seule commande
   * ne devient jamais principale, voire secondaire). Une activité récurrente sur
   * plusieurs années est revalorisée même derrière un corps dominant (poids
   * récurrence) — elle n'est jamais « écrasée ».
   * Seuils : score ≥ 60 → principal ; score ≥ 24 → secondaire ; sinon occasionnel.
   */
  niveauScoring: {
    poidsPartCommandes: 20,
    poidsAbsolu: 50,
    poidsRecurrence: 20,
    poidsRecence: 5,
    poidsMontant: 12,
    poidsConcentration: 5,
    capCommandes: 10,
    capAnnees: 4,
    seuilPrincipal: 60,
    seuilSecondaire: 24,
  },
  /**
   * V8.16p — classification RELATIVE par écart (règle utilisateur) :
   *   · équilibré (top−second ≤ ecartEquilibre) → les activités significatives
   *     (part ≥ max(top×0.5, partMinPrincipale)) sont TOUTES « principale » ;
   *   · écart marqué → hiérarchie RELATIVE : le dominant (ratio ≥ ratioPrincipal)
   *     est « principale », les activités moyennes (ratio ≥ ratioSecondaire)
   *     « secondaire », la queue « occasionnel ».
   */
  ecartEquilibre: 0.15,
  partMinPrincipale: 0.1,
  /** Ratio à la part maximale : activité « principale » (écart marqué) — seul le
   *  dominant (ou une activité quasi égale, ≥ 75 % du top) est principale. */
  ratioPrincipal: 0.75,
  /** Ratio à la part maximale : activité « secondaire » (écart marqué). */
  ratioSecondaire: 0.15,
  /**
   * V8.16p — BARÈME COMBINÉ : « part d'activité » = blendCommandes × part du
   * NOMBRE DE COMMANDES + blendMontant × part du MONTANT (jamais négatif). Les
   * deux critères comptent : ex. 12562 isolat extérieure = 1 commande mais 35 k€
   * (plus gros montant) → activité significative, pas « occasionnel ».
   */
  blendCommandes: 0.5,
  blendMontant: 0.5,
} as const;

export interface ProfilCorps {
  corps_etat: string;
  famille: FamilleMetier;
  commandes: number;
  montant: number;
  partCommandes: number;
  partMontant: number;
  /** V8.16p — « part d'activité » combinée (commandes + montant) → classification. */
  part_activite: number;
  /** Exercices distincts avec au moins une commande de ce corps. */
  annees_actives: number;
  /** Activité récente : 1 (exercice le plus récent), 0,5 (l'avant-dernier), 0 sinon. */
  recence: number;
  /** Score de la méthode de scoring transparente. */
  score: number;
  niveau: ProfilNiveau;
}

export interface FamilleStat {
  famille: FamilleMetier;
  commandes: number;
  montant: number;
  partCommandes: number;
  partMontant: number;
}

export interface ProfilActivite {
  corps: ProfilCorps[];
  familles: FamilleStat[];
  corps_principaux: string[];
  corps_secondaires: string[];
  corps_occasionnels: string[];
  famille_principale: FamilleMetier | null;
  familles_secondaires: FamilleMetier[];
  est_tce: boolean;
  specialite: string | null;
  /** Libellé court : TCE / CVC-P / CEA / Spécialiste X / Multi-activités / AUTRE. */
  libelle: string;
}

/**
 * Score de la méthode transparente des niveaux d'activité (voir PROFIL_CONFIG.niveauScoring).
 * Les signaux sont normalisés puis pondérés ; le montant négatif est neutralisé.
 */
export function calculerScoreActivite(s: {
  partCommandes: number;
  partMontant: number;
  commandes: number;
  anneesActives: number;
  recence: number;
}): number {
  const c = PROFIL_CONFIG.niveauScoring;
  const absScore = Math.min(s.commandes / c.capCommandes, 1);
  const recurrScore = Math.min(s.anneesActives / c.capAnnees, 1);
  const concScore = Math.min(s.partCommandes / 0.5, 1);
  return (
    c.poidsPartCommandes * s.partCommandes +
    c.poidsAbsolu * absScore +
    c.poidsRecurrence * recurrScore +
    c.poidsRecence * s.recence +
    c.poidsMontant * Math.max(s.partMontant, 0) +
    c.poidsConcentration * concScore
  );
}

/** Classe un score en niveau : principal / secondaire / occasionnel. */
export function classerScoreActivite(score: number): ProfilNiveau {
  if (score >= PROFIL_CONFIG.niveauScoring.seuilPrincipal) return "principal";
  if (score >= PROFIL_CONFIG.niveauScoring.seuilSecondaire) return "secondaire";
  return "occasionnel";
}

/**
 * V8.16p — Classification RELATIVE des niveaux par écart (règle utilisateur).
 * Chaque corps porte une « part d'activité » combinée (nombre de commandes +
 * montant, voir PROFIL_CONFIG.blendCommandes/blendMontant) :
 *   · équilibré (top−second ≤ ecartEquilibre) : les activités significatives
 *     (part ≥ max(top×0.5, partMinPrincipale)) deviennent TOUTES « principale »
 *     (ex. étanchéité + divers 50/50, ou 12562 isolat extérieure 35 k€) ;
 *   · écart marqué : hiérarchie RELATIVE — le dominant (ratio ≥ ratioPrincipal)
 *     est « principale », les activités moyennes « secondaire », la queue
 *     « occasionnel ». Ex. 5700 : 3/5 Fermetures → Fermetures principale.
 * Pur et testable.
 */
export function classerNiveauxParEcart(
  corps: Array<{ corps_etat: string; part: number }>,
  config: {
    ecartEquilibre?: number;
    partMinPrincipale?: number;
    ratioPrincipal?: number;
    ratioSecondaire?: number;
  } = {},
): Map<string, ProfilNiveau> {
  const {
    ecartEquilibre = PROFIL_CONFIG.ecartEquilibre,
    partMinPrincipale = PROFIL_CONFIG.partMinPrincipale,
    ratioPrincipal = PROFIL_CONFIG.ratioPrincipal,
    ratioSecondaire = PROFIL_CONFIG.ratioSecondaire,
  } = config;
  const out = new Map<string, ProfilNiveau>();
  if (corps.length === 0) return out;
  const tries = [...corps].sort((a, b) => b.part - a.part);
  const top = tries[0]?.part ?? 0;
  const second = tries[1]?.part ?? 0;
  // Équilibre : les activités significatives sont TOUTES « principale ».
  if (top - second <= ecartEquilibre) {
    const seuil = Math.max(top * 0.5, partMinPrincipale);
    for (const c of tries) {
      out.set(c.corps_etat, c.part >= seuil ? "principal" : "occasionnel");
    }
    return out;
  }
  // Écart marqué : hiérarchie relative — le dominant et toute activité proche sont
  // « principale », les activités moyennes « secondaire », la queue « occasionnel ».
  for (const c of tries) {
    const ratio = top > 0 ? c.part / top : 0;
    out.set(
      c.corps_etat,
      ratio >= ratioPrincipal
        ? "principal"
        : ratio >= ratioSecondaire
          ? "secondaire"
          : "occasionnel",
    );
  }
  return out;
}

/** Calcule le profil d'activité d'un fournisseur depuis ses commandes (toutes années). */
export function calculerProfilActivite(
  commandes: Array<{
    corps_etat: string | null;
    montant: number | null;
    annee?: number | null;
  }>,
): ProfilActivite {
  const totalCommandes = commandes.length;
  const totalMontant = commandes.reduce((s, c) => s + (c.montant ?? 0), 0);

  // Agrégation par corps d'état (avec exercices distincts pour la récurrence/récence).
  let anneeMax: number | null = null;
  const parCorps = new Map<string, { commandes: number; montant: number; annees: Set<number> }>();
  for (const c of commandes) {
    const corps = (c.corps_etat ?? "").trim();
    if (!corps) continue;
    if (c.annee != null && (anneeMax === null || c.annee > anneeMax)) anneeMax = c.annee;
    const k = parCorps.get(corps) ?? { commandes: 0, montant: 0, annees: new Set<number>() };
    k.commandes += 1;
    k.montant += c.montant ?? 0;
    if (c.annee != null) k.annees.add(c.annee);
    parCorps.set(corps, k);
  }

  const corps: ProfilCorps[] = [...parCorps.entries()]
    .map(([corps_etat, v]) => {
      const partCommandes = totalCommandes > 0 ? v.commandes / totalCommandes : 0;
      const partMontant = totalMontant > 0 ? v.montant / totalMontant : 0;
      // V8.16p — « part d'activité » combinée (barème : commandes + montant).
      const part_activite =
        PROFIL_CONFIG.blendCommandes * partCommandes +
        PROFIL_CONFIG.blendMontant * Math.max(partMontant, 0);
      const annees_actives = v.annees.size;
      const recence =
        anneeMax == null ? 0 : v.annees.has(anneeMax) ? 1 : v.annees.has(anneeMax - 1) ? 0.5 : 0;
      const score = calculerScoreActivite({
        partCommandes,
        partMontant,
        commandes: v.commandes,
        anneesActives: annees_actives,
        recence,
      });
      return {
        corps_etat,
        famille: classerCorpsEtatDansFamille(corps_etat),
        commandes: v.commandes,
        montant: v.montant,
        partCommandes,
        partMontant,
        part_activite,
        annees_actives,
        recence,
        score,
        niveau: classerScoreActivite(score),
      };
    })
    .sort((a, b) => b.montant - a.montant || b.commandes - a.commandes);

  // V8.16p — niveau RELATIF par écart sur la PART D'ACTIVITÉ combinée (nombre de
  // commandes + montant) : équilibré → activités significatives toutes « principale »
  // ; écart marqué → hiérarchie relative (dominant = principale). Le score absolu
  // reste disponible pour l'ordonnancement.
  {
    const ajustements = classerNiveauxParEcart(
      corps.map((c) => ({ corps_etat: c.corps_etat, part: c.part_activite })),
    );
    for (const c of corps) {
      const n = ajustements.get(c.corps_etat);
      if (n) c.niveau = n;
    }
  }

  // Agrégation par famille
  const parFamille = new Map<FamilleMetier, { commandes: number; montant: number }>();
  for (const c of corps) {
    const k = parFamille.get(c.famille) ?? { commandes: 0, montant: 0 };
    k.commandes += c.commandes;
    k.montant += c.montant;
    parFamille.set(c.famille, k);
  }
  const familles: FamilleStat[] = [...parFamille.entries()]
    .map(([famille, v]) => ({
      famille,
      commandes: v.commandes,
      montant: v.montant,
      partCommandes: totalCommandes > 0 ? v.commandes / totalCommandes : 0,
      partMontant: totalMontant > 0 ? v.montant / totalMontant : 0,
    }))
    .sort((a, b) => b.montant - a.montant);

  const corps_principaux = corps.filter((c) => c.niveau === "principal").map((c) => c.corps_etat);
  const corps_secondaires = corps.filter((c) => c.niveau === "secondaire").map((c) => c.corps_etat);
  const corps_occasionnels = corps
    .filter((c) => c.niveau === "occasionnel")
    .map((c) => c.corps_etat);

  const famille_principale = familles[0]?.famille ?? null;
  const familles_secondaires = familles
    .filter((f) => f.famille !== famille_principale && f.commandes > 0)
    .map((f) => f.famille);

  // Détection TCE — prudente : nombreux corps ET répartition dispersée ET aucune
  // spécialisation dominante. Un simple multi-corps ne suffit jamais. La domination
  // d'une famille CEA/CVC-P bloque le TCE ; la famille AUTRE ne bloque pas (un
  // multi-corps non spécialisé reste éligible à TCE).
  const premierCorps = corps[0];
  const premiereFamille = familles[0];
  const familleSpeciale =
    premiereFamille != null &&
    (premiereFamille.famille === "CEA" || premiereFamille.famille === "CVC-P");
  const est_tce =
    corps.length >= PROFIL_CONFIG.tceMinCorps &&
    (premierCorps?.partCommandes ?? 1) < PROFIL_CONFIG.tceSeuilPartDominante &&
    (!familleSpeciale ||
      (premiereFamille?.partCommandes ?? 0) < PROFIL_CONFIG.tceSeuilFamilleDominante);

  // Libellé de profil
  let libelle: string;
  let specialite: string | null = null;
  if (est_tce) {
    libelle = "TCE";
  } else if (premierCorps && premierCorps.partCommandes >= PROFIL_CONFIG.specialisteSeuilPart) {
    libelle = `Spécialiste ${premierCorps.corps_etat}`;
    specialite = premierCorps.corps_etat;
  } else if (famille_principale === "CEA" || famille_principale === "CVC-P") {
    libelle = famille_principale;
  } else if (premierCorps) {
    libelle = "Multi-activités";
  } else {
    libelle = "AUTRE";
  }

  return {
    corps,
    familles,
    corps_principaux,
    corps_secondaires,
    corps_occasionnels,
    famille_principale,
    familles_secondaires,
    est_tce,
    specialite,
    libelle,
  };
}

// ── Indicateurs (part de marché, évolutions) ──────────────────────────────────
/** Part de marché d'un montant sur un total (null si total ≤ 0). */
export function partMarche(montant: number, total: number): number | null {
  if (total > 0) return montant / total;
  return null;
}

/** Évolution N/N-1 (ratio, null si base non positive). */
export function evolution(actuel: number, precedent: number): number | null {
  if (precedent > 0) return (actuel - precedent) / precedent;
  return null;
}

/** Agrège des commandes par année (année null → ignorée). */
export function agregerParAnnee(
  commandes: Array<{ annee: number | null; montant: number | null }>,
): { commandes: number; montant: number; annee: number }[] {
  const map = new Map<number, { commandes: number; montant: number; annee: number }>();
  for (const c of commandes) {
    if (c.annee == null) continue;
    const k = map.get(c.annee) ?? { commandes: 0, montant: 0, annee: c.annee };
    k.commandes += 1;
    k.montant += c.montant ?? 0;
    map.set(c.annee, k);
  }
  return [...map.values()].sort((a, b) => a.annee - b.annee);
}

/** Niveau du corps recherché dans le profil d'un fournisseur (null si absent). */
export function niveauCorpsRecherche(
  profil: ProfilActivite,
  corpsEtat: string,
): ProfilNiveau | null {
  const q = normaliserTexte(corpsEtat);
  const hit = profil.corps.find((c) => normaliserTexte(c.corps_etat).includes(q));
  return hit?.niveau ?? null;
}

/** Classement de recherche : principal (0) > secondaire (1) > occasionnel (2) > absent (3). */
export const ORDRE_NIVEAU: Record<string, number> = {
  principal: 0,
  secondaire: 1,
  occasionnel: 2,
};

/** Trie des lignes selon une clé (croissant/décroissant), valeurs nulles en fin. */
export function trierLignes<T>(
  lignes: T[],
  cle: (l: T) => number | string | null | undefined,
  direction: "asc" | "desc",
): T[] {
  return [...lignes].sort((a, b) => {
    const va = cle(a);
    const vb = cle(b);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === "string" && typeof vb === "string") {
      return direction === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
    }
    const na = Number(va);
    const nb = Number(vb);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) {
      return direction === "asc" ? na - nb : nb - na;
    }
    return 0;
  });
}

// ── Recherche multi-corps d'état (OR) et classement ───────────────────────────
/**
 * Vrai si l'entreprise a réalisé AU MOINS UN des corps d'état sélectionnés (OR).
 * Un tableau vide → aucune contrainte (vrai).
 */
export function correspondSurAuMoinsUnCorps(profil: ProfilActivite, corpsEtats: string[]): boolean {
  const qs = corpsEtats.map((c) => normaliserTexte(c)).filter((x) => x !== "");
  if (qs.length === 0) return true;
  return profil.corps.some((c) => qs.some((q) => normaliserTexte(c.corps_etat).includes(q)));
}

/**
 * Meilleur niveau atteint par l'entreprise parmi les corps d'état sélectionnés
 * (principal > secondaire > occasionnel). null si aucun corps ne correspond.
 */
export function meilleurNiveauCorps(
  profil: ProfilActivite,
  corpsEtats: string[],
): ProfilNiveau | null {
  const qs = corpsEtats.map((c) => normaliserTexte(c)).filter((x) => x !== "");
  let best: ProfilNiveau | null = null;
  for (const c of profil.corps) {
    if (!qs.some((q) => normaliserTexte(c.corps_etat).includes(q))) continue;
    if (best === null || (ORDRE_NIVEAU[c.niveau] ?? 3) < (ORDRE_NIVEAU[best] ?? 3)) best = c.niveau;
  }
  return best;
}

// ── Dernière commande (tri par défaut) ────────────────────────────────────────
const timestampDate = (s: string | null | undefined): number => {
  if (!s) return NaN;
  const t = new Date(s).getTime();
  return Number.isNaN(t) ? NaN : t;
};

const isoDateLocale = (ts: number): string => {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export interface DerniereCommande {
  /** Date ISO (AAAA-MM-JJ) de la commande la plus récente, ou null. */
  date: string | null;
  /** Numéro de la dernière commande, ou null. */
  numero: string | null;
}

/** Dernière commande d'un ensemble (date maximale). Pur, jamais inventé. */
export function derniereCommande(
  commandes: Array<{
    date_commande: string | null;
    date_demarrage: string | null;
    numero_commande: string;
  }>,
): DerniereCommande {
  let best: { ts: number; date: string; numero: string } | null = null;
  for (const c of commandes) {
    for (const d of [c.date_commande, c.date_demarrage]) {
      const ts = timestampDate(d);
      if (Number.isNaN(ts)) continue;
      if (!best || ts > best.ts) {
        best = { ts, date: isoDateLocale(ts), numero: c.numero_commande };
      }
    }
  }
  return best ? { date: best.date, numero: best.numero } : { date: null, numero: null };
}

// ── Activités manuelles / validées (couche de décision, jamais sur les sources) ─
export interface ActiviteManuelle {
  id?: string | null;
  fournisseur_id: string;
  corps_etat_code: string;
  corps_etat_libelle: string;
  niveau: ProfilNiveau;
  source: "manuel" | "ia";
}

export interface ActiviteManuelleSaisie {
  corps_etat_code: string;
  corps_etat_libelle: string;
  niveau: ProfilNiveau;
}

/** Activité à niveau EFFECTIF (manuel si présent, sinon automatique). */
export interface ActiviteEffective {
  code: string;
  libelle: string;
  corps_etat: string;
  niveau: ProfilNiveau | null;
  niveau_auto: ProfilNiveau | null;
  niveau_manuel: ProfilNiveau | null;
  source: "calculé" | "manuel";
  commandes: number;
  montant: number;
  partCommandes: number;
}

/**
 * Niveau effectif par corps d'état : une décision manuelle écrase l'automatique
 * SANS jamais écraser niveau_auto (retour possible au calcul).
 * Les corps d'état attribués manuellement sans aucun historique sont conservés
 * avec des KPIs à zéro (aucune commande ni montant fabriqués).
 */
export function calculerActivitesEffectives(
  profil: ProfilActivite,
  manuelles: ActiviteManuelle[],
): ActiviteEffective[] {
  const manuelParCode = new Map<string, ActiviteManuelle>();
  for (const m of manuelles) {
    const code = m.corps_etat_code.trim().toLowerCase();
    if (code) manuelParCode.set(code, m);
  }
  const vus = new Set<string>();
  const out: ActiviteEffective[] = [];
  for (const c of profil.corps) {
    const { code } = extraireCorpsEtatCode(c.corps_etat);
    vus.add(code);
    const m = manuelParCode.get(code);
    out.push({
      code,
      libelle: c.corps_etat,
      corps_etat: c.corps_etat,
      niveau: m ? m.niveau : c.niveau,
      niveau_auto: c.niveau,
      niveau_manuel: m?.niveau ?? null,
      source: m ? "manuel" : "calculé",
      commandes: c.commandes,
      montant: c.montant,
      partCommandes: c.partCommandes,
    });
  }
  for (const m of manuelles) {
    const code = m.corps_etat_code.trim().toLowerCase();
    if (!code || vus.has(code)) continue;
    out.push({
      code,
      libelle: m.corps_etat_libelle,
      corps_etat: m.corps_etat_libelle,
      niveau: m.niveau,
      niveau_auto: null,
      niveau_manuel: m.niveau,
      source: "manuel",
      commandes: 0,
      montant: 0,
      partCommandes: 0,
    });
  }
  return out;
}

/** Libellé « Ajustement » : uniquement si une décision manuelle existe (sinon vide). */
export function libelleAjustement(a: { niveau_manuel: ProfilNiveau | null }): string {
  return a.niveau_manuel ? "Manuel" : "";
}

/** Corps d'état à niveau effectif PRINCIPAL (pour la liste et la part de marché). */
export function corpsPrincipauxEffectifs(
  profil: ProfilActivite,
  manuelles: ActiviteManuelle[],
): { codes: Set<string>; libelles: string[] } {
  const effectives = calculerActivitesEffectives(profil, manuelles);
  const codes = new Set<string>();
  const libelles: string[] = [];
  for (const e of effectives) {
    if (e.niveau === "principal") {
      codes.add(e.code);
      libelles.push(e.corps_etat);
    }
  }
  return { codes, libelles };
}

/**
 * Part de marché — MODE PRINCIPAUX : uniquement les commandes dont le corps
 * d'état est une activité principale effective. Chaque commande est comptée au
 * plus une fois (jamais de double comptage d'un même montant). Base financière :
 * montant engagé (repli psp). Dénominateur = marché global de l'année.
 */
export function partMarchePrincipaux(
  commandes: Array<{ corps_etat: string | null; montant: number | null }>,
  codesPrincipaux: Set<string>,
  marcheAnnee: number,
): { montant: number; part: number | null } {
  let montant = 0;
  for (const c of commandes) {
    if (c.montant == null || !c.corps_etat) continue;
    const { code } = extraireCorpsEtatCode(c.corps_etat);
    if (codesPrincipaux.has(code)) montant += c.montant;
  }
  return { montant, part: partMarche(montant, marcheAnnee) };
}

export interface PlanMajActivites {
  creer: ActiviteManuelleSaisie[];
  modifier: { id: string; saisie: ActiviteManuelleSaisie }[];
  supprimer: ActiviteManuelle[];
}

/**
 * Diff entre les activités manuelles existantes et celles souhaitées
 * (identifiées par corps_etat_code). Fonction PUR, testable en Node.
 */
export function planifierMajActivites(
  existantes: ActiviteManuelle[],
  souhaite: ActiviteManuelleSaisie[],
): PlanMajActivites {
  const voulues = souhaite
    .map((s) => ({
      corps_etat_code: s.corps_etat_code.trim().toLowerCase(),
      corps_etat_libelle: s.corps_etat_libelle.trim(),
      niveau: s.niveau,
    }))
    .filter((s) => s.corps_etat_code !== "" && s.corps_etat_libelle !== "");
  const parCode = new Map(existantes.map((e) => [e.corps_etat_code, e]));
  const codesVoulus = new Set(voulues.map((v) => v.corps_etat_code));
  const creer: ActiviteManuelleSaisie[] = [];
  const modifier: PlanMajActivites["modifier"] = [];
  for (const v of voulues) {
    const e = parCode.get(v.corps_etat_code);
    if (e && e.id) modifier.push({ id: e.id, saisie: v });
    else creer.push(v);
  }
  const supprimer = existantes.filter((e) => !codesVoulus.has(e.corps_etat_code));
  return { creer, modifier, supprimer };
}

// ── Phase 4F : historique, adresses, cartographie des villes ──────────────────

/**
 * Historique annuel trié par année DÉCROISSANTE (année la plus récente en premier).
 * Copie dédiée à l'affichage fiche : ne modifie jamais l'ordre des agrégats source.
 */
export function trierHistoriqueAnnuelDesc<T extends { annee: number }>(historique: T[]): T[] {
  return [...historique].sort((a, b) => b.annee - a.annee);
}

/**
 * Adresse physique d'une commande, débarrassée de tout identifiant patrimoine
 * (« 61 PLACE DES CHÊNES, NANDY - ER.37062 » → « 61 PLACE DES CHÊNES, NANDY » ;
 * « … - INDIV ER.34690 » → adresse sans ER). Ne renvoie jamais un code ER seul en
 * guise d'adresse. Retourne null si aucune adresse exploitable.
 */
export function extraireAdressePhysique(adresse: string | null | undefined): string | null {
  const brut = (adresse ?? "").trim();
  if (!brut) return null;
  // Un identifiant patrimoine « ER.… » n'est pas une adresse : retiré où qu'il apparaisse
  // (« - ER.37062 », «, SERRIS - ER.26252 », « - INDIV ER.34690 », « ER.T1400 »…).
  const sansEr = brut
    .replace(/\s*[-–—,;]\s*ER\.[A-Z0-9.-]+/gi, "")
    .replace(/\s*[-–—,;]\s*[A-ZÀ-ÿ][A-ZÀ-ÿ0-9]{0,14}\s+ER\.[A-Z0-9.-]+/gi, "");
  const nettoye = sansEr
    .trim()
    .replace(/[,\-–—]\s*$/, "")
    .trim();
  if (!nettoye) return null;
  if (/^ER\.[A-Z0-9.-]+$/i.test(nettoye)) return null;
  return nettoye;
}

/** Une ville où le fournisseur a réellement réalisé des travaux (données réelles). */
export interface VilleFournisseur {
  ville: string;
  lat: number;
  lng: number;
  /** Nombre de commandes réalisées dans cette ville (taille des cercles). */
  commandes: number;
  /** Montant total engagé dans cette ville (information complémentaire). */
  montant: number;
}

/**
 * Villes des commandes d'un fournisseur — même source de vérité que le Dashboard
 * Travaux (`villeDeCommande` : adresse d'import puis tranche). Aucune coordonnée
 * inventée : une ville absente de `villes_geo` est renvoyée dans `nonLocalisees`
 * (liste complémentaire à l'écran), jamais positionnée arbitrairement.
 * Lecture seule : rien n'est stocké sur le fournisseur.
 */
export function calculerVillesFournisseur(
  commandes: Array<{
    adresse: string | null;
    tranche_code: string | null;
    montant: number | null;
  }>,
  tranches: TrancheGeo[],
  villesGeo: VilleGeoPure[],
): { villes: VilleFournisseur[]; nonLocalisees: string[]; commandesSansVille: number } {
  const map = new Map<string, VilleFournisseur>();
  const nonLocalisees = new Set<string>();
  let commandesSansVille = 0;
  for (const c of commandes) {
    const ville = villeDeCommande(c, tranches, villesGeo);
    if (!ville) {
      commandesSansVille += 1;
      continue;
    }
    const geo = matchVille(ville, villesGeo);
    if (!geo) {
      nonLocalisees.add(ville);
      continue;
    }
    const g =
      map.get(geo.ville) ??
      ({
        ville: geo.ville,
        lat: geo.lat,
        lng: geo.lng,
        commandes: 0,
        montant: 0,
      } as VilleFournisseur);
    g.commandes += 1;
    g.montant += c.montant ?? 0;
    map.set(geo.ville, g);
  }
  return {
    villes: [...map.values()].sort((a, b) => b.commandes - a.commandes),
    nonLocalisees: [...nonLocalisees].sort(),
    commandesSansVille,
  };
}

/**
 * Timestamp chronologique d'une commande pour le tri par date :
 * accepte les formats réellement rencontrés (chaîne locale JS « Wed Feb 01 2023 … »,
 * ISO « YYYY-MM-DD », française « DD/MM/YYYY »). Retourne null si aucune date
 * exploitable → les commandes sans date restent en fin de tri (trierLignes).
 */
export function timestampDateCommande(
  dateCommande: string | null | undefined,
  dateDemarrage: string | null | undefined,
): number | null {
  for (const v of [dateCommande, dateDemarrage]) {
    if (!v) continue;
    const t = Date.parse(v);
    if (Number.isFinite(t)) return t;
  }
  return null;
}

/**
 * Tranche(s) d'un patrimoine : uniquement les codes à 4 chiffres, dérivés de la
 * relation patrimoine → tranche (tranche_code du suivi / de la vue, puis code du
 * patrimoine « ER.T1400 », « ER.B1976.001 », « ER.E1396.001.004 »). Ne renvoie
 * JAMAIS un ER, une ville, une adresse ou un bâtiment. null si aucune tranche.
 */
export function trancheDepuisPatrimoine(patrimoine: string | null | undefined): string | null {
  const p = (patrimoine ?? "").trim();
  const m = /^ER\.(?:T|B|E)?(\d{4})(?:\.|$)/i.exec(p);
  return m ? (m[1] ?? null) : null;
}

/** Tranche de commande (4 chiffres uniquement), support multi (« 1395, 1401 »). */
export function trancheDeCommande(c: {
  tranche_code: string | null;
  patrimoine: string | null;
}): string | null {
  const t = (c.tranche_code ?? "").trim();
  if (/^\d{4}$/.test(t)) return t;
  const fromPat = trancheDepuisPatrimoine(c.patrimoine);
  if (fromPat) return fromPat;
  const codes = t.match(/\d{4}/g);
  if (codes?.length) return [...new Set(codes)].join(", ");
  return null;
}

// ── Affichage métier partagé (labels / couleurs) — Phase 5 mutualisation ───────
// Utilisés par la liste des entreprises ET la fiche fournisseur (badges niveau /
// famille). Les classes Tailwind sont des constantes d'affichage, jamais du calcul.

export const NIVEAU_LABEL: Record<string, string> = {
  principal: "Principal",
  secondaire: "Secondaire",
  occasionnel: "Occasionnel",
};

export const NIVEAU_COULEUR: Record<string, string> = {
  principal: "bg-emerald-100 text-emerald-700",
  secondaire: "bg-amber-100 text-amber-700",
  occasionnel: "bg-slate-100 text-slate-600",
};

export const PROFIL_BADGE: Record<string, string> = {
  TCE: "bg-violet-100 text-violet-700",
  CEA: "bg-teal-100 text-teal-700",
  "CVC-P": "bg-sky-100 text-sky-700",
};
