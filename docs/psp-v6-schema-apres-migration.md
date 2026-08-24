# État du schéma Supabase — snapshot 2026-08-15T15:59:33.035Z

Capture lecture seule (OpenAPI /rest/v1/), aucune écriture. **Piège `head:true` évité.**

## Tables exposées par PostgREST

**29 tables** : adresses_geo, fournisseur_activites, fournisseur_aliases, fournisseurs, fournisseurs_contacts, import_travaux, imports, lots, occupants, psp_command_analysis, psp_command_links, psp_decisions, psp_devis, psp_feedback, psp_import_rows, psp_imports, psp_ligne_historique, psp_lignes, psp_patrimoine_context, psp_programmations, psp_reports, psp_rules, tranches, travaux, travaux_commandes, travaux_commandes_historique, travaux_import_details, v_travaux_commandes_enrichies, villes_geo

## Colonnes des tables `psp_*`

### psp_command_analysis
- `analyse_json` :jsonb
- `analyzed_at` string:timestamp with time zone
- `categorie_budget` string:text
- `categorie_budget_statut` string:text
- `cause_probable` string:text
- `composant` string:text
- `confiance` number:numeric
- `er_reference` string:text
- `id` string:uuid (def "gen_random_uuid()")
- `import_row_id` string:uuid
- `justification` string:text
- `modele` string:text
- `niveau_rattachement` string:text
- `numero_commande` string:text
- `numero_commande_interne` string:text
- `phase_patrimoniale` string:text
- `prompt_version` string:text
- `source_import_id` string:uuid
- `statut` string:text (def "a_analyser")
- `type_intervention` string:text
- `updated_at` string:timestamp with time zone (def "now()")
- `utilisable_cycle` boolean:boolean

### psp_command_links
- `commande_id` string:uuid
- `confiance` number:numeric
- `created_at` string:timestamp with time zone (def "now()")
- `id` string:uuid (def "gen_random_uuid()")
- `import_row_id` string:uuid
- `justification` string:text
- `methode` string:text (def "numero_commande_interne")
- `psp_ligne_id` string:uuid
- `statut` string:text (def "automatique")
- `type_relation` string:text (def "commande")
- `updated_at` string:timestamp with time zone (def "now()")

### psp_decisions
- `annee_cible` integer:int32
- `cible_id` string:text
- `cible_type` string:text
- `cle_metier` string:text
- `created_at` string:timestamp with time zone (def "now()")
- `decision_utilisateur` string:text
- `id` string:uuid (def "gen_random_uuid()")
- `montant` number:numeric
- `motif` string:text
- `proposition_initiale` :jsonb
- `psp_ligne_id` string:uuid
- `source_historique` string:text
- `source_suivi_annuel` string:text
- `statut` string:text (def "validee")
- `type_decision` string:text
- `updated_at` string:timestamp with time zone (def "now()")
- `valeur_retenue` :jsonb

### psp_devis
- `commentaire` string:text
- `created_at` string:timestamp with time zone (def "now()")
- `date_devis` string:date
- `document_reference` string:text
- `entreprise` string:text
- `fournisseur_id` string:uuid
- `id` string:uuid (def "gen_random_uuid()")
- `montant` number:numeric
- `psp_ligne_id` string:uuid
- `statut` string:text (def "a_demander")
- `updated_at` string:timestamp with time zone (def "now()")

### psp_feedback
- `cible_id` string:text
- `cible_type` string:text
- `correction` :jsonb
- `created_at` string:timestamp with time zone (def "now()")
- `decision_utilisateur` string:text
- `id` string:uuid (def "gen_random_uuid()")
- `motif` string:text
- `proposition_initiale` :jsonb

