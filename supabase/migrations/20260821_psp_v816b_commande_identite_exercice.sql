-- V8.16b — Identité commande = (numero_commande, annee_exercice).
-- Une même commande peut porter sur PLUSIEURS exercices (ex. « REPORT 2025 » dans le
-- fichier 2026 : 2/3 des travaux réalisés en 2025, 1/3 en 2026, même n° de commande).
-- L'unicité sur numero_commande SEUL empêchait de conserver les deux exercices : le
-- report créait un conflit non appliqué et l'exercice 2026 perdait ses montants.
-- Désormais chaque exercice a sa propre ligne (même n° = plusieurs lignes, une par année).
alter table public.travaux_commandes
  drop constraint if exists travaux_commandes_numero_commande_key;

create unique index if not exists travaux_commandes_numero_annee_uidx
  on public.travaux_commandes (numero_commande, annee_exercice);
