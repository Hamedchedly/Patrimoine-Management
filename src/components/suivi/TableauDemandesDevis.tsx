/**
 * V8.10 — TABLEAU DES DEMANDES DE DEVIS (onglets de /suivi).
 *
 * Tableau partagé par les deux onglets : « Suivi annuel » (opérations sans
 * commande → demandes de devis) et « PSP » (opérations programmées). Filtre
 * d'avancement dérivé des données RÉELLES (psp_devis) : Sans devis /
 * Attente de devis / Devis reçus / Toutes. Aucun MOCK, aucun état inventé.
 * Clic sur une ligne → ouvre la fiche opération (workflow demande de devis).
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  CheckSquare,
  ChevronRight,
  Mail,
  RefreshCcw,
  Search,
  Send,
  Square,
  X,
} from "lucide-react";

import PspFournisseurSearch, {
  type FournisseurSelection,
} from "@/components/preparation-psp/PspFournisseurSearch";
import { EtiquetteTranche } from "@/components/tranches/EtiquetteTranche";
import { useMailModeles } from "@/lib/psp.mail.hooks";

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
import { money0 } from "@/lib/formats";
import { secteurDe } from "@/lib/travaux";
import {
  JOURS_REPONSE_DEFAUT_MAIL,
  codeLotDepuis,
  composerMail,
  construireMailto,
  dateRetourParDefaut,
} from "@/lib/psp.suivi.foundation";
import { libelleEntrepriseAvecNumero } from "@/lib/psp.prep.v7";
import { createPspDevis, getPspEntreprisesSuggestions } from "@/lib/psp.prep.supabase.functions";
import {
  AVANCEMENT_DEVIS_LABELS,
  AVANCEMENT_DEVIS_OPTIONS,
  filtrerAvancementDevis,
  type AvancementDevis,
  type LigneDemandeDevis,
} from "@/lib/psp.suivi.view";

const AVANCEMENT_BADGE: Record<AvancementDevis, string> = {
  sans_devis: "bg-slate-100 text-slate-600",
  attente_devis: "bg-amber-100 text-amber-800",
  devis_recus: "bg-emerald-600 text-white",
};

/** V8.16n — colonnes triables du tableau. */
type CleTri =
  "lb" | "tranche" | "adresse" | "ville" | "operation" | "corps" | "budget" | "avancement";

/** En-tête cliquable (tri asc/desc). */
function TriEnTete({
  cle,
  label,
  tri,
  onTri,
}: {
  cle: CleTri;
  label: string;
  tri: { cle: CleTri; dir: 1 | -1 };
  onTri: (cle: CleTri) => void;
}) {
  return (
    <th className="px-2 py-1.5 font-bold">
      <button
        type="button"
        onClick={() => onTri(cle)}
        className="inline-flex items-center gap-1 uppercase transition-colors hover:text-foreground"
        title="Trier"
      >
        {label}
        <span className="text-[8px]">{tri.cle === cle ? (tri.dir === 1 ? "▲" : "▼") : "⇅"}</span>
      </button>
    </th>
  );
}

/** V8.16o — entreprise choisie pour l'envoi groupé (suggestions réelles ou recherche libre). */
type EntrepriseChoisie = {
  fournisseur_id: string;
  nom: string;
  numero?: string | null;
  email?: string | null;
};

/** V8.16o — forme d'une suggestion d'entreprise renvoyée par le serveur (socle V8.1). */
type SuggestionMail = {
  fournisseur_id: string;
  nom: string;
  numero?: string | null;
  email?: string | null;
};

/**
 * V8.16o — DIALOGUE D'ENVOI GROUPÉ. Sélectionner plusieurs lignes → « Suivant »
 * → choisir une ou plusieurs entreprises (suggestions réelles cochables + liste
 * déroulante à recherche réutilisée PspFournisseurSearch) → UN SEUL mailto:
 * listant toutes les adresses et descriptions de travaux (même moteur
 * composerMail / construireMailto que l'envoi ligne par ligne) → confirmation
 * « envoyée » → enregistrement psp_devis (statut demande_envoyee) pour CHAQUE
 * couple (opération × entreprise) via createPspDevis (réutilisé).
 */
