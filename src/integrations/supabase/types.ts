export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15";
  };
  public: {
    Tables: {
      adresses_geo: {
        Row: {
          adresse: string;
          cle: string;
          created_at: string;
          id: string;
          lat: number | null;
          lng: number | null;
          statut: string;
          updated_at: string;
          ville: string;
        };
        Insert: {
          adresse: string;
          cle: string;
          created_at?: string;
          id?: string;
          lat?: number | null;
          lng?: number | null;
          statut?: string;
          updated_at?: string;
          ville: string;
        };
        Update: {
          adresse?: string;
          cle?: string;
          created_at?: string;
          id?: string;
          lat?: number | null;
          lng?: number | null;
          statut?: string;
          updated_at?: string;
          ville?: string;
        };
        Relationships: [
        ];
      };
      fournisseur_activites: {
        Row: {
          corps_etat_code: string;
          corps_etat_libelle: string;
          created_at: string;
          fournisseur_id: string;
          id: string;
          niveau: string;
          source: string;
          updated_at: string;
        };
        Insert: {
          corps_etat_code: string;
          corps_etat_libelle: string;
          created_at?: string;
          fournisseur_id: string;
          id?: string;
          niveau: string;
          source?: string;
          updated_at?: string;
        };
        Update: {
          corps_etat_code?: string;
          corps_etat_libelle?: string;
          created_at?: string;
          fournisseur_id?: string;
          id?: string;
          niveau?: string;
          source?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "fournisseur_activites_fournisseur_id_fkey";
            columns: ["fournisseur_id"];
            isOneToOne: false;
            referencedRelation: "fournisseurs";
            referencedColumns: ["id"];
          },
        ];
      };
      fournisseur_aliases: {
        Row: {
          created_at: string;
          fournisseur_id: string;
          id: string;
          identifiant_source: string;
          source: string;
        };
        Insert: {
          created_at?: string;
          fournisseur_id: string;
          id?: string;
          identifiant_source: string;
          source: string;
        };
        Update: {
          created_at?: string;
          fournisseur_id?: string;
          id?: string;
          identifiant_source?: string;
          source?: string;
        };
        Relationships: [
          {
            foreignKeyName: "fournisseur_aliases_fournisseur_id_fkey";
            columns: ["fournisseur_id"];
            isOneToOne: false;
            referencedRelation: "fournisseurs";
            referencedColumns: ["id"];
          },
        ];
      };
      fournisseurs: {
        Row: {
          adresse: string | null;
          code_postal: string | null;
          complement_adresse: string | null;
          created_at: string;
          id: string;
          nom: string;
          notes: string | null;
          pays: string | null;
          site_web: string | null;
          updated_at: string;
          ville: string | null;
        };
        Insert: {
          adresse?: string | null;
          code_postal?: string | null;
          complement_adresse?: string | null;
          created_at?: string;
          id?: string;
          nom: string;
          notes?: string | null;
          pays?: string | null;
          site_web?: string | null;
          updated_at?: string;
          ville?: string | null;
        };
        Update: {
          adresse?: string | null;
          code_postal?: string | null;
          complement_adresse?: string | null;
          created_at?: string;
          id?: string;
          nom?: string;
          notes?: string | null;
          pays?: string | null;
          site_web?: string | null;
          updated_at?: string;
          ville?: string | null;
        };
        Relationships: [
        ];
      };
      fournisseurs_contacts: {
        Row: {
          created_at: string;
          email: string | null;
          fonction: string | null;
          fournisseur_id: string;
          id: string;
          nom: string;
          ordre: number;
          telephone: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          email?: string | null;
          fonction?: string | null;
          fournisseur_id: string;
          id?: string;
          nom: string;
          ordre?: number;
          telephone?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          email?: string | null;
          fonction?: string | null;
          fournisseur_id?: string;
          id?: string;
          nom?: string;
          ordre?: number;
          telephone?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "fournisseurs_contacts_fournisseur_id_fkey";
            columns: ["fournisseur_id"];
            isOneToOne: false;
            referencedRelation: "fournisseurs";
            referencedColumns: ["id"];
          },
        ];
      };
      import_travaux: {
        Row: {
          annee_exercice: number | null;
          archivees: number;
          conflits: number;
          creees: number;
          demarre_at: string;
          doublons: number;
          erreurs: number;
          fichier: string;
          id: string;
          ignorees: number;
          inchangees: number;
          lignes: number;
          modifiees: number;
          reports: number;
          statut: string;
          termine_at: string | null;
        };
        Insert: {
          annee_exercice?: number | null;
          archivees?: number;
          conflits?: number;
          creees?: number;
          demarre_at?: string;
          doublons?: number;
          erreurs?: number;
          fichier: string;
          id?: string;
          ignorees?: number;
          inchangees?: number;
          lignes?: number;
          modifiees?: number;
          reports?: number;
          statut?: string;
          termine_at?: string | null;
        };
        Update: {
          annee_exercice?: number | null;
          archivees?: number;
          conflits?: number;
          creees?: number;
          demarre_at?: string;
          doublons?: number;
          erreurs?: number;
          fichier?: string;
          id?: string;
          ignorees?: number;
          inchangees?: number;
          lignes?: number;
          modifiees?: number;
          reports?: number;
          statut?: string;
          termine_at?: string | null;
        };
        Relationships: [
        ];
      };
      imports: {
        Row: {
          created_at: string;
          fichier: string | null;
          id: string;
          lignes: number;
          lots_crees: number;
          lots_disparus: number;
          lots_maj: number;
          tranches_creees: number;
        };
        Insert: {
          created_at?: string;
          fichier?: string | null;
          id?: string;
          lignes?: number;
          lots_crees?: number;
          lots_disparus?: number;
          lots_maj?: number;
          tranches_creees?: number;
        };
        Update: {
          created_at?: string;
          fichier?: string | null;
          id?: string;
          lignes?: number;
          lots_crees?: number;
          lots_disparus?: number;
          lots_maj?: number;
          tranches_creees?: number;
        };
        Relationships: [
        ];
      };
      lots: {
        Row: {
          actif: boolean;
          adresse: string | null;
          batiment: string | null;
          code_patrimoine: string;
          code_postal: string | null;
          created_at: string;
          date_achevement_travaux: string | null;
          date_dpe: string | null;
          date_entree: string | null;
          dpe: string | null;
          etage: string | null;
          id: string;
          identifiant_insee: string | null;
          individuel_collectif: string | null;
          locataire_email: string | null;
          locataire_nom: string | null;
          locataire_telephone: string | null;
          porte: string | null;
          surface_utile: number | null;
          tranche_code: string;
          type_lot: string | null;
          updated_at: string;
          ville: string | null;
          vu_le: string | null;
        };
        Insert: {
          actif?: boolean;
          adresse?: string | null;
          batiment?: string | null;
          code_patrimoine: string;
          code_postal?: string | null;
          created_at?: string;
          date_achevement_travaux?: string | null;
          date_dpe?: string | null;
          date_entree?: string | null;
          dpe?: string | null;
          etage?: string | null;
          id?: string;
          identifiant_insee?: string | null;
          individuel_collectif?: string | null;
          locataire_email?: string | null;
          locataire_nom?: string | null;
          locataire_telephone?: string | null;
          porte?: string | null;
          surface_utile?: number | null;
          tranche_code: string;
          type_lot?: string | null;
          updated_at?: string;
          ville?: string | null;
          vu_le?: string | null;
        };
        Update: {
          actif?: boolean;
          adresse?: string | null;
          batiment?: string | null;
          code_patrimoine?: string;
          code_postal?: string | null;
          created_at?: string;
          date_achevement_travaux?: string | null;
          date_dpe?: string | null;
          date_entree?: string | null;
          dpe?: string | null;
          etage?: string | null;
          id?: string;
          identifiant_insee?: string | null;
          individuel_collectif?: string | null;
          locataire_email?: string | null;
          locataire_nom?: string | null;
          locataire_telephone?: string | null;
          porte?: string | null;
          surface_utile?: number | null;
          tranche_code?: string;
          type_lot?: string | null;
          updated_at?: string;
          ville?: string | null;
          vu_le?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "lots_tranche_code_fkey";
            columns: ["tranche_code"];
            isOneToOne: false;
            referencedRelation: "tranches";
            referencedColumns: ["code"];
          },
        ];
      };
      occupants: {
        Row: {
          created_at: string;
          date_entree: string | null;
          date_naissance: string | null;
          id: string;
          lot_code: string;
          nom: string | null;
          prenom: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          date_entree?: string | null;
          date_naissance?: string | null;
          id?: string;
          lot_code: string;
          nom?: string | null;
          prenom?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          date_entree?: string | null;
          date_naissance?: string | null;
          id?: string;
          lot_code?: string;
          nom?: string | null;
          prenom?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "occupants_lot_code_fkey";
            columns: ["lot_code"];
            isOneToOne: false;
            referencedRelation: "lots";
            referencedColumns: ["code_patrimoine"];
          },
        ];
      };
      psp_command_analysis: {
        Row: {
          analyse_json: Json;
          analyzed_at: string | null;
          categorie_budget: string | null;
          categorie_budget_statut: string | null;
          cause_probable: string | null;
          composant: string | null;
          confiance: number | null;
          er_reference: string | null;
          id: string;
          import_row_id: string | null;
          justification: string | null;
          modele: string | null;
          niveau_rattachement: string | null;
          numero_commande: string;
          numero_commande_interne: string | null;
          phase_patrimoniale: string | null;
          prompt_version: string | null;
          source_import_id: string | null;
          statut: string;
          type_intervention: string | null;
          updated_at: string;
          utilisable_cycle: boolean | null;
        };
        Insert: {
          analyse_json: Json;
          analyzed_at?: string | null;
          categorie_budget?: string | null;
          categorie_budget_statut?: string | null;
          cause_probable?: string | null;
          composant?: string | null;
          confiance?: number | null;
          er_reference?: string | null;
          id?: string;
          import_row_id?: string | null;
          justification?: string | null;
          modele?: string | null;
          niveau_rattachement?: string | null;
          numero_commande: string;
          numero_commande_interne?: string | null;
          phase_patrimoniale?: string | null;
          prompt_version?: string | null;
          source_import_id?: string | null;
          statut?: string;
          type_intervention?: string | null;
          updated_at?: string;
          utilisable_cycle?: boolean | null;
        };
        Update: {
          analyse_json?: Json;
          analyzed_at?: string | null;
          categorie_budget?: string | null;
          categorie_budget_statut?: string | null;
          cause_probable?: string | null;
          composant?: string | null;
          confiance?: number | null;
          er_reference?: string | null;
          id?: string;
          import_row_id?: string | null;
          justification?: string | null;
          modele?: string | null;
          niveau_rattachement?: string | null;
          numero_commande?: string;
          numero_commande_interne?: string | null;
          phase_patrimoniale?: string | null;
          prompt_version?: string | null;
          source_import_id?: string | null;
          statut?: string;
          type_intervention?: string | null;
          updated_at?: string;
          utilisable_cycle?: boolean | null;
        };
        Relationships: [
          {
            foreignKeyName: "psp_command_analysis_import_row_id_fkey";
            columns: ["import_row_id"];
            isOneToOne: false;
            referencedRelation: "psp_import_rows";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "psp_command_analysis_source_import_id_fkey";
            columns: ["source_import_id"];
            isOneToOne: false;
            referencedRelation: "psp_imports";
            referencedColumns: ["id"];
          },
        ];
      };
      psp_command_links: {
        Row: {
          commande_id: string;
          confiance: number | null;
          created_at: string;
          id: string;
          import_row_id: string;
          justification: string | null;
          methode: string;
          psp_ligne_id: string | null;
          statut: string;
          type_relation: string;
          updated_at: string;
        };
        Insert: {
          commande_id: string;
          confiance?: number | null;
          created_at?: string;
          id?: string;
          import_row_id: string;
          justification?: string | null;
          methode?: string;
          psp_ligne_id?: string | null;
          statut?: string;
          type_relation?: string;
          updated_at?: string;
        };
        Update: {
          commande_id?: string;
          confiance?: number | null;
          created_at?: string;
          id?: string;
          import_row_id?: string;
          justification?: string | null;
          methode?: string;
          psp_ligne_id?: string | null;
          statut?: string;
          type_relation?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "psp_command_links_commande_id_fkey";
            columns: ["commande_id"];
            isOneToOne: false;
            referencedRelation: "travaux_commandes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "psp_command_links_import_row_id_fkey";
            columns: ["import_row_id"];
            isOneToOne: false;
            referencedRelation: "psp_import_rows";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "psp_command_links_psp_ligne_id_fkey";
            columns: ["psp_ligne_id"];
            isOneToOne: false;
            referencedRelation: "psp_lignes";
            referencedColumns: ["id"];
          },
        ];
      };
      psp_decisions: {
        Row: {
          annee_cible: number | null;
          cible_id: string;
          cible_type: string;
          cle_metier: string | null;
          created_at: string;
          decision_utilisateur: string | null;
          id: string;
          montant: number | null;
          motif: string | null;
          proposition_initiale: Json;
          psp_ligne_id: string | null;
          source_historique: string | null;
          source_suivi_annuel: string | null;
          statut: string;
          type_decision: string;
          updated_at: string;
          valeur_retenue: Json;
        };
        Insert: {
          annee_cible?: number | null;
          cible_id: string;
          cible_type: string;
          cle_metier?: string | null;
          created_at?: string;
          decision_utilisateur?: string | null;
          id?: string;
          montant?: number | null;
          motif?: string | null;
          proposition_initiale: Json;
          psp_ligne_id?: string | null;
          source_historique?: string | null;
          source_suivi_annuel?: string | null;
          statut?: string;
          type_decision: string;
          updated_at?: string;
          valeur_retenue: Json;
        };
        Update: {
          annee_cible?: number | null;
          cible_id?: string;
          cible_type?: string;
          cle_metier?: string | null;
          created_at?: string;
          decision_utilisateur?: string | null;
          id?: string;
          montant?: number | null;
          motif?: string | null;
          proposition_initiale?: Json;
          psp_ligne_id?: string | null;
          source_historique?: string | null;
          source_suivi_annuel?: string | null;
          statut?: string;
          type_decision?: string;
          updated_at?: string;
          valeur_retenue?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "psp_decisions_psp_ligne_id_fkey";
            columns: ["psp_ligne_id"];
            isOneToOne: false;
            referencedRelation: "psp_lignes";
            referencedColumns: ["id"];
          },
        ];
      };
      psp_devis: {
        Row: {
          commentaire: string | null;
          created_at: string;
          date_devis: string | null;
          document_reference: string | null;
          entreprise: string | null;
          fournisseur_id: string | null;
          id: string;
          montant: number | null;
          psp_ligne_id: string;
          statut: string;
          updated_at: string;
        };
        Insert: {
          commentaire?: string | null;
          created_at?: string;
          date_devis?: string | null;
          document_reference?: string | null;
          entreprise?: string | null;
          fournisseur_id?: string | null;
          id?: string;
          montant?: number | null;
          psp_ligne_id: string;
          statut?: string;
          updated_at?: string;
        };
        Update: {
          commentaire?: string | null;
          created_at?: string;
          date_devis?: string | null;
          document_reference?: string | null;
          entreprise?: string | null;
          fournisseur_id?: string | null;
          id?: string;
          montant?: number | null;
          psp_ligne_id?: string;
          statut?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "psp_devis_fournisseur_id_fkey";
            columns: ["fournisseur_id"];
            isOneToOne: false;
            referencedRelation: "fournisseurs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "psp_devis_psp_ligne_id_fkey";
            columns: ["psp_ligne_id"];
            isOneToOne: false;
            referencedRelation: "psp_lignes";
            referencedColumns: ["id"];
          },
        ];
      };
      psp_enveloppes: {
        Row: {
          annee: number;
          categorie: string;
          created_at: string;
          id: string;
          montant: number;
          programmation_id: string;
          updated_at: string;
        };
        Insert: {
          annee: number;
          categorie: string;
          created_at?: string;
          id?: string;
          montant?: number;
          programmation_id: string;
          updated_at?: string;
        };
        Update: {
          annee?: number;
          categorie?: string;
          created_at?: string;
          id?: string;
          montant?: number;
          programmation_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "psp_enveloppes_programmation_id_fkey";
            columns: ["programmation_id"];
            isOneToOne: false;
            referencedRelation: "psp_programmations";
            referencedColumns: ["id"];
          },
        ];
      };
      psp_feedback: {
        Row: {
          cible_id: string;
          cible_type: string;
          correction: Json;
          created_at: string;
          decision_utilisateur: string | null;
          id: string;
          motif: string | null;
          proposition_initiale: Json;
        };
        Insert: {
          cible_id: string;
          cible_type: string;
          correction: Json;
          created_at?: string;
          decision_utilisateur?: string | null;
          id?: string;
          motif?: string | null;
          proposition_initiale: Json;
        };
        Update: {
          cible_id?: string;
          cible_type?: string;
          correction?: Json;
          created_at?: string;
          decision_utilisateur?: string | null;
          id?: string;
          motif?: string | null;
          proposition_initiale?: Json;
        };
        Relationships: [
        ];
      };
      psp_import_rows: {
        Row: {
          adresse: string | null;
          annee_exercice: number | null;
          batiment_er: string | null;
          batiment_num: string | null;
          commune: string | null;
          corps_etat_code: string | null;
          corps_etat_libelle: string | null;
          created_at: string;
          date_commande: string | null;
          donnees_brutes: Json;
          entree_er: string | null;
          entree_num: string | null;
          er_reference: string | null;
          erreurs: Json;
          etat: string | null;
          fournisseur: string | null;
          id: string;
          import_id: string;
          ligne_numero: number;
          lot_er: string | null;
          montant_budget: number | null;
          montant_ecart: number | null;
          montant_engage: number | null;
          montant_paye: number | null;
          nature_analytique: string | null;
          numero_commande: string | null;
          numero_commande_interne: string | null;
          patrimoine: string | null;
          secteur: string | null;
          statut: string;
          tranche_er: string | null;
        };
        Insert: {
          adresse?: string | null;
          annee_exercice?: number | null;
          batiment_er?: string | null;
          batiment_num?: string | null;
          commune?: string | null;
          corps_etat_code?: string | null;
          corps_etat_libelle?: string | null;
          created_at?: string;
          date_commande?: string | null;
          donnees_brutes: Json;
          entree_er?: string | null;
          entree_num?: string | null;
          er_reference?: string | null;
          erreurs: Json;
          etat?: string | null;
          fournisseur?: string | null;
          id?: string;
          import_id: string;
          ligne_numero: number;
          lot_er?: string | null;
          montant_budget?: number | null;
          montant_ecart?: number | null;
          montant_engage?: number | null;
          montant_paye?: number | null;
          nature_analytique?: string | null;
          numero_commande?: string | null;
          numero_commande_interne?: string | null;
          patrimoine?: string | null;
          secteur?: string | null;
          statut?: string;
          tranche_er?: string | null;
        };
        Update: {
          adresse?: string | null;
          annee_exercice?: number | null;
          batiment_er?: string | null;
          batiment_num?: string | null;
          commune?: string | null;
          corps_etat_code?: string | null;
          corps_etat_libelle?: string | null;
          created_at?: string;
          date_commande?: string | null;
          donnees_brutes?: Json;
          entree_er?: string | null;
          entree_num?: string | null;
          er_reference?: string | null;
          erreurs?: Json;
          etat?: string | null;
          fournisseur?: string | null;
          id?: string;
          import_id?: string;
          ligne_numero?: number;
          lot_er?: string | null;
          montant_budget?: number | null;
          montant_ecart?: number | null;
          montant_engage?: number | null;
          montant_paye?: number | null;
          nature_analytique?: string | null;
          numero_commande?: string | null;
          numero_commande_interne?: string | null;
          patrimoine?: string | null;
          secteur?: string | null;
          statut?: string;
          tranche_er?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "psp_import_rows_import_id_fkey";
            columns: ["import_id"];
            isOneToOne: false;
            referencedRelation: "psp_imports";
            referencedColumns: ["id"];
          },
        ];
      };
      psp_imports: {
        Row: {
          completed_at: string | null;
          created_at: string;
          doublons: number;
          erreurs_detail: Json;
          exercice: number | null;
          fichier_nom: string;
          id: string;
          lignes_erreur: number;
          lignes_total: number;
          lignes_valides: number;
          statut: string;
          structure_detectee: Json;
        };
        Insert: {
          completed_at?: string | null;
          created_at?: string;
          doublons?: number;
          erreurs_detail: Json;
          exercice?: number | null;
          fichier_nom: string;
          id?: string;
          lignes_erreur?: number;
          lignes_total?: number;
          lignes_valides?: number;
          statut?: string;
          structure_detectee: Json;
        };
        Update: {
          completed_at?: string | null;
          created_at?: string;
          doublons?: number;
          erreurs_detail?: Json;
          exercice?: number | null;
          fichier_nom?: string;
          id?: string;
          lignes_erreur?: number;
          lignes_total?: number;
          lignes_valides?: number;
          statut?: string;
          structure_detectee?: Json;
        };
        Relationships: [
        ];
      };
      psp_ligne_historique: {
        Row: {
          apres: Json | null;
          avant: Json | null;
          created_at: string;
          id: string;
          ligne_id: string;
          motif: string | null;
          operation: string;
          resolu: boolean;
          utilisateur: string | null;
        };
        Insert: {
          apres?: Json | null;
          avant?: Json | null;
          created_at?: string;
          id?: string;
          ligne_id: string;
          motif?: string | null;
          operation?: string;
          resolu?: boolean;
          utilisateur?: string | null;
        };
        Update: {
          apres?: Json | null;
          avant?: Json | null;
          created_at?: string;
          id?: string;
          ligne_id?: string;
          motif?: string | null;
          operation?: string;
          resolu?: boolean;
          utilisateur?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "psp_ligne_historique_ligne_id_fkey";
            columns: ["ligne_id"];
            isOneToOne: false;
            referencedRelation: "psp_lignes";
            referencedColumns: ["id"];
          },
        ];
      };
      psp_ligne_patrimoine: {
        Row: {
          created_at: string;
          id: string;
          lot_id: string | null;
          niveau: string;
          numero: string | null;
          psp_ligne_id: string;
          rue: string | null;
          tranche_code: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          lot_id?: string | null;
          niveau: string;
          numero?: string | null;
          psp_ligne_id: string;
          rue?: string | null;
          tranche_code: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          lot_id?: string | null;
          niveau?: string;
          numero?: string | null;
          psp_ligne_id?: string;
          rue?: string | null;
          tranche_code?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "psp_ligne_patrimoine_lot_id_fkey";
            columns: ["lot_id"];
            isOneToOne: false;
            referencedRelation: "lots";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "psp_ligne_patrimoine_psp_ligne_id_fkey";
            columns: ["psp_ligne_id"];
            isOneToOne: false;
            referencedRelation: "psp_lignes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "psp_ligne_patrimoine_tranche_code_fkey";
            columns: ["tranche_code"];
            isOneToOne: false;
            referencedRelation: "tranches";
            referencedColumns: ["code"];
          },
        ];
      };
      psp_lignes: {
        Row: {
          categorie: string;
          corps_etat: string | null;
          corps_etat_code: string | null;
          created_at: string;
          id: string;
          ligne_budget: string | null;
          nature_travaux: string | null;
          origine: string;
          priorite: string;
          programmation_id: string;
          programme: Json;
          remarques: string | null;
          statut: string;
          tranche_code: string;
          updated_at: string;
        };
        Insert: {
          categorie: string;
          corps_etat?: string | null;
          corps_etat_code?: string | null;
          created_at?: string;
          id?: string;
          ligne_budget?: string | null;
          nature_travaux?: string | null;
          origine?: string;
          priorite?: string;
          programmation_id: string;
          programme: Json;
          remarques?: string | null;
          statut?: string;
          tranche_code: string;
          updated_at?: string;
        };
        Update: {
          categorie?: string;
          corps_etat?: string | null;
          corps_etat_code?: string | null;
          created_at?: string;
          id?: string;
          ligne_budget?: string | null;
          nature_travaux?: string | null;
          origine?: string;
          priorite?: string;
          programmation_id?: string;
          programme?: Json;
          remarques?: string | null;
          statut?: string;
          tranche_code?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "psp_lignes_programmation_id_fkey";
            columns: ["programmation_id"];
            isOneToOne: false;
            referencedRelation: "psp_programmations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "psp_lignes_tranche_code_fkey";
            columns: ["tranche_code"];
            isOneToOne: false;
            referencedRelation: "tranches";
            referencedColumns: ["code"];
          },
        ];
      };
      psp_patrimoine_context: {
        Row: {
          date_reference_gestion: string | null;
          donnees_contextuelles: Json;
          er_id: string;
          exception: boolean;
          id: string;
          justification: string | null;
          niveau: string;
          parent_er_id: string | null;
          perimetre_psp: string;
          source_date_reference: string | null;
          type_patrimoine: string | null;
          updated_at: string;
        };
        Insert: {
          date_reference_gestion?: string | null;
          donnees_contextuelles: Json;
          er_id: string;
          exception?: boolean;
          id?: string;
          justification?: string | null;
          niveau: string;
          parent_er_id?: string | null;
          perimetre_psp?: string;
          source_date_reference?: string | null;
          type_patrimoine?: string | null;
          updated_at?: string;
        };
        Update: {
          date_reference_gestion?: string | null;
          donnees_contextuelles?: Json;
          er_id?: string;
          exception?: boolean;
          id?: string;
          justification?: string | null;
          niveau?: string;
          parent_er_id?: string | null;
          perimetre_psp?: string;
          source_date_reference?: string | null;
          type_patrimoine?: string | null;
          updated_at?: string;
        };
        Relationships: [
        ];
      };
      psp_programmations: {
        Row: {
          annee_debut: number;
          annee_fin: number;
          auteur: string | null;
          created_at: string;
          frozen_at: string | null;
          frozen_by: string | null;
          id: string;
          parent_id: string | null;
          remarques: string | null;
          statut: string;
          type: string;
          updated_at: string;
          validated_at: string | null;
          validated_by: string | null;
          version: number;
        };
        Insert: {
          annee_debut: number;
          annee_fin: number;
          auteur?: string | null;
          created_at?: string;
          frozen_at?: string | null;
          frozen_by?: string | null;
          id?: string;
          parent_id?: string | null;
          remarques?: string | null;
          statut?: string;
          type?: string;
          updated_at?: string;
          validated_at?: string | null;
          validated_by?: string | null;
          version?: number;
        };
        Update: {
          annee_debut?: number;
          annee_fin?: number;
          auteur?: string | null;
          created_at?: string;
          frozen_at?: string | null;
          frozen_by?: string | null;
          id?: string;
          parent_id?: string | null;
          remarques?: string | null;
          statut?: string;
          type?: string;
          updated_at?: string;
          validated_at?: string | null;
          validated_by?: string | null;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "psp_programmations_parent_id_fkey";
            columns: ["parent_id"];
            isOneToOne: false;
            referencedRelation: "psp_programmations";
            referencedColumns: ["id"];
          },
        ];
      };
      psp_reports: {
        Row: {
          cible_annee: number;
          cible_ligne_id: string;
          created_at: string;
          created_by: string | null;
          id: string;
          montant: number;
          motif: string | null;
          source_annee: number;
          source_ligne_id: string;
        };
        Insert: {
          cible_annee: number;
          cible_ligne_id: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          montant?: number;
          motif?: string | null;
          source_annee: number;
          source_ligne_id: string;
        };
        Update: {
          cible_annee?: number;
          cible_ligne_id?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          montant?: number;
          motif?: string | null;
          source_annee?: number;
          source_ligne_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "psp_reports_cible_ligne_id_fkey";
            columns: ["cible_ligne_id"];
            isOneToOne: false;
            referencedRelation: "psp_lignes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "psp_reports_source_ligne_id_fkey";
            columns: ["source_ligne_id"];
            isOneToOne: false;
            referencedRelation: "psp_lignes";
            referencedColumns: ["id"];
          },
        ];
      };
      psp_rules: {
        Row: {
          condition: Json;
          created_at: string;
          id: string;
          justification: string | null;
          nom: string;
          priorite: number;
          resultat: Json;
          statut: string;
          type_regle: string;
          updated_at: string;
        };
        Insert: {
          condition: Json;
          created_at?: string;
          id?: string;
          justification?: string | null;
          nom: string;
          priorite?: number;
          resultat: Json;
          statut?: string;
          type_regle: string;
          updated_at?: string;
        };
        Update: {
          condition?: Json;
          created_at?: string;
          id?: string;
          justification?: string | null;
          nom?: string;
          priorite?: number;
          resultat?: Json;
          statut?: string;
          type_regle?: string;
          updated_at?: string;
        };
        Relationships: [
        ];
      };
      tranches: {
        Row: {
          actif: boolean;
          code: string;
          copro_numero: string | null;
          created_at: string;
          id: string;
          libelle: string | null;
          localite: string | null;
          nb_logements: number;
          quartier: string | null;
          secteur: string | null;
          sous_secteur: string | null;
          updated_at: string;
          vu_le: string | null;
          zone_apl: string | null;
          zone_edf: string | null;
        };
        Insert: {
          actif?: boolean;
          code: string;
          copro_numero?: string | null;
          created_at?: string;
          id?: string;
          libelle?: string | null;
          localite?: string | null;
          nb_logements?: number;
          quartier?: string | null;
          secteur?: string | null;
          sous_secteur?: string | null;
          updated_at?: string;
          vu_le?: string | null;
          zone_apl?: string | null;
          zone_edf?: string | null;
        };
        Update: {
          actif?: boolean;
          code?: string;
          copro_numero?: string | null;
          created_at?: string;
          id?: string;
          libelle?: string | null;
          localite?: string | null;
          nb_logements?: number;
          quartier?: string | null;
          secteur?: string | null;
          sous_secteur?: string | null;
          updated_at?: string;
          vu_le?: string | null;
          zone_apl?: string | null;
          zone_edf?: string | null;
        };
        Relationships: [
        ];
      };
      travaux: {
        Row: {
          batiment: string | null;
          cout: number;
          created_at: string;
          date_travaux: string | null;
          id: string;
          libelle: string;
          lot_code: string | null;
          niveau: string;
          note: string | null;
          statut: string;
          tranche_code: string | null;
          updated_at: string;
        };
        Insert: {
          batiment?: string | null;
          cout?: number;
          created_at?: string;
          date_travaux?: string | null;
          id?: string;
          libelle: string;
          lot_code?: string | null;
          niveau?: string;
          note?: string | null;
          statut?: string;
          tranche_code?: string | null;
          updated_at?: string;
        };
        Update: {
          batiment?: string | null;
          cout?: number;
          created_at?: string;
          date_travaux?: string | null;
          id?: string;
          libelle?: string;
          lot_code?: string | null;
          niveau?: string;
          note?: string | null;
          statut?: string;
          tranche_code?: string | null;
          updated_at?: string;
        };
        Relationships: [
        ];
      };
      travaux_commandes: {
        Row: {
          actif: boolean;
          adresse: string | null;
          annee_exercice: number | null;
          batiment: string | null;
          budget: number | null;
          charge_clientele: string | null;
          charge_operation: string | null;
          corps_etat: string | null;
          created_at: string;
          date_communication: string | null;
          date_demarrage: string | null;
          date_fin_travaux: string | null;
          descriptif: string | null;
          ecart: number | null;
          engage: number | null;
          etat_commande: string | null;
          etat_travaux: string | null;
          fournisseur: string | null;
          id: string;
          ligne_budget: string | null;
          lot_code: string | null;
          nature_analytique: string | null;
          numero_commande: string;
          numero_fournisseur: string | null;
          observations: string | null;
          paye: number | null;
          secteur: string | null;
          solde: number | null;
          support_communication: string | null;
          tranche_code: string | null;
          updated_at: string;
          vu_dans_import_id: string | null;
        };
        Insert: {
          actif?: boolean;
          adresse?: string | null;
          annee_exercice?: number | null;
          batiment?: string | null;
          budget?: number | null;
          charge_clientele?: string | null;
          charge_operation?: string | null;
          corps_etat?: string | null;
          created_at?: string;
          date_communication?: string | null;
          date_demarrage?: string | null;
          date_fin_travaux?: string | null;
          descriptif?: string | null;
          ecart?: number | null;
          engage?: number | null;
          etat_commande?: string | null;
          etat_travaux?: string | null;
          fournisseur?: string | null;
          id?: string;
          ligne_budget?: string | null;
          lot_code?: string | null;
          nature_analytique?: string | null;
          numero_commande: string;
          numero_fournisseur?: string | null;
          observations?: string | null;
          paye?: number | null;
          secteur?: string | null;
          solde?: number | null;
          support_communication?: string | null;
          tranche_code?: string | null;
          updated_at?: string;
          vu_dans_import_id?: string | null;
        };
        Update: {
          actif?: boolean;
          adresse?: string | null;
          annee_exercice?: number | null;
          batiment?: string | null;
          budget?: number | null;
          charge_clientele?: string | null;
          charge_operation?: string | null;
          corps_etat?: string | null;
          created_at?: string;
          date_communication?: string | null;
          date_demarrage?: string | null;
          date_fin_travaux?: string | null;
          descriptif?: string | null;
          ecart?: number | null;
          engage?: number | null;
          etat_commande?: string | null;
          etat_travaux?: string | null;
          fournisseur?: string | null;
          id?: string;
          ligne_budget?: string | null;
          lot_code?: string | null;
          nature_analytique?: string | null;
          numero_commande?: string;
          numero_fournisseur?: string | null;
          observations?: string | null;
          paye?: number | null;
          secteur?: string | null;
          solde?: number | null;
          support_communication?: string | null;
          tranche_code?: string | null;
          updated_at?: string;
          vu_dans_import_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "travaux_commandes_lot_code_fkey";
            columns: ["lot_code"];
            isOneToOne: false;
            referencedRelation: "lots";
            referencedColumns: ["code_patrimoine"];
          },
          {
            foreignKeyName: "travaux_commandes_tranche_code_fkey";
            columns: ["tranche_code"];
            isOneToOne: false;
            referencedRelation: "tranches";
            referencedColumns: ["code"];
          },
          {
            foreignKeyName: "travaux_commandes_vu_dans_import_id_fkey";
            columns: ["vu_dans_import_id"];
            isOneToOne: false;
            referencedRelation: "import_travaux";
            referencedColumns: ["id"];
          },
        ];
      };
      travaux_commandes_historique: {
        Row: {
          apres: Json | null;
          avant: Json | null;
          commande_id: string;
          created_at: string;
          id: string;
          import_id: string;
          operation: string;
          resolu: boolean;
        };
        Insert: {
          apres?: Json | null;
          avant?: Json | null;
          commande_id: string;
          created_at?: string;
          id?: string;
          import_id: string;
          operation: string;
          resolu?: boolean;
        };
        Update: {
          apres?: Json | null;
          avant?: Json | null;
          commande_id?: string;
          created_at?: string;
          id?: string;
          import_id?: string;
          operation?: string;
          resolu?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "travaux_commandes_historique_commande_id_fkey";
            columns: ["commande_id"];
            isOneToOne: false;
            referencedRelation: "travaux_commandes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "travaux_commandes_historique_import_id_fkey";
            columns: ["import_id"];
            isOneToOne: false;
            referencedRelation: "import_travaux";
            referencedColumns: ["id"];
          },
        ];
      };
      travaux_import_details: {
        Row: {
          annee_exercice: number | null;
          commande_id: string | null;
          created_at: string;
          details: Json | null;
          id: string;
          import_id: string;
          ligne: number | null;
          lot_code: string | null;
          message: string | null;
          numero_commande: string | null;
          type: string;
        };
        Insert: {
          annee_exercice?: number | null;
          commande_id?: string | null;
          created_at?: string;
          details?: Json | null;
          id?: string;
          import_id: string;
          ligne?: number | null;
          lot_code?: string | null;
          message?: string | null;
          numero_commande?: string | null;
          type: string;
        };
        Update: {
          annee_exercice?: number | null;
          commande_id?: string | null;
          created_at?: string;
          details?: Json | null;
          id?: string;
          import_id?: string;
          ligne?: number | null;
          lot_code?: string | null;
          message?: string | null;
          numero_commande?: string | null;
          type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "travaux_import_details_commande_id_fkey";
            columns: ["commande_id"];
            isOneToOne: false;
            referencedRelation: "travaux_commandes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "travaux_import_details_import_id_fkey";
            columns: ["import_id"];
            isOneToOne: false;
            referencedRelation: "import_travaux";
            referencedColumns: ["id"];
          },
        ];
      };
      v_travaux_commandes_enrichies: {
        Row: {
          adresse: string | null;
          analyse_confiance: number | null;
          analyse_id: string | null;
          analyse_justification: string | null;
          analyse_modele: string | null;
          analyse_statut: string | null;
          annee_exercice: number | null;
          batiment: string | null;
          budget: number | null;
          categorie_budget: string | null;
          categorie_budget_statut: string | null;
          cause_probable: string | null;
          charge_clientele: string | null;
          charge_operation: string | null;
          commande_id: string | null;
          composant: string | null;
          corps_etat_suivi_annuel: string | null;
          date_communication: string | null;
          date_demarrage: string | null;
          date_fin_travaux: string | null;
          descriptif: string | null;
          ecart: number | null;
          engage: number | null;
          etat_commande: string | null;
          etat_travaux: string | null;
          fournisseur: string | null;
          lien_confiance: number | null;
          lien_id: string | null;
          lien_methode: string | null;
          lien_statut: string | null;
          ligne_budget: string | null;
          lot_code: string | null;
          nature_historique: string | null;
          nature_suivi_annuel: string | null;
          niveau_rattachement: string | null;
          numero_commande: string | null;
          numero_commande_interne: string | null;
          numero_fournisseur: string | null;
          observations: string | null;
          paye: number | null;
          phase_patrimoniale: string | null;
          psp_adresse: string | null;
          psp_annee_exercice: number | null;
          psp_batiment_er: string | null;
          psp_batiment_num: string | null;
          psp_commune: string | null;
          psp_corps_etat_code: string | null;
          psp_corps_etat_libelle: string | null;
          psp_date_commande: string | null;
          psp_donnees_brutes: Json | null;
          psp_entree_er: string | null;
          psp_entree_num: string | null;
          psp_er_reference: string | null;
          psp_erreurs: Json | null;
          psp_etat: string | null;
          psp_fournisseur: string | null;
          psp_import_id: string | null;
          psp_ligne_numero: number | null;
          psp_lot_er: string | null;
          psp_montant_budget: number | null;
          psp_montant_ecart: number | null;
          psp_montant_engage: number | null;
          psp_montant_paye: number | null;
          psp_patrimoine: string | null;
          psp_tranche_er: string | null;
          secteur: string | null;
          solde: number | null;
          support_communication: string | null;
          tranche_code: string | null;
          type_intervention: string | null;
          utilisable_cycle: boolean | null;
        };
        Insert: {
          adresse?: string | null;
          analyse_confiance?: number | null;
          analyse_id?: string | null;
          analyse_justification?: string | null;
          analyse_modele?: string | null;
          analyse_statut?: string | null;
          annee_exercice?: number | null;
          batiment?: string | null;
          budget?: number | null;
          categorie_budget?: string | null;
          categorie_budget_statut?: string | null;
          cause_probable?: string | null;
          charge_clientele?: string | null;
          charge_operation?: string | null;
          commande_id?: string | null;
          composant?: string | null;
          corps_etat_suivi_annuel?: string | null;
          date_communication?: string | null;
          date_demarrage?: string | null;
          date_fin_travaux?: string | null;
          descriptif?: string | null;
          ecart?: number | null;
          engage?: number | null;
          etat_commande?: string | null;
          etat_travaux?: string | null;
          fournisseur?: string | null;
          lien_confiance?: number | null;
          lien_id?: string | null;
          lien_methode?: string | null;
          lien_statut?: string | null;
          ligne_budget?: string | null;
          lot_code?: string | null;
          nature_historique?: string | null;
          nature_suivi_annuel?: string | null;
          niveau_rattachement?: string | null;
          numero_commande?: string | null;
          numero_commande_interne?: string | null;
          numero_fournisseur?: string | null;
          observations?: string | null;
          paye?: number | null;
          phase_patrimoniale?: string | null;
          psp_adresse?: string | null;
          psp_annee_exercice?: number | null;
          psp_batiment_er?: string | null;
          psp_batiment_num?: string | null;
          psp_commune?: string | null;
          psp_corps_etat_code?: string | null;
          psp_corps_etat_libelle?: string | null;
          psp_date_commande?: string | null;
          psp_donnees_brutes?: Json | null;
          psp_entree_er?: string | null;
          psp_entree_num?: string | null;
          psp_er_reference?: string | null;
          psp_erreurs?: Json | null;
          psp_etat?: string | null;
          psp_fournisseur?: string | null;
          psp_import_id?: string | null;
          psp_ligne_numero?: number | null;
          psp_lot_er?: string | null;
          psp_montant_budget?: number | null;
          psp_montant_ecart?: number | null;
          psp_montant_engage?: number | null;
          psp_montant_paye?: number | null;
          psp_patrimoine?: string | null;
          psp_tranche_er?: string | null;
          secteur?: string | null;
          solde?: number | null;
          support_communication?: string | null;
          tranche_code?: string | null;
          type_intervention?: string | null;
          utilisable_cycle?: boolean | null;
        };
        Update: {
          adresse?: string | null;
          analyse_confiance?: number | null;
          analyse_id?: string | null;
          analyse_justification?: string | null;
          analyse_modele?: string | null;
          analyse_statut?: string | null;
          annee_exercice?: number | null;
          batiment?: string | null;
          budget?: number | null;
          categorie_budget?: string | null;
          categorie_budget_statut?: string | null;
          cause_probable?: string | null;
          charge_clientele?: string | null;
          charge_operation?: string | null;
          commande_id?: string | null;
          composant?: string | null;
          corps_etat_suivi_annuel?: string | null;
          date_communication?: string | null;
          date_demarrage?: string | null;
          date_fin_travaux?: string | null;
          descriptif?: string | null;
          ecart?: number | null;
          engage?: number | null;
          etat_commande?: string | null;
          etat_travaux?: string | null;
          fournisseur?: string | null;
          lien_confiance?: number | null;
          lien_id?: string | null;
          lien_methode?: string | null;
          lien_statut?: string | null;
          ligne_budget?: string | null;
          lot_code?: string | null;
          nature_historique?: string | null;
          nature_suivi_annuel?: string | null;
          niveau_rattachement?: string | null;
          numero_commande?: string | null;
          numero_commande_interne?: string | null;
          numero_fournisseur?: string | null;
          observations?: string | null;
          paye?: number | null;
          phase_patrimoniale?: string | null;
          psp_adresse?: string | null;
          psp_annee_exercice?: number | null;
          psp_batiment_er?: string | null;
          psp_batiment_num?: string | null;
          psp_commune?: string | null;
          psp_corps_etat_code?: string | null;
          psp_corps_etat_libelle?: string | null;
          psp_date_commande?: string | null;
          psp_donnees_brutes?: Json | null;
          psp_entree_er?: string | null;
          psp_entree_num?: string | null;
          psp_er_reference?: string | null;
          psp_erreurs?: Json | null;
          psp_etat?: string | null;
          psp_fournisseur?: string | null;
          psp_import_id?: string | null;
          psp_ligne_numero?: number | null;
          psp_lot_er?: string | null;
          psp_montant_budget?: number | null;
          psp_montant_ecart?: number | null;
          psp_montant_engage?: number | null;
          psp_montant_paye?: number | null;
          psp_patrimoine?: string | null;
          psp_tranche_er?: string | null;
          secteur?: string | null;
          solde?: number | null;
          support_communication?: string | null;
          tranche_code?: string | null;
          type_intervention?: string | null;
          utilisable_cycle?: boolean | null;
        };
        Relationships: [
          {
            foreignKeyName: "v_travaux_commandes_enrichies_lot_code_fkey";
            columns: ["lot_code"];
            isOneToOne: false;
            referencedRelation: "lots";
            referencedColumns: ["code_patrimoine"];
          },
          {
            foreignKeyName: "v_travaux_commandes_enrichies_tranche_code_fkey";
            columns: ["tranche_code"];
            isOneToOne: false;
            referencedRelation: "tranches";
            referencedColumns: ["code"];
          },
        ];
      };
      villes_geo: {
        Row: {
          created_at: string;
          id: string;
          lat: number;
          lng: number;
          updated_at: string;
          ville: string;
          ville_normalisee: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          lat: number;
          lng: number;
          updated_at?: string;
          ville: string;
          ville_normalisee: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          lat?: number;
          lng?: number;
          updated_at?: string;
          ville?: string;
          ville_normalisee?: string;
        };
        Relationships: [
        ];
      };
    };
    Views: {
      [key: string]: never;
    };
    Functions: {
      [key: string]: never;
    };
    Enums: {
      [key: string]: never;
    };
    CompositeTypes: {
      [key: string]: never;
    };
  };
};
