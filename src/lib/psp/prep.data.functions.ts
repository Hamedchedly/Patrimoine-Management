/**
 * PSP — Lecture LECTURE SEULE des vraies données PAT S11 (V2).
 *
 * Trois requêtes (aucun N+1) :
 *  - `tranches`            → localité / sous-secteur / secteur S11 / nb logements ;
 *  - `lots`                → adresse / ville de référence par TR (paginé 1000) ;
 *  - `travaux_commandes`   → historique des commandes (jamais utilisé comme
 *    source du CC actuel — V7.6 §8 : le CC vient du référentiel sous-secteur).
 *
 * Aucune écriture : uniquement des `.select(...)` sur des tables existantes.
 * La référence est construite côté client (`psp.prep.data.ts`) à partir des
 * tableaux bruts renvoyés (une `Map` ne se sérialise pas proprement).
 */
import { createServerFn } from "@tanstack/react-start";

import { parseProgrammationWorkbook } from "./prep.data.ts";
import { parseTravauxWorkbook } from "../travaux/index.ts";
import type {
  ChargesClienteleReferentiel,
  CommandeRaw,
  LotRaw,
  TrancheRaw,
} from "./prep.data.ts";

export type DonneesReferenceBrutes = {
  tranches: TrancheRaw[];
  lots: LotRaw[];
  commandes: CommandeRaw[];
  /** Référentiel actuel sous_secteur → chargé de clientèle (V7.5). */
  chargesClientele: ChargesClienteleReferentiel[];
};

export const getPspReferencePatrimoine = createServerFn({ method: "GET" }).handler(
  async (): Promise<DonneesReferenceBrutes> => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;

    const PAGE = 1000;

    const tranchesResult = await db
      .from("tranches")
      .select("code, libelle, localite, sous_secteur, secteur, nb_logements")
      .eq("actif", true);
    if (tranchesResult.error) {
      throw new Error(`Lecture des tranches : ${tranchesResult.error.message}`);
    }

    const chargerPage = async (table: string, colonnes: string, from: number) =>
      db
        .from(table)
        .select(colonnes)
        .order("created_at")
        .range(from, from + PAGE - 1);

    const lots: LotRaw[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await chargerPage(
        "lots",
        "id, code_patrimoine, tranche_code, adresse, ville",
        from,
      );
      if (error) throw new Error(`Lecture des lots : ${error.message}`);
      const page = (data ?? []) as LotRaw[];
      lots.push(...page);
      if (page.length < PAGE) break;
    }

    const commandes: CommandeRaw[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await chargerPage(
        "travaux_commandes",
        "tranche_code, charge_clientele",
        from,
      );
      if (error) throw new Error(`Lecture des commandes : ${error.message}`);
      const page = (data ?? []) as CommandeRaw[];
      commandes.push(...page);
      if (page.length < PAGE) break;
    }

    const chargesClienteleResult = await db
      .from("psp_charges_clientele")
      .select("sous_secteur, charge_clientele, identifiant_personnel, actif")
      .eq("actif", true);
    if (chargesClienteleResult.error) {
      throw new Error(`Lecture du référentiel CC : ${chargesClienteleResult.error.message}`);
    }

    return {
      tranches: (tranchesResult.data ?? []) as TrancheRaw[],
      lots,
      commandes,
      chargesClientele: (chargesClienteleResult.data ?? []) as ChargesClienteleReferentiel[],
    };
  },
);

/** Consultation du référentiel chargé clientèle (V7.5 §8) — lecture seule. */
export const getPspChargesClientele = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
  const db = supabaseAdmin as any;
  const { data, error } = await db
    .from("psp_charges_clientele")
    .select("sous_secteur, charge_clientele, identifiant_personnel, actif")
    .order("sous_secteur", { ascending: true });
  if (error) throw new Error(`Lecture du référentiel CC : ${error.message}`);
  return (data ?? []) as ChargesClienteleReferentiel[];
});

/**
 * V8.16w — SOUS-SECTEURS RÉELS (synchronisés base patrimoine) : distincts depuis
 * `tranches.sous_secteur` (actives) UNIQUEMENT. Le secteur (S11) N'EST PAS un
 * sous-secteur (il regroupe tous les sous-secteurs) et ne doit JAMAIS y figurer.
 * Les sous-secteurs proviennent du fichier ISIS patrimoine — jamais créés/modifiés
 * manuellement. Source de vérité pour l'onglet « Chargés clientèle » des Paramètres
 * (aligné sur la console PSP preparation-psp.tsx) : un sous-secteur présent en base
 * est TOUJOURS listé, même sans CC.
 */
export const getSousSecteursConnus = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
  const db = supabaseAdmin as any;
  const set = new Set<string>();

  const { data: tranches } = await db.from("tranches").select("sous_secteur").eq("actif", true);
  for (const t of (tranches ?? []) as Array<{ sous_secteur: string | null }>) {
    const v = (t.sous_secteur ?? "").trim();
    if (v) set.add(v);
  }

  return [...set].sort((a, b) => a.localeCompare(b, "fr", { numeric: true }));
});

/**
 * V4 — Lecture des VRAIS fichiers 2026 (programmation + suivi) via le MOTEUR
 * D'IMPORT EXISTANT (aucun parseur parallèle) :
 *  - programmation : `parseProgrammationWorkbook` (feuille « Prog 2026 ») ;
 *  - suivi annuel  : `parseTravauxWorkbook` (moteur d'import annuel) —
 *    commandes + lignes sans commande (erreurs « Numéro de commande manquant »).
 *
 * Fichiers présents dans `data/2026/` (source de validation V4, suivie par git).
 * Aucune écriture, aucun stockage.
 */
export const getPspFichiers2026 = createServerFn({ method: "GET" }).handler(async () => {
  const { existsSync, readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const dir = fileURLToPath(new URL("../../data/2026/", import.meta.url));
  const cheminProg = `${dir}Prog_Secteur_11_2026.xlsx`;
  const cheminSuivi = `${dir}Suivi_Travaux_Secteur_2026.xlsx`;

  if (!existsSync(cheminProg) || !existsSync(cheminSuivi)) {
    return { disponible: false as const };
  }
  const arrayBuffer = (chemin: string): ArrayBuffer => {
    const b = readFileSync(chemin);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  };

  const programmation = parseProgrammationWorkbook(arrayBuffer(cheminProg), {
    nom: "Prog_Secteur_11_2026.xlsx",
    feuille: "Prog 2026",
  });
  const suivi = parseTravauxWorkbook(arrayBuffer(cheminSuivi));

  return { disponible: true as const, programmation, suivi };
});
