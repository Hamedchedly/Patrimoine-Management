/**
 * V8.3 — SUIVI OPÉRATION : fiche opération du registre « Opérations ».
 *   IDENTITÉ → PROGRAMMATION → CONSULTATION → DEVIS → COMMANDES → TRAVAUX.
 *
 * Une SEULE fiche pour les opérations PSP et HORS PSP (aucun écran parallèle).
 * Consomme le socle V8.1 (SuiviOperationVue, suggestions, moteur mailto) et le
 * workflow V8.2.1 (PspDemandeDevisWorkflow — suggestions, sélection multi,
 * éditeur de mail, mailto:, enregistrement de la demande).
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Building2,
  Copy,
  FileSearch,
  FileText,
  GitBranch,
  History,
  Loader2,
  Mail,
  MapPin,
  RefreshCcw,
  Wallet,
  Workflow,
} from "lucide-react";

import PspDemandeDevisWorkflow from "@/components/preparation-psp/PspDemandeDevisWorkflow";
import PspCorrespondancesSection from "@/components/suivi/PspCorrespondancesSection";
import PspRechercheCommandeDialog from "@/components/suivi/PspRechercheCommandeDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { money0 } from "@/lib/formats";
import {
  enregistrerRelanceDevis,
  ETAT_PILOTAGE_LABELS,
  getPspEntreprisesSuggestions,
  getPspLignesHistorique,
  updatePspLigneEtatPilotage,
} from "@/lib/psp.prep.supabase.functions";
import {
  MAIL_MODELES,
  chronologieConsultationEntreprise,
  composerMail,
  construireMailto,
  dateLimiteReponse,
  dateRetourParDefaut,
  type ConsultationEntreprise,
} from "@/lib/psp.suivi.foundation";
import {
  comparatifDevis,
  deriverEtatSuiviAnnuel,
  etapesAvancement,
  ETAT_SUIVI_LABEL,
} from "@/lib/psp.suivi.view";
import { libelleEntreprise } from "@/lib/psp.prep.v7";
import type { SuiviOperationVue } from "@/lib/psp.suivi.foundation";

const fmtDate = (v: string | null | undefined): string =>
  v ? new Date(v).toLocaleDateString("fr-FR") : "—";

export default function SuiviOperationFiche({
  operation,
  onClose,
  onRefresh,
}: {
  operation: SuiviOperationVue;
  onClose: () => void;
  /** V8.3 — recharge la sélection après enregistrement d'une demande de devis. */
  onRefresh?: () => Promise<void>;
}) {
  const horsPsp = operation.identite.origine === "hors_psp";
  const p = operation.programmation;
  const c = operation.consultation;
  const cmd = operation.commandes;
  const ex = operation.execution;
  const comparatif = comparatifDevis(operation.consultation.entreprises.flatMap((e) => e.devis));
  // V8.6.1.1 §3 — ÉTAT RÉEL / SYSTÈME : dérivé des montants réels des commandes
  // liées (payé / engagé). Aucune valeur inventée.
  const etatsCommandes = cmd.liees.map((l) =>
    deriverEtatSuiviAnnuel({
      numeroCommande: l.numero_commande ?? null,
      engage: l.engage,
      paye: l.paye,
    }),
  );
  const etatReel =
    etatsCommandes.length === 0
      ? "sans_commande"
      : etatsCommandes.includes("a_verifier")
        ? "a_verifier"
        : etatsCommandes.includes("en_cours")
          ? "en_cours"
          : "terminee";
  const refresh = onRefresh ?? (async () => undefined);

  // V8.8 §9 — statut de pilotage manuel (distinct de l'état réel dérivé).
  const setPilotageFn = useServerFn(updatePspLigneEtatPilotage);
  const [pilotage, setPilotage] = useState<string | null>(operation.identite.etat_pilotage ?? null);
  const [pilotageBusy, setPilotageBusy] = useState(false);
  const changerPilotage = async (v: string | null) => {
    if (pilotageBusy) return;
    setPilotageBusy(true);
    try {
      await setPilotageFn({ data: { id: operation.identite.id, etatPilotage: v } });
      setPilotage(v);
      await refresh();
    } catch {
      // Migration non appliquée ou erreur : on laisse la valeur précédente.
    } finally {
      setPilotageBusy(false);
    }
  };

  // Entreprises suggérées (données réelles — socle V8.1). Réutilisées pour
  // retrouver l'email d'un fournisseur déjà consulté (relance).
  const fetchSuggestions = useServerFn(getPspEntreprisesSuggestions);
  const { data: suggestions } = useQuery({
    queryKey: ["psp-suivi-suggestions", operation.identite.id],
    queryFn: () => fetchSuggestions({ data: { pspLigneId: operation.identite.id, limite: 8 } }),
    staleTime: 1000 * 60 * 10,
    retry: 1,
    enabled: operation.consultation.statut !== "devis_retenu",
  });

  const [relance, setRelance] = useState<ConsultationEntreprise | null>(null);
  const emailRelance = relance
    ? (suggestions?.find((s) => s.fournisseur_id === relance.fournisseur_id)?.email ?? null)
    : null;

  // V8.5.4 — recherche manuelle d'une commande dans la fiche.
  const [rechercheCommandeOuverte, setRechercheCommandeOuverte] = useState(false);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] w-[min(94vw,960px)] gap-0 p-0 sm:max-w-[960px]">
        <ScrollArea className="max-h-[calc(92vh-4rem)]">
          <div className="p-5">
            <DialogHeader className="space-y-2">
              <DialogTitle className="flex items-center gap-2 text-base">
                <Workflow className="size-4 text-primary" />
                Suivi opération — TR {operation.identite.tranche}
                <Badge variant="outline">{operation.identite.categorie}</Badge>
                <Badge variant={horsPsp ? "secondary" : "outline"} className="text-[10px]">
                  {horsPsp ? "Hors programmation PSP" : `PSP : ${p.statut_psp_label}`}
                </Badge>
                <Badge variant="outline" className="text-[10px]">
                  Opération : {ex.statut_label}
                </Badge>
              </DialogTitle>
              <DialogDescription>
                {p.nature ?? "Sans nature"} · {p.corps_etat ?? "Corps d'état non renseigné"} · CC{" "}
                {p.cc ?? "—"} · Priorité {p.priorite ?? "normale"}
              </DialogDescription>
            </DialogHeader>
            {/* V8.2.1 §5 — chaîne d avancement (états RÉELS) */}
            <div className="mt-3 rounded-lg border bg-muted/30 p-2">
              <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                Avancement
              </p>
              <ol className="space-y-0.5">
                {etapesAvancement(operation).map((etape) => (
                  <li key={etape.code} className="flex items-center gap-2 text-[11px]">
                    <span className={etape.atteint ? "text-emerald-600" : "text-muted-foreground"}>
                      {etape.atteint ? "●" : "○"}
                    </span>
                    <span className={etape.atteint ? "font-semibold" : "text-muted-foreground"}>
                      {etape.label}
                    </span>
                    <span className="text-[9px] text-muted-foreground">↓</span>
                  </li>
                ))}
              </ol>
            </div>{" "}
            {/* V8.2.2 — IDENTITÉ (patrimoine) */}
            <Section title="Identité" icon={MapPin}>
              <div className="grid grid-cols-2 gap-1.5 text-[11px] sm:grid-cols-4">
                <Cell label="TR" value={operation.identite.tranche} />
                <Cell
                  label="Origine"
                  value={operation.identite.origine === "hors_psp" ? "Hors PSP" : "PSP"}
                />
                <Cell label="Sous-secteur" value={p.sous_secteur ?? "—"} />
                <Cell label="CC" value={p.cc ?? "—"} />
                <Cell label="Adresse" value={p.adresse ?? "—"} />
                <Cell label="Corps d&#39;état" value={p.corps_etat ?? "—"} />
                <Cell label="Nature" value={p.nature ?? "—"} />
                <Cell
                  label="Périmètre"
                  value={p.perimetre.length > 0 ? `${p.perimetre.length} élément(s)` : "—"}
                />
              </div>
            </Section>
            {/* ── PROGRAMMATION ── */}
            <Section title="Programmation" icon={Wallet}>
              {horsPsp ? (
                <p className="rounded border border-dashed px-2 py-1.5 text-[11px] text-muted-foreground">
                  Hors programmation PSP — aucune année ni ligne budgétaire (les montants de
                  programmation sont « — »).
                </p>
              ) : (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div className="rounded border border-dashed p-2 text-[11px]">
                    <p className="text-muted-foreground">Répartition par année</p>
                    <ul className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5">
                      {p.annees.map((a) => (
                        <li key={a.annee} className="flex justify-between gap-2">
                          <span className="font-bold">{a.annee}</span>
                          <span>{a.montant > 0 ? money0(a.montant) : "—"}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                    <Cell
                      label="Budget estimatif"
                      value={p.montant_total > 0 ? money0(p.montant_total) : "—"}
                    />
                    <Cell
                      label="Reste estimatif"
                      value={p.montant_total > 0 ? money0(p.montant_total - cmd.engage) : "—"}
                      strong
                    />
                  </div>
                  <p className="text-[9px] text-muted-foreground">
                    Source : programmation (estimation) — jamais un montant de commande.
                  </p>
                </div>
              )}
              {/* Commandes / engagement — données RÉELLES (travaux_commandes liées). */}
              <div className="mt-2 grid grid-cols-2 gap-1.5 text-[11px] sm:grid-cols-4">
                <Cell
                  label="Commandé"
                  value={cmd.budget_commande > 0 ? money0(cmd.budget_commande) : "—"}
                />
                <Cell label="Engagé" value={cmd.engage > 0 ? money0(cmd.engage) : "—"} />
                <Cell label="Payé" value={cmd.paye > 0 ? money0(cmd.paye) : "—"} />
                <Cell
                  label="Solde"
                  value={cmd.paye > 0 ? money0(cmd.engage - cmd.paye) : "—"}
                  strong
                />
              </div>
              <p className="mt-1 text-[9px] text-muted-foreground">
                Source : commandes importées liées (travaux_commandes) — lecture seule.
              </p>
            </Section>
            {/* ── CONSULTATION ── */}
            <Section title="Consultation" icon={Building2}>
              <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                <Badge variant="outline">Statut : {c.statut_label}</Badge>
                <span className="text-muted-foreground">
                  {c.nb_entreprises_consultees} entreprise(s) · {c.nb_demandes} demande(s) ·{" "}
                  {c.nb_devis_recus} devis reçu(s)
                </span>
                {c.relance_necessaire && (
                  <Badge className="bg-amber-100 text-amber-800">Relance nécessaire</Badge>
                )}
              </div>
              {c.entreprises.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">Aucune donnée disponible.</p>
              ) : (
                <ul className="space-y-1">
                  {c.entreprises.map((e) => {
                    const chrono = chronologieConsultationEntreprise(e.devis);
                    return (
                      <li
                        key={e.fournisseur_id ?? e.entreprise}
                        className="rounded border border-dashed px-2 py-1 text-[11px]"
                      >
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                          <span className="font-semibold">
                            {/* V8.8.2 §1 — entreprise sans nom → « Fournisseur n°… »
                                ou « Entreprise non renseignée » (aucune valeur vide). */}
                            {libelleEntreprise(e.entreprise)}
                          </span>
                          <span className="text-muted-foreground">
                            Demande le {fmtDate(e.date_demande)}
                          </span>
                          {e.devis[0]?.derniere_relance_at && (
                            <span className="text-muted-foreground">
                              Dernière relance le {fmtDate(e.devis[0].derniere_relance_at)}
                            </span>
                          )}
                          {e.date_devis && (
                            <span className="text-muted-foreground">
                              Devis reçu le {fmtDate(e.date_devis)}
                            </span>
                          )}
                          <span>
                            {e.statut_consultation === "devis_retenu"
                              ? "Devis retenu"
                              : e.statut_devis}
                          </span>
                          <span className="font-semibold">
                            {e.montant == null ? "—" : money0(e.montant)}
                          </span>
                          {e.relance_necessaire ? (
                            <>
                              <Badge className="bg-amber-100 text-amber-800 text-[9px]">
                                Relance nécessaire
                              </Badge>
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-6 text-[9px]"
                                onClick={() => setRelance(e)}
                              >
                                <Mail className="size-3" /> Préparer une relance
                              </Button>
                            </>
                          ) : null}
                        </div>
                        {/* V8.4 §11 — chronologie de consultation (dérivée de psp_devis) */}
                        {chrono.length > 0 && (
                          <ul className="mt-1 space-y-0.5 border-t border-dashed pt-1 text-[10px] text-muted-foreground">
                            {chrono.map((ev) => (
                              <li
                                key={`${ev.type}-${ev.date ?? ev.libelle}`}
                                className="flex gap-2"
                              >
                                <span>{fmtDate(ev.date)}</span>
                                <span>→ {ev.libelle}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              {/* V8.3 — workflow consultation (suggestions expliquées + sélection
                  multi-entreprises + éditeur de mail + mailto: + enregistrement). */}
              <div className="mt-2">
                <PspDemandeDevisWorkflow
                  operation={{
                    id: operation.identite.id,
                    tranche: operation.identite.tranche,
                    nature_travaux: p.nature,
                    corps_etat: p.corps_etat,
                    adresse: p.adresse,
                  }}
                  figee={false}
                  onEnvoye={refresh}
                />
              </div>
            </Section>
            {/* ── DEVIS ── */}
            <Section title="Devis" icon={FileText}>
              <div className="mb-2 flex flex-wrap gap-1.5 text-[11px]">
                <Badge variant="outline">{comparatif.nb_devises} devis reçu(s)</Badge>
                <Badge variant="outline">
                  Min {comparatif.min == null ? "—" : money0(comparatif.min)}
                </Badge>
                <Badge variant="outline">
                  Moy {comparatif.moyenne == null ? "—" : money0(comparatif.moyenne)}
                </Badge>
                <Badge variant="outline">
                  Max {comparatif.max == null ? "—" : money0(comparatif.max)}
                </Badge>
                {comparatif.nb_sans_montant > 0 && (
                  <Badge variant="outline" className="text-muted-foreground">
                    {comparatif.nb_sans_montant} demande(s) sans montant (normal)
                  </Badge>
                )}
              </div>
              {comparatif.retenu ? (
                <div className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-[11px] text-emerald-800">
                  Devis retenu — {comparatif.retenu.entreprise} ·{" "}
                  {fmtDate(comparatif.retenu.date_devis)} ·{" "}
                  {comparatif.retenu.montant == null ? "—" : money0(comparatif.retenu.montant)}
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  Aucun devis retenu (la décision reste à l'utilisateur).
                </p>
              )}
            </Section>
            {/* ── COMMANDES (données importées) ── */}
            <Section title="Commandes" icon={GitBranch}>
              {cmd.liees.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  Aucune donnée disponible — opération sans commande (situation normale).
                </p>
              ) : (
                <ul className="space-y-1">
                  {cmd.liees.map((l) => (
                    <li
                      key={l.lien_id}
                      className="grid grid-cols-2 gap-x-3 gap-y-0.5 rounded border border-dashed px-2 py-1 text-[11px] sm:grid-cols-4"
                    >
                      <span className="font-semibold">{l.numero_commande ?? "—"}</span>
                      <span>
                        {/* V8.8.2 §1 — entreprise sans nom → « Fournisseur n°… ». */}
                        {libelleEntreprise(l.entreprise, l.numero_fournisseur)}
                      </span>
                      <span>{l.budget == null ? "—" : money0(l.budget)}</span>
                      <span>
                        Engagé {l.engage == null ? "—" : money0(l.engage)} · Payé{" "}
                        {l.paye == null ? "—" : money0(l.paye)}
                      </span>
                      <span className="text-muted-foreground">
                        État cmd : {l.etat_commande ?? "—"}
                      </span>
                      <span className="text-muted-foreground">
                        État trav. : {l.etat_travaux ?? "—"}
                      </span>
                      <Badge variant="outline" className="text-[9px]">
                        {l.statut_rapprochement_label}
                      </Badge>
                      <span className="text-muted-foreground">{fmtDate(l.date_import)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
            {/* ── TRAVAUX / EXÉCUTION ── */}
            <Section title="Travaux" icon={MapPin}>
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <Badge>{ex.statut_label}</Badge>
                <span className="text-muted-foreground">
                  Démarrage : {fmtDate(ex.date_demarrage)} · Fin : {fmtDate(ex.date_fin)}
                </span>
                <span className="text-muted-foreground">
                  Dernier état travaux : {ex.etat_travaux ?? "—"}
                </span>
              </div>
            </Section>
            {/* V8.6.1.1 §3 — ÉTAT RÉEL / SYSTÈME vs ÉTAT DE PILOTAGE (manuel). */}
            <Section title="État de suivi" icon={FileSearch}>
              <div className="space-y-1.5 rounded border border-dashed px-2 py-1.5 text-[11px]">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                    État réel / système
                  </span>
                  <Badge className="text-[10px]">{ETAT_SUIVI_LABEL[etatReel]}</Badge>
                  <span className="text-[10px] text-muted-foreground">
                    (dérivé automatiquement des commandes importées : payé / engagé)
                  </span>
                </div>
                {cmd.liees.map((l) => {
                  const e = deriverEtatSuiviAnnuel({
                    numeroCommande: l.numero_commande ?? null,
                    engage: l.engage,
                    paye: l.paye,
                  });
                  return (
                    <p key={l.lien_id} className="text-[10px] text-muted-foreground">
                      {l.numero_commande ?? "—"} : Commandé {money0(l.budget)} · Engagé{" "}
                      {l.engage == null ? "—" : money0(l.engage)} · Payé{" "}
                      {l.paye == null ? "—" : money0(l.paye)} →{" "}
                      <span className="font-semibold">{ETAT_SUIVI_LABEL[e]}</span>
                    </p>
                  );
                })}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-dashed pt-1">
                  <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                    État importé
                  </span>
                  <span className="text-[10px]">
                    {cmd.liees[0]?.etat_commande ?? "—"} · {ex.etat_travaux ?? "—"}
                  </span>
                  <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                    Consultation
                  </span>
                  <span className="text-[10px]">{c.statut_label}</span>
                </div>
                {/* V8.8 §9 — ÉTAT DE PILOTAGE MANUEL (distinct de l'état réel dérivé
                    et de l'état importé ; historisé dans psp_ligne_historique). */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-dashed pt-1">
                  <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                    Statut de pilotage (manuel)
                  </span>
                  <Select
                    value={pilotage ?? "aucun"}
                    onValueChange={(v) => void changerPilotage(v === "aucun" ? null : v)}
                  >
                    <SelectTrigger className="h-7 w-[180px] text-[10px]">
                      <SelectValue placeholder="—" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="aucun">—</SelectItem>
                      {Object.entries(ETAT_PILOTAGE_LABELS).map(([v, l]) => (
                        <SelectItem key={v} value={v}>
                          {l}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {pilotage && (
                    <span className="text-[10px] text-muted-foreground">
                      {ETAT_PILOTAGE_LABELS[pilotage] ?? pilotage}
                    </span>
                  )}
                  <span className="text-[10px] text-muted-foreground">
                    (ne remplace pas l'état réel dérivé ni l'état importé)
                  </span>
                </div>
              </div>
            </Section>
            {/* V8.5.2 — REVUE DES CORRESPONDANCES COMMANDES (lecture seule) */}
            <Section title="Correspondances commandes" icon={FileSearch}>
              <PspCorrespondancesSection pspLigneId={operation.identite.id} onRattache={refresh} />
              {/* V8.5.4 — RECHERCHE MANUELLE D'UNE COMMANDE */}
              <div className="mt-2 flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-[11px]"
                  onClick={() => setRechercheCommandeOuverte(true)}
                >
                  Rechercher une commande
                </Button>
              </div>
            </Section>
            <PspRechercheCommandeDialog
              pspLigneId={operation.identite.id}
              open={rechercheCommandeOuverte}
              onClose={() => setRechercheCommandeOuverte(false)}
              onRattache={refresh}
            />
            {/* V8.6 §12 — HISTORIQUE de l'opération (psp_ligne_historique, table EXISTANTE). */}
            <Section title="Historique" icon={History}>
              <HistoriqueSection pspLigneId={operation.identite.id} />
            </Section>
            <Separator className="my-4" />
            <div className="flex justify-end">
              <Button variant="outline" size="sm" onClick={onClose}>
                Fermer
              </Button>
            </div>
          </div>
        </ScrollArea>
        {relance && (
          <RelanceDialog
            entreprise={relance}
            operation={operation}
            email={emailRelance}
            onClose={() => setRelance(null)}
            onRelanceEnregistree={refresh}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof Wallet;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-4">
      <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
        <Icon className="size-3.5" />
        {title}
      </p>
      {children}
    </div>
  );
}

function Cell({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="rounded border border-dashed px-2 py-1">
      <p className="text-[9px] text-muted-foreground">{label}</p>
      <p className={`font-semibold ${strong ? "text-primary" : ""}`}>{value}</p>
    </div>
  );
}

/**
 * V8.6 §12 — HISTORIQUE de l'opération (psp_ligne_historique, table EXISTANTE).
 *
 * Affiche les événements réels : création, modifications (dont rattachement et
 * retrait de commande), relances, reports, annulations. Aucune écriture —
 * lecture seule via `getPspLignesHistorique` (batch).
 */
const LIBELLES_HISTORIQUE: Record<string, string> = {
  creation: "Opération créée",
  modification: "Opération modifiée",
  report: "Report d'exercice",
  annulation: "Annulation",
  conflit_categorie: "Conflit de catégorie",
  relance: "Relance envoyée",
};

const libelleHistorique = (operation: string, motif: string | null): string => {
  const m = (motif ?? "").toLowerCase();
  if (operation === "modification") {
    if (m.includes("rattachement") && m.includes("retrait")) return "Rattachement retiré";
    if (m.includes("rattachement")) return "Commande rattachée";
  }
  return LIBELLES_HISTORIQUE[operation] ?? "Événement";
};

function HistoriqueSection({ pspLigneId }: { pspLigneId: string }) {
  const fetchHist = useServerFn(getPspLignesHistorique);
  const { data, isLoading } = useQuery({
    queryKey: ["psp-ligne-historique", pspLigneId],
    queryFn: () => fetchHist({ data: { ids: [pspLigneId] } }),
    staleTime: 1000 * 30,
    retry: 1,
  });
  const entrees = (data ?? []) as Array<{
    id: string;
    operation: string;
    motif: string | null;
    created_at: string | null;
  }>;

  if (isLoading) {
    return (
      <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <Loader2 className="size-3 animate-spin" /> Chargement de l'historique…
      </p>
    );
  }
  if (entrees.length === 0) {
    return (
      <p className="text-[11px] text-muted-foreground">
        Aucune donnée disponible — pas encore d'événement historisé pour cette opération.
      </p>
    );
  }
  return (
    <ul className="space-y-1">
      {entrees.map((e) => (
        <li
          key={e.id}
          className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded border border-dashed px-2 py-1 text-[11px]"
        >
          <span className="text-[10px] text-muted-foreground">{fmtDate(e.created_at)}</span>
          <span className="font-semibold">{libelleHistorique(e.operation, e.motif)}</span>
          {e.motif && e.motif !== libelleHistorique(e.operation, e.motif) && (
            <span className="text-[10px] text-muted-foreground">— {e.motif}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * V8.3 §12 — RELANCE : éditeur de mail réutilisant le MÊME moteur central
 * (MAIL_MODELES.relance · composerMail · construireMailto). PAT S11 ne prétend
 * JAMAIS avoir envoyé le mail ; aucun envoi automatique. La règle
 * « Relance nécessaire » reste DÉRIVÉE (date limite dépassée + aucun devis reçu,
 * socle V8.1) : elle se lève dès qu'un devis est reçu.
 */
function RelanceDialog({
  entreprise,
  operation,
  email,
  onClose,
  onRelanceEnregistree,
}: {
  entreprise: ConsultationEntreprise;
  operation: SuiviOperationVue;
  email: string | null;
  onClose: () => void;
  /** V8.4 — recharge la fiche après « Marquer comme envoyée ». */
  onRelanceEnregistree: () => Promise<void>;
}) {
  const p = operation.programmation;
  // V8.4 §5 — date limite : explicite sinon created_at + 21 jours.
  const devisRef = entreprise.devis[0];
  const dateLimite = devisRef ? dateLimiteReponse(devisRef) : null;
  const variables = {
    TR: operation.identite.tranche,
    NATURE_TRAVAUX: p.nature ?? "",
    CORPS_ETAT: p.corps_etat ?? "",
    ADRESSE: p.adresse ?? "",
    DATE_RETOUR: dateLimite
      ? dateLimite.toLocaleDateString("fr-FR")
      : dateRetourParDefaut(new Date()),
    DATE_DEMANDE: entreprise.date_demande
      ? new Date(entreprise.date_demande).toLocaleDateString("fr-FR")
      : "dernière demande",
  };
  const modele = composerMail(
    MAIL_MODELES.find((m) => m.id === "relance")!,
    variables,
  );
  const [sujet, setSujet] = useState(modele.sujet);
  const [corps, setCorps] = useState(modele.corps);
  const [enregistre, setEnregistre] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const enregistrer = useServerFn(enregistrerRelanceDevis);
  const mailto = construireMailto({ email, sujet, corps });

  const marquerEnvoyee = async () => {
    if (!devisRef || saving) return;
    setSaving(true);
    setErreur(null);
    try {
      await enregistrer({ data: { id: devisRef.id, motif: "Relance de demande de devis" } });
      setEnregistre(true);
      await onRelanceEnregistree();
    } catch (e) {
      setErreur(String((e as Error)?.message ?? e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[min(94vw,640px)]">
        <DialogHeader>
          <DialogTitle className="text-sm">Relance — {entreprise.entreprise}</DialogTitle>
          <DialogDescription>
            Destinataire :{" "}
            {email ? (
              email
            ) : (
              <span className="font-semibold text-amber-700">Email fournisseur non renseigné</span>
            )}
          </DialogDescription>
        </DialogHeader>
        {/* V8.4 §5 — date limite de réponse */}
        <p className="text-[11px] text-muted-foreground">
          Demande le {fmtDate(entreprise.date_demande)} · Date souhaitée de réponse :{" "}
          <span className="font-semibold">
            {dateLimite ? dateLimite.toLocaleDateString("fr-FR") : "—"}
          </span>
          {devisRef?.derniere_relance_at && (
            <span className="ml-2">
              · Dernière relance le {fmtDate(devisRef.derniere_relance_at)}
            </span>
          )}
        </p>
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
              setSujet(modele.sujet);
              setCorps(modele.corps);
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
            <Copy className="size-3" /> Copier
          </Button>
          <Button asChild size="sm" className="h-7 text-[10px]">
            <a href={mailto} target="_blank" rel="noreferrer">
              <Mail className="size-3" /> Ouvrir dans ma messagerie (mailto:)
            </a>
          </Button>
          {/* V8.4 §10 — action explicite après ouverture du mail (jamais automatique) */}
          <Button
            size="sm"
            variant={enregistre ? "outline" : "default"}
            className="h-7 text-[10px]"
            disabled={saving || !devisRef}
            onClick={marquerEnvoyee}
          >
            {enregistre ? "✓ Relance enregistrée" : "Marquer comme envoyée"}
          </Button>
        </DialogFooter>
        {erreur && <p className="text-[11px] font-semibold text-red-700">{erreur}</p>}
        <p className="text-[10px] text-muted-foreground">
          Le mail s'ouvre en BROUILLON dans votre messagerie — PAT S11 ne prétend jamais avoir
          envoyé le mail. « Relance nécessaire » reste dérivée jusqu'à réception d'un devis.
        </p>
      </DialogContent>
    </Dialog>
  );
}
