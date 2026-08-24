/**
 * V8.6.1 §6-§8 — REGISTRE ANNUEL : tableau principal (état + origine + recherche).
 *
 * États DÉRIVÉS des données financières réelles (jamais inventés) :
 *   · SANS COMMANDE — aucune commande ;
 *   · EN COURS — commande + (payé vide OU payé < engagé) ;
 *   · TERMINÉE — commande + |payé − engagé| < 0,01 ;
 *   · À VÉRIFIER — incohérences financières.
 * Vue par défaut : « Sans commande » (ce qui doit encore être commandé).
 */
import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { money0 } from "@/lib/formats";
import {
  ETAT_SUIVI_LABEL,
  FILTRES_REGISTRE_DEFAUT,
  filtrerRegistreAnnuel,
  kpiRegistreAnnuel,
  trierLignesRegistre,
  type CleTriRegistre,
  type EtatSuiviAnnuel,
  type FiltresRegistreAnnuel,
  type LigneRegistreAnnuel,
} from "@/lib/psp.suivi.view";

const selectCls =
  "h-8 rounded-md border bg-card px-2 text-[10px] text-foreground focus:outline-none";

const ETATS: Array<"toutes" | EtatSuiviAnnuel> = [
  "toutes",
  "sans_commande",
  "en_cours",
  "terminee",
  "a_verifier",
];

const ETAT_BADGE: Record<EtatSuiviAnnuel, "default" | "secondary" | "outline" | "destructive"> = {
  sans_commande: "outline",
  en_cours: "secondary",
  terminee: "default",
  a_verifier: "destructive",
};

/**
 * V8.8 §3 — couleurs des statuts de consultation dans le registre :
 * les états ACTIFS / positifs du workflow (demande envoyée, en attente,
 * relance, devis reçu, devis retenu) sont VERT ; « Devis demandé » est donc
 * vert comme les autres états positifs. Aucun état stocké : dérivé de psp_devis.
 */
const CONSULTATION_BADGE: Record<string, string> = {
  pas_consulte: "outline text-muted-foreground",
  demande_a_envoyer: "outline text-amber-700",
  demande_envoyee: "bg-emerald-600 text-white",
  en_attente: "bg-emerald-600 text-white",
  relance_necessaire: "bg-amber-500 text-white",
  devis_recu: "bg-emerald-600 text-white",
  devis_retenu: "bg-emerald-700 text-white",
  consultation_abandonnee: "outline text-muted-foreground",
};