function DialogueMailGroupe({
  lignes,
  ouvert,
  onFermer,
  onEnvoye,
}: {
  lignes: LigneDemandeDevis[];
  ouvert: boolean;
  onFermer: () => void;
  onEnvoye?: (() => Promise<void>) | undefined;
}) {
  const [etape, setEtape] = useState<"lignes" | "entreprises" | "mail">("lignes");
  const [entrChoisies, setEntrChoisies] = useState<EntrepriseChoisie[]>([]);
  const [entrepriseLibre, setEntrepriseLibre] = useState<FournisseurSelection | null>(null);
  const [sujet, setSujet] = useState("");
  const [corps, setCorps] = useState("");
  const [enregistre, setEnregistre] = useState(false);

  const fetchSuggestions = useServerFn(getPspEntreprisesSuggestions);
  const creerDevis = useServerFn(createPspDevis);
  // V8.16p — modèles de mail persistés (base sinon constantes).
  const { modeles } = useMailModeles();
  const premiereOperation = lignes.find((l) => l.pspLigneId) ?? null;
  const { data: suggestions } = useQuery({
    queryKey: ["psp-suggestions-groupe", premiereOperation?.pspLigneId ?? "aucune"],
    queryFn: () =>
      premiereOperation?.pspLigneId
        ? fetchSuggestions({
            data: {
              pspLigneId: premiereOperation.pspLigneId,
              corpsEtat: premiereOperation.corps_etat,
              limite: 10,
            },
          })
        : Promise.resolve([]),
    enabled: ouvert && etape === "entreprises" && !!premiereOperation?.pspLigneId,
    staleTime: 1000 * 60 * 10,
    retry: 1,
  });

  // Réinitialise le dialogue à chaque ouverture.
  useEffect(() => {
    if (ouvert) {
      setEtape("lignes");
      setEntrChoisies([]);
      setEntrepriseLibre(null);
      setEnregistre(false);
    }
  }, [ouvert]);

  // V8.16r — UN seul mail, modèle dédié « demande_devis_groupe » (liste élaborée).
  // Destinataires en CCI (bcc), date au format jj/mm/aaaa, délai du modèle.
  const modeleGroupe = modeles.find((m) => m.id === "demande_devis_groupe") ??
    modeles[0] ?? {
      id: "demande_devis_groupe",
      libelle: "Demande de devis groupée",
      sujet: "Demande de devis – {N_OPERATIONS} opération(s)",
      corps: "",
      delai_jours: JOURS_REPONSE_DEFAUT_MAIL,
    };
  const delaiGroupe = modeleGroupe.delai_jours ?? JOURS_REPONSE_DEFAUT_MAIL;
  const listeOperations = lignes
    .map((l, i) => {
      const adresse = [l.adresse_rue ?? l.adresse, l.ville].filter(Boolean).join(", ") || "—";
      const codeLot = codeLotDepuis(l.nature);
      return [
        `${i + 1}. Référence patrimoine : ${l.tranche}`,
        `   Adresse : ${adresse}`,
        ...(codeLot ? [`   Code lot : ${codeLot}`] : []),
        `   Nature des travaux : ${l.nature ?? "—"}`,
        `   Corps d'état : ${l.corps_etat ?? "—"}`,
      ].join("\n");
    })
    .join("\n");
  const sujetCompose = composerMail(modeleGroupe, {
    N_OPERATIONS: String(lignes.length),
  }).sujet;
  const corpsCompose = composerMail(modeleGroupe, {
    N_OPERATIONS: String(lignes.length),
    LISTE_OPERATIONS: listeOperations,
    DATE_RETOUR: dateRetourParDefaut(new Date(), delaiGroupe),
  }).corps;

  useEffect(() => {
    if (etape !== "mail") return;
    setSujet(sujetCompose);
    setCorps(corpsCompose);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [etape]);

  const suggestionsMail = (suggestions ?? []) as unknown as SuggestionMail[];
  const basculerSuggestion = (s: SuggestionMail) =>
    setEntrChoisies((prev) =>
      prev.some((e) => e.fournisseur_id === s.fournisseur_id)
        ? prev.filter((e) => e.fournisseur_id !== s.fournisseur_id)
        : [
            ...prev,
            {
              fournisseur_id: s.fournisseur_id,
              nom: s.nom,
              numero: s.numero ?? null,
              email: s.email ?? null,
            },
          ],
    );
  const ajouterLibre = () => {
    if (!entrepriseLibre?.nom) return;
    const id = entrepriseLibre.id ?? `libre:${entrepriseLibre.nom}`;
    setEntrChoisies((prev) =>
      prev.some((e) => e.fournisseur_id === id)
        ? prev
        : [
            ...prev,
            {
              fournisseur_id: id,
              nom: entrepriseLibre.nom,
              numero: entrepriseLibre.numero ?? null,
              email: null,
            },
          ],
    );
    setEntrepriseLibre(null);
  };
  const retirerEntreprise = (id: string) =>
    setEntrChoisies((prev) => prev.filter((e) => e.fournisseur_id !== id));

  const emails = entrChoisies.map((e) => e.email ?? "").filter((e) => e !== "");
  // V8.16r — envoi groupé en CCI (copie cachée) : les destinataires ne se voient pas.
  const mailto = construireMailto({ bcc: emails.join(","), sujet, corps });

  // V8.16o — enregistrement psp_devis pour chaque couple (opération × entreprise),
  // même logique que l'envoi ligne par ligne (statut demande_envoyee, montant vide).
  const enregistrer = async () => {
    for (const l of lignes) {
      if (!l.pspLigneId) continue;
      for (const e of entrChoisies) {
        await creerDevis({
          data: {
            pspLigneId: l.pspLigneId,
            fournisseurId: e.fournisseur_id,
            entreprise: e.nom,
            dateDevis: null,
            montant: null,
            statut: "demande_envoyee",
            commentaire: null,
            documentReference: null,
          },
        });
      }
    }
    setEnregistre(true);
    await onEnvoye?.();
    onFermer();
  };

  return (
    <Dialog open={ouvert} onOpenChange={(o) => !o && onFermer()}>
      <DialogContent className="w-[min(94vw,680px)]">
        <DialogHeader>
          <DialogTitle className="text-sm">Envoi groupé de demande de devis</DialogTitle>
          <DialogDescription>
            {etape === "lignes" && `${lignes.length} opération(s) sélectionnée(s) — étape 1/3`}
            {etape === "entreprises" &&
              `${entrChoisies.length} entreprise(s) choisie(s) — étape 2/3`}
            {etape === "mail" && "Un seul mail listant toutes les opérations — étape 3/3"}
          </DialogDescription>
        </DialogHeader>

        {etape === "lignes" && (
          <div className="space-y-1.5">
            {lignes.map((l, i) => (
              <div key={l.key} className="rounded border border-dashed px-2 py-1 text-[11px]">
                <span className="font-bold">{i + 1}.</span> TR {l.tranche} —{" "}
                {[l.adresse_rue ?? l.adresse, l.ville].filter(Boolean).join(", ") || "—"}
                <span className="block text-[10px] text-muted-foreground">
                  {l.nature ?? "Travaux non précisés"} · {secteurDe({ corps_etat: l.corps_etat })} /{" "}
                  {l.corps_etat ?? "—"}
                </span>
              </div>
            ))}
          </div>
        )}

        {etape === "entreprises" && (
          <div className="space-y-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
              Entreprises suggérées (pour la 1re opération sélectionnée)
            </p>
            {suggestionsMail.length > 0 ? (
              <ul className="space-y-1">
                {suggestionsMail.map((s) => {
                  const coche = entrChoisies.some((e) => e.fournisseur_id === s.fournisseur_id);
                  return (
                    <li
                      key={s.fournisseur_id}
                      className="flex flex-wrap items-center gap-2 rounded border border-dashed px-2 py-1 text-[11px]"
                    >
                      <button
                        type="button"
                        onClick={() => basculerSuggestion(s)}
                        className="inline-flex items-center gap-1.5 font-semibold hover:underline"
                      >
                        {coche ? (
                          <CheckSquare className="size-3.5 text-primary" />
                        ) : (
                          <Square className="size-3.5 text-muted-foreground" />
                        )}
                        {libelleEntrepriseAvecNumero(s.nom, s.numero)}
                      </button>
                      {s.email ? (
                        <span className="text-[9px] text-muted-foreground">{s.email}</span>
                      ) : (
                        <span className="text-[9px] font-semibold text-amber-700">
                          Email non renseigné
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-[11px] text-muted-foreground">Aucune suggestion disponible.</p>
            )}

            <div className="border-t border-dashed pt-2">
              <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                <Search className="mr-1 inline size-3" />
                Rechercher une autre entreprise
              </p>
              <div className="flex gap-2">
                <div className="min-w-0 flex-1">
                  <PspFournisseurSearch
                    value={entrepriseLibre?.nom ?? ""}
                    onSelect={setEntrepriseLibre}
                    placeholder="Rechercher dans le référentiel fournisseurs…"
                  />
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 shrink-0 text-[10px]"
                  disabled={!entrepriseLibre?.nom}
                  onClick={ajouterLibre}
                >
                  Ajouter
                </Button>
              </div>
            </div>

            {entrChoisies.length > 0 && (
              <div className="flex flex-wrap gap-1 border-t border-dashed pt-2">
                {entrChoisies.map((e) => (
                  <Badge
                    key={e.fournisseur_id}
                    variant="secondary"
                    className="gap-1 pr-1 text-[9px]"
                  >
                    {libelleEntrepriseAvecNumero(e.nom, e.numero)}
                    {e.email ? ` · ${e.email}` : " · email ?"}
                    <button
                      type="button"
                      onClick={() => retirerEntreprise(e.fournisseur_id)}
                      className="rounded p-0.5 hover:bg-muted"
                      title="Retirer"
                    >
                      <X className="size-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>
        )}

        {etape === "mail" && (
          <div className="space-y-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
              Destinataire(s) :{" "}
              {emails.length > 0 ? (
                emails.join(", ")
              ) : (
                <span className="font-semibold text-amber-700">aucun email renseigné</span>
              )}
            </p>
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
              rows={14}
              className="text-[11px]"
            />
          </div>
        )}

        {enregistre && (
          <p className="text-[11px] font-semibold text-emerald-700">
            ✓ Demandes enregistrées — visibles dans le Suivi.
          </p>
        )}

        <DialogFooter className="flex-wrap items-center gap-2">
          {etape !== "lignes" && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-[10px]"
              onClick={() => setEtape(etape === "mail" ? "entreprises" : "lignes")}
            >
              Retour
            </Button>
          )}
          {etape === "lignes" && (
            <Button size="sm" className="h-7 text-[10px]" onClick={() => setEtape("entreprises")}>
              Suivant <ChevronRight className="size-3" />
            </Button>
          )}
          {etape === "entreprises" && (
            <Button
              size="sm"
              className="h-7 text-[10px]"
              disabled={entrChoisies.length === 0}
              onClick={() => setEtape("mail")}
            >
              Préparer le mail <ChevronRight className="size-3" />
            </Button>
          )}
          {etape === "mail" && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-[10px]"
                onClick={() => {
                  setSujet(sujetCompose);
                  setCorps(corpsCompose);
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
                aria-disabled={emails.length === 0}
                onClick={(e) => {
                  if (emails.length === 0) e.preventDefault();
                }}
                title={
                  emails.length === 0
                    ? "Ajoutez une entreprise avec un email pour ouvrir le mail"
                    : "Ouvrir le mail dans votre messagerie"
                }
                className={
                  emails.length === 0
                    ? "inline-flex h-7 cursor-not-allowed items-center gap-1 rounded-md bg-muted px-3 text-[10px] font-medium text-muted-foreground"
                    : "inline-flex h-7 items-center gap-1 rounded-md bg-primary px-3 text-[10px] font-medium text-primary-foreground hover:bg-primary/90"
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
                    <AlertDialogTitle>Demande groupée envoyée ?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Ouvrez le mail dans votre messagerie (mailto:) puis confirmez ici. PAT S11 ne
                      peut pas vérifier l&apos;envoi. Confirmer enregistre la demande (date =
                      aujourd&apos;hui, statut « Demande envoyée », montant vide) pour chaque
                      opération sélectionnée et chaque entreprise choisie.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Non, plus tard</AlertDialogCancel>
                    <AlertDialogAction onClick={() => void enregistrer()}>
                      Oui, marquer comme envoyée
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Filtre segmenté de l'avancement devis. */
export default function TableauDemandesDevis({
  titre,
  sousTitre,
  lignes,
  onOpen,
  onEnvoye,
  etiquettesParTranche,
}: {
  titre: string;
  sousTitre?: string;
  lignes: LigneDemandeDevis[];
  onOpen: (l: LigneDemandeDevis) => void;
  /** V8.16o — rechargement après un envoi groupé (demandes enregistrées). */
  onEnvoye?: (() => Promise<void>) | undefined;
  /** V8.18 — étiquettes des tranches (VEFA, RACHAT…) affichées sous le TR. */
  etiquettesParTranche?: Record<string, string | null>;
}) {
  // V8.10 — vue par défaut « Sans devis » (ce qui doit encore être demandé).
  const [avancement, setAvancement] = useState<AvancementDevis | "toutes">("sans_devis");
  // V8.16n — tri par colonne (clic sur l'en-tête).
  const [tri, setTri] = useState<{ cle: CleTri; dir: 1 | -1 }>({ cle: "tranche", dir: 1 });
  // V8.16p — mode sélection : les cases à cocher n'apparaissent qu'après clic sur
  // « Envoyer un mail groupé » (sélection des opérations → Continuer → entreprises → mail).
  const [modeSelection, setModeSelection] = useState(false);
  const [selectionIds, setSelectionIds] = useState<string[]>([]);
  const [mailGroupeOuvert, setMailGroupeOuvert] = useState(false);
  const basculerSelection = (key: string) =>
    setSelectionIds((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  const quitterModeSelection = () => {
    setSelectionIds([]);
    setModeSelection(false);
  };
  const lignesSelection = useMemo(
    () => lignes.filter((l) => selectionIds.includes(l.key)),
    [lignes, selectionIds],
  );
  const basculerTri = (cle: CleTri) =>
    setTri((t) => (t.cle === cle ? { cle, dir: t.dir === 1 ? -1 : 1 } : { cle, dir: 1 }));
  const visibles = useMemo(() => {
    const rows = filtrerAvancementDevis(lignes, avancement);
    return [...rows].sort((a, b) => {
      let va: string | number;
      let vb: string | number;
      switch (tri.cle) {
        case "lb":
          va = a.ligne_budget ?? "";
          vb = b.ligne_budget ?? "";
          break;
        case "tranche":
          va = a.tranche;
          vb = b.tranche;
          break;
        case "adresse":
          va = `${a.adresse ?? ""} ${a.adresse_rue ?? ""}`;
          vb = `${b.adresse ?? ""} ${b.adresse_rue ?? ""}`;
          break;
        case "ville":
          va = a.ville ?? "";
          vb = b.ville ?? "";
          break;
        case "operation":
          va = a.nature ?? "";
          vb = b.nature ?? "";
          break;
        case "corps":
          va = a.corps_etat ?? "";
          vb = b.corps_etat ?? "";
          break;
        case "budget":
          va = a.montant ?? 0;
          vb = b.montant ?? 0;
          break;
        default:
          va = a.avancement;
          vb = b.avancement;
      }
      const cmp =
        typeof va === "number" && typeof vb === "number"
          ? va - vb
          : String(va).localeCompare(String(vb), "fr");
      return cmp * tri.dir;
    });
  }, [lignes, avancement, tri]);

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-sm font-bold leading-tight">{titre}</h2>
        {sousTitre && <p className="text-[11px] text-muted-foreground">{sousTitre}</p>}
      </div>

      {/* Filtre d'avancement — Sans devis / Attente de devis / Devis reçus / Toutes */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-2">
        <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
          Avancement
        </label>
        {AVANCEMENT_DEVIS_OPTIONS.map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => setAvancement(o)}
            className={
              avancement === o
                ? "rounded-md bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground"
                : "rounded-md px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-muted"
            }
          >
            {o === "toutes" ? "Toutes" : AVANCEMENT_DEVIS_LABELS[o]}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          {modeSelection ? (
            <>
              <span className="text-[10px] text-muted-foreground">
                {selectionIds.length} opération(s) sélectionnée(s)
              </span>
              <Button
                size="sm"
                className="h-7 text-[10px]"
                disabled={lignesSelection.length === 0}
                onClick={() => setMailGroupeOuvert(true)}
              >
                <ChevronRight className="size-3" /> Continuer
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-[10px]"
                onClick={quitterModeSelection}
              >
                <X className="size-3" /> Annuler
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              className="h-7 text-[10px]"
              onClick={() => setModeSelection(true)}
              title="Sélectionner plusieurs opérations puis envoyer un seul mail groupé"
            >
              <Send className="size-3" /> Envoyer un mail groupé
            </Button>
          )}
        </div>
      </div>

      {/* Tableau */}
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full min-w-[820px] text-[11px]">
          <thead>
            <tr className="border-b bg-muted/50 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
              {modeSelection && (
                <th className="w-8 px-2 py-1.5">
                  <input
                    type="checkbox"
                    checked={
                      visibles.length > 0 && visibles.every((l) => selectionIds.includes(l.key))
                    }
                    onChange={() =>
                      setSelectionIds((prev) =>
                        visibles.every((l) => selectionIds.includes(l.key))
                          ? prev.filter((k) => !visibles.some((l) => l.key === k))
                          : [...new Set([...prev, ...visibles.map((l) => l.key)])],
                      )
                    }
                    className="size-3.5 accent-primary"
                    title="Sélectionner toutes les lignes affichées"
                  />
                </th>
              )}
              <TriEnTete cle="lb" label="LB" tri={tri} onTri={basculerTri} />
              <TriEnTete cle="tranche" label="TR" tri={tri} onTri={basculerTri} />
              <TriEnTete cle="adresse" label="Adresse" tri={tri} onTri={basculerTri} />
              <TriEnTete cle="ville" label="Ville" tri={tri} onTri={basculerTri} />
              <TriEnTete cle="operation" label="Opération" tri={tri} onTri={basculerTri} />
              <TriEnTete
                cle="corps"
                label="Catégorie · Corps d'état"
                tri={tri}
                onTri={basculerTri}
              />
              <TriEnTete cle="budget" label="Budget prévu" tri={tri} onTri={basculerTri} />
              <TriEnTete cle="avancement" label="Avancement devis" tri={tri} onTri={basculerTri} />
            </tr>
          </thead>
          <tbody>
            {visibles.length === 0 ? (
              <tr>
                <td className="px-2 py-3 text-muted-foreground" colSpan={9}>
                  Aucune opération pour cet avancement de devis.
                </td>
              </tr>
            ) : (
              visibles.map((l) => (
                <tr
                  key={l.key}
                  className="cursor-pointer border-b border-dashed hover:bg-muted/40"
                  onClick={() => onOpen(l)}
                  title="Ouvrir la fiche opération (demande de devis)"
                >
                  {modeSelection && (
                    <td className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectionIds.includes(l.key)}
                        onChange={() => basculerSelection(l.key)}
                        className="size-3.5 accent-primary"
                        title="Sélectionner pour l'envoi groupé"
                      />
                    </td>
                  )}
                  <td className="px-2 py-1.5">
                    <span className="font-semibold">{l.ligne_budget || "—"}</span>
                  </td>
                  <td className="px-2 py-1.5">
                    <span className="block font-bold">{l.tranche}</span>
                    <EtiquetteTranche
                      etiquette={
                        etiquettesParTranche?.[l.tranche] ??
                        (etiquettesParTranche ? null : undefined)
                      }
                      className="mt-0.5"
                    />
                  </td>
                  <td className="max-w-[200px] px-2 py-1.5">
                    <span
                      className="flex items-center gap-1"
                      title={
                        l.adresse_ambigu
                          ? `${l.adresse_rue ?? l.adresse ?? ""}\n⚠ ${l.adresse_ambigu}`
                          : (l.adresse_rue ?? l.adresse ?? "")
                      }
                    >
                      <span className="block truncate text-[10px]">
                        {l.adresse_rue ?? l.adresse ?? "—"}
                      </span>
                      {l.adresse_ambigu ? (
                        <AlertTriangle className="size-3 shrink-0 text-amber-500" />
                      ) : null}
                    </span>
                  </td>
                  <td className="px-2 py-1.5">
                    <span className="block text-[10px] font-semibold">{l.ville ?? "—"}</span>
                  </td>
                  <td className="px-2 py-1.5">
                    <span className="line-clamp-1 block max-w-[200px] text-[10px]">
                      {l.nature ?? "—"}
                    </span>
                  </td>
                  <td className="max-w-[200px] px-2 py-1.5">
                    <span className="inline-flex items-center gap-1.5">
                      <Badge variant="outline">{secteurDe({ corps_etat: l.corps_etat })}</Badge>
                      <span className="line-clamp-1 block text-[10px]">{l.corps_etat ?? "—"}</span>
                    </span>
                  </td>
                  <td className="px-2 py-1.5">
                    {l.montant != null && l.montant > 0 ? (
                      <span className="font-semibold">{money0(l.montant)}</span>
                    ) : (
                      <span className="text-muted-foreground">Hors programme</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    <span className="inline-flex flex-wrap items-center gap-1">
                      <Badge className={AVANCEMENT_BADGE[l.avancement]}>
                        {AVANCEMENT_DEVIS_LABELS[l.avancement]}
                      </Badge>
                      {l.avancement !== "sans_devis" && (
                        <>
                          <span className="text-[9px] text-muted-foreground">
                            {l.nb_demandes} demande(s) · {l.nb_devis_recus} reçu(s)
                          </span>
                          {l.entreprises && l.entreprises.length > 0 && (
                            <span className="block text-[9px] font-semibold text-slate-500">
                              {l.entreprises.join(", ")}
                            </span>
                          )}
                        </>
                      )}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-muted-foreground">
        {visibles.length} ligne(s) affichée(s) sur {lignes.length} — cliquez pour ouvrir la fiche et
        faire les demandes de devis. L&apos;avancement est dérivé des demandes réelles (psp_devis),
        aucun état inventé.
      </p>

      {/* V8.16o/p — envoi groupé (mailto unique, enregistrement des demandes) */}
      <DialogueMailGroupe
        lignes={lignesSelection}
        ouvert={mailGroupeOuvert}
        onFermer={() => {
          setMailGroupeOuvert(false);
          quitterModeSelection();
        }}
        onEnvoye={onEnvoye}
      />
    </div>
  );
}
