// V8.17 — Tests PURS du rattachement commande → lot (commande.rattachement.lots.ts).
// Exécution : node scripts/test-rattachement-lot.ts  (Node 24 : type stripping natif)
import {
  creerIndexLots,
  extraireErTexte,
  lotUniqueDe,
  normaliserCodeEr,
  refsErHistorique,
  refsErSuivi,
  resoudreRattachement,
  type LotPatrimoine,
} from "../src/lib/commande/rattachement.lots.ts";

let ok = 0;
let ko = 0;
const check = (nom: string, cond: boolean, detail?: unknown) => {
  if (cond) ok++;
  else {
    ko++;
    console.error(`✗ ${nom}`, detail ?? "");
  }
};

const LOT: LotPatrimoine = {
  code_patrimoine: "ER.39351",
  tranche_code: "2443",
  adresse: "5 RUE DE LA CLEF DES CHAMPS",
  ville: "MAGNY-LE-HONGRE",
  actif: true,
};
const LOT_B: LotPatrimoine = {
  code_patrimoine: "ER.26073",
  tranche_code: "1395",
  adresse: "13 RUE DES PETITS CHAMPS",
  ville: "CHESSY",
  actif: true,
};
const lotsIndex = creerIndexLots([LOT, LOT_B]);

// ── Extraction / normalisation ────────────────────────────────────────────────
check("extrait une référence ER. d'un texte", extraireErTexte("RUE X - ER.39351").length === 1);
check(
  "extrait en majuscules sans point final",
  (extraireErTexte("adresse ER.39351.")[0] ?? "") === "ER.39351",
);
check(
  "déduplique les références",
  extraireErTexte("ER.39351 et ER.39351 et er.39351").length === 1,
);
check("ignore « ER. » isolé (trop court)", extraireErTexte("ER. seulement").length === 0);
check(
  "normaliserCodeEr retire le préfixe et la ponctuation",
  normaliserCodeEr("ER.G2273.01023") === "G227301023",
);
check(
  "refsErSuivi combine adresse + descriptif sans doublon",
  refsErSuivi("RUE - ER.39351", "COUVERTURE - er.39351").length === 1,
);
check(
  "refsErHistorique combine les champs",
  refsErHistorique(["ER.39351", "ER.26073"]).length === 2,
);

// ── Cas réel 5037762 (suivi uniquement) ───────────────────────────────────────
const cas5037762 = resoudreRattachement({
  refsHistorique: [],
  refsSuivi: refsErSuivi(
    "RUE DE LA CLEF DES CHAMPS, MAGNY-LE-HONGRE - ER.39351",
    "RACHAT - TRAVAUX COUVERTURE - ER.39351",
  ),
  lotsIndex,
});
check("5037762 → rattache (1 lot)", cas5037762.statut === "rattache", cas5037762);
check("5037762 → source suivi", cas5037762.source === "suivi");
check("5037762 → code ER.39351", cas5037762.codes[0] === "ER.39351");
check("lotUniqueDe renvoie le lot", lotUniqueDe(cas5037762)?.code_patrimoine === "ER.39351");

// ── Priorité Historique CMD ───────────────────────────────────────────────────
const prioriteHist = resoudreRattachement({
  refsHistorique: ["ER.39351"],
  refsSuivi: ["ER.26073"],
  lotsIndex,
});
check("historique prioritaire → source historique", prioriteHist.source === "historique");
check("historique prioritaire → code ER.39351", (prioriteHist.codes[0] ?? "") === "ER.39351");

// ── Repli suivi quand l'historique est hors référentiel ───────────────────────
const repliSuivi = resoudreRattachement({
  refsHistorique: ["ER.99999"],
  refsSuivi: ["ER.26073"],
  lotsIndex,
});
check("historique hors référentiel → repli suivi", repliSuivi.source === "suivi", repliSuivi);
check("repli suivi → code ER.26073", (repliSuivi.codes[0] ?? "") === "ER.26073");

// ── Multi-lots ────────────────────────────────────────────────────────────────
const multi = resoudreRattachement({
  refsHistorique: [],
  refsSuivi: refsErSuivi("RUE - ER.39351 et ER.26073", null),
  lotsIndex,
});
check("2 lots distincts → multi_lots", multi.statut === "multi_lots", multi);
check("multi_lots → 2 codes", multi.codes.length === 2);

// ── Aucun / hors référentiel ──────────────────────────────────────────────────
const aucun = resoudreRattachement({ refsHistorique: [], refsSuivi: [], lotsIndex });
check("aucun ER → non_rattache", aucun.statut === "non_rattache");

const hors = resoudreRattachement({ refsHistorique: [], refsSuivi: ["ER.99999"], lotsIndex });
check("ER absent du référentiel → hors_referentiel", hors.statut === "hors_referentiel", hors);
check("hors_referentiel → refsNonTrouvees", hors.refsNonTrouvees.includes("ER.99999"));

// ── Rapport ───────────────────────────────────────────────────────────────────
console.log(`\nRattachement lot : ${ok} checks OK / ${ko} échec(s)`);
process.exit(ko > 0 ? 1 : 0);
