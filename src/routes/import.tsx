import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { FileSpreadsheet, Upload } from "lucide-react";

import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { parseIsisWorkbook } from "@/lib/isis";
import { finalizeIsisImport, importIsisBatch } from "@/lib/isis.functions";

export const Route = createFileRoute("/import")({
  head: () => ({
    meta: [
      { title: "Import Patrimoine — ISIS" },
      {
        name: "description",
        content:
          "Importation de la base patrimoine ISIS : les tranches et lots existants sont mis à jour, les nouveaux créés, les disparus marqués sortis de patrimoine.",
      },
      { property: "og:title", content: "Import Patrimoine — ISIS" },
      {
        property: "og:description",
        content: "Rapprochement automatique de l'export complet ISIS avec le patrimoine géré.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ImportPage,
});

type Report = {
  lotsActifs: number;
  tranchesActives: number;
  lotsSortis: number;
  tranchesSorties: number;
};

function ImportPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const runBatch = useServerFn(importIsisBatch);
  const runFinalize = useServerFn(finalizeIsisImport);

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setBusy(true);
    setError(null);
    setReport(null);
    setProgress(0);
    try {
      setMessage("Analyse du fichier…");
      const parsed = parseIsisWorkbook(await file.arrayBuffer());
      const runDate = new Date().toISOString().slice(0, 10);

      const steps: Array<() => Promise<unknown>> = [];
      const chunk = <T,>(arr: T[], size: number) =>
        Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
          arr.slice(i * size, i * size + size),
        );

      for (const part of chunk(parsed.tranches, 200))
        steps.push(() => runBatch({ data: { runDate, tranches: part, lots: [], occupants: [] } }));
      for (const part of chunk(parsed.lots, 400))
        steps.push(() => runBatch({ data: { runDate, tranches: [], lots: part, occupants: [] } }));
      for (const part of chunk(parsed.occupants, 400))
        steps.push(() => runBatch({ data: { runDate, tranches: [], lots: [], occupants: part } }));

      let done = 0;
      for (const step of steps) {
        await step();
        done += 1;
        setProgress(Math.round((done / steps.length) * 100));
        setMessage(`Envoi ${done}/${steps.length} — ${parsed.lignes} lignes analysées`);
      }

      setMessage("Rapprochement final…");
      const res = await runFinalize({
        data: { runDate, fichier: file.name, lignes: parsed.lignes },
      });
      setReport(res);
      setMessage(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import impossible");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-4 sm:p-8">
      <PageHeader
        title="Import Patrimoine — ISIS"
        subtitle="Importation de la base patrimoine ISIS. Déposez l'export complet. Les lignes connues sont mises à jour, les nouvelles créées, et celles absentes de l'export sont marquées sorties de patrimoine sans perdre l'historique."
      >
        <Button asChild variant="outline">
          <Link to="/">Accueil</Link>
        </Button>
      </PageHeader>

      <div className="rounded-xl border border-dashed bg-surface p-8 text-center">
        <FileSpreadsheet className="mx-auto size-8 text-muted-foreground" />
        <p className="mt-3 text-sm text-muted-foreground">Fichier .xlsx exporté depuis ISIS</p>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
          }}
        />
        <Button className="mt-4" disabled={busy} onClick={() => inputRef.current?.click()}>
          <Upload className="size-4" /> Choisir le fichier
        </Button>
      </div>

      {busy || message ? (
        <div className="space-y-2">
          <Progress value={progress} />
          <p className="text-sm text-muted-foreground">{message}</p>
        </div>
      ) : null}

      {error ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {report ? (
        <div className="space-y-2 rounded-xl border bg-surface p-4 text-sm">
          <h2 className="font-semibold">Rapport d'import</h2>
          <ul className="space-y-1 text-muted-foreground">
            <li>{report.tranchesActives} tranches actives</li>
            <li>{report.lotsActifs} lots actifs</li>
            <li>{report.lotsSortis} lots absents de cet export (sortis de patrimoine)</li>
            <li>{report.tranchesSorties} tranches absentes de cet export</li>
          </ul>
        </div>
      ) : null}
    </main>
  );
}
