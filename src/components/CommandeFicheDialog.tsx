import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ChevronRight,
  Edit3,
  Euro,
  History,
  Save,
  User,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { libelleEntreprise } from "@/lib/fournisseurs";
import { construireSearchAdresses } from "@/lib/adresses";
import { money2 } from "@/lib/formats";
import { getFournisseursPourCommandes } from "@/lib/fournisseurs.functions";
import {
  construireCleMetierCommande,
  detecterIncoherenceNature,
  detecterPmr,
  extraireChargePsp,
  extraireWNotes,
  formatDateCommandeFr,
  patrimoineAmbigue,
  type TypeDecisionPsp,
} from "@/lib/psp.validation";
import { secteurDe } from "@/lib/travaux.ts";
import {
  getPspEnrichissementCommandes,
  type CommandeTravauxEnrichie,
} from "@/lib/travaux.dashboard.functions";

/** Confiance (ratio → %) et statut du lien — affichage uniquement. */
const confianceLabel = (v: number | null | undefined): string =>
  typeof v === "number" ? `${Math.round(v * 100)}%` : "—";
const statutTxt = (v: string | null | undefined): string =>
  v === "valide" ? "valide" : v === "a_confirmer" ? "à confirmer" : (v ?? "—");

/** Fournisseur référencé (référentiel — source jamais modifiée). */
export type FicheFournisseurInfo = { id: string; nom: string; identifiants: string[] };

/** Décision humaine Historique CMD (nature / corps d'état) — couche psp_decisions. */
export type DecideState = {
  type: TypeDecisionPsp;
  cleMetier: string;
  titre: string;
  options: { label: string; value: string }[];
};

