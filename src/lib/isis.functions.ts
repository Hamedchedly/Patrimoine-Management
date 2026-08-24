import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { villeDeCommande, type TrancheGeo, type VilleGeoPure } from "@/lib/travaux";

const trancheSchema = z.object({
  code: z.string(),
  libelle: z.string().nullable(),
  localite: z.string().nullable(),
  copro_numero: z.string().nullable(),
  secteur: z.string().nullable(),
  sous_secteur: z.string().nullable(),
  quartier: z.string().nullable(),
  zone_edf: z.string().nullable(),
  zone_apl: z.string().nullable(),
  nb_logements: z.number(),
});

export const lotSchema = z.object({
  code_patrimoine: z.string(),
  tranche_code: z.string(),
  type_lot: z.string().nullable(),
  batiment: z.string().nullable(),
  etage: z.string().nullable(),
  porte: z.string().nullable(),
  surface_utile: z.number().nullable(),
  dpe: z.string().nullable(),
  date_dpe: z.string().nullable(),
  identifiant_insee: z.string().nullable(),
  individuel_collectif: z.string().nullable(),
  date_achevement_travaux: z.string().nullable(),
  adresse: z.string().nullable(),
  code_postal: z.string().nullable(),
  ville: z.string().nullable(),
  locataire_nom: z.string().nullable(),
  locataire_telephone: z.string().nullable(),
  locataire_email: z.string().nullable(),
  date_entree: z.string().nullable(),
});

export type LotItem = z.infer<typeof lotSchema>;

const occupantSchema = z.object({
  lot_code: z.string(),
  nom: z.string().nullable(),
  prenom: z.string().nullable(),
  date_naissance: z.string().nullable(),
  date_entree: z.string().nullable(),
});

const batchSchema = z.object({
  runDate: z.string(),
  tranches: z.array(trancheSchema).default([]),
  lots: z.array(lotSchema).default([]),
  occupants: z.array(occupantSchema).default([]),
});

/** Upsert d'un lot de lignes ISIS (rapprochement sur la clé métier). */
export const importIsisBatch = createServerFn({ method: "POST" })
  .validator((d: unknown) => batchSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");

    if (data.tranches.length) {
      const { error } = await supabaseAdmin.from("tranches").upsert(
        data.tranches.map((t) => ({ ...t, actif: true, vu_le: data.runDate })),
        { onConflict: "code" },
      );
      if (error) throw new Error(`tranches: ${error.message}`);
    }

    if (data.lots.length) {
      const { error } = await supabaseAdmin.from("lots").upsert(
        data.lots.map((l) => ({ ...l, actif: true, vu_le: data.runDate })),
        { onConflict: "code_patrimoine" },
      );
      if (error) throw new Error(`lots: ${error.message}`);
    }

    if (data.occupants.length) {
      const { error } = await supabaseAdmin
        .from("occupants")
        .upsert(data.occupants, { onConflict: "lot_code,nom,prenom,date_naissance" });
      if (error) throw new Error(`occupants: ${error.message}`);
    }

    return { ok: true };
  });

/** Clôture de l'import : marque comme sorties de patrimoine les lignes absentes du dernier export. */
export const finalizeIsisImport = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ runDate: z.string(), fichier: z.string(), lignes: z.number() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");

    const disparus = await supabaseAdmin
      .from("lots")
      .update({ actif: false })
      .neq("vu_le", data.runDate)
      .eq("actif", true)
      .select("code_patrimoine");
    if (disparus.error) throw new Error(disparus.error.message);

    const trDisparues = await supabaseAdmin
      .from("tranches")
      .update({ actif: false })
      .neq("vu_le", data.runDate)
      .eq("actif", true)
      .select("code");
    if (trDisparues.error) throw new Error(trDisparues.error.message);

    const [{ count: lots }, { count: tranches }] = await Promise.all([
      supabaseAdmin.from("lots").select("*", { count: "exact", head: true }).eq("actif", true),
      supabaseAdmin.from("tranches").select("*", { count: "exact", head: true }).eq("actif", true),
    ]);

    const { error } = await supabaseAdmin.from("imports").insert({
      fichier: data.fichier,
      lignes: data.lignes,
      lots_crees: lots ?? 0,
      tranches_creees: tranches ?? 0,
      lots_disparus: disparus.data?.length ?? 0,
    });
    if (error) throw new Error(error.message);

    return {
      lotsActifs: lots ?? 0,
      tranchesActives: tranches ?? 0,
      lotsSortis: disparus.data?.length ?? 0,
      tranchesSorties: trDisparues.data?.length ?? 0,
    };
  });

