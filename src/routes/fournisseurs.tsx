import { createFileRoute, Outlet } from "@tanstack/react-router";

/**
 * Route layout /fournisseurs : la liste est la route index (fournisseurs.index.tsx),
 * la fiche est la route enfant (fournisseurs.$fournisseurId.tsx).
 * Ce composant ne fait que rendre l'enfant actif (aucun chrome propre).
 */
export const Route = createFileRoute("/fournisseurs")({
  component: FournisseursLayout,
});

function FournisseursLayout() {
  return <Outlet />;
}
