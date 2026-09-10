/**
 * V8.16p — CLIENT : modèles de mail courants (hook partagé).
 * `useMailModeles` : modèles depuis la base `mail_modeles` si présente, sinon
 * repli constantes MAIL_MODELES. Source de composition partagée entre l'envoi
 * par ligne (PspDemandeDevisWorkflow) et l'envoi groupé (DialogueMailGroupe).
 * Le moteur de composition (composerMail / remplacerVariablesMail) est inchangé.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { getMailModeles, type ModeleMail } from "@/lib/psp/mail.functions";
import { JOURS_REPONSE_DEFAUT_MAIL, MAIL_MODELES } from "@/lib/psp/suivi.foundation";

export const MAIL_MODELES_QUERY_KEY = ["mail-modeles"];

/** Repli constantes (MAIL_MODELES) tant que la base est absente/vide. */
export const MODELES_REPLI: ModeleMail[] = MAIL_MODELES.map((m) => ({
  id: m.id,
  libelle: m.libelle,
  sujet: m.sujet,
  corps: m.corps,
  delai_jours: m.delai_jours ?? JOURS_REPONSE_DEFAUT_MAIL,
}));

/** Modèles courants : base si présente, sinon repli constantes. */
export function useMailModeles() {
  const fetchModeles = useServerFn(getMailModeles);
  const { data } = useQuery({
    queryKey: MAIL_MODELES_QUERY_KEY,
    queryFn: () => fetchModeles({ data: {} }),
    staleTime: 1000 * 60 * 5,
    retry: 1,
  });
  return {
    modeles: (data?.modeles && data.modeles.length > 0
      ? data.modeles
      : MODELES_REPLI) as ModeleMail[],
    enBase: data?.en_base ?? false,
  };
}
