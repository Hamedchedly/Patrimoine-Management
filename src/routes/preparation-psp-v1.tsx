/**
 * V1 VISUELLE — Futur module de préparation PSP (prototype UX, lecture seule).
 *
 * Route dédiée à la maquette V1 : aucun changement au module opérationnel
 * /preparation-psp, aucune écriture Supabase, aucun nouveau moteur.
 */
import { createFileRoute } from "@tanstack/react-router";

import PspV1Page from "@/components/preparation-psp/PspV1Page";

export const Route = createFileRoute("/preparation-psp-v1")({
  head: () => ({
    meta: [
      { title: "Préparation PSP — Prototype V1 (programmation pluriannuelle)" },
      {
        name: "description",
        content:
          "V1 visuelle du futur module de préparation PSP : programmation pluriannuelle 2027-2031, revue des anciennes programmations et suivi annuel — lecture seule.",
      },
    ],
  }),
  component: PspV1Page,
});
