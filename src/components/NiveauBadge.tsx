import { Badge } from "@/components/ui/badge";
import { NIVEAU_COULEUR, NIVEAU_LABEL, type ProfilNiveau } from "@/lib/fournisseurs.analyse";

/**
 * Badge de niveau d'activité (principal / secondaire / occasionnel) — couleur et
 * libellé centralisés (NIVEAU_LABEL / NIVEAU_COULEUR). Même rendu partout.
 */
export default function NiveauBadge({ niveau }: { niveau: ProfilNiveau | null | undefined }) {
  const cle = niveau ?? "occasionnel";
  return (
    <Badge variant="outline" className={NIVEAU_COULEUR[cle] ?? ""}>
      {NIVEAU_LABEL[cle]}
    </Badge>
  );
}
