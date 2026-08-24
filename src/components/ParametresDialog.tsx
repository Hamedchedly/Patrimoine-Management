import { useState } from "react";
import { Layers, Settings2, Users } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ReferentielChargesClienteleBody } from "@/components/preparation-psp/PspChargesClienteleDialog";
import { ReferentielCorpsEtatsBody } from "@/components/preparation-psp/PspCorpsEtatsDialog";

/**
 * V8.16u — dialogue « Paramètres » (menu Admin). Réutilise les BODY existants des
 * dialogues « Paramètres PSP » (ReferentielChargesClienteleBody / ReferentielCorpsEtatsBody) :
 * aucune duplication du moteur. Les enveloppes budgétaires restent dans le dialogue de la
 * page Programmation PSP (elles dépendent de la programmation courante).
 */
export function ParametresDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [onglet, setOnglet] = useState<"charges" | "corps">("charges");
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[min(94vw,820px)] sm:max-w-[820px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="size-4 text-primary" /> Paramètres
          </DialogTitle>
          <DialogDescription>
            Référentiels métier : chargés clientèle (sous-secteurs) et corps d'état — sources de
            vérité des sélecteurs.
          </DialogDescription>
        </DialogHeader>
        <Tabs value={onglet} onValueChange={(v) => setOnglet(v as "charges" | "corps")}>
          <TabsList className="w-full justify-start">
            <TabsTrigger value="charges" className="flex items-center gap-1.5">
              <Users className="size-3.5" /> Chargés clientèle
            </TabsTrigger>
            <TabsTrigger value="corps" className="flex items-center gap-1.5">
              <Layers className="size-3.5" /> Corps d'état
            </TabsTrigger>
          </TabsList>
          <TabsContent value="charges" className="border-t pt-3">
            <ReferentielChargesClienteleBody />
          </TabsContent>
          <TabsContent value="corps" className="border-t pt-3">
            <ReferentielCorpsEtatsBody />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
