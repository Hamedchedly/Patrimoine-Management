import { FilterX, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FILTRES_VIDES, type FiltresDetail, type PspOperation } from "@/lib/psp.prep";

/**
 * Barre de filtres du mode Détail :
 * recherche texte + secteur / tranche / chargé clientèle / corps d'état / année.
 */
export default function PspDetailFilters({
  filters,
  onChange,
  operations,
}: {
  filters: FiltresDetail;
  onChange: (f: FiltresDetail) => void;
  operations: PspOperation[];
}) {
  const tranches = [...new Set(operations.map((o) => o.tranche))].sort(
    (a, b) => Number(a) - Number(b),
  );
  const charges = [...new Set(operations.map((o) => o.charge_clientele))].sort();
  const corps = [...new Set(operations.map((o) => o.corps_etat))].sort();
  const actifs =
    filters.q ||
    filters.categorie ||
    filters.tranche ||
    filters.charge_clientele ||
    filters.corps_etat ||
    filters.annee;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-[220px] flex-1">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={filters.q}
          onChange={(e) => onChange({ ...filters, q: e.target.value })}
          placeholder="Rechercher : nature, adresse, ville, corps d'état…"
          className="h-8 pl-8 text-xs"
        />
      </div>
      <FiltreSelect
        value={filters.categorie}
        placeholder="C — GE/GT/CP"
        options={["GE", "GT", "CP"]}
        onValueChange={(v) => onChange({ ...filters, categorie: v === "tous" ? "" : v })}
      />
      <FiltreSelect
        value={filters.tranche}
        placeholder="Tranche"
        options={tranches}
        onValueChange={(v) => onChange({ ...filters, tranche: v === "tous" ? "" : v })}
      />
      <FiltreSelect
        value={filters.charge_clientele}
        placeholder="Chargé clientèle"
        options={charges}
        onValueChange={(v) => onChange({ ...filters, charge_clientele: v === "tous" ? "" : v })}
      />
      <FiltreSelect
        value={filters.corps_etat}
        placeholder="Corps d'état"
        options={corps}
        onValueChange={(v) => onChange({ ...filters, corps_etat: v === "tous" ? "" : v })}
      />
      <Button
        variant="ghost"
        size="sm"
        className="h-8 text-xs text-muted-foreground"
        disabled={!actifs}
        onClick={() => onChange(FILTRES_VIDES)}
      >
        <FilterX className="size-3.5" />
        Réinitialiser
      </Button>
    </div>
  );
}

function FiltreSelect({
  value,
  placeholder,
  options,
  onValueChange,
}: {
  value: string;
  placeholder: string;
  options: string[];
  onValueChange: (v: string) => void;
}) {
  return (
    <Select value={value || "tous"} onValueChange={onValueChange}>
      <SelectTrigger className="h-8 w-auto min-w-[130px] text-xs">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="tous">Tous — {placeholder}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            {o}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
