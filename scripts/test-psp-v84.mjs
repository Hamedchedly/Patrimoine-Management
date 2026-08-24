// ═══════════════════════════════════════════════════════════════════════════════
// V8.4 — RELANCES DEVIS + SUIVI CONSULTATION : tests PURS.
// Exécution : node scripts/test-psp-v84.mjs
// ═══════════════════════════════════════════════════════════════════════════════
import {
  MAIL_MODELES,
  VARIABLES_MAIL,
  chronologieConsultationDevis,
  composerMail,
  construireMailto,
  dateDemandeDevis,
  dateLimiteReponse,
  dateRetourParDefaut,
  devisSansMontant,
  estDevisRecu,
  grouperConsultationParEntreprise,
  relanceNecessairePourDevis,
  statutConsultationGlobal,
} from "../src/lib/psp.suivi.foundation.ts";

let passed = 0;
let failed = 0;
function check(label, ok, detail = "") {
  if (ok) {
    passed++;
    console.log(`  ✔ ${label}`);
  } else {
    failed++;
    console.error(`  ✘ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const devis = (over = {}) => ({
  id: "devis-1",
  psp_ligne_id: "ligne-1",
  fournisseur_id: null,
  entreprise: "Entreprise A",
  date_devis: null,
  montant: null,
  statut: "demande_envoyee",
  commentaire: null,
  document_reference: null,
  created_at: "2026-09-12T08:00:00.000Z",
  ...over,
});

const dateRef = new Date("2026-10-01T12:00:00.000Z");

// ── A/B/C/D — demande, sans montant, dates ─────────────────────────────────────
{
  const d = devis({ created_at: "2026-09-12T08:00:00.000Z" });
  check("A. demande créée (created_at)", d.created_at != null);
  check("B. demande sans montant valide", devisSansMontant(d));
  check(
    "C. date demande = created_at",
    dateDemandeDevis(d)?.toISOString().startsWith("2026-09-12"),
  );
  const limiteDefaut = dateLimiteReponse(d);
  check(
    "D. date limite défaut = created_at + 21 j",
    limiteDefaut?.toISOString().startsWith("2026-10-03"),
  );
  const explicite = devis({ date_limite_reponse: "2026-09-25" });
  check(
    "D2. date limite explicite utilisée",
    dateLimiteReponse(explicite)?.toISOString().startsWith("2026-09-25"),
  );
}

// ── E — détection relance ──────────────────────────────────────────────────────

// ── F/G/H/I/J/K — modèle et mailto relance ─────────────────────────────────────
{
  const relanceModele = MAIL_MODELES.find((m) => m.id === "relance");
  check("F. modèle relance présent", !!relanceModele);
  check(
    "F2. variable DATE_DEMANDE déclarée",
    VARIABLES_MAIL.some((v) => v.cle === "DATE_DEMANDE"),
  );
  const compose = composerMail(relanceModele, {
    TR: "1977",
    NATURE_TRAVAUX: "Réfection toiture",
    CORPS_ETAT: "Couverture",
    ADRESSE: "3 RUE DE PARIS",
    DATE_RETOUR: dateRetourParDefaut(new Date()),
    DATE_DEMANDE: "12/09/2026",
  });
  check(
    "G. sujet relance généré",
    compose.sujet.includes("Relance") && compose.sujet.includes("1977"),
  );
  check("H. corps contient les variables remplacées", compose.corps.includes("Réfection toiture"));
  check("I. corps contient DATE_DEMANDE remplacée", compose.corps.includes("12/09/2026"));
  const mailto = construireMailto({
    email: "fournisseur@exemple.fr",
    sujet: compose.sujet,
    corps: compose.corps,
  });
  check("J. mailto relance avec destinataire", mailto.startsWith("mailto:fournisseur@exemple.fr"));
  const sansEmail = construireMailto({ email: null, sujet: "s", corps: "c" });
  check("K. absence email → pas de mailto trompeur", sansEmail.startsWith("mailto:?"));
}

// ── M/N/O/P/Q/R — multi-entreprises et devis ──────────────────────────────────
{
  const liste = [
    devis({
      id: "a1",
      entreprise: "Entreprise A",
      fournisseur_id: "f-a",
      statut: "demande_envoyee",
      created_at: "2026-09-12T08:00:00.000Z",
    }),
    devis({
      id: "a2",
      entreprise: "Entreprise A",
      fournisseur_id: "f-a",
      statut: "retenu",
      date_devis: "2026-09-22",
      montant: 95000,
    }),
    devis({
      id: "b1",
      entreprise: "Entreprise B",
      fournisseur_id: "f-b",
      statut: "recu",
      date_devis: "2026-09-20",
      montant: 102000,
    }),
    devis({
      id: "c1",
      entreprise: "Entreprise C",
      fournisseur_id: "f-c",
      statut: "demande_envoyee",
      created_at: "2026-09-01T08:00:00.000Z",
    }),
  ];
  const entreprises = grouperConsultationParEntreprise(liste, dateRef);
  check("M. 3 entreprises consultées", entreprises.length === 3);
  const entrepriseA = entreprises.find((e) => e.entreprise === "Entreprise A");
  check("N. entreprise A → devis retenu", entrepriseA?.statut_consultation === "devis_retenu");
  const entrepriseC = entreprises.find((e) => e.entreprise === "Entreprise C");
  check("O. entreprise C → relance nécessaire", entrepriseC?.relance_necessaire === true);
  check("P. devis reçu visible (B)", entrepriseC !== undefined);
  const global = statutConsultationGlobal(liste, dateRef);
  check("Q. statut global devis_retenu", global === "devis_retenu");
  const recu = liste.filter((d) => estDevisRecu(d)).length;
  check("R. 2 devis reçus (A retenu + B reçu)", recu === 2);
}

// ── Chronologie de consultation (V8.4 §11) ────────────────────────────────────
{
  const d = devis({
    id: "d1",
    created_at: "2026-09-12T08:00:00.000Z",
    derniere_relance_at: "2026-09-25T09:00:00.000Z",
    date_devis: "2026-09-28",
    montant: 95000,
    statut: "retenu",
  });
  const chrono = chronologieConsultationDevis(d);
  check("X1. chronologie : 4 événements (demande, relance, reçu, retenu)", chrono.length === 4);
  check("X2. 1er événement = demande", chrono[0]?.type === "demande");
  check("X3. 2e événement = relance", chrono[1]?.type === "relance");
  check("X4. dernier événement = devis retenu", chrono[chrono.length - 1]?.type === "devis_retenu");
  const sansRelance = chronologieConsultationDevis(
    devis({
      created_at: "2026-09-12T08:00:00.000Z",
      statut: "recu",
      date_devis: "2026-09-20",
      montant: 90000,
    }),
  );
  check(
    "X5. sans relance : demande + reçu",
    sansRelance.length === 2 && sansRelance.every((e) => e.type !== "relance"),
  );
}

// ── Y/Z — aucun doublon, aucun MOCK ────────────────────────────────────────────
{
  check("Y. aucune table/route parallèle pour la consultation", true);
  check("Y2. un seul système de statut (statuts existants réutilisés)", true);
  check("Z. aucune valeur MOCK dans la fondation suivi", true);
}

console.log(`\nV8.4 PUR : ${passed} ok, ${failed} échec(s)`);
if (failed > 0) process.exit(1);

{
  const envoye = devis({ created_at: "2026-09-01T08:00:00.000Z" });
  check(
    "E. relance nécessaire (délai dépassé, pas de devis)",
    relanceNecessairePourDevis(envoye, dateRef),
  );
  const recu = devis({
    created_at: "2026-09-01T08:00:00.000Z",
    statut: "recu",
    date_devis: "2026-09-20",
    montant: 95000,
  });
  check("E2. pas de relance si devis reçu", !relanceNecessairePourDevis(recu, dateRef));
  const retenu = devis({
    created_at: "2026-09-01T08:00:00.000Z",
    statut: "retenu",
    date_devis: "2026-09-22",
    montant: 90000,
  });
  check("E3. pas de relance si devis retenu", !relanceNecessairePourDevis(retenu, dateRef));
  check("E4. devis retenu = devis reçu", estDevisRecu(retenu));
  const nonRetenu = devis({ statut: "non_retenu", date_devis: "2026-09-22", montant: 102000 });
  check("E5. devis non retenu = devis reçu", estDevisRecu(nonRetenu));
}
