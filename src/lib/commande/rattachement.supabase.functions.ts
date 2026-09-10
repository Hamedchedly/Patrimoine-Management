/**
 * V8.17 — Helper SUPABASE du rattachement commande → lot.
 *
 * Charge, en UNE passe pour un lot de commandes :
 *  · les références ER de l'Historique CMD (`psp_import_rows`) rattachées par n° de commande
 *    (numero_commande_interne = numero_commande suivi, repli numero_commande) — PRIORITAIRES ;
 *  · les références ER de la ligne de suivi (adresse + descriptif) — repli ;
 *  · le référentiel `lots` (par code) pour ne retenir que les ER existants.
 * Puis résout (module pur `commande.rattachement.lots.ts`) et renvoie Map<commandeId, résolution>.
 *
 * Lecture seule. Le client Supabase (`db`) est passé en paramètre.
 */
import {
  creerIndexLots,
  refsErHistorique,
  refsErSuivi,
  resoudreRattachement,
  type LotPatrimoine,
  type ResolutionRattachementLot,
} from "./rattachement.lots.ts";

/** Colonnes `lots` utilisées par le rattachement. */
const SELECT_LOTS = "code_patrimoine, tranche_code, adresse, ville, actif";
/** Colonnes `psp_import_rows` porteuses de l'ER du lot. */
const SELECT_PSP_ER = "numero_commande, numero_commande_interne, patrimoine, lot_er, er_reference";

/** Commande à rattacher (champs minimum). */
export type CommandeARattacher = {
  id: string;
  numero_commande: string | null;
  adresse: string | null;
  descriptif: string | null;
};

/** Nettoie un numéro de commande pour comparaison (chiffres/lettres). */
const cleNumero = (v: string | null | undefined): string =>
  (v ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();

/**
 * Charge les lots du référentiel correspondant aux codes ER candidats.
 * (requête `.in` limitée aux codes en forme « ER.… » pour éviter un filtre vide/hors bornes)
 */
export async function chargerLotsParRefs(
  db: any,
  refs: string[],
): Promise<Map<string, LotPatrimoine>> {
  const codes = [...new Set(refs.map((r) => r.trim()))].filter((r) => /^ER\.[A-Za-z0-9]/i.test(r));
  if (codes.length === 0) return new Map();
  const { data, error } = await db
    .from("lots")
    .select(SELECT_LOTS)
    .in("code_patrimoine", codes.slice(0, 300));
  if (error) return new Map();
  return creerIndexLots((data ?? []) as LotPatrimoine[]);
}

/**
 * Résout le rattachement d'un lot de commandes.
 * @returns Map<commandeId, ResolutionRattachementLot>
 */
export async function rattacherLotsACommandes(
  db: any,
  commandes: CommandeARattacher[],
): Promise<Map<string, ResolutionRattachementLot>> {
  const result = new Map<string, ResolutionRattachementLot>();
  if (commandes.length === 0) return result;

  // 1. Réfs ER de la ligne suivi (adresse/descriptif) par commande.
  const refsSuiviParId = new Map<string, string[]>();
  const refsHistoriqueParId = new Map<string, string[]>();
  for (const c of commandes) {
    refsSuiviParId.set(c.id, refsErSuivi(c.adresse, c.descriptif));
  }

  // 2. Réfs ER de l'Historique CMD par commande (n° de commande → lignes psp_import_rows).
  const numeros = [...new Set(commandes.map((c) => cleNumero(c.numero_commande)).filter(Boolean))];
  if (numeros.length > 0) {
    const { data: rows, error } = await db
      .from("psp_import_rows")
      .select(SELECT_PSP_ER)
      .or(
        `numero_commande_interne.in.(${numeros.join(",")}),numero_commande.in.(${numeros.join(",")})`,
      );
    if (!error) {
      for (const c of commandes) {
        const num = cleNumero(c.numero_commande);
        if (!num) continue;
        const refs = new Set<string>();
        for (const r of (rows ?? []) as Array<Record<string, unknown>>) {
          const interne = cleNumero(String(r["numero_commande_interne"] ?? ""));
          const numero = cleNumero(String(r["numero_commande"] ?? ""));
          if (interne !== num && numero !== num) continue;
          for (const ref of refsErHistorique([
            String(r["patrimoine"] ?? ""),
            String(r["lot_er"] ?? ""),
            String(r["er_reference"] ?? ""),
          ])) {
            refs.add(ref);
          }
        }
        if (refs.size > 0) refsHistoriqueParId.set(c.id, [...refs]);
      }
    }
  }

  // 3. Référentiel `lots` (une seule requête sur l'union des refs).
  const toutesRefs = [
    ...[...refsSuiviParId.values()].flat(),
    ...[...refsHistoriqueParId.values()].flat(),
  ];
  const lotsIndex = await chargerLotsParRefs(db, toutesRefs);

  // 4. Résolution par commande (module pur).
  for (const c of commandes) {
    const resolution = resoudreRattachement({
      refsHistorique: refsHistoriqueParId.get(c.id) ?? [],
      refsSuivi: refsSuiviParId.get(c.id) ?? [],
      lotsIndex,
    });
    result.set(c.id, resolution);
  }
  return result;
}