### psp_import_rows
- `adresse` string:text
- `annee_exercice` integer:int32
- `batiment_er` string:text
- `batiment_num` string:text
- `commune` string:text
- `corps_etat_code` string:text
- `corps_etat_libelle` string:text
- `created_at` string:timestamp with time zone (def "now()")
- `date_commande` string:text
- `donnees_brutes` :jsonb
- `entree_er` string:text
- `entree_num` string:text
- `er_reference` string:text
- `erreurs` :jsonb
- `etat` string:text
- `fournisseur` string:text
- `id` string:uuid (def "gen_random_uuid()")
- `import_id` string:uuid
- `ligne_numero` integer:int32
- `lot_er` string:text
- `montant_budget` number:numeric
- `montant_ecart` number:numeric
- `montant_engage` number:numeric
- `montant_paye` number:numeric
- `nature_analytique` string:text
- `numero_commande` string:text
- `numero_commande_interne` string:text
- `patrimoine` string:text
- `secteur` string:text
- `statut` string:text (def "valide")
- `tranche_er` string:text

### psp_imports
- `completed_at` string:timestamp with time zone
- `created_at` string:timestamp with time zone (def "now()")
- `doublons` integer:int32 (def 0)
- `erreurs_detail` :jsonb
- `exercice` integer:int32
- `fichier_nom` string:text
- `id` string:uuid (def "gen_random_uuid()")
- `lignes_erreur` integer:int32 (def 0)
- `lignes_total` integer:int32 (def 0)
- `lignes_valides` integer:int32 (def 0)
- `statut` string:text (def "analyse")
- `structure_detectee` :jsonb

### psp_ligne_historique
- `apres` :jsonb
- `avant` :jsonb
- `created_at` string:timestamp with time zone (def "now()")
- `id` string:uuid (def "gen_random_uuid()")
- `ligne_id` string:uuid
- `motif` string:text
- `operation` string:text (def "modification")
- `resolu` boolean:boolean (def false)
- `utilisateur` string:uuid

### psp_lignes
- `categorie` string:text
- `corps_etat` string:text
- `corps_etat_code` string:text
- `created_at` string:timestamp with time zone (def "now()")
- `id` string:uuid (def "gen_random_uuid()")
- `ligne_budget` string:text
- `nature_travaux` string:text
- `origine` string:text (def "preparation")
- `programmation_id` string:uuid
- `programme` :jsonb
- `remarques` string:text
- `tranche_code` string:text
- `updated_at` string:timestamp with time zone (def "now()")

### psp_patrimoine_context
- `date_reference_gestion` string:date
- `donnees_contextuelles` :jsonb
- `er_id` string:text
- `exception` boolean:boolean (def false)
- `id` string:uuid (def "gen_random_uuid()")
- `justification` string:text
- `niveau` string:text
- `parent_er_id` string:text
- `perimetre_psp` string:text (def "a_confirmer")
- `source_date_reference` string:text
- `type_patrimoine` string:text
- `updated_at` string:timestamp with time zone (def "now()")

### psp_programmations
- `annee_debut` integer:int32
- `annee_fin` integer:int32
- `auteur` string:uuid
- `created_at` string:timestamp with time zone (def "now()")
- `frozen_at` string:timestamp with time zone
- `frozen_by` string:uuid
- `id` string:uuid (def "gen_random_uuid()")
- `parent_id` string:uuid
- `remarques` string:text
- `statut` string:text (def "brouillon")
- `type` string:text (def "officielle")
- `updated_at` string:timestamp with time zone (def "now()")
- `validated_at` string:timestamp with time zone
- `validated_by` string:uuid
- `version` integer:int32 (def 1)

### psp_reports
- `cible_annee` integer:int32
- `cible_ligne_id` string:uuid
- `created_at` string:timestamp with time zone (def "now()")
- `created_by` string:uuid
- `id` string:uuid (def "gen_random_uuid()")
- `montant` number:numeric (def 0)
- `motif` string:text
- `source_annee` integer:int32
- `source_ligne_id` string:uuid

### psp_rules
- `condition` :jsonb
- `created_at` string:timestamp with time zone (def "now()")
- `id` string:uuid (def "gen_random_uuid()")
- `justification` string:text
- `nom` string:text
- `priorite` integer:int32 (def 100)
- `resultat` :jsonb
- `statut` string:text (def "active")
- `type_regle` string:text
- `updated_at` string:timestamp with time zone (def "now()")
