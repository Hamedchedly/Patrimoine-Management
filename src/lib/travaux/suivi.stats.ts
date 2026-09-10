/**
 * V8.16 — Statistiques du suivi annuel (KPI + barres par catégorie GT/GE/CP).
 * Fonctions PURES et testables — aucun accès base, aucun MOCK.
 *
 * Règles (alignées sur l'outil d'export de l'utilisateur, référence 2023) :
 *  · lignes = commandes de l'exercice + lignes suivi (sans commande) de l'exercice ;
 *  · « programmé » = ligne portant une ligne budgétaire (LB) ; « hors programmation » = sans LB ;
 *  · enveloppe budgétaire = somme du budget par LB DISTINCTE (V8.15) ;
 *  · % engagé programmé vs budget = engagé programmé ÷ enveloppe ;
 *  · % engagé total vs budget = engagé (programmé + hors) ÷ enveloppe ;
 *  · % payé vs engagé = payé ÷ engagé (global + par segment) ;
 *  · % hors budget = engagé hors programmation ÷ enveloppe ;
 *  · barre par catégorie : 100 % = enveloppe budgétaire ; segments programmé + hors prog +
 *    reste TOUJOURS à l'intérieur. Reste = budget − engagé total (programmé + hors prog) ;
 *    overrun = engagé total au-delà de l'enveloppe (dépassement).
 */

export type LigneStatsSuivi = {
  nature_analytique?: string | null;
  ligne_budget?: string | null;
  engage?: number | null;
  paye?: number | null;
  budget?: number | null;
};

export type CatStatsSuivi = {
  code: "GT" | "GE" | "CP";
  budget: number;
  prog: number;
  hors: number;
  engage: number;
  paye: number;
  reste: number;
  overrun: number;
  nbProg: number;
  nbHors: number;
  nbSuivi: number;
};

export type StatsSuiviAnnuel = {
  engage: number;
  paye: number;
  pct: number;
  pctTotal: number;
  pctPaye: number;
  pctHorsBudget: number;
  pctPayeProg: number;
  pctPayeHors: number;
  budgetTotal: number;
  engProg: number;
  engHors: number;
  nProg: number;
  nHors: number;
  nProgCmd: number;
  nProgSuivi: number;
  cat: CatStatsSuivi[];
};

export type AlerteLb = {
  ligne_budget: string;
  /** Valeurs de budget distinctes portées par les lignes de cette LB (triées croissant). */
  budgets: number[];
  nbLignes: number;
};

/**
 * Détecte les lignes budgétaires INCOHÉRENTES : une même LB portée par plusieurs lignes
 * avec des budgets DIFFÉRENTS (ex. LB 565 : 5 000 € sur une commande et 6 000 € sur une
 * autre). L'enveloppe (LB distinctes) n'est alors pas déterministe — on ALERTE l'utilisateur
 * plutôt que de choisir une valeur arbitraire ; la correction se fera au prochain import.
 */
export const detecterLBIncoherentes = (
  lignes: Array<{ ligne_budget?: string | null; budget?: number | null }>,
): AlerteLb[] => {
  const parLB = new Map<string, number[]>();
  for (const r of lignes) {
    const lb = (r.ligne_budget ?? "").trim();
    if (!lb) continue;
    const b = Number(r.budget) || 0;
    const arr = parLB.get(lb) ?? [];
    if (!arr.includes(b)) arr.push(b);
    parLB.set(lb, arr);
  }
  return [...parLB.entries()]
    .filter(([, budgets]) => budgets.length > 1)
    .map(([ligne_budget, budgets]) => ({
      ligne_budget,
      budgets: [...budgets].sort((a, b) => a - b),
      nbLignes: lignes.filter((r) => (r.ligne_budget ?? "").trim() === ligne_budget).length,
    }));
};

const eng = (rows: LigneStatsSuivi[]) => rows.reduce((s, r) => s + (r.engage || 0), 0);
const pay = (rows: LigneStatsSuivi[]) => rows.reduce((s, r) => s + (r.paye || 0), 0);

