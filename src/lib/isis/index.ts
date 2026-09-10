import * as XLSX from "xlsx";

export type TrancheRow = {
  code: string;
  libelle: string | null;
  localite: string | null;
  copro_numero: string | null;
  secteur: string | null;
  sous_secteur: string | null;
  quartier: string | null;
  zone_edf: string | null;
  zone_apl: string | null;
  nb_logements: number;
};

export type LotRow = {
  code_patrimoine: string;
  tranche_code: string;
  type_lot: string | null;
  batiment: string | null;
  etage: string | null;
  porte: string | null;
  surface_utile: number | null;
  dpe: string | null;
  date_dpe: string | null;
  identifiant_insee: string | null;
  individuel_collectif: string | null;
  date_achevement_travaux: string | null;
  adresse: string | null;
  code_postal: string | null;
  ville: string | null;
  locataire_nom: string | null;
  locataire_telephone: string | null;
  locataire_email: string | null;
  date_entree: string | null;
};

export type OccupantRow = {
  lot_code: string;
  nom: string | null;
  prenom: string | null;
  date_naissance: string | null;
  date_entree: string | null;
};

export type ParsedIsis = {
  tranches: TrancheRow[];
  lots: LotRow[];
  occupants: OccupantRow[];
  lignes: number;
};

const COL = {
  tranche: "TRANCHE",
  typeLot: "TYPE DU LOT",
  copro: "NUMERO DE COPRO EFFORT",
  particularite: "PARTICULARITES LOT OU NOM POUR PAT DE NIVEAU > 1",
  secteur: "CODE SECTEUR OU SAE POUR ERACQ ET SAM POUR MCACQ",
  sousSecteur: "CODE SOUS SECTEUR (ANCIENNEMENT UH)",
  quartier: "CODE QUARTIER (EX : '001' ...)",
  localite: "LOCALITÉ",
  zoneEdf: "CODE ZONE EDF",
  zoneApl: "ZONE GEOGRAPHIQUE APL",
  insee: "IDENTIFIANT LOT INSEE",
  ic: "I=INDIVIDUEL, C=COLLECTIF, NULL",
  dpe: "INDICE GLOBALE DPE NRJ",
  prenom: "PRENOM DU MEMBRE DE LA FAMILLE",
  nom: "NOM DU MEMBRE DE LA FAMILLE",
  dateEntree: "DATE D'ENTRÉE",
  naissance: "DATE DE NAISSANCE DU MEMBRE DE LA FAMILLE",
  dateDpe: "DATE INDICE ENERGIE",
  surface: "SURFACE UTILE",
  code: "CODE LIBELLÉ DU PATRIMOINE",
  batiment: "BÂTIMENT",
  etage: "ETAGE",
  porte: "N° DE PORTE",
  dateTravaux: "DATE ACHEVEMENT DES TRAVAUX",
  locataire: "Nom et prénom locataire",
  adresse: "Adresse",
  cp: "CP",
  ville: "Ville",
  tel: "N° TELEPHONE PORTABLE LOCATAIRE",
  email: "ADRESSE EMAIL DU LOCATAIRE",
} as const;

type Raw = Record<string, unknown>;

const txt = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t === "" || t === "..." ? null : t;
};

