/**
 * V8.2.1 — WORKFLOW DEMANDE DE DEVIS (fiche opération de /preparation-psp).
 *
 * Entreprises suggérées (données RÉELLES — socle V8.1) → sélection multi
 * (retirable) → « Préparer la demande de devis » → éditeur de mail par
 * entreprise (destinataire, sujet, corps modifiables) → mailto: → confirmation
 * « Demande préparée / envoyée » → enregistrement dans psp_devis
 * (statut demande_envoyee, montant NULL, date = created_at).
 *
 * PAT S11 ne prétend JAMAIS avoir envoyé le mail ; aucune connexion messagerie.
 */
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckSquare, Mail, RefreshCcw, Search, Square } from "lucide-react";

import PspFournisseurSearch, {
  type FournisseurSelection,
} from "@/components/preparation-psp/PspFournisseurSearch";
import PspLotsDevisSection from "@/components/preparation-psp/PspLotsDevisSection";
import { useMailModeles } from "@/lib/psp/mail.hooks";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  JOURS_REPONSE_DEFAUT_MAIL,
  codeLotDepuis,
  composerMail,
  construireMailto,
  dateRetourParDefaut,
} from "@/lib/psp/suivi.foundation";
import { libelleEntrepriseAvecNumero } from "@/lib/psp/prep.v7";
import { createPspDevis, getPspEntreprisesSuggestions } from "@/lib/psp/prep.supabase.functions";

/**
 * V8.3 — opération source d'une demande de devis. Type STRUCTUREL : utilisé
 * depuis /preparation-psp (PspOperation) comme depuis le registre /suivi
 * (SuiviOperationVue). Aucune dépendance à une table parallèle.
 */
export interface OperationDemandeDevis {
  id: string;
  tranche: string;
  nature_travaux?: string | null;
  corps_etat?: string | null;
  adresse?: string | null;
  ville?: string | null;
  /** V8.16r — code lot (ex. ER.26154) si connu (sinon extrait de la nature). */
  code_lot?: string | null;
  /** V8.16z — lots concernés, issus du périmètre (adresse/périmètre) de la ligne. */
  lots?: Array<{ lot_id: string | null; niveau?: string | null }> | null;
}

type SuggestionAvecEmail = {
  fournisseur_id: string;
  nom: string;
  /** Numéro fournisseur réel (alias) — libellé robuste si nom absent. */
  numero?: string | null;
  correspondance: "forte" | "compatible" | "aucune";
  etiquettes: string[];
  /** V8.3 §5 — historique réel des commandes (travaux_commandes). */
  commandes_corps_etat: number;
  commandes_total: number;
  email: string | null;
};

