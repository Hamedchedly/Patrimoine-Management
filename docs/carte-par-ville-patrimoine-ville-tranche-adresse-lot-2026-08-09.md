# Carte par ville + patrimoine Ville → Tranche → Adresse → Lot

## 1. Carte de l'accueil à deux niveaux

- **Niveau ville (par défaut)** : un seul pin par ville, positionné au barycentre des adresses déjà localisées. L'étiquette affiche le nom de la ville, le nombre de tranches et le nombre de lots.
- **Clic sur un pin ville** : la carte zoome sur cette ville et affiche un pin par adresse exacte, avec l'adresse et son nombre de lots.
- **Bouton « Retour aux villes »** affiché sur la carte en mode ville sélectionnée : revient à la vue élargie de toutes les villes.
- Le géocodage progressif déjà en place (mise en cache en base) reste inchangé.

## 2. Page patrimoine : nouvelle hiérarchie

Ordre de navigation : **Ville → Tranche → Adresse (rue) → Lots**.

- Niveau 1 : liste des villes, avec le nombre de tranches (et le nombre de lots en complément).
- Niveau 2 : les tranches de la ville (code + libellé), avec leur nombre d'adresses et de lots.
- Niveau 3 : les rues/adresses de la tranche, cliquables, avec le nombre de lots.
- Niveau 4 : la liste des lots (étage, porte, type, surface, locataire, DPE).
- Fil d'Ariane mis à jour pour ces quatre niveaux ; l'ancien niveau « bâtiment » disparaît de la navigation principale (le bâtiment reste affiché comme information sur le lot).

## 3. Fiche locataire

- Le nom du locataire devient cliquable, partout où il apparaît (liste des lots et résultats de recherche par nom).
- Un panneau/dialogue affiche : nom, téléphone, e-mail, date d'entrée, lot rattaché, adresse, ville, tranche, type de lot, surface, étage/porte, et les occupants enregistrés pour ce lot.
- Ces champs existent déjà en base mais ne sont pas encore remontés : la lecture du patrimoine sera étendue pour inclure téléphone, e-mail et date d'entrée.

## 4. Filtre garages / boxes

- Case à cocher « Afficher les garages et boxes », **décochée par défaut** sur toute la page patrimoine (comptages inclus : les nombres de lots affichés à chaque niveau suivent le filtre).
- Détection : code lot commençant par `ER.G` ou type de lot `PAR`, `GAR`, `BOX` (≈ 3 030 lots concernés).
- L'état de la case est conservé dans l'URL pour pouvoir partager un lien filtré.

## Détails techniques

- `src/lib/isis.functions.ts` : ajouter `locataire_telephone`, `locataire_email`, `date_entree` au select de `getPatrimoine` ; nouvelle fonction serveur pour lire les occupants d'un lot.
- `src/lib/adresses.ts` : ajouter un helper `estGarage(lot)` et le regroupement par ville/tranche.
- `src/components/PatrimoineMap.tsx` : état `villeSelectionnee`, agrégation ville, bouton retour, ajustement du zoom via `fitBounds`.
- `src/routes/adresses.tsx` : paramètres de recherche `ville`, `tranche`, `rue`, `garages` ; nouveau composant fiche locataire (dialogue shadcn).
- Aucune modification de la base de données n'est nécessaire.
