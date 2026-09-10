/**
 * Fournisseurs — Server functions du référentiel fournisseur (couche d'enrichissement).
 *
 * Aucune écriture sur les données sources (travaux_commandes, psp_import_rows, ISIS,
 * Excel) : les commandes sont rapprochées en LECTURE via travaux_commandes /
 * psp_import_rows / v_travaux_commandes_enrichies et les identifiants du référentiel.
 *
 * Les tables `fournisseurs`, `fournisseurs_contacts`, `fournisseur_aliases` peuvent ne
 * pas encore exister en base : chaque handler replie alors silencieusement
 * ({ disponibles: false … }) pour ne jamais casser l'application.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import {
  NOM_A_RENSEIGNER,
  type CommandeFournisseur,
  type ContactSaisie,
  type Fournisseur,
  type FournisseurAlias,
  type FournisseurContact,
  type FournisseurRow,
  calculerKpisFournisseur,
  matchRechercheEntreprise,
  monterIdentifiantsFournisseur,
  montantReference,
  normaliserCodeFournisseur,
  planifierMajContacts,
  refIsisDepuisAliases,
  resoudreFournisseursParCommande,
} from "./index.ts";
import {
  agregerParAnnee,
  calculerActivitesEffectives,
  calculerProfilActivite,
  calculerVillesFournisseur,
  correspondSurAuMoinsUnCorps,
  corpsPrincipauxEffectifs,
  derniereCommande,
  evolution,
  extraireCorpsEtatCode,
  meilleurNiveauCorps,
  partMarche,
  partMarchePrincipaux,
  planifierMajActivites,
  trierHistoriqueAnnuelDesc,
  type ActiviteEffective,
  type ActiviteManuelle,
  type FamilleMetier,
  type ProfilActivite,
  type ProfilNiveau,
} from "./analyse.ts";
import { villeDeCommande, type TrancheGeo, type VilleGeoPure } from "../travaux/index.ts";
import { extraireWNotes } from "../psp/validation";

/** Colonnes lues sur la vue de rapprochement pour les commandes d'un fournisseur. */
const SELECT_FOURNISSEUR_VIEW =
  "commande_id, numero_commande, numero_commande_interne, numero_fournisseur, fournisseur, " +
  "tranche_code, lot_code, batiment, adresse, annee_exercice, date_demarrage, " +
  "nature_suivi_annuel, corps_etat_suivi_annuel, engage, etat_commande, etat_travaux, " +
  "descriptif, " +
  "psp_fournisseur, psp_date_commande, psp_montant_engage, psp_patrimoine, psp_entree_num, " +
  "psp_corps_etat_libelle, psp_annee_exercice, psp_etat, psp_donnees_brutes";

/** Construit une commande fournisseur depuis une ligne de la vue (suivi + Historique CMD). */
const buildCommandeFournisseur = (r: Record<string, unknown>): CommandeFournisseur => {
  const dn = (r["psp_donnees_brutes"] as Record<string, unknown> | null) ?? null;
  const ref = montantReference(
    typeof r["engage"] === "number" ? (r["engage"] as number) : null,
    typeof r["psp_montant_engage"] === "number" ? (r["psp_montant_engage"] as number) : null,
  );
  return {
    id: String(r["commande_id"] ?? "") || null,
    numero_commande: String(r["numero_commande"] ?? r["numero_commande_interne"] ?? "") || "",
    date_commande: String(r["psp_date_commande"] ?? "") || null,
    date_demarrage: String(r["date_demarrage"] ?? "") || null,
    annee:
      typeof r["annee_exercice"] === "number"
        ? (r["annee_exercice"] as number)
        : typeof r["psp_annee_exercice"] === "number"
          ? (r["psp_annee_exercice"] as number)
          : null,
    corps_etat: String(r["corps_etat_suivi_annuel"] ?? "") || null,
    nature_travaux: String(r["psp_corps_etat_libelle"] ?? "") || null,
    categorie: String(r["nature_suivi_annuel"] ?? "") || null,
    descriptif: String(r["descriptif"] ?? "") || extraireWNotes(dn),
    tranche_code: String(r["tranche_code"] ?? "") || null,
    batiment: String(r["batiment"] ?? "") || null,
    entree: String(r["psp_entree_num"] ?? "") || null,
    lot_code: String(r["lot_code"] ?? "") || null,
    adresse: String(r["adresse"] ?? "") || null,
    patrimoine: String(r["psp_patrimoine"] ?? "") || null,
    patrimoine_ambigu: dn
      ? dn["er_ambigue"] === true || dn["niveau_rattachement"] === "ambiguous"
      : false,
    ville: null,
    montant: ref.montant,
    montant_type: ref.type,
    etat: String(r["etat_commande"] ?? r["psp_etat"] ?? r["etat_travaux"] ?? "") || null,
    fournisseur_source_code: String(r["numero_fournisseur"] ?? r["psp_fournisseur"] ?? "") || null,
  };
};

/** Ligne analytique de la liste Fournisseurs (lecture seule, dérivée des commandes).
 * `id` vaut null pour les refs suivi (Ref ISIS) encore sans fiche dans le référentiel :
 * les données affichées sont alors calculées depuis les commandes réelles, sans invention. */
export interface LigneFournisseurListe {
  id: string | null;
  nom: string;
  ref_isis: string | null;
  identifiants: string[];
  profil: ProfilActivite;
  nb_commandes: number;
  total_engage: number;
  commandes_annee: number;
  montant_annee: number;
  evolution_commandes: number | null;
  evolution_montant: number | null;
  part_marche_annee: number | null;
  part_marche_moyenne: number | null;
  annees_actives: number;
  nb_corps_etat: number;
  corps_etat_principal: string | null;
  niveau_corps_principal: ProfilNiveau | null;
  niveau_corps_recherche: ProfilNiveau | null;
  nb_lots: number;
  nb_tranches: number;
  nb_batiments: number;
  premiere_commande: number | null;
  derniere_commande: number | null;
  derniere_commande_date: string | null;
  derniere_commande_numero: string | null;
  /** Classification famille (CEA / CVC-P / TCE / AUTRE) — jamais un corps d'état. */
  famille: FamilleMetier;
  /** Libellés (codes conservés) des activités à niveau EFFECTIF principal. */
  corps_principaux_effectifs: string[];
  /** Part de marché de l'année cible — MODE PRINCIPAUX (activités principales effectives). */
  part_marche_annee_principaux: number | null;
  /** Montant de l'année cible sur les seules activités principales effectives. */
  montant_annee_principaux: number;
  favori: boolean;
  /** V8.16p — infos importantes manquantes (nom inconnu ou aucun email) → pastille. */
  a_completer: boolean;
  actif_annee: boolean;
  actif_3ans: boolean;
  actif_5ans: boolean;
  /** V8.16s — aucune commande sur la période sélectionnée (masqué par défaut). */
  sans_commande: boolean;
  rang_montant: number | null;
  rang_commandes: number | null;
}