function InfoLigne({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b border-slate-50 pb-1.5">
      <span className="shrink-0 text-[9px] font-bold uppercase text-slate-400">{label}</span>
      <span className="break-words text-right text-xs font-semibold text-slate-700">
        {value ?? "—"}
      </span>
    </div>
  );
}
/** Enrichissement Historique CMD — mêmes sections et règles que la fiche du Dashboard. */
function FicheHistoriqueCmd({
  commande,
  appliedNature,
  appliedCorps,
  fournisseur,
  onDecider,
  readOnly = false,
}: {
  commande: CommandeTravauxEnrichie;
  appliedNature: string | null;
  appliedCorps: string | null;
  fournisseur: FicheFournisseurInfo | null;
  onDecider?: ((s: DecideState) => void) | undefined;
  readOnly?: boolean | undefined;
}) {
  const incoNat = detecterIncoherenceNature(commande.nature_analytique, commande.nature_historique);
  const hasHistorique = !!(
    commande.nature_historique ||
    commande.psp_date_commande ||
    commande.psp_corps_etat_libelle ||
    commande.psp_numero_commande_interne ||
    commande.psp_patrimoine ||
    commande.psp_fournisseur
  );
  const wnotes = extraireWNotes(commande.psp_donnees_brutes);
  const chargeHist =
    commande.psp_charge_operation ?? extraireChargePsp(commande.psp_donnees_brutes);
  const ambigu = patrimoineAmbigue(commande.psp_donnees_brutes);
  const pmr = detecterPmr(commande.psp_corps_etat_libelle ?? "");
  const comc =
    String(
      (commande.psp_donnees_brutes as Record<string, unknown> | null)?.["numero_commande"] ?? "",
    ) || null;

  return (
    <div className="space-y-6 bg-white px-8 pb-4">
      {hasHistorique && (
        <section>
          <h3 className="mb-4 flex items-center gap-2 text-xs font-black uppercase tracking-widest text-indigo-600">
            <History className="size-4" /> Historique CMD
          </h3>
          <div className="grid grid-cols-1 gap-y-2 text-xs md:grid-cols-2 md:gap-x-8">
            <InfoLigne
              label="Date commande"
              value={formatDateCommandeFr(commande.psp_date_commande)}
            />
            <InfoLigne label="COMN_NUM" value={commande.psp_numero_commande_interne} />
            <InfoLigne label="COMC_NOLIG" value={comc} />
            <InfoLigne
              label="Nature Historique CMD (WNATURE)"
              value={commande.psp_corps_etat_libelle}
            />
            <InfoLigne label="Catégorie Historique CMD (NAAC)" value={commande.nature_historique} />
            <InfoLigne label="Corps d'état — Suivi annuel" value={commande.corps_etat} />
            <InfoLigne
              label="WPATRIMOINE"
              value={
                ambigu ? (
                  <span>
                    <span>{commande.psp_patrimoine ?? "—"}</span>{" "}
                    <span className="ml-1 text-[9px] font-black text-amber-600">À VALIDER</span>
                  </span>
                ) : (
                  (commande.psp_patrimoine ?? "—")
                )
              }
            />
            <InfoLigne label="Chargé d'opération" value={chargeHist} />
            <InfoLigne
              label="Fournisseur (référentiel)"
              value={
                fournisseur ? (
                  <Link
                    to="/fournisseurs/$fournisseurId"
                    params={{ fournisseurId: fournisseur.id }}
                    search={{ cmd: undefined, annee: undefined }}
                    className="text-blue-600 hover:underline"
                  >
                    {fournisseur.nom}
                  </Link>
                ) : (
                  "—"
                )
              }
            />
            <InfoLigne label="ID fournisseur source" value={commande.psp_fournisseur} />
            <InfoLigne
              label="Montant budget (Hist. CMD)"
              value={money2(commande.psp_montant_budget)}
            />
            <InfoLigne
              label="Montant engagé (Hist. CMD)"
              value={money2(commande.psp_montant_engage)}
            />
            <InfoLigne label="Montant payé (Hist. CMD)" value={money2(commande.psp_montant_paye)} />
          </div>
          {wnotes ? (
            <p className="mt-3 whitespace-pre-wrap rounded-xl border border-indigo-100 bg-indigo-50/40 p-3 text-xs text-slate-700">
              <span className="text-[9px] font-black uppercase text-indigo-500">Travaux — </span>
              {wnotes}
            </p>
          ) : null}
          {pmr ? (
            <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-orange-100 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-orange-700">
              PMR — Hors PSP
            </p>
          ) : null}
        </section>
      )}

      <section>
        <h3 className="mb-4 flex items-center gap-2 text-xs font-black uppercase tracking-widest text-teal-600">
          <CheckCircle2 className="size-4" /> Rapprochement
        </h3>
        <div className="grid grid-cols-1 gap-y-2 text-xs md:grid-cols-3 md:gap-x-8">
          <InfoLigne label="Statut du lien" value={commande.lien_statut} />
          <InfoLigne label="Méthode" value={commande.lien_methode} />
          <InfoLigne label="Confiance" value={confianceLabel(commande.lien_confiance)} />
        </div>
        {commande.analyse_statut || commande.categorie_budget ? (
          <p className="mt-3 rounded-xl border border-teal-100 bg-teal-50/50 p-3 text-[11px] text-slate-600">
            <span className="font-bold">Analyse :</span> {commande.analyse_statut ?? "—"}
            {commande.type_intervention ? ` · Type : ${commande.type_intervention}` : ""}
            {commande.cause_probable ? ` · Cause : ${commande.cause_probable}` : ""}
            {commande.categorie_budget
              ? ` · Catégorie budgétaire : ${commande.categorie_budget} (${statutTxt(
                  commande.categorie_budget_statut,
                )})`
              : ""}
          </p>
        ) : null}
      </section>

      {incoNat && (
        <section className="rounded-2xl border border-amber-300 bg-amber-50/60 p-4">
          <h3 className="mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-widest text-amber-700">
            <AlertTriangle className="size-4" /> Incohérence de nature
          </h3>
          <div className="space-y-1 text-xs">
            <p>
              <span className="text-slate-400">Suivi annuel :</span>{" "}
              <span className="font-black text-slate-800">{commande.nature_analytique}</span>
            </p>
            <p>
              <span className="text-slate-400">Historique CMD :</span>{" "}
              <span className="font-black text-slate-800">{commande.nature_historique}</span>
            </p>
          </div>
          {appliedNature ? (
            <p className="mt-2 text-xs font-black text-emerald-700">
              Décision appliquée : {appliedNature}
            </p>
          ) : null}
          {!readOnly && onDecider && !appliedNature ? (
            <Button
              size="sm"
              className="mt-3 bg-amber-600 text-white hover:bg-amber-700"
              onClick={() =>
                onDecider({
                  type: "nature",
                  cleMetier: construireCleMetierCommande(commande.numero_commande, "nature"),
                  titre: "Incohérence de nature",
                  options: [
                    {
                      label: `Conserver le suivi annuel : ${commande.nature_analytique}`,
                      value: commande.nature_analytique ?? "",
                    },
                    {
                      label: `Conserver l'Historique CMD : ${commande.nature_historique}`,
                      value: commande.nature_historique ?? "",
                    },
                  ],
                })
              }
            >
              Décider
            </Button>
          ) : null}
        </section>
      )}
    </div>
  );
}

