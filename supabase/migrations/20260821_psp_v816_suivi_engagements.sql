-- V8.16 — Lignes suivi annuel : exercice + engagé/payé réels.
-- Les lignes annuelles SANS commande (psp_lignes origine='suivi') sont matérialisées
-- depuis le fichier annuel. Jusqu'ici seule la PROGRAMMATION (programme[annee]=budget)
-- était portée ; l'EXERCICE d'origine était perdu quand budget=0 (programme={}) et
-- l'engagé/payé du fichier (STSN_ENGAGE / STSN_PAYE) n'était jamais stocké.
-- Ces colonnes permettent au dashboard de :
--   · filtrer les lignes suivi par année (annee_exercice, même sans budget) ;
--   · intégrer l'engagé/payé des lignes sans commande aux totaux.
alter table public.psp_lignes
  add column if not exists annee_exercice integer,
  add column if not exists montant_engage numeric,
  add column if not exists montant_paye numeric;

comment on column public.psp_lignes.annee_exercice is
  'Exercice du suivi annuel (origine=suivi) — porté depuis l''import annuel. NULL pour les lignes de préparation.';
comment on column public.psp_lignes.montant_engage is
  'Engagé d''une ligne annuelle sans commande (STSN_ENGAGE) — NULL si non engagé (0 dans les totaux).';
comment on column public.psp_lignes.montant_paye is
  'Payé d''une ligne annuelle sans commande (STSN_PAYE) — NULL si non payé (0 dans les totaux).';