/** Vue synthétique du patrimoine pour le tableau de bord. */
export const getPatrimoine = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");

  const tranches = await supabaseAdmin
    .from("tranches")
    .select("code, libelle, localite, copro_numero, sous_secteur, nb_logements, actif")
    .eq("actif", true)
    .order("code");
  if (tranches.error) throw new Error(tranches.error.message);

  // PostgREST plafonne à 1000 lignes : on pagine jusqu'à récupérer tout le patrimoine.
  const PAGE = 1000;
  const lots: NonNullable<Awaited<ReturnType<typeof fetchLotsPage>>> = [];
  async function fetchLotsPage(from: number) {
    const { data, error } = await supabaseAdmin
      .from("lots")
      .select(
        "code_patrimoine, tranche_code, type_lot, batiment, etage, porte, surface_utile, dpe, ville, code_postal, adresse, locataire_nom, locataire_telephone, locataire_email, date_entree, date_achevement_travaux",
      )
      .eq("actif", true)
      .order("code_patrimoine")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  for (let from = 0; ; from += PAGE) {
    const page = await fetchLotsPage(from);
    lots.push(...page);
    if (page.length < PAGE) break;
  }

  return { tranches: tranches.data ?? [], lots };
});

const occupantsSchema = z.object({ lotCode: z.string().min(1).max(64) });

/** Occupants enregistrés pour un lot (fiche locataire). */
export const getOccupants = createServerFn({ method: "POST" })
  .validator((d: unknown) => occupantsSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    // `id` est la clé technique stable de l'occupant (jamais le nom comme clé).
    // L'ordre SQL n'est PAS utilisé pour déterminer le locataire actuel :
    // determinerLocataireActuel trie explicitement (date_entree DESC, nom ASC).
    const { data: rows, error } = await supabaseAdmin
      .from("occupants")
      .select("id, lot_code, nom, prenom, date_naissance, date_entree, created_at")
      .eq("lot_code", data.lotCode)
      .order("date_entree", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

const searchAdressesSchema = z.object({
  q: z.string().optional(),
  ville: z.string().optional(),
  tranche: z.string().optional(),
  rue: z.string().optional(),
  adresse: z.string().optional(),
});

/** Récupère toutes les villes distinctes depuis la table tranches. */
export const getVilles = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
  const { data: rows, error } = await supabaseAdmin
    .from("tranches")
    .select("localite")
    .not("localite", "is", null)
    .order("localite");

  if (error) throw new Error(error.message);

  const villes = Array.from(
    new Set((rows ?? []).map((r) => r.localite).filter((v): v is string => !!v)),
  );
  return villes;
});

/** Recherche filtrée dans le patrimoine (lots). */
export const getAdresses = createServerFn({ method: "POST" })
  .validator((d: unknown) => searchAdressesSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    let query = supabaseAdmin.from("lots").select("*").eq("actif", true);

    if (data.q) {
      query = query.or(
        `code_patrimoine.ilike.%${data.q}%,adresse.ilike.%${data.q}%,locataire_nom.ilike.%${data.q}%`,
      );
    }
    if (data.ville) query = query.eq("ville", data.ville);
    if (data.tranche) query = query.eq("tranche_code", data.tranche);
    if (data.rue) query = query.ilike("adresse", `%${data.rue}%`);
    if (data.adresse) query = query.eq("adresse", data.adresse);

    // PostgREST plafonne chaque requête à 1000 lignes : on pagine par blocs.
    const results: LotItem[] = [];
    const PAGE = 1000;
    let from = 0;
    for (;;) {
      const { data: rows, error } = await query
        .order("code_patrimoine")
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      if (!rows?.length) break;
      results.push(...(rows as LotItem[]));
      if (rows.length < PAGE) break;
      from += PAGE;
    }
    return results;
  });

