import { Link } from "@tanstack/react-router";
import {
  BarChart3,
  Building2,
  CalendarRange,
  Database,
  Home,
  MapPin,
  Wrench,
  type LucideIcon,
} from "lucide-react";

import { LISTE_FOURNISSEURS_SEARCH_VIDE } from "@/routes/fournisseurs.index";
import { construireSearchAdresses } from "@/lib/adresses";

const LIEN_CLASS =
  "flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-black uppercase tracking-widest text-slate-300 transition-colors hover:bg-slate-800 hover:text-white";
const LIEN_CLASS_ACTIF = "bg-slate-800 text-white";

/** Lien de la barre globale (classes partagées). */
function LienNav({
  to,
  label,
  icon: Icon,
  search,
  exact,
}: {
  to: string;
  label: string;
  icon: LucideIcon;
  search?: unknown;
  exact?: boolean;
}) {
  return (
    <Link
      to={to as never}
      search={search as never}
      activeOptions={{ exact: exact ?? false }}
      className={LIEN_CLASS}
      activeProps={{ className: `${LIEN_CLASS} ${LIEN_CLASS_ACTIF}` }}
    >
      <Icon className="size-3.5" />
      {label}
    </Link>
  );
}

/**
 * Barre de navigation GLOBALE persistante (Phase 6, P1) — pôles métier.
 * Rendu dans le layout racine : l'utilisateur change de pôle sans repasser par l'accueil.
 */
export default function AppNavigation() {
  return (
    <nav className="sticky top-0 z-40 border-b border-slate-800 bg-slate-900">
      <div className="mx-auto flex max-w-[2200px] items-center gap-1 overflow-x-auto px-4 py-2 sm:px-6">
        <LienNav to="/" label="Accueil" icon={Home} exact />
        <LienNav
          to="/dashboard-travaux"
          label="Pilotage"
          icon={BarChart3}
          search={{ commande: undefined, de: undefined, a: undefined }}
        />
        <LienNav to="/preparation-psp" label="Préparation PSP" icon={CalendarRange} />
        <LienNav
          to="/fournisseurs"
          label="Sourcing"
          icon={Building2}
          search={LISTE_FOURNISSEURS_SEARCH_VIDE}
        />
        <LienNav
          to="/adresses"
          label="Patrimoine"
          icon={MapPin}
          search={construireSearchAdresses({})}
        />
        <LienNav to="/psp-validation" label="Données" icon={Database} />
        <LienNav to="/import-travaux" label="Imports" icon={Wrench} />
      </div>
    </nav>
  );
}