const num = (v: unknown): number | null => {
  const t = txt(v);
  if (t === null) return null;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

const iso = (v: unknown): string | null => {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number") {
    const parsed = XLSX.SSF.parse_date_code(v);
    if (!parsed) return null;
    const d = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
    return d.toISOString().slice(0, 10);
  }
  const t = String(v).trim();
  const m = t.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

/** Analyse un export ISIS complet (1 ligne = 1 membre du foyer). */
export function parseIsisWorkbook(data: ArrayBuffer): ParsedIsis {
  const wb = XLSX.read(data, { cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]!]!;
  const rows = XLSX.utils.sheet_to_json<Raw>(sheet, { defval: null });

  const clean = rows.map((r) => {
    const o: Raw = {};
    for (const [k, v] of Object.entries(r)) o[k.trim()] = v;
    return o;
  });

  const tranches = new Map<string, TrancheRow>();
  const lots = new Map<string, LotRow>();
  const occupants = new Map<string, OccupantRow>();
  // V8.19 — `lots.locataire_*` = OCCUPANT ACTUEL : ligne du foyer avec la date d'entrée la plus
  // récente (et un locataire renseigné). L'export contient une ligne par membre/bail successif :
  // l'ancien code prenait la PREMIÈRE ligne du lot (locataire obsolète, ex. ER.26603).
  const locataireBest = new Map<
    string,
    {
      date: string | null;
      nom: string | null;
      tel: string | null;
      email: string | null;
      hasLoc: boolean;
    }
  >();

  for (const r of clean) {
    const trancheCode = txt(r[COL.tranche]);
    const code = txt(r[COL.code]);
    if (!trancheCode || !code) continue;

    // Meilleure ligne « locataire » de ce lot (occupant actuel = date d'entrée max).
    const dateEntree = iso(r[COL.dateEntree]);
    const nomLoc = txt(r[COL.locataire]);
    const hasLoc = Boolean(nomLoc);
    const prevBest = locataireBest.get(code);
    const meilleur =
      !prevBest ||
      (dateEntree ?? "") > (prevBest.date ?? "") ||
      ((dateEntree ?? "") === (prevBest.date ?? "") && hasLoc && !prevBest.hasLoc);
    if (meilleur) {
      locataireBest.set(code, {
        date: dateEntree,
        nom: nomLoc,
        tel: txt(r[COL.tel]),
        email: txt(r[COL.email]),
        hasLoc,
      });
    }

    if (!tranches.has(trancheCode)) {
      tranches.set(trancheCode, {
        code: trancheCode,
        libelle: txt(r[COL.particularite]),
        localite: txt(r[COL.localite]),
        copro_numero: txt(r[COL.copro]),
        secteur: txt(r[COL.secteur]),
        sous_secteur: txt(r[COL.sousSecteur]),
        quartier: txt(r[COL.quartier]),
        zone_edf: txt(r[COL.zoneEdf]),
        zone_apl: txt(r[COL.zoneApl]),
        nb_logements: 0,
      });
    }

    if (!lots.has(code)) {
      const typeLot = txt(r[COL.typeLot]);
      lots.set(code, {
        code_patrimoine: code,
        tranche_code: trancheCode,
        type_lot: typeLot,
        batiment: txt(r[COL.batiment]),
        etage: txt(r[COL.etage]),
        porte: txt(r[COL.porte]),
        surface_utile: num(r[COL.surface]),
        dpe: txt(r[COL.dpe]),
        date_dpe: iso(r[COL.dateDpe]),
        identifiant_insee: txt(r[COL.insee]),
        individuel_collectif: txt(r[COL.ic]),
        date_achevement_travaux: iso(r[COL.dateTravaux]),
        adresse: txt(r[COL.adresse]),
        code_postal: txt(r[COL.cp]),
        ville: txt(r[COL.ville]),
        // V8.19 — locataire renseigné après la boucle (occupant actuel du lot).
        locataire_nom: null,
        locataire_telephone: null,
        locataire_email: null,
        date_entree: null,
      });
      if (typeLot && /^\d+$/.test(typeLot)) {
        tranches.get(trancheCode)!.nb_logements += 1;
      }
    }

    const nom = txt(r[COL.nom]);
    const prenom = txt(r[COL.prenom]);
    const naissance = iso(r[COL.naissance]);
    const key = `${code}|${nom}|${prenom}|${naissance}`;
    if (!occupants.has(key) && (nom || prenom)) {
      occupants.set(key, {
        lot_code: code,
        nom,
        prenom,
        date_naissance: naissance,
        date_entree: iso(r[COL.dateEntree]),
      });
    }
  }

  // V8.19 — applique l'occupant ACTUEL (date d'entrée max) sur chaque lot.
  for (const lot of lots.values()) {
    const b = locataireBest.get(lot.code_patrimoine);
    lot.locataire_nom = b?.nom ?? null;
    lot.locataire_telephone = b?.tel ?? null;
    lot.locataire_email = b?.email ?? null;
    lot.date_entree = b?.date ?? null;
  }

  return {
    tranches: [...tranches.values()],
    lots: [...lots.values()],
    occupants: [...occupants.values()],
    lignes: clean.length,
  };
}

export const TYPE_LOT_LABELS: Record<string, string> = {
  "1": "T1",
  "2": "T2",
  "3": "T3",
  "4": "T4",
  "5": "T5",
  "6": "T6",
  PAR: "Parking",
  GAR: "Garage",
  BOX: "Box",
  COM: "Commerce",
  DIV: "Divers",
  MOT: "Moto",
  FOY: "Foyer",
};

export const typeLotLabel = (t: string | null) => (t ? (TYPE_LOT_LABELS[t] ?? t) : "—");

export const isLogement = (t: string | null) => !!t && /^\d+$/.test(t);