export const travauxScopeSchema = z.object({
  niveau: z.enum(["ville", "tranche", "adresse", "lot"]),
  label: z.string().optional(),
  ville: z.string().max(160).optional(),
  trancheCode: z.string().max(64).optional(),
  adresse: z.string().max(255).optional(),
  lotCode: z.string().max(64).optional(),
});

export type TravauxScope = z.infer<typeof travauxScopeSchema>;

/** Travaux d'un périmètre patrimoine, enrichis avec les informations du lot concerné. */
export const getTravaux = createServerFn({ method: "POST" })
  .validator((d: unknown) => travauxScopeSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase-ext/client.server");
    let lotsQuery = supabaseAdmin
      .from("lots")
      .select("code_patrimoine, tranche_code, batiment, etage, porte, adresse, code_postal, ville")
      .eq("actif", true);

    if (data.niveau === "ville") {
      if (!data.ville) return [];
      lotsQuery =
        data.ville === "Ville inconnue"
          ? lotsQuery.is("ville", null)
          : lotsQuery.eq("ville", data.ville);
    } else if (data.niveau === "tranche") {
      if (!data.trancheCode) return [];
      lotsQuery = lotsQuery.eq("tranche_code", data.trancheCode);
    } else if (data.niveau === "adresse") {
      if (!data.adresse) return [];
      lotsQuery = lotsQuery.ilike("adresse", `%${data.adresse}%`);
    } else {
      if (!data.lotCode) return [];
      lotsQuery = lotsQuery.eq("code_patrimoine", data.lotCode);
    }

    const { data: lots, error: lotsError } = await lotsQuery;
    if (lotsError) throw new Error(lotsError.message);
    if (!lots?.length) return [];

    const trancheCodes = [...new Set(lots.map((lot) => lot.tranche_code))];
    const travauxSelect =
      "id, niveau, tranche_code, batiment, lot_code, libelle, statut, date_travaux, cout, note";
    const travauxParTranche = supabaseAdmin
      .from("travaux")
      .select(travauxSelect)
      .order("date_travaux", { ascending: false, nullsFirst: false })
      .in("tranche_code", trancheCodes);

    // Récupération des commandes de travaux (issues des imports Excel).
    // Le filtre `actif` est VOLONTAIREMENT absent : le modal « Travaux » est un historique
    // complet (commandes actives + archivées, tous exercices).
    const commandesSelect =
      "id, tranche_code, lot_code, batiment, adresse, descriptif, engage, date_demarrage, date_fin_travaux, date_communication, etat_travaux, corps_etat, annee_exercice";
    let commandesQuery = supabaseAdmin
      .from("travaux_commandes")
      .select(commandesSelect)
      .order("date_demarrage", { ascending: false, nullsFirst: false });

    if (data.niveau === "tranche" && data.trancheCode) {
      commandesQuery = commandesQuery.eq("tranche_code", data.trancheCode);
    } else if (data.niveau === "lot" && data.lotCode) {
      commandesQuery = commandesQuery.eq("lot_code", data.lotCode);
    } else if (data.niveau === "adresse") {
      commandesQuery = commandesQuery.in("tranche_code", trancheCodes);
    }
    // niveau « ville » : pas de filtre SQL — le rattachement est fait via villeDeCommande
    // (adresse d'import prioritaire, sinon tranche.localite) sur TOUTES les commandes.

    const [travauxResults, commandesResult] = await Promise.all([
      data.niveau === "lot"
        ? Promise.all([
            travauxParTranche,
            supabaseAdmin
              .from("travaux")
              .select(travauxSelect)
              .order("date_travaux", { ascending: false, nullsFirst: false })
              .eq("lot_code", data.lotCode!),
          ])
        : Promise.all([travauxParTranche]),
      commandesQuery,
    ]);

    const travauxErrors = travauxResults.filter((result) => result.error);
    if (travauxErrors[0]?.error) throw new Error(travauxErrors[0].error.message);
    if (commandesResult.error) throw new Error(commandesResult.error.message);

    const baseTravaux = [
      ...new Map(
        travauxResults
          .flatMap((result) => result.data ?? [])
          .map((travail) => [travail.id, travail]),
      ).values(),
    ];

    // Périmètre ville : rattachement métier via villeDeCommande (adresse d'import prioritaire,
    // sinon tranche.localite), sur TOUTES les commandes (actives + archivées, tous exercices).
    let commandes = commandesResult.data ?? [];
    if (data.niveau === "ville" && data.ville) {
      const codes = [
        ...new Set(commandes.map((c) => c.tranche_code).filter((c): c is string => !!c)),
      ];
      const [tranchesRows, villesGeoRows] = await Promise.all([
        codes.length
          ? supabaseAdmin.from("tranches").select("code, localite").in("code", codes)
          : { data: [] as { code: string; localite: string | null }[] },
        supabaseAdmin.from("villes_geo").select("ville"),
      ]);
      const tranches: TrancheGeo[] = (tranchesRows.data ?? []).map((t) => ({
        code: t.code,
        localite: t.localite,
      }));
      const villesGeo: VilleGeoPure[] = (villesGeoRows.data ?? []).map((v) => ({
        ville: v.ville,
        lat: 0,
        lng: 0,
        n: 1,
      }));
      commandes = commandes.filter(
        (c) => villeDeCommande(c, tranches, villesGeo) === data.ville,
      );
    }

    // Conversion des commandes au format "travaux" pour l'affichage
    const commandesTravaux = commandes.map((c) => {
      const corps_etat = (c.corps_etat ?? "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
      let type = "GT";
      if (["electricite", "couvertures", "halls", "cages"].some((k) => corps_etat.includes(k)))
        type = "GE";
      if (
        ["plomberie", "menuiseries", "toitures", "fermetures", "etancheite"].some((k) =>
          corps_etat.includes(k),
        )
      )
        type = "CP";

      return {
        id: c.id,
        niveau: c.lot_code ? "lot" : "tranche",
        tranche_code: c.tranche_code,
        batiment: c.batiment,
        lot_code: c.lot_code,
        type,
        libelle: `[${type}] ${c.descriptif || c.corps_etat || "Commande"}`,
        statut: c.etat_travaux || "En cours",
        date_travaux: c.date_demarrage,
        date_demarrage: c.date_demarrage,
        date_fin_travaux: c.date_fin_travaux,
        date_communication: c.date_communication,
        annee_exercice: c.annee_exercice,
        cout: c.engage,
        adresse: c.adresse ?? null,
        note: `${type}${c.corps_etat ? ` - ${c.corps_etat}` : ""}`,
        is_commande: true,
      };
    });

    const travaux = [...baseTravaux, ...commandesTravaux];

    const lotsByCode = new Map(lots.map((lot) => [lot.code_patrimoine, lot]));
    const mapped = travaux
      .filter((travail) => {
        if (data.niveau !== "lot") return true;
        return (
          travail.lot_code === data.lotCode ||
          (!travail.lot_code && (!travail.batiment || travail.batiment === lots[0]!.batiment)) ||
          (travail.batiment && travail.batiment === lots[0]!.batiment)
        );
      })
      .map((travail) => {
        const lot =
          (travail.lot_code ? lotsByCode.get(travail.lot_code) : undefined) ??
          lots.find((item) => item.batiment === travail.batiment) ??
          (data.niveau === "lot" ? lots[0] : undefined);
        return {
          ...travail,
          adresse:
            "adresse" in travail
              ? travail.adresse ?? lot?.adresse ?? null
              : lot?.adresse ?? null,
          code_postal: lot?.code_postal ?? null,
          ville: lot?.ville ?? null,
          etage: lot?.etage ?? null,
          porte: lot?.porte ?? null,
        };
      });

    // Périmètre « adresse » : les travaux « tranche » (sans lot) s'appliquent à toute la
    // tranche de l'adresse ; les travaux « lot » ne sont conservés que s'ils appartiennent
    // réellement à l'adresse demandée (les adresses des commandes peuvent être écrites
    // différemment de celles des lots, d'où le rattachement par lot/bâtiment).
    if (data.niveau === "adresse" && data.adresse) {
      const needle = data.adresse.toLocaleLowerCase();
      return mapped.filter((t) => {
        if (!t.lot_code) return true;
        return (t.adresse ?? "").toLocaleLowerCase().includes(needle);
      });
    }
    return mapped;
  });
