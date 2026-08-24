// Test de la classification métier PSP (module PUR) + vérification réelle
// des 407 lignes du dernier import PSP (lecture seule).
// Exécution : node scripts/test-psp-classification.mjs
//
// Section 1 — assertions pures (sans base) sur les règles.
// Section 2 — vérification réelle sur le dernier import (lecture seule) :
//   407 COMN_NUM conservés, aucune fusion, aucun perdu, COMC nullable,
//   NAAC_CODE inchangé, invariants de classification.
import "dotenv/config";
import {
  classifierCommande,
  construireGroupesValidation,
  normaliserTexte,
} from "../src/lib/psp.classification.ts";

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) {
    passed += 1;
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ── Section 1 : assertions pures ────────────────────────────────────────────
console.log("== Section 1 — règles pures ==");

function cls(wnature, opts = {}) {
  return classifierCommande({
    comn: "TEST",
    comc: opts.comc ?? null,
    naac: opts.naac ?? "CP",
    wnature,
    patrimoine: opts.patrimoine ?? "ER.T1396",
    montant_engage: opts.montant_engage ?? 0,
    descriptif: opts.descriptif ?? null,
    observations: opts.observations ?? null,
  });
}

// Cas impératifs (type)
const casType = [
  ["DIAGNOSTIC AMIANTE AVANT TRAVAUX (RAVALEMENT DE FACADES)", "diagnostic"],
  ["RECHERCHE DE FUITE", "diagnostic"],
  ["ATTESTATION GAZ", "controle"],
  ["HONORAIRES MISSION MOE EXE", "prestation_intellectuelle"],
  ["MISE AUX NORMES DES PORTES DES GAINES TECHNIQUE GAZ", "mise_en_conformite"],
  ["MISE EN SECURITE GAZ", "mise_en_securite"],
  ["REMPLACEMENT VMC - URGENT", "urgence"],
  ["SUITE FUITE SUR COLONNE", "sinistre"],
  ["REHABILITATION DU RELAIS DE CHELLES - LOT 01", "rehabilitation"],
  ["REMPLACEMENT DE VELUX", "remplacement"],
  ["REPARATION DE FUITE", "reparation"],
  ["ENTRETIEN COUVERTURE", "entretien"],
  ["REMPLACEMENT COMPLET ASCENSEUR 2025", "remplacement"],
  ["DIAG ET ENTRETIEN TOITURE TERRASSE", "diagnostic"],
];
for (const [lib, attendu] of casType) {
  const r = cls(lib);
  check(`type «${lib.slice(0, 40)}» → ${attendu}`, r.type_intervention === attendu, r.type_intervention);
}

// Domaine / corrections obligatoires
check("REMPLACEMENT COMPLET ASCENSEUR → ascenseur", cls("REMPLACEMENT COMPLET ASCENSEUR 2025").domaine_technique === "ascenseur");
const treuil = cls("REMPLACEMENT DE TREUIL");
check("REMPLACEMENT DE TREUIL → ascenseur", treuil.domaine_technique === "ascenseur", treuil.domaine_technique);
check("REMPLACEMENT DE TREUIL → validation", treuil.besoin_validation_humaine === true);
const verin = cls("REMPLACEMENT DE VERIN");
check("REMPLACEMENT DE VERIN → ascenseur", verin.domaine_technique === "ascenseur");
check("REMPLACEMENT DE VERIN → validation", verin.besoin_validation_humaine === true);
const dad = cls("REMPLACEMENT DE DAD");
check("REMPLACEMENT DE DAD → SSI", dad.domaines_detectes.includes("ssi"), dad.domaines_detectes.join(","));
check("REMPLACEMENT DE DAD → validation", dad.besoin_validation_humaine === true);
const bal = cls("REMPLACEMENT DES BAL");
check("REMPLACEMENT DES BAL → SSI (pas menuiserie)", bal.domaines_detectes.includes("ssi") && !bal.domaines_detectes.includes("menuiserie"), bal.domaines_detectes.join(","));
check("REMPLACEMENT DES BAL → validation", bal.besoin_validation_humaine === true);
const vitrines = cls("FOURNITURE ET POSE DE VITRINES, PORTE AUTOMATIQUE ET RIDEAUX METALLIQUES");
check("VITRINES/PORTE AUTO/RIDEAUX → jamais plomberie", !vitrines.domaines_detectes.includes("plomberie"), vitrines.domaines_detectes.join(","));
check("VITRINES/PORTE AUTO/RIDEAUX → menuiserie ou serrurerie", vitrines.domaines_detectes.includes("menuiserie") || vitrines.domaines_detectes.includes("serrurerie_acces"), vitrines.domaines_detectes.join(","));
check("VITRINES/PORTE AUTO/RIDEAUX → multi_domaine + validation", vitrines.domaine_technique === "multi_domaine" && vitrines.besoin_validation_humaine === true, vitrines.domaine_technique);
const ballon = cls("REMPLACEMENT BALLON THERMODYNAMIQUE");
check("BALLON THERMODYNAMIQUE → chauffage (pas multi)", ballon.domaine_technique === "chauffage" && !ballon.domaines_detectes.includes("plomberie"), ballon.domaine_technique + " / " + ballon.domaines_detectes.join(","));
const chaud = cls("REMPLACEMENTS DE 6 CHAUDIÈRES VMC GAZ");
check("CHAUDIÈRES VMC GAZ → multi (chauffage+ventilation)", chaud.domaine_technique === "multi_domaine" && chaud.domaines_detectes.includes("chauffage") && chaud.domaines_detectes.includes("ventilation"), chaud.domaines_detectes.join(","));
check("CHAUDIÈRES VMC GAZ → validation", chaud.besoin_validation_humaine === true);
const diagToit = cls("DIAG ET ENTRETIEN TOITURE TERRASSE");
check("DIAG TOITURE → multi (couverture+étanchéité) + validation", diagToit.besoin_validation_humaine === true && (diagToit.domaine_technique === "multi_domaine"), diagToit.domaine_technique);
const adapt = cls("ADAPT PMR - TRAVAUX SDB");
check("ADAPT PMR - TRAVAUX SDB → plomberie + validation", adapt.domaines_detectes.includes("plomberie") && adapt.besoin_validation_humaine === true, adapt.domaines_detectes.join(","));
const revsol = cls("REMPLACEMENT REV SOL ESPACES COMMUNS");
check("REV SOL ESPACES COMMUNS → parties communes + validation", revsol.famille_psp === "parties_communes" && revsol.besoin_validation_humaine === true, revsol.famille_psp);

// Attestations : type contrôle, domaine technique réel, PAS de faux multi
const attGaz = cls("ATTESTATION GAZ");
check("ATTESTATION GAZ → contrôle", attGaz.type_intervention === "controle", attGaz.type_intervention);
check("ATTESTATION GAZ → chauffage (pas plomberie/multi)", attGaz.domaine_technique === "chauffage" && !attGaz.domaines_detectes.includes("plomberie"), attGaz.domaine_technique + "/" + attGaz.domaines_detectes.join(","));
const attElec = cls("ATTESTATION ELECTRIQUE");
check("ATTESTATION ELECTRIQUE → électricité (pas plomberie/multi)", attElec.domaine_technique === "electricite" && !attElec.domaines_detectes.includes("plomberie"), attElec.domaine_technique + "/" + attElec.domaines_detectes.join(","));

// Libellés génériques → validation obligatoire
for (const g of ["TRAVAUX GENERAUX", "TRAVAUX DIVERS", "POLYVALENCE", "TRAVAUX", "ASCENSEUR", "ASCENSEURS", "MENUISERIE", "PLOMBERIE", "EMBELLISSEMENT"]) {
  const r = cls(g);
  check(`générique «${g}» → validation`, r.besoin_validation_humaine === true, r.regle_appliquee);
}

// Relais de Chelles
const relais = cls("RÉHABILITATION DU RELAIS DE CHELLES - 169 LOGEMENTS - LOT 01 : TRAITEMENT DES FAÇADES");
check("RELAIS DE CHELLES LOT 01 → réhabilitation", relais.type_intervention === "rehabilitation");
check("RELAIS DE CHELLES LOT 01 → commande_exceptionnelle", relais.nature_exceptionnelle === "commande_exceptionnelle");
check("RELAIS DE CHELLES LOT 01 → validation", relais.besoin_validation_humaine === true);
check("RELAIS DE CHELLES LOT 01 → domaine façade", relais.domaine_technique === "facade", relais.domaine_technique);

// NAAC jamais modifié
const naacTest = cls("REMPLACEMENT DE VELUX", { naac: "GE" });
check("NAAC_CODE inchangé", naacTest.naac_source === "GE");

// COMC nullable accepté
check("COMC null accepté", cls("REMPLACEMENT DE VELUX", { comc: null }).comn === "TEST");

// Niveaux patrimoniaux (pas d'invention)
check("WPATRIMOINE ER.T → tranche", cls("REMPLACEMENT DE VELUX", { patrimoine: "ER.T1396" }).element_patrimonial === "tranche");
check("WPATRIMOINE ER.B → batiment", cls("REMPLACEMENT DE VELUX", { patrimoine: "ER.B1400.002" }).element_patrimonial === "batiment");

// Confiance ≥ 0.90 pour cas direct non ambigu
check("confiance 0.90 (direct non ambigu)", cls("REMPLACEMENT DE VELUX").confiance === 0.9, String(cls("REMPLACEMENT DE VELUX").confiance));
check("confiance < 0.60 → validation", cls("REMPLACEMENT DE TREUIL").confiance < 0.6);

// ── Section 2 : vérification réelle (lecture seule) ─────────────────────────
console.log("\n== Section 2 — import réel (lecture seule) ==");
const { supabaseAdmin } = await import("../src/integrations/supabase-ext/client.server.ts");
const db = supabaseAdmin;
const { data: imps } = await db.from("psp_imports").select("id").order("created_at", { ascending: false }).limit(1);
if (!imps || imps.length === 0) {
  console.log("Aucun import PSP trouvé — section réelle ignorée.");
} else {
  const importId = imps[0].id;
  const { data: rows, error } = await db
    .from("psp_import_rows")
    .select("numero_commande_interne, numero_commande, patrimoine, nature_analytique, corps_etat_libelle, montant_engage, donnees_brutes")
    .eq("import_id", importId);
  check("lecture psp_import_rows", !error, error?.message ?? "");
  const R = rows ?? [];
  check("407 lignes présentes", R.length === 407, String(R.length));
  const comns = R.map((r) => r.numero_commande_interne);
  check("407 COMN_NUM distincts (aucune fusion)", new Set(comns).size === 407 && comns.length === 407, `${new Set(comns).size}/${comns.length}`);
  check("aucun COMN_NUM null", comns.every((c) => c != null && String(c).trim() !== ""));

  // Classification en mémoire de toutes les lignes (aucune écriture)
  const classifications = R.map((r) =>
    classifierCommande({
      comn: r.numero_commande_interne,
      comc: r.numero_commande,
      naac: r.nature_analytique,
      wnature: r.corps_etat_libelle ?? "",
      patrimoine: r.patrimoine,
      montant_engage: r.montant_engage,
      descriptif: r.donnees_brutes?.descriptif,
      observations: r.donnees_brutes?.observations,
    }),
  );
  check("aucune ligne perdue (407 classifiées)", classifications.length === 407, String(classifications.length));
  const naacInchange = classifications.every((c, i) => c.naac_source === R[i].nature_analytique);
  check("NAAC_CODE inchangé sur les 407", naacInchange);
  const comnConserves = classifications.every((c, i) => c.comn === R[i].numero_commande_interne);
  check("COMN_NUM conservés sur les 407", comnConserves);

  // Invariants de classification
  const nVal = classifications.filter((c) => c.besoin_validation_humaine).length;
  const nMulti = classifications.filter((c) => c.domaine_technique === "multi_domaine").length;
  const nIndet = classifications.filter((c) => c.domaine_technique === "indetermine" || c.type_intervention === "indetermine").length;
  const nAscenseur = classifications.filter((c) => c.domaines_detectes.includes("ascenseur")).length;
  const nRelais = classifications.filter((c) => c.projet_relais_chelles).length;
  check("≥1 commande ascenseur détectée", nAscenseur >= 1, String(nAscenseur));
  check("≥1 multi-domaine", nMulti >= 1, String(nMulti));
  check("≥1 validation nécessaire", nVal >= 1, String(nVal));
  check("≥1 commande RELAIS DE CHELLES", nRelais >= 1, String(nRelais));
  check("indéterminé borné (< 407)", nIndet < 407, String(nIndet));

  // Groupes de validation
  const groupes = construireGroupesValidation(classifications);
  check("groupes de validation construits", groupes.length >= 1, String(groupes.length));
  const totalGroupes = groupes.reduce((s, g) => s + g.occurrences, 0);
  check("total occurrences des groupes = nb validations", totalGroupes === nVal, `${totalGroupes}/${nVal}`);
  console.log(`  groupes de validation : ${groupes.length} (couvrant ${totalGroupes} lignes)`);
  console.log(`  multi-domaines : ${nMulti} | validations : ${nVal} | relais : ${nRelais}`);
}

console.log(`\n${passed} passé(s), ${failed} échec(s)`);
process.exit(failed > 0 ? 1 : 0);
