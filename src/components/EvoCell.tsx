import { evo } from "@/lib/formats";

/**
 * Indicateur d'évolution avec couleur de signe (règle métier Phase 4H) :
 * positif → vert, négatif → rouge, nul → neutre. Jamais de couleur pour un montant.
 * Utilisé par la liste des entreprises et la fiche fournisseur (colonnes Évolution
 * et lignes « Évol. commandes / Évol. montant »).
 */
export default function EvoCell({ v }: { v: number | null | undefined }) {
  if (v == null) return <span className="text-muted-foreground">—</span>;
  const classe =
    v > 0
      ? "font-semibold text-emerald-600"
      : v < 0
        ? "font-semibold text-red-600"
        : "font-semibold text-muted-foreground";
  return <span className={classe}>{evo(v)}</span>;
}
