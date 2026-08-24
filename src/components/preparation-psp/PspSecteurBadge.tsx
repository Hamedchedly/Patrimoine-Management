import type { PspCategorie } from "@/lib/psp.prep";
import { cn } from "@/lib/utils";

/**
 * Badge de la catégorie budgétaire « C » (GE / GT / CP) — mêmes couleurs que le
 * Dashboard travaux existant : GT bleu, GE teal, CP orange.
 */
export default function PspSecteurBadge({
  categorie,
  className,
}: {
  categorie: PspCategorie;
  className?: string;
}) {
  const styles: Record<PspCategorie, string> = {
    GE: "bg-teal-50 text-teal-700 border-teal-200",
    GT: "bg-blue-50 text-blue-700 border-blue-200",
    CP: "bg-orange-50 text-orange-700 border-orange-200",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[10px] font-bold leading-none",
        styles[categorie],
        className,
      )}
    >
      {categorie}
    </span>
  );
}
