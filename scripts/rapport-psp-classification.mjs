// Rapport de contrôle de la classification PSP normalisée (lecture seule).
// Exécution : node scripts/rapport-psp-classification.mjs
// Applique classifierCommande aux 407 lignes du dernier import, en mémoire,
// puis affiche le rapport A-K. Aucune écriture.
import "dotenv/config";
import { classifierCommande, construireGroupesValidation } from "../src/lib/psp.classification.ts";

const { supabaseAdmin } = await import("../src/integrations/supabase-ext/client.server.ts");
const db = supabaseAdmin;

const { data: imps } = await db.from("psp_imports").select("id").order("created_at", { ascending: false }).limit(1);
if (!imps || imps.length === 0) {
  console.log("Aucun import PSP trouvé.");
  process.exit(1);
}
const importId = imps[0].id;
const { data: rows, error } = await db
  .from("psp_import_rows")
  .select("numero_commande_interne, numero_commande, patrimoine, nature_analytique, corps_etat_libelle, montant_engage, donnees_brutes")
  .eq("import_id", importId);
if (error) {
  console.log("ERREUR:", error.message);
  process.exit(1);
}

const classifications = (rows ?? []).map((r) =>
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

const compter = (cle) => {
  const m = new Map();
  for (const c of classifications) m.set(c[cle], (m.get(c[cle]) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

console.log(`\n# RAPPORT DE CONTRÔLE — Classification PSP normalisée (${classifications.length} lignes, import ${importId})`);

console.log("\nA. Statistiques par type_intervention :");
for (const [k, v] of compter("type_intervention")) console.log(`   ${String(k).padEnd(26)} ${v}`);

console.log("\nB. Statistiques par domaine_technique :");
for (const [k, v] of compter("domaine_technique")) console.log(`   ${String(k).padEnd(26)} ${v}`);

console.log("\nC. Statistiques par famille_psp :");
for (const [k, v] of compter("famille_psp")) console.log(`   ${String(k).padEnd(26)} ${v}`);

const n90 = classifications.filter((c) => c.confiance === 0.9).length;
const n60_89 = classifications.filter((c) => c.confiance >= 0.6 && c.confiance < 0.9).length;
const n60moins = classifications.filter((c) => c.confiance < 0.6).length;
const nVal = classifications.filter((c) => c.besoin_validation_humaine).length;
const nMulti = classifications.filter((c) => c.domaine_technique === "multi_domaine").length;
const nGen = classifications.filter((c) => c.regle_appliquee.includes("generique") || ["TRAVAUX GENERAUX","TRAVAUX DIVERS","POLYVALENCE","TRAVAUX DE REMISE EN ETAT","TRAVAUX","ASCENSEUR","ASCENSEURS","MENUISERIE","PLOMBERIE","EMBELLISSEMENT"].includes(c.libelle_normalise)).length;
const nExc = classifications.filter((c) => c.nature_exceptionnelle !== "aucune").length;

console.log(`\nD. confiance >= 0.90           : ${n90}`);
console.log(`E. confiance 0.60–0.89 (0.75) : ${n60_89}`);
console.log(`F. confiance < 0.60           : ${n60moins}`);
console.log(`G. nécessitant validation     : ${nVal}`);
console.log(`H. multi-domaines             : ${nMulti}`);
console.log(`I. libellés génériques        : ${nGen}`);
console.log(`   (commandes exceptionnelles : ${nExc})`);

const groupes = construireGroupesValidation(classifications);
console.log(`\nJ. Top 30 groupes nécessitant validation (${groupes.length} groupes au total) :`);
for (const [i, g] of groupes.slice(0, 30).entries()) {
  console.log(`   ${String(i + 1).padStart(2)}. [${g.occurrences}x] ${g.libelle_normalise} | règle=${g.regle_appliquee} | domaine=${g.domaine_technique} | type=${g.type_intervention} | montant=${Math.round(g.montant_total)}`);
}

const aValider = classifications.filter((c) => c.besoin_validation_humaine).sort((a, b) => (b.montant_engage ?? 0) - (a.montant_engage ?? 0));
console.log(`\nK. Top 20 commandes par montant nécessitant validation :`);
for (const [i, c] of aValider.slice(0, 20).entries()) {
  console.log(`   ${String(i + 1).padStart(2)}. ${c.comn} | ${c.naac_source} | ${Math.round(c.montant_engage ?? 0)} € | ${c.type_intervention}/${c.domaine_technique} | ${c.libelle_normalise}`);
}

console.log(`\n--- FIN RAPPORT (lecture seule, rien d'écrit) ---`);
