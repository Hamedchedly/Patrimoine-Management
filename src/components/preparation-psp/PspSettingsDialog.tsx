/**
 * V7.7 §7 — PARAMÈTRES PSP : UN SEUL bouton ⚙ ouvrant une interface unique.
 * Onglets : [ Chargés clientèle ] [ Corps d'état ] [ Enveloppes budgétaires ].
 * Réutilise les CORPS des consoles V7.6 (ReferentielChargesClienteleBody,
 * ReferentielCorpsEtatsBody) — aucun moteur parallèle.
 * `onChangedCC` / `onChangedCorps` invalident les caches (CC affiché partout,
 * sélecteurs corps d'état). Les enveloppes restent dans psp_enveloppes.
 */
import { useState } from "react";
import { Coins, Layers, Settings2, Users } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { ReferentielChargesClienteleBody } from "@/components/preparation-psp/PspChargesClienteleDialog";
import { ReferentielCorpsEtatsBody } from "@/components/preparation-psp/PspCorpsEtatsDialog";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PSP_ANNEES, type PspAnnee } from "@/lib/psp.prep";
import { getPspEnveloppes } from "@/lib/psp.prep.supabase.functions";
import type { EnveloppeMap } from "@/lib/psp.prep.v7";

export type OngletParametres = "charges" | "corps" | "enveloppes";

const CATEGORIES = ["GE", "GT", "CP"] as const;

