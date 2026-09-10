import { useRef, useState } from "react";
import {
  CalendarRange,
  Download,
  FlaskConical,
  HelpCircle,
  History,
  ScanSearch,
  Upload,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * En-tête du module « Préparation PSP » :
 * titre, sous-titre, badge « Brouillon », badge de source de données
 * (mock / esquisse fichier / référence réelle), et actions.
 * Le sélecteur d'exercice vit dans la répartition annuelle (filtre unique) ;
 * le chargement de l'esquisse 2027 est LOCAL (aucune écriture en base).
 */
export default function PspHeader({
  onAncienneProgrammation,
  onAnalyser,
  onSimulation,
  onExporter,
  onChargerEsquisse,
  sourceLabel,
  referenceResume,
}: {
  onAncienneProgrammation: () => void;
  onAnalyser: () => void;
  onSimulation: () => void;
  onExporter: () => void;
  onChargerEsquisse: (file: File) => void;
  sourceLabel: string;
  referenceResume: string | null;
}) {
  const fichierRef = useRef<HTMLInputElement>(null);
  const [esquisseAideOuverte, setEsquisseAideOuverte] = useState(false);

  return (
    <header className="sticky top-11 z-30 border-b bg-white/90 shadow-sm backdrop-blur-lg">
      <div className="mx-auto max-w-[2200px] px-4 py-3 sm:px-6">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary p-2 text-primary-foreground shadow-md shadow-primary/20">
              <CalendarRange className="size-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-lg font-black uppercase tracking-tight text-foreground">
                  Préparation PSP
                </h1>
                <Badge className="border-amber-200 bg-amber-100 text-amber-800 hover:bg-amber-100">
                  Brouillon
                </Badge>
                <Badge
                  variant="outline"
                  className="border-primary/30 bg-primary/5 font-mono text-[10px] font-bold text-primary"
                  title="Source des opérations de la programmation en préparation"
                >
                  Source : {sourceLabel}
                </Badge>
              </div>
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                Programmation pluriannuelle des travaux
                {referenceResume ? ` · ${referenceResume}` : ""}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fichierRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const fichier = e.target.files?.[0];
                if (fichier) onChargerEsquisse(fichier);
                e.target.value = "";
              }}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => fichierRef.current?.click()}
              title="Charger le fichier « esquisse PSP 2027 » (source de préparation, non stockée)"
            >
              <Upload className="size-3.5" />
              Esquisse 2027
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground"
              onClick={() => setEsquisseAideOuverte(true)}
              title="Colonnes attendues dans le fichier Esquisse 2027"
            >
              <HelpCircle className="size-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={onAncienneProgrammation}>
              <History className="size-3.5" />
              Ancienne programmation
            </Button>
            <Button variant="outline" size="sm" onClick={onAnalyser}>
              <ScanSearch className="size-3.5" />
              Analyser
            </Button>
            <Button variant="outline" size="sm" onClick={onSimulation}>
              <FlaskConical className="size-3.5" />
              Simulation
            </Button>
            <Button variant="outline" size="sm" onClick={onExporter}>
              <Download className="size-3.5" />
              Exporter
            </Button>
          </div>
        </div>
      </div>

      {/* V8.16x — aide : ordre des colonnes attendu par le parser Esquisse 2027. */}
      <Dialog open={esquisseAideOuverte} onOpenChange={setEsquisseAideOuverte}>
        <DialogContent className="w-[min(94vw,520px)] sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <HelpCircle className="size-4 text-primary" />
              Fichier « Esquisse 2027 » — colonnes attendues
            </DialogTitle>
            <DialogDescription>
              Ordre exact des colonnes du fichier Excel lu par le parser (ligne d'en-tête avec la
              cellule « TR » ; les années sont des en-têtes numériques à 4 chiffres).
            </DialogDescription>
          </DialogHeader>
          <ol className="space-y-1 text-sm">
            {[
              "TR (numéro de tranche)",
              "Arl/sect (référence / secteur)",
              "ADRESSE",
              "Ville",
              "C (catégorie budgétaire GT / GE / CP)",
              "CORPS D'ÉTAT",
              "Ch. Op. (charge d'opération)",
              "Ligne budgétaire",
              "NATURE TRAVAUX",
              "Remarques",
              "2027",
              "2028",
              "2029",
              "2030",
              "2031",
            ].map((c, i) => (
              <li key={c} className="flex gap-2">
                <span className="w-6 shrink-0 text-right font-mono text-[10px] font-black text-primary">
                  {i + 1}
                </span>
                <span className="font-medium">{c}</span>
              </li>
            ))}
          </ol>
        </DialogContent>
      </Dialog>
    </header>
  );
}