/** V8.15 — enveloppe budgétaire : somme du budget par LIGNE BUDGÉTAIRE DISTINCTE. */
export const enveloppeBudgetaireSuivi = (
  rows: Array<{ ligne_budget?: string | null; budget?: number | null }>,
): number => {
  const parLB = new Map<string, number>();
  for (const r of rows) {
    const lb = (r.ligne_budget ?? "").trim();
    if (!lb) continue;
    if (!parLB.has(lb)) parLB.set(lb, r.budget ?? 0);
  }
  return [...parLB.values()].reduce((s, v) => s + v, 0);
};

/**
 * KPI + barres du suivi annuel. `commandes` = lignes commande de l'exercice ;
 * `suivi` = lignes annuelles sans commande de l'exercice (déjà filtrées par année).
 */
export const calculerStatsSuiviAnnuel = (
  commandes: LigneStatsSuivi[],
  suivi: LigneStatsSuivi[],
): StatsSuiviAnnuel => {
  const lignes = [...commandes, ...suivi];
  const prog = lignes.filter((r) => !!r.ligne_budget);
  const hors = lignes.filter((r) => !r.ligne_budget);
  const engage = eng(lignes);
  const paye = pay(lignes);
  const engProg = eng(prog);
  const engHors = eng(hors);
  const budgetTotal = enveloppeBudgetaireSuivi(lignes);

  const pct = budgetTotal > 0 ? Math.round((engProg / budgetTotal) * 100) : 0;
  const pctTotal = budgetTotal > 0 ? Math.round((engage / budgetTotal) * 100) : 0;
  const pctPaye = engage > 0 ? Math.round((paye / engage) * 100) : 0;
  const pctHorsBudget = budgetTotal > 0 ? Math.round((engHors / budgetTotal) * 100) : 0;
  const pctPayeProg = engProg > 0 ? Math.round((pay(prog) / engProg) * 100) : 0;
  const pctPayeHors = engHors > 0 ? Math.round((pay(hors) / engHors) * 100) : 0;

  const cat: CatStatsSuivi[] = (["GT", "GE", "CP"] as const).map((code) => {
    const lignesCat = lignes.filter((r) => r.nature_analytique === code);
    const suiviCat = suivi.filter((l) => l.nature_analytique === code);
    const progCat = lignesCat.filter((r) => !!r.ligne_budget);
    const horsCat = lignesCat.filter((r) => !r.ligne_budget);
    const budget = enveloppeBudgetaireSuivi(lignesCat);
    const progEng = eng(progCat);
    const horsEng = eng(horsCat);
    return {
      code,
      budget,
      // Segments mesurés en ENGAGÉ : le hors programmation n'a pas de budget.
      prog: progEng,
      hors: horsEng,
      engage: eng(lignesCat),
      paye: pay(lignesCat),
      // V8.16d — reste = budget − engagé total (programmé + hors prog) ; overrun = engagé
      // total au-delà de l'enveloppe. La barre affiche prog + hors + reste dans 100 %.
      reste: Math.max(0, budget - progEng - horsEng),
      overrun: Math.max(0, progEng + horsEng - budget),
      nbProg: progCat.length,
      nbHors: horsCat.length,
      nbSuivi: suiviCat.length,
    };
  });

  return {
    engage,
    paye,
    pct,
    pctTotal,
    pctPaye,
    pctHorsBudget,
    pctPayeProg,
    pctPayeHors,
    budgetTotal,
    engProg,
    engHors,
    nProg: prog.length,
    nHors: hors.length,
    // Programmées = avec LB : avec n° de commande (commandes) vs sans commande (lignes suivi).
    nProgCmd: commandes.filter((r) => !!r.ligne_budget).length,
    nProgSuivi: suivi.filter((r) => !!r.ligne_budget).length,
    cat,
  };
};
