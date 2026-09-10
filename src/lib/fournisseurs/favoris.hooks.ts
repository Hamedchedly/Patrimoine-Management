import { useCallback, useState } from "react";

/**
 * V8.16s — Favoris fournisseurs SANS authentification (localStorage).
 *
 * L'app n'a pas de flux de connexion : le serveur (user_id depuis le token Bearer)
 * renvoie « Authentification requise » dès qu'aucune session n'est attachée.
 * Les favoris sont donc persistés LOCALEMENT dans le navigateur, clé dédiée.
 * Le serveur conserve ses fonctions (`toggleFournisseurFavori` / `getFournisseurFavoris`)
 * pour un futur retour de l'auth — l'UI n'y fait plus appel.
 */
const CLE_FAVORIS = "pat-s11:fournisseurs:favoris";

/** Liste des ids favoris persistés (toujours un tableau, jamais d'exception). */
export function lireFavorisLocal(): string[] {
  try {
    const brut = localStorage.getItem(CLE_FAVORIS);
    if (!brut) return [];
    const parsed = JSON.parse(brut) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string" && x.length > 0);
  } catch {
    return [];
  }
}

function ecrireFavorisLocal(ids: string[]): void {
  try {
    localStorage.setItem(CLE_FAVORIS, JSON.stringify(ids));
  } catch {
    // stockage indisponible : favoris non persistés (non bloquant).
  }
}

/**
 * Hook favoris : état local + bascule persistée. `disponibles` est toujours
 * vrai (localStorage) → les étoiles restent actives sans authentification.
 */
export function useFavorisLocal() {
  const [ids, setIds] = useState<string[]>(() => lireFavorisLocal());
  const basculer = useCallback((id: string) => {
    setIds((prev) => {
      const suivant = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      ecrireFavorisLocal(suivant);
      return suivant;
    });
  }, []);
  const estFavori = useCallback((id: string | null | undefined) => !!id && ids.includes(id), [ids]);
  return { ids, basculer, estFavori, disponibles: true };
}
