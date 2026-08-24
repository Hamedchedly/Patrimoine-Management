import type { ReactNode } from "react";

/**
 * En-tête de page commun (Phase 6B) — reproduit la structure des pages d'import :
 * titre + sous-titre à gauche, actions à droite. Aucun changement visuel.
 */
export default function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="flex items-start justify-between gap-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {children}
    </header>
  );
}
