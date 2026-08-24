import { History, Layers, List, Users } from "lucide-react";

import { cn } from "@/lib/utils";

/** Modes d'affichage du module (V2 + V3). */
export type ModeAffichage = "tranche" | "charge" | "detail" | "reports";

// V8.8.3 — « Revue des anciennes lignes PSP non commandées » RESTAURÉE comme
// fonctionnalité de CONSULTATION / HISTORIQUE, clairement séparée de la
// programmation actuelle (aucune écriture, aucune deuxième source de vérité :
// source = psp_lignes + données d'import existantes, réutilise l'UI/contrat
// legacy PspRevueReports). Elle identifie les anciennes lignes non commandées,
// reportées ou non réalisées, sans créer/modifier aucune opération.
const MODES: Array<{
  valeur: ModeAffichage;
  label: string;
  icone: typeof Layers;
  separateur?: boolean;
}> = [
  { valeur: "detail", label: "Détail", icone: List },
  { valeur: "tranche", label: "Par tranche", icone: Layers },
  { valeur: "charge", label: "Par chargé de clientèle", icone: Users },
  {
    valeur: "reports",
    label: "Revue des anciennes lignes PSP non commandées",
    icone: History,
    separateur: true,
  },
];

/**
 * Sélecteur des modes d'affichage (V7.4 — ordre métier) :
 * [Détail] [Par tranche] [Par chargé de clientèle] [Revue des reports]
 * Détail est le premier et le mode par défaut.
 */
export default function PspGroupingSelector({
  mode,
  onChange,
}: {
  mode: ModeAffichage;
  onChange: (mode: ModeAffichage) => void;
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-lg border bg-surface p-1">
      {MODES.map(({ valeur, label, icone: Icone, separateur }) => (
        <button
          key={valeur}
          type="button"
          onClick={() => onChange(valeur)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-bold transition-colors",
            separateur && "ml-1 border-l border-dashed pl-3",
            mode === valeur
              ? "bg-card text-foreground shadow-sm ring-1 ring-border"
              : "text-muted-foreground hover:bg-card/60 hover:text-foreground",
          )}
        >
          <Icone className="size-3.5" />
          {label}
        </button>
      ))}
    </div>
  );
}
