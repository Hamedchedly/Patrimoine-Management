import type { ReactNode } from "react";

import { Label } from "@/components/ui/label";

/** Champ de formulaire (label + contenu) — même structure dans la liste et la fiche fournisseur. */
export default function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