export default function SuiviTable({
  lignes,
  annee,
  onOpen,
}: {
  lignes: LigneRegistreAnnuel[];
  annee: number;
  onOpen: (l: LigneRegistreAnnuel) => void;
}) {
  // V8.6.1 §8 — vue par défaut « Sans commande ».
  const [filtres, setFiltres] = useState<FiltresRegistreAnnuel>(() =>
    FILTRES_REGISTRE_DEFAUT(annee),
  );
  const set = (patch: Partial<FiltresRegistreAnnuel>) => setFiltres((f) => ({ ...f, ...patch }));
  // V8.8 §8 — tri cliquable : 1 clic ↑, 2 clics ↓, nouvelle colonne → ascendant.
  const [tri, setTri] = useState<{ cle: CleTriRegistre; asc: boolean }>({
    cle: "tranche",
    asc: true,
  });

  const kpi = useMemo(() => kpiRegistreAnnuel(lignes), [lignes]);
  const visibles = useMemo(
    () => trierLignesRegistre(filtrerRegistreAnnuel(lignes, filtres), tri.cle, tri.asc),
    [lignes, filtres, tri],
  );

  const trierSur = (cle: CleTriRegistre) =>
    setTri((t) => (t.cle === cle ? { cle, asc: !t.asc } : { cle, asc: true }));
  const fleche = (cle: CleTriRegistre) => (tri.cle === cle ? (tri.asc ? " ↑" : " ↓") : "");

  return (
    <div className="space-y-3">
      {/* KPI — 7 conventionnels (V8.2.2 conservés), états détaillés en badges/filtre */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        <Kpi label="Opérations" value={String(kpi.operations)} />
        <Kpi label="Budget programmé" value={money0(kpi.budgetProgramme)} />
        <Kpi label="Commandé" value={money0(kpi.budgetCommande)} />
        <Kpi label="Engagé" value={money0(kpi.budgetEngage)} />
        <Kpi label="Payé" value={money0(kpi.budgetPaye)} />
        <Kpi label="Travaux en cours" value={String(kpi.travauxEnCours)} />
        <Kpi label="Terminées" value={String(kpi.terminees)} />
      </div>
      {/* Filtres — État + Origine + Recherche */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-2">
        <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
          État
        </label>
        <select
          className={selectCls}
          value={filtres.etat}
          onChange={(e) => set({ etat: e.target.value as FiltresRegistreAnnuel["etat"] })}
        >
          {ETATS.map((e) => (
            <option key={e} value={e}>
              {e === "toutes" ? "Toutes" : ETAT_SUIVI_LABEL[e]}
            </option>
          ))}
        </select>
        <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
          Origine
        </label>
        <select
          className={selectCls}
          value={filtres.origine}
          onChange={(e) => set({ origine: e.target.value as FiltresRegistreAnnuel["origine"] })}
        >
          <option value="toutes">Toutes</option>
          <option value="psp">PSP</option>
          <option value="hors_psp">Hors PSP</option>
        </select>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-8 w-56 pl-7 text-[11px]"
            placeholder="TR / adresse / CC / corps d'état / commande / fournisseur…"
            value={filtres.recherche}
            onChange={(e) => set({ recherche: e.target.value })}
          />
        </div>
      </div>

      {/* Tableau */}
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full min-w-[900px] text-[11px]">
          <thead>
            <tr className="border-b bg-muted/50 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
              <th
                className="cursor-pointer px-2 py-1.5 font-bold select-none hover:text-foreground"
                onClick={() => trierSur("operation")}
              >
                Opération / Nature{fleche("operation")}
              </th>
              <th
                className="cursor-pointer px-2 py-1.5 font-bold select-none hover:text-foreground"
                onClick={() => trierSur("origine")}
              >
                Origine{fleche("origine")}
              </th>
              <th
                className="cursor-pointer px-2 py-1.5 font-bold select-none hover:text-foreground"
                onClick={() => trierSur("tranche")}
              >
                TR{fleche("tranche")}
              </th>
              <th
                className="cursor-pointer px-2 py-1.5 font-bold select-none hover:text-foreground"
                onClick={() => trierSur("adresse")}
              >
                Adresse{fleche("adresse")}
              </th>
              <th
                className="cursor-pointer px-2 py-1.5 font-bold select-none hover:text-foreground"
                onClick={() => trierSur("cc")}
              >
                CC{fleche("cc")}
              </th>
              <th
                className="cursor-pointer px-2 py-1.5 font-bold select-none hover:text-foreground"
                onClick={() => trierSur("corps_etat")}
              >
                Corps d&apos;état{fleche("corps_etat")}
              </th>
              <th
                className="cursor-pointer px-2 py-1.5 font-bold select-none hover:text-foreground"
                onClick={() => trierSur("descriptif")}
              >
                Descriptif{fleche("descriptif")}
              </th>
              <th
                className="cursor-pointer px-2 py-1.5 font-bold select-none hover:text-foreground"
                onClick={() => trierSur("programmation")}
              >
                Programmation{fleche("programmation")}
              </th>
              <th
                className="cursor-pointer px-2 py-1.5 font-bold select-none hover:text-foreground"
                onClick={() => trierSur("consultation")}
              >
                Consultation{fleche("consultation")}
              </th>
              <th
                className="cursor-pointer px-2 py-1.5 font-bold select-none hover:text-foreground"
                onClick={() => trierSur("devis")}
              >
                Devis{fleche("devis")}
              </th>
              <th
                className="cursor-pointer px-2 py-1.5 font-bold select-none hover:text-foreground"
                onClick={() => trierSur("commande")}
              >
                Commande{fleche("commande")}
              </th>
              <th
                className="cursor-pointer px-2 py-1.5 font-bold select-none hover:text-foreground"
                onClick={() => trierSur("travaux")}
              >
                Travaux{fleche("travaux")}
              </th>
            </tr>
          </thead>
          <tbody>
            {visibles.length === 0 ? (
              <tr>
                <td className="px-2 py-3 text-muted-foreground" colSpan={12}>
                  Aucune donnée disponible. — pour cette année / ce filtre, les données réelles
                  (fichier annuel + opérations de la préparation) ne contiennent aucune ligne.
                </td>
              </tr>
            ) : (
              visibles.map((l) => (
                <tr
                  key={l.id}
                  className="cursor-pointer border-b border-dashed hover:bg-muted/40"
                  onClick={() => onOpen(l)}
                  title={
                    l.type === "operation"
                      ? "Ouvrir la fiche opération"
                      : "Commande non rattachée — voir les opérations existantes"
                  }
                >
                  <td className="px-2 py-1.5">
                    <span className="flex items-center gap-1.5">
                      <span className="font-semibold">
                        {l.type === "operation" ? "Opération" : "Commande"}
                      </span>
                      <span className="line-clamp-1 max-w-[180px] text-[10px] text-muted-foreground">
                        {l.nature ?? "—"}
                      </span>
                    </span>
                  </td>
                  <td className="px-2 py-1.5">
                    <Badge variant={l.origine === "hors_psp" ? "secondary" : "outline"}>
                      {l.origine === "hors_psp" ? "Hors PSP" : "PSP"}
                    </Badge>
                  </td>
                  <td className="px-2 py-1.5 font-bold">{l.tranche}</td>
                  <td className="max-w-[220px] px-2 py-1.5">
                    <span className="block truncate text-[10px]" title={l.adresse ?? ""}>
                      {l.adresse ?? "—"}
                    </span>
                  </td>
                  <td className="px-2 py-1.5">{l.cc ?? "—"}</td>
                  <td className="px-2 py-1.5">{l.corps_etat ?? "—"}</td>
                  <td className="max-w-[220px] px-2 py-1.5">
                    <span className="line-clamp-2 block text-[10px]">{l.nature ?? "—"}</span>
                  </td>
                  <td className="px-2 py-1.5">
                    <p className="font-semibold">{l.ligne_budget ?? "—"}</p>
                    <p className="text-[9px] text-muted-foreground">
                      {l.type === "operation"
                        ? l.programme_annee != null && l.programme_annee > 0
                          ? `Programmé ${annee} : ${money0(l.programme_annee)}`
                          : "Hors programme"
                        : l.budget != null
                          ? `Budget : ${money0(l.budget)}`
                          : "—"}
                    </p>
                  </td>
                  <td className="px-2 py-1.5">
                    {l.consultation.nb_demandes > 0 ? (
                      <span className="inline-flex flex-wrap items-center gap-1">
                        <Badge className={CONSULTATION_BADGE[l.consultation.statut] ?? "outline"}>
                          {l.consultation.statut_label ?? "Demande envoyée"}
                        </Badge>
                        <span className="text-[9px] text-muted-foreground">
                          {l.consultation.nb_demandes} demande(s)
                        </span>
                      </span>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground">
                        Aucune demande
                      </Badge>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    {l.consultation.nb_devis_recus > 0 ? (
                      <span className="text-emerald-700">
                        {l.consultation.nb_devis_recus} reçu(s)
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    {l.commande?.numero_commande ? (
                      <>
                        <p className="font-semibold">{l.commande.numero_commande}</p>
                        <p className="text-[9px] text-muted-foreground">
                          {l.commande.fournisseur ?? "—"}
                        </p>
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    <Badge variant={ETAT_BADGE[l.etat_annuel]} className="text-[9px]">
                      {ETAT_SUIVI_LABEL[l.etat_annuel]}
                    </Badge>
                    {l.commande?.etat_travaux && (
                      <p className="text-[9px] text-muted-foreground">{l.commande.etat_travaux}</p>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-muted-foreground">
        {visibles.length} ligne(s) affichée(s) sur {lignes.length} pour {annee} — cliquez pour
        ouvrir la fiche (opération) ou le dialogue de correspondance (commande non rattachée). Les
        états sont dérivés des montants réels (payé / engagé) et des données importées.
      </p>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card px-2 py-1.5">
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-sm font-bold">{value}</p>
    </div>
  );
}
