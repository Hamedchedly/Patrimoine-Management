import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  BarChart3,
  Building2,
  ChevronRight,
  Clock,
  ListChecks,
  ListTree,
  MapPin,
  Upload,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { LISTE_FOURNISSEURS_SEARCH_VIDE } from "@/routes/fournisseurs.index";
import { PatrimoineHomeMap } from "@/components/PatrimoineHomeMap";
import { getPatrimoine } from "@/lib/isis.functions";
import { isLogement } from "@/lib/isis";
import { loadRecents, rueDe, type LotItem, type RecentAdresse } from "@/lib/adresses";

const raccourcis = [
  {
    to: "/import",
    label: "Import Patrimoine — ISIS",
    icon: Upload,
    variant: "outline" as const,
  },
  {
    to: "/import-travaux",
    label: "Import Suivi budgétaire annuel",
    icon: Upload,
    variant: "outline" as const,
  },
  {
    to: "/import-psp",
    label: "Import Historique CMD",
    icon: Upload,
    variant: "outline" as const,
  },
  {
    to: "/psp-validation",
    label: "Analyse historique CMD",
    icon: ListChecks,
    variant: "outline" as const,
  },
  {
    to: "/suivi",
    label: "Opérations",
    icon: ListChecks,
    variant: "outline" as const,
  },
  {
    to: "/fournisseurs",
    label: "Fournisseurs",
    icon: Building2,
    variant: "outline" as const,
    search: LISTE_FOURNISSEURS_SEARCH_VIDE,
  },
  {
    to: "/dashboard-travaux",
    label: "Dashboard travaux",
    icon: BarChart3,
    variant: "default" as const,
    search: { commande: undefined, de: undefined, a: undefined },
  },
] as const;

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Carte du patrimoine et adresses récentes" },
      {
        name: "description",
        content:
          "Carte des bâtiments gérés avec un repère par adresse, accès direct aux cinq dernières adresses consultées et à la liste complète par ville.",
      },
      { property: "og:title", content: "Carte du patrimoine et adresses récentes" },
      {
        property: "og:description",
        content:
          "Visualisez vos bâtiments sur une carte et retrouvez instantanément vos dernières adresses consultées.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

function Index() {
  const fetchPatrimoine = useServerFn(getPatrimoine);
  const { data, isLoading } = useQuery({
    queryKey: ["patrimoine"],
    queryFn: () => fetchPatrimoine(),
  });

  const [recents, setRecents] = useState<RecentAdresse[]>([]);
  useEffect(() => setRecents(loadRecents()), []);

  const lots = useMemo(() => (data?.lots ?? []) as LotItem[], [data?.lots]);

  const totaux = useMemo(() => {
    const adresses = new Set(lots.map((l) => `${rueDe(l.adresse)}|${l.ville ?? ""}`));
    const villes = new Set(lots.map((l) => l.ville).filter(Boolean));
    return {
      adresses: adresses.size,
      villes: villes.size,
      lots: lots.length,
      logements: lots.filter((l) => isLogement(l.type_lot)).length,
    };
  }, [lots]);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-4 sm:px-6">
          <div className="mr-auto">
            <h1 className="text-lg font-semibold leading-tight">Patrimoine</h1>
            <p className="text-sm text-muted-foreground">Carte et accès rapide</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {raccourcis.map(({ to, label, icon: Icon, variant, search }) => (
              <Button key={label} asChild variant={variant}>
                {search ? (
                  <Link to={to} search={search}>
                    <Icon className="size-4" /> {label}
                  </Link>
                ) : (
                  <Link to={to}>
                    <Icon className="size-4" /> {label}
                  </Link>
                )}
              </Button>
            ))}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6">
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Villes" value={String(totaux.villes)} />
          <Stat label="Adresses" value={String(totaux.adresses)} />
          <Stat label="Lots" value={String(totaux.lots)} />
          <Stat label="Logements" value={String(totaux.logements)} />
        </section>

        <section className="grid gap-5 lg:grid-cols-[2fr_1fr]">
          {isLoading ? (
            <div className="flex h-[420px] items-center justify-center rounded-xl border bg-card text-sm text-muted-foreground shadow-panel">
              Chargement de la carte…
            </div>
          ) : (
            <PatrimoineHomeMap lots={lots} />
          )}

          <div className="space-y-3">
            <div className="rounded-xl border bg-card shadow-panel">
              <h2 className="flex items-center gap-2 border-b p-3 text-sm font-semibold">
                <Clock className="size-4 text-muted-foreground" /> Recherches récentes
              </h2>
              {recents.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">
                  Aucune adresse consultée pour l'instant. Ouvrez la liste des adresses pour
                  démarrer.
                </p>
              ) : (
                <ul className="divide-y">
                  {recents.map((r) => (
                    <li key={`${r.rue}|${r.ville}`}>
                      <Link
                        to="/adresses"
                        search={{
                          q: "",
                          ville: r.ville,
                          tranche: undefined,
                          rue: undefined,
                          adresse: undefined,
                        }}
                        className="flex items-center gap-3 p-3 transition-colors hover:bg-accent/50"
                      >
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                          <MapPin className="size-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{r.rue}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {r.ville} · {r.lots} lots
                          </span>
                        </span>
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <Button asChild className="w-full" size="lg">
              <Link
                to="/adresses"
                search={{
                  q: "",
                  ville: undefined,
                  tranche: undefined,
                  rue: undefined,
                  adresse: undefined,
                }}
              >
                <ListTree className="size-4" /> Afficher toutes les adresses
              </Link>
            </Button>
          </div>
        </section>
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-panel">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="tabnum mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}
