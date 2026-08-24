// Tests purs — Phase 7A : locataire actuel (règle unique determinerLocataireActuel).
// Exécution : node scripts/test-locataire-actuel.mjs
// Aucune dépendance à Supabase / à l'ordre SQL.
import { determinerLocataireActuel, nomCompletOccupant } from "../src/lib/adresses.ts";

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

// Données réelles du lot ER.26092 (ordre VOLONTAIREMENT différent de la base).
const occupantsEr26092 = [
  {
    id: "u1",
    lot_code: "ER.26092",
    nom: "ETIENNE",
    prenom: "ZACHARIE",
    date_naissance: "1993-09-23",
    date_entree: "2018-03-15",
    created_at: "2026-08-10T23:22:23Z",
  },
  {
    id: "u2",
    lot_code: "ER.26092",
    nom: "TOUSSAINT",
    prenom: "LAETITIA",
    date_naissance: "1983-01-10",
    date_entree: "2012-12-31",
    created_at: "2026-08-10T23:22:23Z",
  },
  {
    id: "u3",
    lot_code: "ER.26092",
    nom: "GUENNOUF",
    prenom: "HAKIM",
    date_naissance: "1987-12-13",
    date_entree: "2022-02-21",
    created_at: "2026-08-10T23:22:23Z",
  },
  {
    id: "u4",
    lot_code: "ER.26092",
    nom: "SALHI",
    prenom: "KHALED",
    date_naissance: "1992-09-10",
    date_entree: "2014-09-25",
    created_at: "2026-08-10T23:22:23Z",
  },
];

// T_LOC_01 — [] → null
check("T_LOC_01 [] → null", determinerLocataireActuel([]) === null);

// T_LOC_02 — un seul occupant → lui-même
{
  const seul = [occupantsEr26092[0]];
  const r = determinerLocataireActuel(seul);
  check(
    "T_LOC_02 un occupant → cet occupant",
    r?.id === "u1" && nomCompletOccupant(r) === "ZACHARIE ETIENNE",
  );
}

// T_LOC_03 — plusieurs occupants → date_entree la plus récente
{
  const r = determinerLocataireActuel(occupantsEr26092);
  check(
    "T_LOC_03 date_entree la plus récente → GUENNOUF",
    r?.id === "u3" && nomCompletOccupant(r) === "HAKIM GUENNOUF",
  );
}

// T_LOC_04 — ordre aléatoire du tableau → résultat identique
{
  const melange = [
    occupantsEr26092[3],
    occupantsEr26092[1],
    occupantsEr26092[0],
    occupantsEr26092[2],
  ];
  const r = determinerLocataireActuel(melange);
  check("T_LOC_04 ordre aléatoire → même résultat", r?.id === "u3");
}

// T_LOC_05 — égalité date_entree → nom ASC
{
  const exAequo = [
    {
      id: "x2",
      lot_code: "L",
      nom: "ZEBRE",
      prenom: "A",
      date_naissance: null,
      date_entree: "2020-01-01",
      created_at: null,
    },
    {
      id: "x1",
      lot_code: "L",
      nom: "ALPHA",
      prenom: "B",
      date_naissance: null,
      date_entree: "2020-01-01",
      created_at: null,
    },
  ];
  const r = determinerLocataireActuel(exAequo);
  check("T_LOC_05 égalité date_entree → nom ASC (ALPHA)", r?.id === "x1");
}

// T_LOC_06 — ER.26092 (données réelles) → HAKIM GUENNOUF
{
  const r = determinerLocataireActuel(occupantsEr26092);
  check(
    "T_LOC_06 ER.26092 → HAKIM GUENNOUF",
    r?.id === "u3" && nomCompletOccupant(r) === "HAKIM GUENNOUF" && r.date_entree === "2022-02-21",
  );
}

// T_LOC_07 — aucune dépendance à l'ordre SQL : toutes les permutations donnent le même occupant
{
  const permutations = [
    occupantsEr26092,
    [...occupantsEr26092].reverse(),
    [occupantsEr26092[2], occupantsEr26092[0], occupantsEr26092[3], occupantsEr26092[1]],
  ];
  const ids = new Set(permutations.map((p) => determinerLocataireActuel(p)?.id));
  check("T_LOC_07 indépendance de l'ordre (permutations)", ids.size === 1 && ids.has("u3"));
}

// T_LOC_08 — date_sortie passée → occupant exclu (préparation future, modèle actuel sans date_sortie)
{
  const avecSortie = [
    {
      id: "s1",
      lot_code: "L",
      nom: "RECENT",
      prenom: "N",
      date_naissance: null,
      date_entree: "2025-01-01",
      created_at: null,
      date_sortie: "2025-06-01",
    },
    {
      id: "s2",
      lot_code: "L",
      nom: "ANCIEN",
      prenom: "A",
      date_naissance: null,
      date_entree: "2020-01-01",
      created_at: null,
      date_sortie: null,
    },
  ];
  const r = determinerLocataireActuel(avecSortie, { aujourdHui: "2026-08-14" });
  check("T_LOC_08 sortie passée → exclu (ANCIEN reste actuel)", r?.id === "s2");
}

// T_LOC_09 — date_sortie future → occupant toujours actuel
{
  const avecSortieFuture = [
    {
      id: "f1",
      lot_code: "L",
      nom: "RECENT",
      prenom: "N",
      date_naissance: null,
      date_entree: "2025-01-01",
      created_at: null,
      date_sortie: "2026-12-31",
    },
    {
      id: "f2",
      lot_code: "L",
      nom: "ANCIEN",
      prenom: "A",
      date_naissance: null,
      date_entree: "2020-01-01",
      created_at: null,
      date_sortie: null,
    },
  ];
  const r = determinerLocataireActuel(avecSortieFuture, { aujourdHui: "2026-08-14" });
  check("T_LOC_09 sortie future → occupant toujours actuel", r?.id === "f1");
}

// T_LOC_10 — nom d'affichage : prénom puis nom, null géré
{
  check("T_LOC_10 nomCompletOccupant null → —", nomCompletOccupant(null) === "—");
  check(
    "T_LOC_10 nomCompletOccupant prénom+nom",
    nomCompletOccupant({ nom: "GUENNOUF", prenom: "HAKIM" }) === "HAKIM GUENNOUF",
  );
}

console.log(`\n${passed} passé(s), ${failed} échec(s)`);
process.exit(failed > 0 ? 1 : 0);