export default function PspSettingsDialog({
  open,
  onClose,
  ongletInitial = "charges",
  sousSecteursConnus = [],
  programmationId,
  onSaveEnveloppes,
  onChangedCC,
  onChangedCorps,
}: {
  open: boolean;
  onClose: () => void;
  ongletInitial?: OngletParametres;
  sousSecteursConnus?: string[];
  /** V7.9 §1 — programmation courante : la grille enveloppes se nourrit DIRECTEMENT
   * de `getPspEnveloppes` (jamais de l'état KPI ni d'une valeur par défaut). */
  programmationId?: string | null;
  onSaveEnveloppes: (map: EnveloppeMap) => Promise<void>;
  onChangedCC?: () => void;
  onChangedCorps?: () => void;
}) {
  const queryClient = useQueryClient();
  const [onglet, setOnglet] = useState<OngletParametres>(ongletInitial);
  /** V7.8 §4 — état local : nombres saisis OU chaîne vide (cellule non renseignée). */
  const [valeurs, setValeurs] = useState<Record<string, number | string>>({});
  const [savingEnv, setSavingEnv] = useState(false);
  const [messageEnv, setMessageEnv] = useState<string | null>(null);

  // V7.9 §1-2 — source de vérité = Supabase (psp_enveloppes). Pas de flash de
  // valeurs obsolètes : tant que le chargement n'est pas terminé, la grille
  // affiche « Chargement des enveloppes… ».
  const getEnveloppesFn = useServerFn(getPspEnveloppes);
  const enveloppesQuery = useQuery({
    queryKey: ["psp-enveloppes", programmationId ?? "aucune"],
    queryFn: () => getEnveloppesFn({ data: { programmationId: programmationId as string } }),
    enabled: Boolean(programmationId),
    staleTime: 1000 * 60,
    retry: 1,
  });
  const enveloppesChargees = enveloppesQuery.isLoading || enveloppesQuery.isPending;
  const mapEnveloppes = (rows: Array<{ annee: number; categorie: string; montant: number }>) =>
    rows.reduce<Record<string, number | string>>((m, r) => {
      m[`${r.annee}|${r.categorie}`] = r.montant;
      return m;
    }, {});

  const handleOpenChange = (o: boolean) => {
    if (o) {
      setOnglet(ongletInitial);
      // Repart des valeurs réellement persistées (getPspEnveloppes).
      setValeurs(
        mapEnveloppes(
          (enveloppesQuery.data ?? []) as Array<{
            annee: number;
            categorie: string;
            montant: number;
          }>,
        ),
      );
      setMessageEnv(null);
    }
    if (!o) onClose();
  };

  const setMontant = (annee: PspAnnee, cat: string, value: string) => {
    // V7.8 §4 — une cellule VIDÉE reste vide (n'écrase PAS la valeur existante) :
    // seuls les nombres saisis sont pris en compte à l'enregistrement.
    const brut = value.replace(/[^\d]/g, "");
    if (brut === "") {
      setValeurs((prev) => ({ ...prev, [`${annee}|${cat}`]: "" }));
      return;
    }
    setValeurs((prev) => ({ ...prev, [`${annee}|${cat}`]: Number(brut) || 0 }));
  };

  const enregistrerEnveloppes = async () => {
    setSavingEnv(true);
    setMessageEnv(null);
    try {
      // Ne conserve QUE les cellules réellement renseignées (les cellules vides
      // ne doivent jamais écraser une enveloppe existante en base).
      const nettoie: EnveloppeMap = {};
      for (const [cle, v] of Object.entries(valeurs)) {
        if (v === "" || v === undefined) continue;
        nettoie[cle] = typeof v === "number" ? v : Number(v) || 0;
      }
      await onSaveEnveloppes(nettoie);
      void queryClient.invalidateQueries({ queryKey: ["psp-enveloppes"] });
    } catch (e) {
      setMessageEnv(`Enregistrement impossible : ${(e as Error).message}`);
    } finally {
      setSavingEnv(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="w-[min(94vw,820px)] sm:max-w-[820px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="size-4 text-primary" />
            Paramètres PSP
          </DialogTitle>
          <DialogDescription>
            Référentiels métier et enveloppes budgétaires. Sources de vérité : patrimoine
            (tranches.sous_secteur), référentiels PSP (chargés clientèle, corps d'état) et
            psp_enveloppes. Les KPI restent calculés dynamiquement — jamais stockés.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={onglet} onValueChange={(v) => setOnglet(v as OngletParametres)}>
          <TabsList className="w-full justify-start">
            <TabsTrigger value="charges" className="flex items-center gap-1.5">
              <Users className="size-3.5" /> Chargés clientèle
            </TabsTrigger>
            <TabsTrigger value="corps" className="flex items-center gap-1.5">
              <Layers className="size-3.5" /> Corps d'état
            </TabsTrigger>
            <TabsTrigger value="enveloppes" className="flex items-center gap-1.5">
              <Coins className="size-3.5" /> Enveloppes budgétaires
            </TabsTrigger>
          </TabsList>

          <TabsContent value="charges" className="border-t pt-3">
            <ReferentielChargesClienteleBody
              sousSecteursConnus={sousSecteursConnus}
              onChanged={onChangedCC}
            />
          </TabsContent>

          <TabsContent value="corps" className="border-t pt-3">
            <ReferentielCorpsEtatsBody onChanged={onChangedCorps} />
          </TabsContent>

          <TabsContent value="enveloppes" className="border-t pt-3">
            {/* V7.9 §1-2 — source directe psp_enveloppes : pas de valeurs obsolètes ni de 0
                tant que le chargement n'est pas terminé. */}
            {enveloppesChargees || !programmationId ? (
              <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                {programmationId ? "Chargement des enveloppes…" : "Aucune programmation chargée."}
              </p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr>
                        <th className="border p-2 text-left text-xs font-black uppercase tracking-widest text-muted-foreground">
                          Catégorie
                        </th>
                        {PSP_ANNEES.map((a) => (
                          <th key={a} className="border p-2 text-center font-mono">
                            {a}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {CATEGORIES.map((cat) => (
                        <tr key={cat}>
                          <td className="border p-2 font-black">{cat}</td>
                          {PSP_ANNEES.map((a) => (
                            <td key={a} className="border p-1.5">
                              <Input
                                type="text"
                                inputMode="numeric"
                                className="tabnum h-8 text-right"
                                value={valeurs[`${a}|${cat}`] ?? ""}
                                onChange={(e) => setMontant(a, cat, e.target.value)}
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Les totaux consommés / programmés / restants / % sont TOUJOURS calculés depuis les
                  lignes (jamais stockés) — ils s'affichent dans la répartition annuelle et la
                  simulation. Source de la grille : `psp_enveloppes` (getPspEnveloppes).
                </p>
              </>
            )}
            {messageEnv ? (
              <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-800">
                {messageEnv}
              </p>
            ) : null}
            <div className="mt-2 flex justify-end">
              <Button size="sm" onClick={() => void enregistrerEnveloppes()} disabled={savingEnv}>
                {savingEnv ? "Enregistrement…" : "Enregistrer les enveloppes"}
              </Button>
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            Fermer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
