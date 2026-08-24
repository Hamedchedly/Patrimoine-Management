import type { ReactNode } from "react";
import { BarChart3, Coins, PiggyBank, Scale, Settings2, TriangleAlert } from "lucide-react";

import PspSecteurBadge from "@/components/preparation-psp/PspSecteurBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { money0 } from "@/lib/formats";
import { PSP_ANNEES, kpiGlobal, type PspAnnee, type PspOperation } from "@/lib/psp.prep";
import {
  calculEnveloppe,
  budgetDisponibleParAnnee,
  budgetDisponibleTotalReel,
  programmeParAnneeCategorie,
  type EnveloppeMap,
} from "@/lib/psp.prep.v7";
import { cn } from "@/lib/utils";

const CATEGORIES = ["GE", "GT", "CP"] as const;

/**
 * KPI du module : Budget disponible, Budget programmé, Écart disponible,
 * Nombre d'opérations — puis UNE SEULE zone « Répartition par année »
 * (2027 → 2031), cliquable (filtre cumulatif — ne modifie jamais la
 * programmation), qui intègre le détail GE / GT / CP : montant programmé /
 * enveloppe, pourcentage et barre d'avancement (dépassement en rouge).
 * L'enveloppe reste saisie via « Paramètres PSP → Enveloppes » (psp_enveloppes).
 */