export default function PspDemandeDevisWorkflow({
  operation,
  figee,
  onEnvoye,
}: {
  operation: OperationDemandeDevis;
  figee: boolean;
  onEnvoye: () => Promise<void>;
}) {
  const fetchSuggestions = useServerFn(getPspEntreprisesSuggestions);
  const creerDevis = useServerFn(createPspDevis);
  // V8.16p — modèles de mail persistés (base sinon constantes).
  const { modeles } = useMailModeles();
  const { data: suggestions } = useQuery({
    queryKey: ["psp-suggestions", operation.id],
    queryFn: () =>
      fetchSuggestions({
        data: { pspLigneId: operation.id, corpsEtat: operation.corps_etat, limite: 8 },
      }),
    staleTime: 1000 * 60 * 10,
    retry: 1,
  });

  const [selectionIds, setSelectionIds] = useState<string[]>([]);
  const [editeur, setEditeur] = useState<SuggestionAvecEmail | null>(null);
  const [sujet, setSujet] = useState("");
  const [corps, setCorps] = useState("");
  const [enregistre, setEnregistre] = useState(false);
  // V8.8 §2 — entreprise libre choisie hors suggestions (référentiel fournisseurs).
  const [entrepriseLibre, setEntrepriseLibre] = useState<FournisseurSelection | null>(null);
  // V8.16z — bloc « Informations des lots » injecté dans le mail (rattaché à la
  // ligne ; injecté immédiatement si l'éditeur est ouvert, sinon au prochain envoi).
  const blocLotsRef = useRef("");

  // V8.16r — modèle courant (délai du modèle pour la date de retour, format jj/mm/aaaa).
  const modeleDemande = modeles.find((m) => m.id === "demande_devis") ??
    modeles[0] ?? {
      id: "demande_devis",
      libelle: "Demande de devis",
      sujet: "",
      corps: "",
      delai_jours: JOURS_REPONSE_DEFAUT_MAIL,
    };
  const variables = {
    TR: operation.tranche,
    NATURE_TRAVAUX: operation.nature_travaux ?? "",
    CORPS_ETAT: operation.corps_etat ?? "",
    ADRESSE: [operation.adresse, operation.ville].filter(Boolean).join(", "),
    VILLE: operation.ville ?? "",
    CODE_LOT: operation.code_lot ?? codeLotDepuis(operation.nature_travaux),
    DATE_RETOUR: dateRetourParDefaut(
      new Date(),
      modeleDemande.delai_jours ?? JOURS_REPONSE_DEFAUT_MAIL,
    ),
  };
  const modele = () => composerMail(modeleDemande, variables);

  useEffect(() => {
    if (!editeur) return;
    const m = modele();
    setSujet(m.sujet);
    // V8.16z — si un bloc « Informations des lots » a été composé dans le
    // panneau, il est ajouté au corps du mail de chaque entreprise.
    setCorps(blocLotsRef.current ? `${m.corps}\n\n${blocLotsRef.current}` : m.corps);
    setEnregistre(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editeur]);

  const basculer = (id: string) =>
    setSelectionIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const selection = (suggestions ?? []).filter((s) => selectionIds.includes(s.fournisseur_id));
  // V8.8 §2 — l'entreprise libre sélectionnée rejoint la sélection (hors suggestions).
  const selectionLibre: SuggestionAvecEmail[] = entrepriseLibre
    ? [
        {
          fournisseur_id: entrepriseLibre.id ?? `libre:${entrepriseLibre.nom}`,
          nom: entrepriseLibre.nom,
          numero: entrepriseLibre.numero ?? null,
          correspondance: "aucune",
          etiquettes: ["Hors suggestions"],
          commandes_corps_etat: 0,
          commandes_total: 0,
          email: null,
        },
      ]
    : [];
  const selectionComplete = [...selectionLibre, ...selection];
  const mailto = editeur ? construireMailto({ email: editeur.email, sujet, corps }) : "";

  const enregistrerDemande = async () => {
    if (!editeur) return;
    await creerDevis({
      data: {
        pspLigneId: operation.id,
        fournisseurId: editeur.fournisseur_id,
        entreprise: editeur.nom,
        dateDevis: null,
        montant: null,
        statut: "demande_envoyee",
        commentaire: null,
        documentReference: null,
      },
    });
    setEnregistre(true);
    await onEnvoye();
    // Enchaînement : préparer la demande de l'entreprise suivante (si plusieurs).
    const idx = selectionComplete.findIndex((s) => s.fournisseur_id === editeur.fournisseur_id);
    const suivant = selectionComplete[idx + 1] ?? null;
    if (suivant) {
      setEditeur(suivant);
    } else {
      setEditeur(null);
    }
  };

  return (
    <div className="rounded-lg border bg-card p-3">
      <p className="mb-2 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
        <Mail className="size-3.5" /> Demande de devis — entreprises suggérées
      </p>

      {/* V8.16z — lots concernés (périmètre de la ligne) : informations pour l'entreprise */}
      <div className="mb-2 rounded-lg border bg-muted/30 p-2">
        <PspLotsDevisSection
          lots={operation.lots ?? []}
          onAjouterAuMail={(bloc) => {
            blocLotsRef.current = bloc;
            // Éditeur ouvert → injection immédiate dans le corps du mail.
            if (editeur) setCorps((prev) => [prev, bloc].filter(Boolean).join("\n\n"));
          }}
        />
      </div>

      {suggestions && suggestions.length > 0 ? (
        <ul className="space-y-1">
          {(suggestions as SuggestionAvecEmail[]).map((s) => {
            const coche = selectionIds.includes(s.fournisseur_id);
            return (
              <li
                key={s.fournisseur_id}
                className="flex flex-wrap items-center gap-2 rounded border border-dashed px-2 py-1 text-[11px]"
              >
                <button
                  type="button"
                  onClick={() => basculer(s.fournisseur_id)}
                  className="inline-flex items-center gap-1.5 font-semibold hover:underline"
                >
                  {coche ? (
                    <CheckSquare className="size-3.5 text-primary" />
                  ) : (
                    <Square className="size-3.5 text-muted-foreground" />
                  )}
                  {libelleEntrepriseAvecNumero(s.nom, s.numero)}
                </button>
                <Badge
                  variant={s.correspondance === "forte" ? "default" : "secondary"}
                  className="text-[9px]"
                >
                  {s.correspondance === "forte" ? "Correspondance forte" : "Entreprise compatible"}
                </Badge>
                <span className="text-muted-foreground">{s.etiquettes.join(" · ")}</span>
                <span className="text-[9px] text-muted-foreground">
                  {s.commandes_total > 0
                    ? `${s.commandes_total} commande(s) historique(s)${
                        s.commandes_corps_etat > 0
                          ? ` dont ${s.commandes_corps_etat} pour ce corps d'état`
                          : ""
                      }`
                    : "Aucun historique de commandes"}
                </span>
                {s.email && <span className="text-[9px] text-muted-foreground">{s.email}</span>}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          Aucune donnée disponible (activités manuelles non renseignées).
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          className="h-7 text-[10px]"
          disabled={figee || selectionComplete.length === 0}
          onClick={() => setEditeur(selectionComplete[0] ?? null)}
        >
          <Mail className="size-3" /> Préparer la demande de devis
        </Button>
        <span className="text-[9px] text-muted-foreground">
          {selectionComplete.length} entreprise(s) sélectionnée(s)
        </span>
      </div>

      {/* V8.8 §2 — recherche libre d'une AUTRE entreprise (référentiel fournisseurs) */}
      <div className="mt-2 border-t border-dashed pt-2">
        <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
          <Search className="mr-1 inline size-3" />
          Rechercher une autre entreprise
        </p>
        <PspFournisseurSearch
          value={entrepriseLibre?.nom ?? ""}
          onSelect={(f) => {
            setEntrepriseLibre(f);
            if (f?.nom)
              setSelectionIds((prev) => [
                ...prev.filter((x) => x.startsWith("libre:")),
                `libre:${f.nom}`,
              ]);
          }}
          placeholder="Rechercher dans le référentiel fournisseurs…"
        />
      </div>

      {/* Éditeur de mail (une entreprise à la fois) */}
      <Dialog open={editeur !== null} onOpenChange={(o) => !o && setEditeur(null)}>
        <DialogContent className="w-[min(94vw,640px)]">
          <DialogHeader>
            <DialogTitle className="text-sm">
              Demande de devis —{" "}
              {editeur ? libelleEntrepriseAvecNumero(editeur.nom, editeur.numero) : ""}
            </DialogTitle>
            <DialogDescription>
              Destinataire :{" "}
              {editeur?.email ? (
                editeur.email
              ) : (
                <span className="font-semibold text-amber-700">
                  Email fournisseur non renseigné
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Sujet
            </label>
            <Input
              value={sujet}
              onChange={(e) => setSujet(e.target.value)}
              className="h-8 text-[11px]"
            />
            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Corps
            </label>
            <Textarea
              value={corps}
              onChange={(e) => setCorps(e.target.value)}
              rows={12}
              className="text-[11px]"
            />
          </div>
          <DialogFooter className="flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-[10px]"
              onClick={() => {
                const m = modele();
                setSujet(m.sujet);
                setCorps(m.corps);
              }}
            >
              <RefreshCcw className="size-3" /> Réinitialiser le modèle
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-[10px]"
              onClick={() => navigator.clipboard?.writeText(`${sujet}\n\n${corps}`)}
            >
              Copier
            </Button>
            {/* V8.16p — ancre NATIVE (aucun wrapper AlertDialog) : l'ouverture du
                mailto ne déclenche plus le dialogue → plus de blocage du site. */}
            <a
              href={mailto}
              target="_blank"
              rel="noreferrer"
              aria-disabled={!editeur?.email}
              onClick={(e) => {
                if (!editeur?.email) e.preventDefault();
              }}
              title={
                editeur?.email
                  ? "Ouvrir le mail dans votre messagerie"
                  : "Ajoutez un email fournisseur pour ouvrir le mail"
              }
              className={
                editeur?.email
                  ? "inline-flex h-7 items-center gap-1 rounded-md bg-primary px-3 text-[10px] font-medium text-primary-foreground hover:bg-primary/90"
                  : "inline-flex h-7 cursor-not-allowed items-center gap-1 rounded-md bg-muted px-3 text-[10px] font-medium text-muted-foreground"
              }
            >
              <Mail className="size-3" /> Ouvrir dans ma messagerie
            </a>
            {/* V8.16p — confirmation SÉPARÉE de l'ouverture du mail */}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" className="h-7 text-[10px]">
                  <CheckSquare className="size-3" /> Confirmer l'envoi
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Demande envoyée ?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Ouvrez le mail dans votre messagerie (mailto:) puis confirmez ici. PAT S11 ne
                    peut pas vérifier l'envoi. Confirmer enregistre la demande (date = aujourd'hui,
                    statut « Demande envoyée », montant vide).
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Non, plus tard</AlertDialogCancel>
                  <AlertDialogAction onClick={enregistrerDemande}>
                    Oui, marquer comme envoyée
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </DialogFooter>
          {enregistre && (
            <p className="text-[11px] font-semibold text-emerald-700">
              ✓ Demande enregistrée — visible dans le Suivi.
            </p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
