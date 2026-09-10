import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import {
  BarChart3,
  Bug,
  Building2,
  CalendarRange,
  ChevronDown,
  ClipboardList,
  Columns3,
  Database,
  FileSpreadsheet,
  FileText,
  History,
  Home,
  MapPin,
  Settings2,
  Upload,
  type LucideIcon,
} from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ParametresDialog } from "@/components/ParametresDialog";
import { BugReportsDashboard } from "@/components/bugs/BugReportsDashboard";
import { LISTE_FOURNISSEURS_SEARCH_VIDE } from "@/routes/fournisseurs.index";
import { construireSearchAdresses } from "@/lib/adresses";
import { LABELS, ROUTES } from "@/lib/navigation";

const LIEN_CLASS =
  "flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-black uppercase tracking-widest text-slate-300 transition-colors hover:bg-slate-800 hover:text-white";
const LIEN_CLASS_ACTIF = "bg-slate-800 text-white";

/** Lien principal de la barre globale (classes partagées). */
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

/** Menu déroulant (Popover Radix) pour un pôle avec sous-liens. */
function MenuDeroulant({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon: LucideIcon;
  children: ReactNode;
}) {
  const [ouvert, setOuvert] = useState(false);
  return (
    <Popover open={ouvert} onOpenChange={setOuvert}>
      <PopoverTrigger asChild>
        <button type="button" className={LIEN_CLASS}>
          <Icon className="size-3.5" />
          {label}
          <ChevronDown className="size-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-2">
        <div className="space-y-0.5" onClick={() => setOuvert(false)}>
          {children}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Item de menu déroulant. */
function ItemMenu({
  to,
  label,
  icon: Icon,
  search,
  titre,
}: {
  to: string;
  label: string;
  icon: LucideIcon;
  search?: unknown;
  titre?: string;
}) {
  return (
    <Link
      to={to as never}
      search={search as never}
      title={titre}
      className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-slate-800 transition-colors hover:bg-slate-100 hover:text-slate-950"
    >
      <Icon className="size-4 shrink-0 text-slate-500" />
      <span>{label}</span>
    </Link>
  );
}

/** Libellé de section dans un menu déroulant. */
function SectionMenu({ children }: { children: ReactNode }) {
  return (
    <p className="px-3 pb-1 pt-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
      {children}
    </p>
  );
}

/**
 * Barre de navigation GLOBALE (V8.16u) — pôles métier + Admin.
 * Gauche : Accueil · Dashboard annuel · Suivi devis · Programmation PSP · Base de données
 * (Fournisseurs / Patrimoine / Données). Droite : Admin (Import / Paramètres / Historique / Rapports).
 */
export default function AppNavigation() {
  const [parametresOuvert, setParametresOuvert] = useState(false);
  const [signalementsOuvert, setSignalementsOuvert] = useState(false);
  return (
    <nav className="sticky top-0 z-40 border-b border-slate-800 bg-slate-900">
      <div className="mx-auto flex max-w-[2200px] items-center gap-1 overflow-x-auto px-4 py-2 sm:px-6">
        <LienNav to={ROUTES.accueil} label={LABELS.accueil} icon={Home} exact />
        <LienNav
          to={ROUTES.dashboard}
          label={LABELS.dashboard}
          icon={BarChart3}
          search={{ commande: undefined, de: undefined, a: undefined }}
        />
        <LienNav to={ROUTES.suivi} label={LABELS.suivi} icon={ClipboardList} />
        <LienNav to={ROUTES.preparation} label={LABELS.preparation} icon={CalendarRange} />
        <LienNav to={ROUTES.pilotage} label={LABELS.pilotage} icon={Columns3} />

        <MenuDeroulant label="Base de données" icon={Database}>
          <ItemMenu
            to={ROUTES.fournisseurs}
            label={LABELS.fournisseurs}
            icon={Building2}
            search={LISTE_FOURNISSEURS_SEARCH_VIDE}
          />
          <ItemMenu
            to={ROUTES.adresses}
            label={LABELS.adresses}
            icon={MapPin}
            search={construireSearchAdresses({})}
          />
          <ItemMenu to={ROUTES.donnees} label={LABELS.donnees} icon={Database} />
        </MenuDeroulant>

        <div className="ml-auto">
          <MenuDeroulant label="Admin" icon={Settings2}>
            <SectionMenu>Import</SectionMenu>
            <ItemMenu to={ROUTES.importPatrimoine} label={LABELS.importPatrimoine} icon={Upload} />
            <ItemMenu to={ROUTES.importSuivi} label={LABELS.importSuivi} icon={FileSpreadsheet} />
            <ItemMenu to={ROUTES.importCmd} label={LABELS.importCmd} icon={Upload} />
            <div className="my-1 border-t border-slate-700" />
            <button
              type="button"
              onClick={() => setParametresOuvert(true)}
              className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm text-slate-800 transition-colors hover:bg-slate-100 hover:text-slate-950"
            >
              <Settings2 className="size-4 shrink-0 text-slate-500" />
              <span>Paramètres</span>
            </button>
            <ItemMenu
              to={ROUTES.dashboard}
              label="Historique de changements"
              icon={History}
              search={{ commande: undefined, de: undefined, a: undefined }}
              titre="Journal des versions et résolutions (dashboard)"
            />
            <ItemMenu
              to={ROUTES.importSuivi}
              label="Rapports d'import"
              icon={FileText}
              titre="Rapports d'import et conflits à valider"
            />
            <div className="my-1 border-t border-slate-700" />
            <SectionMenu>Support</SectionMenu>
            <button
              type="button"
              onClick={() => setSignalementsOuvert(true)}
              className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm text-slate-800 transition-colors hover:bg-slate-100 hover:text-slate-950"
            >
              <Bug className="size-4 shrink-0 text-slate-500" />
              <span>Signalements de bugs</span>
            </button>
          </MenuDeroulant>
        </div>
      </div>
      <ParametresDialog open={parametresOuvert} onClose={() => setParametresOuvert(false)} />
      <BugReportsDashboard open={signalementsOuvert} onOpenChange={setSignalementsOuvert} />
    </nav>
  );
}