// getFournisseursList — remplacé par la version analytique (insérée ci-dessous).
/**
 * Liste analytique du référentiel : KPIs par année, profil d'activité, familles
 * métier, part de marché, évolutions, filtres et tri (lecture seule).
 * Montant de référence : engage → repli psp_montant_engage (jamais mélangé).
 */
export const getFournisseursList = createServerFn({ method: "POST", strict: false })
  .validator((d: unknown) =>
    z
      .object({
        query: z.string().optional(),
        corpsEtats: z.array(z.string()).optional(),
        famille: z.enum(["CEA", "CVC-P", "TCE", "AUTRE"]).optional(),
        anneeDe: z.number().int().optional(),
        anneeFin: z.number().int().optional(),
        profil: z.enum(["principal", "secondaire", "occasionnel"]).optional(),
        activite: z.enum(["annee", "3ans", "5ans"]).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("../../integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    const vide = {
      disponibles: false,
      fournisseurs: [],
      annee: null,
      annee_min: null,
      annee_max: null,
      marche: {},
      corps_disponibles: [],
      favoris_disponibles: false,
      activites_disponibles: false,
    };
    try {
      const { data: fournisseurs, error } = await db
        .from("fournisseurs")
        .select("*")
        .order("nom", { ascending: true });
      if (error) return vide;

      const { data: aliasesData } = await db.from("fournisseur_aliases").select("*");
      const aliases = (aliasesData ?? []) as FournisseurAlias[];
      const aliasesParFournisseur = new Map<string, FournisseurAlias[]>();
      const fournisseurParIdentifiant = new Map<string, string>();
      for (const a of aliases) {
        const arr = aliasesParFournisseur.get(a.fournisseur_id) ?? [];
        arr.push(a);
        aliasesParFournisseur.set(a.fournisseur_id, arr);
        const code = normaliserCodeFournisseur(a.identifiant_source);
        if (code) fournisseurParIdentifiant.set(code, a.fournisseur_id);
      }

      // Activités manuelles / validées (couche de décision, table optionnelle).
      let activitesDisponibles = false;
      const manuellesParFournisseur = new Map<string, ActiviteManuelle[]>();
      try {
        const { data: actRows, error: eAct } = await db.from("fournisseur_activites").select("*");
        if (eAct) throw new Error(eAct.message);
        activitesDisponibles = true;
        for (const r of (actRows ?? []) as ActiviteManuelle[]) {
          const arr = manuellesParFournisseur.get(r.fournisseur_id) ?? [];
          arr.push(r);
          manuellesParFournisseur.set(r.fournisseur_id, arr);
        }
      } catch {
        // table absente : aucune activité manuelle, aucune erreur bloquante.
      }

      // Marché global par année (toutes commandes, indépendamment du référentiel).
      const { data: marcheRows } = await db
        .from("travaux_commandes")
        .select("annee_exercice, engage");
      const marcheAnnee = new Map<number, number>();
      for (const m of (marcheRows ?? []) as {
        annee_exercice: number | null;
        engage: number | null;
      }[]) {
        if (m.annee_exercice == null) continue;
        marcheAnnee.set(
          m.annee_exercice,
          (marcheAnnee.get(m.annee_exercice) ?? 0) + (m.engage ?? 0),
        );
      }
      const annees = [...marcheAnnee.keys()].sort((a, b) => a - b);
      const anneeMin = annees[0] ?? null;
      const anneeMax = annees[annees.length - 1] ?? null;
      // V8.16s — plage d'années du slider (min–max). Sans plage explicite → TOUTES les
      // années (anneeCible = dernière année disponible, ancrage des fenêtres 3/5 ans).
      const de = data.anneeDe;
      const fin = data.anneeFin;
      const plage = de != null && fin != null && de <= fin ? { de, fin } : null;
      const anneeCible = fin ?? anneeMax;
      const totalMarchePlage = plage
        ? [...marcheAnnee.entries()]
            .filter(([y]) => y >= plage.de && y <= plage.fin)
            .reduce((s, [, v]) => s + v, 0)
        : anneeCible != null
          ? (marcheAnnee.get(anneeCible) ?? 0)
          : 0;

      // Références suivi réelles (travaux_commandes.numero_fournisseur) — lecture seule.
      const { data: refsRows } = await db
        .from("travaux_commandes")
        .select("numero_fournisseur")
        .not("numero_fournisseur", "is", null);
      const refsDistinct = [
        ...new Set(
          ((refsRows ?? []) as { numero_fournisseur: string | null }[])
            .map((r) => normaliserCodeFournisseur(r.numero_fournisseur))
            .filter(Boolean),
        ),
      ].sort();

      // Commandes suivi par référence (une seule requête sur la vue de rapprochement).
      const commandesParRef = new Map<string, CommandeFournisseur[]>();
      if (refsDistinct.length > 0) {
        const { data: vue } = await db
          .from("v_travaux_commandes_enrichies")
          .select(SELECT_FOURNISSEUR_VIEW)
          .in("numero_fournisseur", refsDistinct);
        for (const r of (vue ?? []) as Record<string, unknown>[]) {
          const ref = normaliserCodeFournisseur(String(r["numero_fournisseur"] ?? ""));
          if (!ref) continue;
          const c = buildCommandeFournisseur(r);
          if (!c.numero_commande) continue;
          const arr = commandesParRef.get(ref) ?? [];
          arr.push(c);
          commandesParRef.set(ref, arr);
        }
      }

      // Commandes des fournisseurs du référentiel (suivi via alias + Historique CMD).
      const commandesParFournisseur = new Map<string, CommandeFournisseur[]>();
      for (const f of (fournisseurs ?? []) as Fournisseur[]) {
        const ids = monterIdentifiantsFournisseur(aliasesParFournisseur.get(f.id) ?? []);
        const m = new Map<string, CommandeFournisseur>();
        for (const idn of ids) {
          for (const c of commandesParRef.get(idn) ?? []) m.set(c.numero_commande, c);
        }
        commandesParFournisseur.set(f.id, [...m.values()]);
      }
      const identifiants = [...fournisseurParIdentifiant.keys()];
      if (identifiants.length > 0) {
        const { data: vuePsp } = await db
          .from("v_travaux_commandes_enrichies")
          .select(SELECT_FOURNISSEUR_VIEW)
          .in("psp_fournisseur", identifiants);
        for (const r of (vuePsp ?? []) as Record<string, unknown>[]) {
          const fid = fournisseurParIdentifiant.get(
            normaliserCodeFournisseur(String(r["psp_fournisseur"] ?? "")),
          );
          if (!fid) continue;
          const c = buildCommandeFournisseur(r);
          if (!c.numero_commande) continue;
          const m = new Map<string, CommandeFournisseur>();
          for (const x of commandesParFournisseur.get(fid) ?? []) m.set(x.numero_commande, x);
          m.set(c.numero_commande, c);
          commandesParFournisseur.set(fid, [...m.values()]);
        }
      }

      // Corps d'état disponibles (toutes les commandes suivi + Historique CMD).
      const corpsSet = new Set<string>();
      for (const arr of commandesParRef.values()) {
        for (const c of arr) if (c.corps_etat) corpsSet.add(c.corps_etat);
      }
      for (const arr of commandesParFournisseur.values()) {
        for (const c of arr) if (c.corps_etat) corpsSet.add(c.corps_etat);
      }
      const corps_disponibles = [...corpsSet].sort((a, b) => a.localeCompare(b));

      // Favoris (table optionnelle — absente tant que la migration n'est pas validée).
      const userId = userIdDepuisRequete();
      let favorisSet = new Set<string>();
      let favorisDisponibles = false;
      if (userId) {
        try {
          const { data: fav } = await db
            .from("fournisseur_favoris")
            .select("fournisseur_id")
            .eq("user_id", userId);
          if (fav) {
            favorisSet = new Set(
              (fav as { fournisseur_id: string }[]).map((x) => x.fournisseur_id),
            );
            favorisDisponibles = true;
          }
        } catch {
          // table absente : favoris non disponibles, aucune erreur bloquante.
        }
      }
      // V8.16p — emails des contacts (pastille « à compléter » si nom ou email manquant).
      const emailParFournisseur = new Set<string>();
      try {
        const { data: contactsRows } = await db
          .from("fournisseurs_contacts")
          .select("fournisseur_id")
          .not("email", "is", null);
        for (const r of (contactsRows ?? []) as { fournisseur_id: string }[]) {
          if (r.fournisseur_id) emailParFournisseur.add(r.fournisseur_id);
        }
      } catch {
        // table absente : aucune erreur bloquante.
      }
      // Construction des lignes analytiques (fournisseurs référencés + refs suivi sans fiche).
      const ligneDepuis = (params: {
        f: Fournisseur | null;
        ref: string | null;
        identifiants: string[];
        commandes: CommandeFournisseur[];
        manuelles: ActiviteManuelle[];
        favori: boolean;
      }): LigneFournisseurListe => {
        const { f, ref, identifiants: ids, commandes, manuelles, favori } = params;
        const profil = calculerProfilActivite(commandes);
        const { codes: codesPrincipaux, libelles: corpsPrincipauxLibelles } =
          corpsPrincipauxEffectifs(profil, manuelles);
        const parAnnee = agregerParAnnee(commandes);
        const dern = derniereCommande(commandes);
        // V8.16s — agrégation sur la plage du slider (sinon année cible unique).
        const parAnneePlage = plage
          ? parAnnee.filter((a) => a.annee >= plage.de && a.annee <= plage.fin)
          : parAnnee.filter((a) => a.annee === anneeCible);
        const commandes_annee = parAnneePlage.reduce((s, a) => s + a.commandes, 0);
        const montant_annee = parAnneePlage.reduce((s, a) => s + a.montant, 0);
        // Période précédente de même largeur (décalage −1 an) pour l'évolution.
        const parAnneePrecedente = plage
          ? parAnnee.filter((a) => a.annee >= plage.de - 1 && a.annee <= plage.fin - 1)
          : parAnnee.filter((a) => a.annee === (anneeCible ?? 0) - 1);
        const commandes_precedentes = parAnneePrecedente.reduce((s, a) => s + a.commandes, 0);
        const montant_precedent = parAnneePrecedente.reduce((s, a) => s + a.montant, 0);
        const pmPrincipaux = partMarchePrincipaux(
          commandes.filter((c) =>
            plage
              ? c.annee != null && c.annee >= plage.de && c.annee <= plage.fin
              : c.annee === anneeCible,
          ),
          codesPrincipaux,
          totalMarchePlage,
        );
        const famille: FamilleMetier = profil.est_tce
          ? "TCE"
          : (profil.famille_principale ?? "AUTRE");
        let sommeParts = 0;
        let nbParts = 0;
        for (const a of parAnnee) {
          const pm = partMarche(a.montant, marcheAnnee.get(a.annee) ?? 0);
          if (pm != null) {
            sommeParts += pm;
            nbParts += 1;
          }
        }
        return {
          id: f?.id ?? null,
          nom: f?.nom ?? "",
          ref_isis: ref,
          identifiants: ids,
          profil,
          nb_commandes: commandes.length,
          total_engage: commandes.reduce((s, c) => s + (c.montant ?? 0), 0),
          commandes_annee,
          montant_annee,
          evolution_commandes: evolution(commandes_annee, commandes_precedentes),
          evolution_montant: evolution(montant_annee, montant_precedent),
          part_marche_annee: partMarche(montant_annee, totalMarchePlage),
          part_marche_annee_principaux: pmPrincipaux.part,
          montant_annee_principaux: pmPrincipaux.montant,
          part_marche_moyenne: nbParts > 0 ? sommeParts / nbParts : null,
          annees_actives: parAnnee.length,
          nb_corps_etat: profil.corps.length,
          corps_etat_principal: profil.corps[0]?.corps_etat ?? null,
          niveau_corps_principal: profil.corps[0]?.niveau ?? null,
          niveau_corps_recherche: data.corpsEtats?.length
            ? meilleurNiveauCorps(profil, data.corpsEtats)
            : null,
          famille,
          corps_principaux_effectifs: corpsPrincipauxLibelles,
          nb_lots: new Set(commandes.map((c) => c.lot_code).filter(Boolean)).size,
          nb_tranches: new Set(commandes.map((c) => c.tranche_code).filter(Boolean)).size,
          nb_batiments: new Set(commandes.map((c) => c.batiment).filter(Boolean)).size,
          premiere_commande: parAnnee[0]?.annee ?? null,
          derniere_commande: parAnnee[parAnnee.length - 1]?.annee ?? null,
          derniere_commande_date: dern.date,
          derniere_commande_numero: dern.numero,
          favori,
          a_completer: !f?.id || !emailParFournisseur.has(f?.id ?? ""),
          actif_annee: commandes_annee > 0,
          actif_3ans: anneeCible != null && parAnnee.some((a) => a.annee >= anneeCible - 2),
          actif_5ans: anneeCible != null && parAnnee.some((a) => a.annee >= anneeCible - 4),
          // V8.16s — aucune commande sur la période sélectionnée (masqué par défaut).
          sans_commande: commandes_annee === 0,
          rang_montant: null,
          rang_commandes: null,
        };
      };

      const lignes: LigneFournisseurListe[] = [];
      const refsCouvertes = new Set<string>();
      for (const f of (fournisseurs ?? []) as Fournisseur[]) {
        const ids = monterIdentifiantsFournisseur(aliasesParFournisseur.get(f.id) ?? []);
        const ref = refIsisDepuisAliases(aliasesParFournisseur.get(f.id) ?? []);
        if (ref) refsCouvertes.add(ref);
        lignes.push(
          ligneDepuis({
            f,
            ref,
            identifiants: ids,
            commandes: commandesParFournisseur.get(f.id) ?? [],
            manuelles: manuellesParFournisseur.get(f.id) ?? [],
            favori: favorisSet.has(f.id),
          }),
        );
      }
      // Refs suivi réelles encore sans fiche → ligne virtuelle (nom jamais inventé).
      for (const ref of refsDistinct) {
        if (refsCouvertes.has(ref)) continue;
        lignes.push(
          ligneDepuis({
            f: null,
            ref,
            identifiants: [ref],
            commandes: commandesParRef.get(ref) ?? [],
            manuelles: [],
            favori: false,
          }),
        );
      }

      // Rangs (année cible).
      const rangMontant = new Map<string, number>();
      const rangCommandes = new Map<string, number>();
      const rangCle = (l: LigneFournisseurListe) => l.id ?? `ref:${l.ref_isis ?? ""}`;
      [...lignes]
        .sort((a, b) => b.montant_annee - a.montant_annee)
        .forEach((l, i) => rangMontant.set(rangCle(l), i + 1));
      [...lignes]
        .sort((a, b) => b.commandes_annee - a.commandes_annee)
        .forEach((l, i) => rangCommandes.set(rangCle(l), i + 1));
      for (const l of lignes) {
        l.rang_montant = rangMontant.get(rangCle(l)) ?? null;
        l.rang_commandes = rangCommandes.get(rangCle(l)) ?? null;
      }

      // Filtres combinables.
      let result: LigneFournisseurListe[] = lignes;
      if (data.corpsEtats?.length) {
        result = result.filter((l) => correspondSurAuMoinsUnCorps(l.profil, data.corpsEtats ?? []));
      }
      if (data.famille === "TCE") {
        result = result.filter((l) => l.profil.est_tce);
      } else if (data.famille) {
        result = result.filter((l) =>
          l.profil.familles.some((fm) => fm.famille === data.famille && fm.commandes > 0),
        );
      }
      if (data.profil) {
        result = result.filter(
          (l) => (l.niveau_corps_recherche ?? l.niveau_corps_principal) === data.profil,
        );
      }
      // V8.16s — favoris filtrés côté client (localStorage) : plus de filtre serveur.
      if (data.activite === "annee") result = result.filter((l) => l.actif_annee);
      if (data.activite === "3ans") result = result.filter((l) => l.actif_3ans);
      if (data.activite === "5ans") result = result.filter((l) => l.actif_5ans);
      if (data.query) {
        result = result.filter((l) =>
          matchRechercheEntreprise(l.nom, l.ref_isis, l.identifiants, data.query ?? ""),
        );
      }

      return {
        disponibles: true,
        fournisseurs: result,
        annee: anneeCible,
        annee_min: anneeMin,
        annee_max: anneeMax,
        marche: Object.fromEntries(marcheAnnee),
        corps_disponibles,
        favoris_disponibles: favorisDisponibles,
        activites_disponibles: activitesDisponibles,
      };
    } catch (e) {
      console.error("getFournisseursList:", e);
      return vide;
    }
  });

/**
 * Fiche complète d'un fournisseur : infos, contacts, alias, commandes liées
 * (suivi + Historique CMD + patrimoine), activités (corps d'état) et KPIs.
 * Lecture seule. Montant de référence : engage → repli psp_montant_engage.
 */
export const getFournisseurDetail = createServerFn({ method: "POST", strict: false })
  .validator((d: unknown) =>
    z.object({ id: z.string().uuid(), annee: z.number().int().optional() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("../../integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    const vide = {
      disponibles: false,
      fournisseur: null,
      contacts: [],
      commandes: [],
      activites: [],
      kpis: null,
      aliases: [],
      profil: null,
      activites_effectives: [],
      activites_manuel: [],
      activites_disponibles: false,
      corps_disponibles: [],
      historique_annuel: [],
      corps_etat_table: [],
      patrimoine: null,
      villes_carte: [],
      villes_non_localisees: [],
      commandes_sans_ville: 0,
      favori: false,
      annee: null,
      annee_max: null,
      kpis_annee: null,
    };
    try {
      const { data: f, error } = await db
        .from("fournisseurs")
        .select("*")
        .eq("id", data.id)
        .maybeSingle();
      if (error || !f) return vide;
      const fournisseur = f as Fournisseur;

      const { data: contacts } = await db
        .from("fournisseurs_contacts")
        .select("*")
        .eq("fournisseur_id", data.id)
        .order("ordre", { ascending: true });
      const { data: aliasesData } = await db
        .from("fournisseur_aliases")
        .select("*")
        .eq("fournisseur_id", data.id);
      const aliases = (aliasesData ?? []) as FournisseurAlias[];

      // Activités manuelles / validées (couche de décision, table optionnelle).
      let activitesDisponibles = false;
      const activites_manuel: ActiviteManuelle[] = [];
      try {
        const { data: actRows, error: eAct } = await db
          .from("fournisseur_activites")
          .select("*")
          .eq("fournisseur_id", data.id);
        if (eAct) throw new Error(eAct.message);
        activitesDisponibles = true;
        activites_manuel.push(...((actRows ?? []) as ActiviteManuelle[]));
      } catch {
        // table absente : aucune activité manuelle, aucune erreur bloquante.
      }

      const ids = monterIdentifiantsFournisseur(aliases);
      const commandesMap = new Map<string, CommandeFournisseur>();

      // Commandes via la vue (une ligne par commande : suivi + Historique CMD).
      if (ids.length > 0) {
        const { data: vue } = await db
          .from("v_travaux_commandes_enrichies")
          .select(SELECT_FOURNISSEUR_VIEW)
          .in("numero_fournisseur", ids);
        for (const r of (vue ?? []) as Record<string, unknown>[]) {
          const c = buildCommandeFournisseur(r);
          if (c.numero_commande) commandesMap.set(c.numero_commande, c);
        }
        const { data: vuePsp } = await db
          .from("v_travaux_commandes_enrichies")
          .select(SELECT_FOURNISSEUR_VIEW)
          .in("psp_fournisseur", ids);
        for (const r of (vuePsp ?? []) as Record<string, unknown>[]) {
          const c = buildCommandeFournisseur(r);
          if (c.numero_commande) commandesMap.set(c.numero_commande, c);
        }
      }

      // Lignes Historique CMD sans commande suivi associée (complétude historique).
      const comnCouverts = new Set(commandesMap.keys());
      const { data: pspr } = await db
        .from("psp_import_rows")
        .select(
          "numero_commande_interne, fournisseur, date_commande, montant_engage, patrimoine, corps_etat_libelle, donnees_brutes",
        )
        .in("fournisseur", ids);
      for (const r of (pspr ?? []) as Record<string, unknown>[]) {
        const comn = String(r["numero_commande_interne"] ?? "");
        if (!comn || comnCouverts.has(comn)) continue;
        const dn = (r["donnees_brutes"] as Record<string, unknown> | null) ?? {};
        const ref = montantReference(
          null,
          typeof r["montant_engage"] === "number" ? (r["montant_engage"] as number) : null,
        );
        commandesMap.set(comn, {
          id: null,
          numero_commande: comn,
          date_commande: String(r["date_commande"] ?? "") || null,
          date_demarrage: null,
          annee: null,
          corps_etat: null,
          nature_travaux: String(r["corps_etat_libelle"] ?? "") || null,
          categorie: null,
          descriptif: extraireWNotes(dn),
          tranche_code: null,
          batiment: null,
          entree: null,
          lot_code: null,
          adresse: String(dn["adresse"] ?? "") || null,
          patrimoine: String(r["patrimoine"] ?? "") || null,
          patrimoine_ambigu: dn["er_ambigue"] === true || dn["niveau_rattachement"] === "ambiguous",
          ville: null,
          montant: ref.montant,
          montant_type: ref.type,
          etat: null,
          fournisseur_source_code: String(r["fournisseur"] ?? "") || null,
        });
      }

      // Référentiel géographique (lecture seule, repli silencieux) — même source que le
      // Dashboard Travaux : tranches (localité) + villes_geo (coordonnées communales).
      let tranches: TrancheGeo[] = [];
      let villesGeo: VilleGeoPure[] = [];
      try {
        const { data: tr } = await db.from("tranches").select("code, localite").eq("actif", true);
        tranches = ((tr ?? []) as { code: string; localite: string | null }[]).map((t) => ({
          code: t.code,
          localite: t.localite,
        }));
        const { data: vg } = await db.from("villes_geo").select("ville, lat, lng");
        villesGeo = ((vg ?? []) as { ville: string; lat: number; lng: number }[]).map((v) => ({
          ville: v.ville,
          lat: v.lat,
          lng: v.lng,
          n: 1,
        }));
      } catch {
        // géographie indisponible : aucune coordonnée inventée, villes non localisées.
      }

      const commandes = [...commandesMap.values()].map((c) => ({
        ...c,
        ville: villeDeCommande(
          { adresse: c.adresse, tranche_code: c.tranche_code },
          tranches,
          villesGeo,
        ),
      }));
      const activites = [
        ...new Set(commandes.map((c) => c.corps_etat).filter((x): x is string => !!x)),
      ].sort((a, b) => a.localeCompare(b));
      const kpis = calculerKpisFournisseur(commandes);

      // Profil d'activité (toutes années) + tableau des corps d'état.
      const profil = calculerProfilActivite(commandes);
      const corps_etat_table = profil.corps;
      const activites_effectives = calculerActivitesEffectives(profil, activites_manuel);

      // Corps d'état réellement disponibles dans le suivi annuel (jamais inventés).
      const { data: corpsRows } = await db
        .from("travaux_commandes")
        .select("corps_etat")
        .not("corps_etat", "is", null);
      const corpsDispoMap = new Map<
        string,
        { corps_etat: string; code: string; libelle: string }
      >();
      for (const r of (corpsRows ?? []) as { corps_etat: string }[]) {
        const { code } = extraireCorpsEtatCode(r.corps_etat);
        if (!code || corpsDispoMap.has(code)) continue;
        corpsDispoMap.set(code, {
          corps_etat: r.corps_etat,
          code,
          libelle: r.corps_etat,
        });
      }
      const corps_disponibles = [...corpsDispoMap.values()].sort((a, b) =>
        a.corps_etat.localeCompare(b.corps_etat),
      );

      // Marché global par année (toutes commandes, indépendamment du référentiel).
      const { data: marcheRows } = await db
        .from("travaux_commandes")
        .select("annee_exercice, engage");
      const marcheAnnee = new Map<number, number>();
      for (const m of (marcheRows ?? []) as {
        annee_exercice: number | null;
        engage: number | null;
      }[]) {
        if (m.annee_exercice == null) continue;
        marcheAnnee.set(
          m.annee_exercice,
          (marcheAnnee.get(m.annee_exercice) ?? 0) + (m.engage ?? 0),
        );
      }

      // Historique annuel (commandes, montant, part de marché par année).
      // Tri PAR DÉFAUT : année décroissante (2026 → 2023), jamais inversé au chargement.
      const historiqueBrut = agregerParAnnee(commandes).map((a) => ({
        ...a,
        part_marche: partMarche(a.montant, marcheAnnee.get(a.annee) ?? 0),
      }));
      const anneesMax = historiqueBrut[historiqueBrut.length - 1]?.annee ?? null;
      const historique_annuel = trierHistoriqueAnnuelDesc(historiqueBrut);
      const anneeCible = data.annee ?? anneesMax;
      const anneeActuelle = historiqueBrut.find((a) => a.annee === anneeCible);
      const anneePrec = historiqueBrut.find((a) => a.annee === (anneeCible ?? 0) - 1);
      const kpis_annee = {
        annee: anneeCible,
        commandes: anneeActuelle?.commandes ?? 0,
        montant: anneeActuelle?.montant ?? 0,
        evolution_commandes: evolution(anneeActuelle?.commandes ?? 0, anneePrec?.commandes ?? 0),
        evolution_montant: evolution(anneeActuelle?.montant ?? 0, anneePrec?.montant ?? 0),
        part_marche: partMarche(
          anneeActuelle?.montant ?? 0,
          anneeCible != null ? (marcheAnnee.get(anneeCible) ?? 0) : 0,
        ),
        part_marche_moyenne:
          historique_annuel.length > 0
            ? historique_annuel.reduce((s, a) => s + (a.part_marche ?? 0), 0) /
              historique_annuel.length
            : null,
      };

      // Patrimoine ventilé (tranches / bâtiments / entrées / lots / villes).
      const villesResolues = [
        ...new Set(commandes.map((c) => c.ville).filter((x): x is string => !!x)),
      ].sort();
      const patrimoine = {
        tranches: [
          ...new Set(commandes.map((c) => c.tranche_code).filter((x): x is string => !!x)),
        ].sort(),
        batiments: [
          ...new Set(commandes.map((c) => c.batiment).filter((x): x is string => !!x)),
        ].sort(),
        entrees: [
          ...new Set(commandes.map((c) => c.entree).filter((x): x is string => !!x)),
        ].sort(),
        lots: [...new Set(commandes.map((c) => c.lot_code).filter((x): x is string => !!x))].sort(),
        villes: villesResolues,
      };

      // Villes de la carte (lecture seule, calculées depuis les commandes liées).
      const villesCarte = calculerVillesFournisseur(commandes, tranches, villesGeo);

      // Favori (table optionnelle — absente tant que la migration n'est pas validée).
      let favori = false;
      const userId = userIdDepuisRequete();
      if (userId) {
        try {
          const { data: fav } = await db
            .from("fournisseur_favoris")
            .select("fournisseur_id")
            .eq("user_id", userId)
            .eq("fournisseur_id", data.id)
            .maybeSingle();
          favori = !!fav;
        } catch {
          // table absente : favori non disponible, aucune erreur bloquante.
        }
      }

      return {
        disponibles: true,
        fournisseur,
        contacts: (contacts ?? []) as FournisseurContact[],
        commandes,
        activites,
        kpis,
        aliases,
        profil,
        activites_effectives,
        activites_manuel,
        activites_disponibles: activitesDisponibles,
        corps_disponibles,
        historique_annuel,
        corps_etat_table,
        patrimoine,
        villes_carte: villesCarte.villes,
        villes_non_localisees: villesCarte.nonLocalisees,
        commandes_sans_ville: villesCarte.commandesSansVille,
        favori,
        annee: anneeCible,
        annee_max: anneesMax,
        kpis_annee,
      };
    } catch (e) {
      console.error("getFournisseurDetail:", e);
      return vide;
    }
  });

/**
 * Résout, pour une liste de commandes, le fournisseur référencé (le cas échéant).
 * Utilisé par le dashboard et /adresses pour afficher le nom enrichi sans jamais
 * remplacer la donnée source (numero_fournisseur / FRAN_NUM restent affichés).
 */
export const getFournisseursPourCommandes = createServerFn({ method: "POST", strict: false })
  .validator((d: unknown) =>
    z.object({ commandeIds: z.array(z.string().uuid()).max(1000) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("../../integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    try {
      if (data.commandeIds.length === 0) return {};
      const { data: cmd } = await db
        .from("travaux_commandes")
        .select("id, numero_commande, numero_fournisseur")
        .in("id", data.commandeIds);
      const commandes = (cmd ?? []) as {
        id: string;
        numero_commande: string;
        numero_fournisseur: string | null;
      }[];
      if (commandes.length === 0) return {};

      // FRAN_NUM de l'Historique CMD par commande (via numero_commande_interne).
      const pspFournisseurs: Record<string, string[]> = {};
      const numeros = commandes.map((c) => c.numero_commande);
      const { data: pspr } = await db
        .from("psp_import_rows")
        .select("numero_commande_interne, fournisseur")
        .in("numero_commande_interne", numeros);
      for (const r of (pspr ?? []) as {
        numero_commande_interne: string | null;
        fournisseur: string | null;
      }[]) {
        const c = commandes.find((x) => x.numero_commande === r.numero_commande_interne);
        if (!c) continue;
        const code = normaliserCodeFournisseur(r.fournisseur);
        if (!code) continue;
        const arr = pspFournisseurs[c.id] ?? [];
        arr.push(code);
        pspFournisseurs[c.id] = arr;
      }

      const { data: fournisseurs } = await db.from("fournisseurs").select("*");
      const { data: aliasesData } = await db.from("fournisseur_aliases").select("*");
      const aliases = (aliasesData ?? []) as FournisseurAlias[];

      return resoudreFournisseursParCommande(
        commandes,
        pspFournisseurs,
        (fournisseurs ?? []) as Fournisseur[],
        aliases,
      );
    } catch {
      return {};
    }
  });

/**
 * Crée un fournisseur dans le référentiel (contacts + alias optionnels).
 * La création est possible même si l'entreprise n'apparaît encore dans aucune
 * commande. Aucune donnée source n'est modifiée.
 */
export const createFournisseur = createServerFn({ method: "POST", strict: false })
  .validator((d: unknown) =>
    z
      .object({
        nom: z.string().min(1),
        adresse: z.string().nullish(),
        complementAdresse: z.string().nullish(),
        codePostal: z.string().nullish(),
        ville: z.string().nullish(),
        pays: z.string().nullish(),
        siteWeb: z.string().nullish(),
        notes: z.string().nullish(),
        contacts: z
          .array(
            z.object({
              nom: z.string(),
              fonction: z.string().nullish(),
              email: z.string().nullish(),
              telephone: z.string().nullish(),
            }),
          )
          .default([]),
        aliases: z
          .array(
            z.object({
              source: z.enum(["travaux_commandes", "psp_import_rows"]),
              identifiantSource: z.string().min(1),
            }),
          )
          .default([]),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("../../integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    const now = new Date().toISOString();
    try {
      const { data: f, error } = await db
        .from("fournisseurs")
        .insert({
          nom: data.nom,
          adresse: data.adresse ?? null,
          complement_adresse: data.complementAdresse ?? null,
          code_postal: data.codePostal ?? null,
          ville: data.ville ?? null,
          pays: data.pays ?? null,
          site_web: data.siteWeb ?? null,
          notes: data.notes ?? null,
          created_at: now,
          updated_at: now,
        })
        .select("*")
        .single();
      if (error) return { ok: false, error: error.message };

      for (let i = 0; i < data.contacts.length; i += 1) {
        const c = data.contacts[i] as {
          nom: string;
          fonction?: string;
          email?: string;
          telephone?: string;
        };
        await db.from("fournisseurs_contacts").insert({
          fournisseur_id: f.id,
          nom: c.nom,
          fonction: c.fonction ?? null,
          email: c.email ?? null,
          telephone: c.telephone ?? null,
          ordre: i,
          created_at: now,
          updated_at: now,
        });
      }
      for (const a of data.aliases) {
        await db.from("fournisseur_aliases").insert({
          fournisseur_id: f.id,
          source: a.source,
          identifiant_source: a.identifiantSource,
          created_at: now,
        });
      }
      return { ok: true, fournisseur: f };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue" };
    }
  });

/**
 * Crée la fiche d'un fournisseur depuis une Ref ISIS du suivi annuel (sans inventer
 * le nom). Écritures UNIQUEMENT dans fournisseurs + fournisseur_aliases.
 * Idempotent : si l'alias (source 'travaux_commandes') existe déjà, retourne la fiche.
 * Le nom réel reste à renseigner manuellement ; le placeholder NOM_A_RENSEIGNER est
 * affiché partout comme « Entreprise non renseignée » (jamais comme un vrai nom).
 */
export const creerFournisseurDepuisRef = createServerFn({ method: "POST", strict: false })
  .validator((d: unknown) => z.object({ ref: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    const ref = normaliserCodeFournisseur(data.ref);
    if (!ref) return { ok: false, error: "Référence invalide." };
    const { supabaseAdmin } = await import("../../integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    const now = new Date().toISOString();
    try {
      const { data: existant } = await db
        .from("fournisseur_aliases")
        .select("fournisseur_id")
        .eq("source", "travaux_commandes")
        .eq("identifiant_source", ref)
        .maybeSingle();
      if (existant?.fournisseur_id) {
        return { ok: true, fournisseur_id: existant.fournisseur_id as string, dejaExistant: true };
      }
      const { data: f, error } = await db
        .from("fournisseurs")
        .insert({
          nom: NOM_A_RENSEIGNER,
          adresse: null,
          complement_adresse: null,
          code_postal: null,
          ville: null,
          pays: null,
          site_web: null,
          notes: null,
          created_at: now,
          updated_at: now,
        })
        .select("id")
        .single();
      if (error) return { ok: false, error: error.message };
      const { error: eAlias } = await db.from("fournisseur_aliases").insert({
        fournisseur_id: f.id,
        source: "travaux_commandes",
        identifiant_source: ref,
        created_at: now,
      });
      if (eAlias) return { ok: false, error: eAlias.message };
      return { ok: true, fournisseur_id: f.id as string, dejaExistant: false };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue" };
    }
  });

/**
 * Met à jour la fiche fournisseur (identité, coordonnées, notes) et ses contacts
 * (ajout / modification / suppression). Écritures UNIQUEMENT dans fournisseurs +
 * fournisseurs_contacts. Jamais dans les tables sources.
 */
export const updateFournisseur = createServerFn({ method: "POST", strict: false })
  .validator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        nom: z.string().min(1),
        adresse: z.string().nullish(),
        complementAdresse: z.string().nullish(),
        codePostal: z.string().nullish(),
        ville: z.string().nullish(),
        pays: z.string().nullish(),
        siteWeb: z.string().nullish(),
        notes: z.string().nullish(),
        contacts: z
          .array(
            z.object({
              id: z.string().uuid().nullish(),
              nom: z.string().min(1),
              fonction: z.string().nullish(),
              email: z.string().nullish(),
              telephone: z.string().nullish(),
            }),
          )
          .default([]),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("../../integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    const now = new Date().toISOString();
    try {
      const { error: eUpd } = await db
        .from("fournisseurs")
        .update({
          nom: data.nom.trim(),
          adresse: data.adresse?.trim() || null,
          complement_adresse: data.complementAdresse?.trim() || null,
          code_postal: data.codePostal?.trim() || null,
          ville: data.ville?.trim() || null,
          pays: data.pays?.trim() || null,
          site_web: data.siteWeb?.trim() || null,
          notes: data.notes?.trim() || null,
          updated_at: now,
        })
        .eq("id", data.id);
      if (eUpd) return { ok: false, error: eUpd.message };

      const { data: existants } = await db
        .from("fournisseurs_contacts")
        .select("*")
        .eq("fournisseur_id", data.id);
      const plan = planifierMajContacts(
        (existants ?? []) as FournisseurContact[],
        data.contacts as ContactSaisie[],
      );
      const ordreDepart = (existants ?? []).length;
      for (let i = 0; i < plan.creer.length; i += 1) {
        const c = plan.creer[i] as ContactSaisie;
        await db.from("fournisseurs_contacts").insert({
          fournisseur_id: data.id,
          nom: c.nom,
          fonction: c.fonction ?? null,
          email: c.email ?? null,
          telephone: c.telephone ?? null,
          ordre: ordreDepart + i,
          created_at: now,
          updated_at: now,
        });
      }
      for (const m of plan.modifier) {
        await db
          .from("fournisseurs_contacts")
          .update({
            nom: m.contact.nom,
            fonction: m.contact.fonction ?? null,
            email: m.contact.email ?? null,
            telephone: m.contact.telephone ?? null,
            updated_at: now,
          })
          .eq("id", m.id);
      }
      for (const s of plan.supprimer) {
        await db.from("fournisseurs_contacts").delete().eq("id", s.id);
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue" };
    }
  });

/**
 * Enregistre les activités manuelles / validées d'un fournisseur (niveau décidé
 * par l'utilisateur). Écritures UNIQUEMENT dans fournisseur_activites.
 * Couche de décision : niveau_auto n'est jamais écrasé (retour au calcul possible).
 * Table absente → { ok:false, indisponible:true } (migration à valider).
 */
export const saveActivitesManuelles = createServerFn({ method: "POST", strict: false })
  .validator((d: unknown) =>
    z
      .object({
        fournisseurId: z.string().uuid(),
        activites: z
          .array(
            z.object({
              corps_etat_code: z.string().min(1),
              corps_etat_libelle: z.string().min(1),
              niveau: z.enum(["principal", "secondaire", "occasionnel"]),
            }),
          )
          .default([]),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("../../integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    const now = new Date().toISOString();
    let existantes: ActiviteManuelle[];
    try {
      const { data: rows, error: eRows } = await db
        .from("fournisseur_activites")
        .select("*")
        .eq("fournisseur_id", data.fournisseurId);
      if (eRows) throw new Error(eRows.message);
      existantes = (rows ?? []) as ActiviteManuelle[];
    } catch {
      return {
        ok: false,
        indisponible: true,
        error: "Couche fournisseur_activites indisponible (migration à valider).",
      };
    }
    try {
      const plan = planifierMajActivites(existantes, data.activites);
      for (const c of plan.creer) {
        await db.from("fournisseur_activites").insert({
          fournisseur_id: data.fournisseurId,
          corps_etat_code: c.corps_etat_code,
          corps_etat_libelle: c.corps_etat_libelle,
          niveau: c.niveau,
          source: "manuel",
          created_at: now,
          updated_at: now,
        });
      }
      for (const m of plan.modifier) {
        await db
          .from("fournisseur_activites")
          .update({ niveau: m.saisie.niveau, updated_at: now })
          .eq("id", m.id);
      }
      for (const s of plan.supprimer) {
        await db.from("fournisseur_activites").delete().eq("id", s.id);
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue" };
    }
  });

/**
 * Identifiant utilisateur depuis le token Bearer de la requête (décodage du JWT,
 * sans validation — la validation est assurée par l'infrastructure d'auth existante).
 * Retourne null si absent → les favoris sont alors indisponibles (aucune écriture).
 */
function userIdDepuisRequete(): string | null {
  try {
    const req = getRequest();
    const header = req?.headers?.get("authorization");
    if (!header || !header.startsWith("Bearer ")) return null;
    const payload = header.slice(7).split(".")[1];
    if (!payload) return null;
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      sub?: unknown;
    };
    return typeof claims.sub === "string" ? claims.sub : null;
  } catch {
    return null;
  }
}

/** Retourne la liste des fournisseurs favoris de l'utilisateur courant (lecture seule). */
export const getFournisseurFavoris = createServerFn({ method: "POST", strict: false })
  .validator((d: unknown) => z.object({}).parse(d))
  .handler(async () => {
    const userId = userIdDepuisRequete();
    if (!userId) return { disponibles: false, favoris: [] };
    const { supabaseAdmin } = await import("../../integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    try {
      const { data, error } = await db
        .from("fournisseur_favoris")
        .select("fournisseur_id")
        .eq("user_id", userId);
      if (error) return { disponibles: false, favoris: [] };
      return {
        disponibles: true,
        favoris: ((data ?? []) as { fournisseur_id: string }[]).map((x) => x.fournisseur_id),
      };
    } catch {
      return { disponibles: false, favoris: [] };
    }
  });

/** Ajoute / retire un favori (écriture UNIQUEMENT dans fournisseur_favoris). */
export const toggleFournisseurFavori = createServerFn({ method: "POST", strict: false })
  .validator((d: unknown) =>
    z.object({ fournisseurId: z.string().uuid(), favori: z.boolean() }).parse(d),
  )
  .handler(async ({ data }) => {
    const userId = userIdDepuisRequete();
    if (!userId) return { ok: false, error: "Authentification requise" };
    const { supabaseAdmin } = await import("../../integrations/supabase-ext/client.server");
    const db = supabaseAdmin as any;
    try {
      if (data.favori) {
        const { error } = await db.from("fournisseur_favoris").upsert(
          {
            user_id: userId,
            fournisseur_id: data.fournisseurId,
            created_at: new Date().toISOString(),
          },
          { onConflict: "user_id,fournisseur_id" },
        );
        if (error) return { ok: false, error: error.message };
      } else {
        const { error } = await db
          .from("fournisseur_favoris")
          .delete()
          .eq("user_id", userId)
          .eq("fournisseur_id", data.fournisseurId);
        if (error) return { ok: false, error: error.message };
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue" };
    }
  });
