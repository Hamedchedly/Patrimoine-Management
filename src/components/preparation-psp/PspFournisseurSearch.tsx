/**
 * V7.8 §6 — Recherche d'ENTREPRISE fournisseur pour un devis : liste déroulante
 * avec recherche progressive par NOM / code / identifiant / alias / CORPS D'ÉTAT
 * (une seule case). Réutilise `rechercherFournisseursDevis` (référentiel
 * fournisseurs + refs sans fiche des commandes passées) — aucun nouveau
 * référentiel fournisseur.
 */
import { useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";

import { Input } from "@/components/ui/input";
import { rechercherFournisseursDevis } from "@/lib/psp.prep.supabase.functions";
import { libelleEntreprise } from "@/lib/psp.prep.v7";

export type FournisseurSelection = {
  id?: string | null;
  nom: string;
  /** Numéro fournisseur réel (alias) — pour le libellé robuste « Fournisseur n°XXXX ». */
  numero?: string | null;
};

type SuggestionFournisseur = {
  id: string | null;
  nom: string;
  ville: string | null;
  codes: string[];
  /** V8.16p — corps d'état distincts (recherche + affichage). */
  corps?: string[];
};

export default function PspFournisseurSearch({
  value,
  onSelect,
  placeholder = "Rechercher une entreprise…",
}: {
  /** Texte courant (nom sélectionné ou saisie). */
  value: string;
  /** Appelé à la sélection (fournisseur) ou au vidage (null). */
  onSelect: (f: FournisseurSelection | null) => void;
  placeholder?: string;
}) {
  const fournisseursFn = useServerFn(rechercherFournisseursDevis);
  const [q, setQ] = useState(value);
  const [sug, setSug] = useState<SuggestionFournisseur[]>([]);
  // V8.8 §1 — la recherche ne se déclenche QUE sur frappe utilisateur (onChange),
  // jamais à l'initialisation : à l'ouverture/modification d'une demande existante,
  // aucun dropdown ne doit s'ouvrir automatiquement. La valeur enregistrée reste
  // affichée ; le combobox ne s'ouvre qu'au clic volontaire dans le champ.
  const [rechercheActive, setRechercheActive] = useState("");

  // Synchronise le texte si le parent change la sélection.
  useEffect(() => setQ(value), [value]);

  useEffect(() => {
    const r = rechercheActive.trim();
    if (r.length < 2) {
      setSug([]);
      return;
    }
    const t = setTimeout(() => {
      void fournisseursFn({ data: { q: r } }).then((res) => {
        setSug((res ?? []) as SuggestionFournisseur[]);
      });
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rechercheActive]);

  return (
    <div className="relative">
      <Input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setRechercheActive(e.target.value);
          // Toute modification invalide la sélection précédente.
          onSelect(null);
        }}
        placeholder={placeholder}
        className="h-7 text-xs pr-7"
      />
      <Search className="pointer-events-none absolute right-2 top-2 size-3 text-muted-foreground" />
      {sug.length > 0 ? (
        <div className="absolute z-40 mt-1 max-h-36 w-full overflow-auto rounded-lg border bg-popover p-1 shadow-lg">
          {sug.map((f) => (
            <button
              key={f.id ?? `ref:${f.codes[0] ?? f.nom}`}
              type="button"
              className="flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-[10px] hover:bg-accent"
              onClick={() => {
                // V8.16p — ref sans fiche (nom vide) : on enregistre le n° comme nom
                // (devis.entreprise = n°), sinon libellé « Fournisseur n°XXXX ».
                onSelect({ id: f.id, nom: f.nom || f.codes[0] || "", numero: f.codes[0] ?? null });
                setQ(libelleEntreprise(f.nom, f.codes[0]));
                setRechercheActive("");
                setSug([]);
              }}
            >
              <span className="flex min-w-0 flex-col">
                <span className="flex items-center gap-1.5">
                  <span className="truncate font-medium">
                    {libelleEntreprise(f.nom, f.codes[0])}
                  </span>
                  {f.codes[0] ? (
                    <span className="shrink-0 font-mono text-[9px] text-muted-foreground">
                      #{f.codes[0]}
                    </span>
                  ) : null}
                </span>
                {f.corps && f.corps.length > 0 ? (
                  <span className="truncate text-[9px] text-muted-foreground">
                    {f.corps.slice(0, 3).join(" · ")}
                  </span>
                ) : null}
              </span>
              {f.ville ? <span className="shrink-0 text-muted-foreground">{f.ville}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
      {q && sug.length === 0 ? (
        <button
          type="button"
          className="absolute right-5 top-2 text-muted-foreground hover:text-destructive"
          title="Effacer la recherche"
          onClick={() => {
            setQ("");
            setRechercheActive("");
            setSug([]);
            onSelect(null);
          }}
        >
          <X className="size-3" />
        </button>
      ) : null}
    </div>
  );
}