export default function PspKpi({
  operations,
  anneesFiltre,
  onToggleAnnee,
  enveloppes,
  onOuvrirEnveloppes,
  figee,
}: {
  operations: PspOperation[];
  anneesFiltre: PspAnnee[];
  onToggleAnnee: (a: PspAnnee) => void;
  enveloppes: EnveloppeMap;
  onOuvrirEnveloppes: () => void;
  figee: boolean;
}) {
  const kpi = kpiGlobal(operations);

  // V7.10 §3 — Budget disponible RÉEL = somme des enveloppes psp_enveloppes par
  // année (GE + GT + CP). AUCUN fallback mock : année sans enveloppe → « — ».
  const budgetDisponible = budgetDisponibleTotalReel(enveloppes);
  const ecartDisponible = budgetDisponible - kpi.programme;

  // Programmé par année × catégorie — règle unique (testable), jamais stocké.
  const programmePar = programmeParAnneeCategorie(operations);

  return (
    <section className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CarteKpi
          icone={<Coins className="size-4" />}
          label="Budget disponible"
          valeur={budgetDisponible > 0 ? money0(budgetDisponible) : "—"}
          note={`${PSP_ANNEES.length} exercices · enveloppes psp_enveloppes`}
          accent="text-primary"
        />
        <CarteKpi
          icone={<BarChart3 className="size-4" />}
          label="Budget programmé"
          valeur={money0(kpi.programme)}
          note={`${kpi.nbOperations} opérations`}
          accent="text-slate-800"
        />
        <CarteKpi
          icone={<PiggyBank className="size-4" />}
          label="Écart disponible"
          valeur={ecartDisponible >= 0 ? money0(ecartDisponible) : "—"}
          note={ecartDisponible >= 0 ? "Marge de programmation" : "Enveloppe dépassée"}
          accent={ecartDisponible >= 0 ? "text-emerald-600" : "text-destructive"}
        />
        <CarteKpi
          icone={<Scale className="size-4" />}
          label="Nombre d'opérations"
          valeur={String(kpi.nbOperations)}
          note="dont reportées de 2026"
          accent="text-primary"
        />
      </div>

      <Card className="shadow-panel">
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-sm font-semibold">
            <span className="flex items-center gap-2">
              <BarChart3 className="size-4 text-muted-foreground" />
              Répartition par année
            </span>
            <Button variant="outline" size="sm" onClick={onOuvrirEnveloppes} disabled={figee}>
              <Settings2 className="size-3.5" />
              Gérer les enveloppes
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
            {PSP_ANNEES.map((annee) => {
              const actif = anneesFiltre.includes(annee);
              const programme = kpi.parAnnee[String(annee)] ?? 0;
              const disponible = budgetDisponibleParAnnee(annee, enveloppes);
              const ecart = disponible - programme;
              return (
                <div
                  key={annee}
                  className={cn(
                    "rounded-lg border bg-surface/60 p-3 transition-colors",
                    actif && "border-primary/60 bg-primary/5 ring-2 ring-primary/25",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onToggleAnnee(annee)}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left",
                      actif
                        ? "bg-primary text-primary-foreground"
                        : "bg-card ring-1 ring-border hover:bg-accent",
                    )}
                    title={
                      actif
                        ? `Désélectionner ${annee} (filtre cumulatif)`
                        : `Sélectionner ${annee} — les opérations programmées en ${annee} sont affichées`
                    }
                  >
                    <span className="font-mono text-sm font-black">{annee}</span>
                    <span className="text-[10px] font-bold opacity-80">
                      {actif ? "✓ ON" : "filtrer"}
                    </span>
                  </button>

                  <div className="mt-2 space-y-1 text-xs">
                    <p className="flex items-center justify-between">
                      <span className="text-muted-foreground">Budget disponible</span>
                      <span className="tabnum font-bold">
                        {disponible > 0 ? money0(disponible) : "—"}
                      </span>
                    </p>
                    <p className="flex items-center justify-between">
                      <span className="text-muted-foreground">Programmé</span>
                      <span className="tabnum font-bold">{money0(programme)}</span>
                    </p>
                    <p className="flex items-center justify-between">
                      <span className="text-muted-foreground">Restant / écart</span>
                      <span
                        className={cn(
                          "tabnum font-black",
                          ecart >= 0 ? "text-emerald-600" : "text-destructive",
                        )}
                      >
                        {disponible > 0 ? money0(ecart) : "—"}
                      </span>
                    </p>
                  </div>

                  <div className="mt-2 space-y-1.5 border-t border-dashed pt-2">
                    {CATEGORIES.map((cat) => {
                      const enveloppe = enveloppes[`${annee}|${cat}`] ?? 0;
                      const prog = programmePar[`${annee}|${cat}`] ?? 0;
                      const calc = calculEnveloppe(enveloppe, prog);
                      const pct = calc.pourcentage == null ? null : Math.min(1, calc.pourcentage);
                      return (
                        <div key={cat}>
                          <div className="flex items-center justify-between gap-2 text-[10px]">
                            <span className="flex items-center gap-1">
                              <PspSecteurBadge categorie={cat} />
                              {enveloppe > 0 ? (
                                <span className="font-mono tabnum text-muted-foreground">
                                  {money0(prog)} / {money0(enveloppe)}
                                </span>
                              ) : (
                                <span className="text-muted-foreground/70">
                                  enveloppe à définir
                                </span>
                              )}
                            </span>
                            <span
                              className={cn(
                                "tabnum font-black",
                                calc.depassement ? "text-destructive" : "text-primary",
                              )}
                            >
                              {calc.pourcentage == null
                                ? "—"
                                : `${Math.round(calc.pourcentage * 100)} %`}
                            </span>
                          </div>
                          <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-border">
                            <div
                              className={cn(
                                "h-full rounded-full",
                                calc.depassement ? "bg-destructive" : "bg-primary/70",
                              )}
                              style={{ width: `${Math.max(2, (pct ?? 0) * 100)}%` }}
                            />
                          </div>
                          {calc.depassement ? (
                            <p className="mt-0.5 flex items-center gap-0.5 text-[9px] font-bold text-destructive">
                              <TriangleAlert className="size-2.5" />
                              Dépassement {money0(-calc.restant)}
                            </p>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">
            Cliquez sur une année pour filtrer le tableau (cumulatif, désélectionnable) · les
            enveloppes GE/GT/CP sont des données de préparation issues de `psp_enveloppes` — la
            dotation officielle sera définie dans une phase ultérieure.
          </p>
        </CardContent>
      </Card>
    </section>
  );
}

function CarteKpi({
  icone,
  label,
  valeur,
  note,
  accent,
}: {
  icone: ReactNode;
  label: string;
  valeur: string;
  note: string;
  accent: string;
}) {
  return (
    <Card className="shadow-panel">
      <CardContent className="flex items-start justify-between gap-2 p-4">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
            {label}
          </p>
          <p className={cn("tabnum mt-1 text-xl font-black", accent)}>{valeur}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{note}</p>
        </div>
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface text-muted-foreground">
          {icone}
        </div>
      </CardContent>
    </Card>
  );
}