/**
 * Fiche COMMANDE — UN SEUL composant partagé entre le Dashboard Travaux et la Fiche
 * Fournisseur (même design, mêmes sections, même footer, même scroll interne).
 * - Dashboard : passe la commande déjà chargée + logique d'édition / décisions PSP.
 * - Fournisseur : passe `commandeId` (le composant charge l'enrichissement en lecture)
 *   + `readOnly` (aucune écriture : pas d'édition ni de « Décider »).
 */
export default function CommandeFicheDialog({
  open,
  commande: commandeProp,
  commandeId,
  onClose,
  readOnly = false,
  isEditing = false,
  editForm,
  onEditField,
  onStartEdit,
  onSave,
  onCancelEdit,
  onOpenHistorique,
  appliedNature = null,
  appliedCorps = null,
  onDecider,
  fournisseur: fournisseurProp,
}: {
  open: boolean;
  /** Fiche déjà chargée (Dashboard) OU fallback d'affichage — optionnel si `commandeId` est fourni. */
  commande?: CommandeTravauxEnrichie | null;
  commandeId?: string | null;
  onClose: () => void;
  readOnly?: boolean;
  isEditing?: boolean;
  editForm?: Partial<CommandeTravauxEnrichie> | null;
  onEditField?: (patch: Partial<CommandeTravauxEnrichie>) => void;
  onStartEdit?: () => void;
  onSave?: () => void;
  onCancelEdit?: () => void;
  onOpenHistorique?: () => void;
  appliedNature?: string | null;
  appliedCorps?: string | null;
  onDecider?: (s: DecideState) => void;
  fournisseur?: FicheFournisseurInfo | null;
}) {
  // Enrichissement par identifiant (voie Fournisseur) — mêmes server functions que le
  // Dashboard, lecture seule. Si `commande` est fourni (Dashboard), aucun appel.
  const fetchEnrich = useServerFn(getPspEnrichissementCommandes);
  const fetchFournisseurs = useServerFn(getFournisseursPourCommandes);
  const { data: enrData } = useQuery({
    queryKey: ["commande-fiche-enrich", commandeId],
    queryFn: () =>
      commandeId ? fetchEnrich({ data: { commandeIds: [commandeId] } }) : Promise.resolve([]),
    enabled: open && !!commandeId,
  });
  const enrichie = (enrData?.[0] as CommandeTravauxEnrichie | undefined) ?? null;
  const commande = enrichie ?? commandeProp;

  const { data: fournisseursData } = useQuery({
    queryKey: ["commande-fiche-fournisseur", commandeId],
    queryFn: () => fetchFournisseurs({ data: { commandeIds: commandeId ? [commandeId] : [] } }),
    enabled: open && !!commandeId,
  });
  const fournisseur =
    fournisseurProp ??
    (commandeId
      ? ((fournisseursData as Record<string, FicheFournisseurInfo> | null)?.[commandeId] ?? null)
      : null);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl flex max-h-[90vh] flex-col rounded-3xl p-0 overflow-hidden border-none shadow-2xl">
        <div className="bg-slate-900 p-8 text-white relative">
          <div className="mb-6">
            <h2 className="text-2xl font-black uppercase tracking-tighter mb-1">
              Fiche Commande #{commande?.numero_commande}
            </h2>
            <p className="text-[9px] font-black text-slate-500 uppercase tracking-[0.3em]">
              Détail exhaustif & Édition Directe
            </p>
          </div>
          <div className="bg-slate-800/50 rounded-2xl p-4 mb-6 border border-white/5">
            <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-2">
              Descriptif complet
            </p>
            {isEditing ? (
              <Textarea
                value={editForm?.descriptif || ""}
                onChange={(e) => onEditField?.({ descriptif: e.target.value })}
                className="bg-slate-800 border-slate-700 text-xs font-medium text-white min-h-[60px] rounded-xl"
              />
            ) : (
              <p className="whitespace-pre-wrap text-xs text-slate-300 leading-relaxed font-medium">
                {commande?.descriptif || "Aucun descriptif renseigné."}
              </p>
            )}
          </div>
          <div className="flex items-center justify-between mb-8">
            <div className="grid grid-cols-2 md:grid-cols-6 gap-8 flex-1">
              <div className="space-y-1">
                <p className="text-[9px] font-black text-slate-500 uppercase">Type</p>
                {isEditing ? (
                  <select
                    value={editForm?.secteur || ""}
                    onChange={(e) => onEditField?.({ secteur: e.target.value })}
                    className="bg-slate-800 border-slate-700 text-xs font-black w-full rounded p-1 outline-none"
                  >
                    <option value="GT">GT</option>
                    <option value="GE">GE</option>
                    <option value="CP">CP</option>
                  </select>
                ) : (
                  <p className="text-sm font-black">{commande ? secteurDe(commande) : "—"}</p>
                )}
              </div>
              <div className="space-y-1">
                <p className="text-[9px] font-black text-slate-500 uppercase">Tranche</p>
                <p className="text-sm font-black text-blue-400">
                  <Link
                    to="/adresses"
                    search={construireSearchAdresses({ tranche: commande?.tranche_code })}
                    className="hover:underline"
                  >
                    {commande?.tranche_code || "—"}
                  </Link>
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-[9px] font-black text-slate-500 uppercase">ID Lot</p>
                {isEditing ? (
                  <Input
                    value={editForm?.lot_code || ""}
                    onChange={(e) => onEditField?.({ lot_code: e.target.value })}
                    className="bg-slate-800 border-slate-700 text-xs font-black h-7 rounded-lg"
                  />
                ) : (
                  <p className="text-sm font-black text-teal-400">
                    {commande?.lot_code ? (
                      <Link
                        to="/adresses"
                        search={construireSearchAdresses({ q: commande.lot_code })}
                        className="hover:underline flex items-center gap-1"
                      >
                        {commande.lot_code} <ChevronRight className="size-3" />
                      </Link>
                    ) : (
                      "Non rattaché"
                    )}
                  </p>
                )}
              </div>

              <div className="space-y-1">
                <p className="text-[9px] font-black text-slate-500 uppercase">État</p>
                {isEditing ? (
                  <Input
                    value={editForm?.etat_travaux || ""}
                    onChange={(e) => onEditField?.({ etat_travaux: e.target.value })}
                    className="bg-slate-800 border-slate-700 text-xs font-black h-7 rounded-lg"
                  />
                ) : (
                  <p className="text-sm font-black uppercase text-amber-400">
                    {commande?.etat_travaux || commande?.etat_commande || "—"}
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <p className="text-[9px] font-black text-slate-500 uppercase">Prog.</p>
                <p className="text-sm font-black uppercase">
                  {commande?.ligne_budget ? "Programmée" : "Hors Budget"}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-[9px] font-black text-slate-500 uppercase">Année</p>
                <p className="text-sm font-black uppercase">{commande?.annee_exercice ?? "—"}</p>
              </div>
            </div>
            {!readOnly ? (
              <div className="ml-8">
                {!isEditing ? (
                  <div className="flex gap-2">
                    <Button
                      onClick={onStartEdit}
                      variant="outline"
                      className="bg-white/10 border-white/20 hover:bg-white/20 text-white font-black text-[10px] uppercase tracking-widest rounded-xl"
                    >
                      <Edit3 className="size-3.5 mr-2" /> MODIFIER
                    </Button>
                    {onOpenHistorique ? (
                      <Button
                        onClick={onOpenHistorique}
                        variant="ghost"
                        className="text-white/80 hover:text-white font-black text-[10px] uppercase tracking-widest rounded-xl"
                      >
                        <History className="size-3.5 mr-2" /> HISTORIQUE
                      </Button>
                    ) : null}
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Button
                      onClick={onSave}
                      className="bg-blue-600 hover:bg-blue-500 text-white font-black text-[10px] uppercase tracking-widest rounded-xl"
                    >
                      <Save className="size-3.5 mr-2" /> SAUVER
                    </Button>
                    <Button
                      onClick={onCancelEdit}
                      variant="ghost"
                      className="text-white font-black text-[10px] uppercase tracking-widest rounded-xl"
                    >
                      ANNULER
                    </Button>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0 custom-scrollbar">
          <div className="p-8 grid grid-cols-1 md:grid-cols-2 gap-12 bg-white">
            <div className="space-y-8">
              <section>
                <h3 className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-slate-400 mb-4">
                  <Building2 className="size-4 text-blue-600" /> Localisation & Nature
                </h3>
                <div className="space-y-4">
                  <div className="flex justify-between border-b border-slate-50 pb-2">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Adresse</span>
                    {isEditing ? (
                      <Input
                        value={editForm?.adresse || ""}
                        onChange={(e) => onEditField?.({ adresse: e.target.value })}
                        className="text-xs font-black h-7 w-48 rounded-lg"
                      />
                    ) : (
                      <span className="text-xs font-black text-slate-700">
                        {commande?.adresse || "—"}
                      </span>
                    )}
                  </div>
                  <div className="flex justify-between border-b border-slate-50 pb-2">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">
                      Corps d'état
                    </span>
                    {isEditing ? (
                      <Input
                        value={editForm?.corps_etat || ""}
                        onChange={(e) => onEditField?.({ corps_etat: e.target.value })}
                        className="text-xs font-black h-7 w-48 rounded-lg"
                      />
                    ) : (
                      <span className="text-xs font-black text-slate-700">
                        {commande?.corps_etat || "—"}
                      </span>
                    )}
                  </div>
                </div>
              </section>
              <section>
                <h3 className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-slate-400 mb-4">
                  <User className="size-4 text-blue-600" /> Intervenants
                </h3>
                <div className="space-y-4">
                  <div className="flex justify-between border-b border-slate-50 pb-2">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">
                      Entreprise
                    </span>
                    {isEditing ? (
                      <div className="flex gap-2">
                        <Input
                          value={editForm?.fournisseur || ""}
                          onChange={(e) => onEditField?.({ fournisseur: e.target.value })}
                          className="text-xs font-black h-7 w-32 rounded-lg"
                        />
                        <Input
                          value={editForm?.numero_fournisseur || ""}
                          onChange={(e) => onEditField?.({ numero_fournisseur: e.target.value })}
                          className="text-xs font-black h-7 w-16 rounded-lg"
                        />
                      </div>
                    ) : fournisseur ? (
                      <span className="text-xs font-black text-slate-700">
                        <Link
                          to="/fournisseurs/$fournisseurId"
                          params={{ fournisseurId: fournisseur.id }}
                          search={{ cmd: undefined, annee: undefined }}
                          className="text-blue-600 hover:underline"
                        >
                          {libelleEntreprise(fournisseur.nom)}
                        </Link>
                        {fournisseur.identifiants.length ? (
                          <span className="text-slate-400">
                            {" "}
                            · {fournisseur.identifiants.join(", ")}
                          </span>
                        ) : null}
                      </span>
                    ) : (
                      <span className="text-xs font-black text-slate-700">
                        {commande?.fournisseur || "—"} ({commande?.numero_fournisseur})
                      </span>
                    )}
                  </div>
                </div>
              </section>
            </div>

            <div className="space-y-8">
              <section>
                <h3 className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-slate-400 mb-4">
                  <Euro className="size-4 text-blue-600" /> Finance
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-slate-50 p-4 rounded-2xl">
                    <p className="text-[9px] font-black text-slate-400 uppercase">Budget</p>
                    <p className="text-lg font-black text-slate-700">{money2(commande?.budget)}</p>
                  </div>
                  <div className="bg-slate-50 p-4 rounded-2xl">
                    <p className="text-[9px] font-black text-slate-400 uppercase">Écart</p>
                    <p className="text-lg font-black text-red-500">{money2(commande?.ecart)}</p>
                  </div>
                  <div className="bg-slate-50 p-4 rounded-2xl">
                    <p className="text-[9px] font-black text-slate-400 uppercase">Engagé</p>
                    {isEditing ? (
                      <Input
                        type="number"
                        value={editForm?.engage || 0}
                        onChange={(e) => onEditField?.({ engage: Number(e.target.value) })}
                        className="text-xs font-black h-7 rounded-lg"
                      />
                    ) : (
                      <p className="text-lg font-black text-blue-700">{money2(commande?.engage)}</p>
                    )}
                  </div>
                  <div className="bg-slate-50 p-4 rounded-2xl">
                    <p className="text-[9px] font-black text-slate-400 uppercase">Payé</p>
                    {isEditing ? (
                      <Input
                        type="number"
                        value={editForm?.paye || 0}
                        onChange={(e) => onEditField?.({ paye: Number(e.target.value) })}
                        className="text-xs font-black h-7 rounded-lg"
                      />
                    ) : (
                      <p className="text-lg font-black">{money2(commande?.paye)}</p>
                    )}
                  </div>
                </div>
              </section>
            </div>
          </div>
          {commande ? (
            <FicheHistoriqueCmd
              commande={commande}
              appliedNature={appliedNature}
              appliedCorps={appliedCorps}
              fournisseur={fournisseur}
              onDecider={onDecider}
              readOnly={readOnly}
            />
          ) : null}
        </div>
        <DialogFooter className="p-6 bg-white border-t">
          <Button
            onClick={onClose}
            className="w-full bg-slate-900 font-black text-[10px] uppercase tracking-[0.2em] rounded-2xl h-12"
          >
            FERMER LA FICHE
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
