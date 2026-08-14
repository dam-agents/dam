import {
  Book,
  type CarbonIconType,
  Chemistry,
  Close,
  ContainerSoftware,
  Folders,
  Home,
  Settings,
  SidePanelOpen,
} from "@carbon/icons-react";
import { useEffect, useState } from "react";

import { BrandLogo } from "@/components/brand-logo";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import { getBrand } from "../brand.js";
import { useDemoState } from "../mock/demo-state.js";
import { protoNavigate, protoPathname } from "../mock/proto-navigate.js";
import { useApprovalsForOwner } from "../modules/approvals/api/queries.js";
import { useStore } from "../store.js";

const EMPTY: never[] = [];
const STORAGE_KEY = "sidebar-expanded";

function useExpanded() {
  const [expanded, setExpanded] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === null ? true : stored === "true";
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(expanded));
  }, [expanded]);

  return [expanded, setExpanded] as const;
}

interface Destination {
  label: string;
  icon: CarbonIconType;
  active: boolean;
  badge: number;
  navigate: () => void;
}

export function IconRail({
  hideMobileBar = false,
}: {
  hideMobileBar?: boolean;
  showBudget?: boolean;
} = {}) {
  const [expanded, setExpanded] = useExpanded();
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const navigateToSettings = useStore((s) => s.navigateToSettings);
  const navigateToExperiments = useStore((s) => s.navigateToExperiments);
  const navigateToKnowledgeBases = useStore((s) => s.navigateToKnowledgeBases);

  const { data: approvals = EMPTY } = useApprovalsForOwner();
  const { state: demoState } = useDemoState();
  const pendingCount =
    demoState === "empty"
      ? 0
      : approvals.filter((r) => r.status === "pending").length;

  const pathname = protoPathname();
  const onMockRoute = [
    "/agent-setup",
    "/experiment-setup",
    "/experiment-onboard",
    "/kb-setup",
    "/compare",
    "/layouts",
    "/variations",
    "/consistency",
    "/wiki-onboard",
    "/explore/configure",
  ].includes(pathname);
  const home: Destination = {
    label: "Home",
    icon: Home,
    active: view === "home" && !onMockRoute,
    badge: pendingCount,
    navigate: () => {
      if (onMockRoute) {
        protoNavigate("/");
      } else {
        setView("home");
      }
    },
  };
  const sandboxes: Destination = {
    label: "Coding agents",
    icon: ContainerSoftware,
    active: view === "list" || pathname === "/agent-setup",
    badge: 0,
    navigate: () => {
      if (onMockRoute) {
        protoNavigate("/sandboxes");
        return;
      }
      setView("list");
    },
  };
  const experiments: Destination = {
    label: "Experiments",
    icon: Chemistry,
    active: view === "experiments" || pathname === "/experiment-setup" || pathname === "/experiment-onboard",
    badge: 0,
    navigate: () => {
      if (onMockRoute) {
        protoNavigate("/experiments");
        return;
      }
      navigateToExperiments();
    },
  };
  const knowledgeBases: Destination = {
    label: "Knowledge bases",
    icon: Book,
    active:
      view === "knowledge-bases" ||
      view === "knowledge-base-chat" ||
      view === "knowledge-base-config" ||
      pathname === "/kb-setup",
    badge: 0,
    navigate: () => {
      if (onMockRoute) {
        protoNavigate("/knowledge-bases");
        return;
      }
      navigateToKnowledgeBases();
    },
  };
  const artifacts: Destination = {
    label: "Artifacts",
    icon: Folders,
    active: view === "artifacts",
    badge: 0,
    navigate: () => setView("artifacts"),
  };
  const settings: Destination = {
    label: "Settings",
    icon: Settings,
    active: view === "settings",
    badge: 0,
    navigate: () => navigateToSettings(),
  };

  return (
    <>
      <nav
        className={cn(
          "hidden md:flex flex-col h-full bg-card border-r border-border shrink-0 transition-[width] duration-200 overflow-hidden",
          expanded ? "w-[240px]" : "w-[56px]",
        )}
        data-testid="app-sidebar"
      >
        {/* Brand logo + collapse toggle */}
        <div
          className={cn(
            "flex items-center pt-2 pb-1",
            expanded ? "px-3 justify-between" : "justify-center",
          )}
        >
          {expanded ? (
            <>
              <button
                type="button"
                onClick={home.navigate}
                title={getBrand().name}
                aria-label={getBrand().name}
                className="rounded-lg p-1 text-foreground/80 cursor-pointer"
              >
                <BrandLogo />
              </button>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                title="Collapse sidebar"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground hover:bg-muted"
              >
                <Close size={16} />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              title="Expand sidebar"
              className="group relative flex h-[34px] w-[34px] items-center justify-center rounded-lg p-1 text-foreground/80 cursor-pointer"
            >
              <BrandLogo className="group-hover:invisible" />
              <span className="absolute inset-0 hidden group-hover:flex items-center justify-center text-muted-foreground">
                <SidePanelOpen size={16} />
              </span>
            </button>
          )}
        </div>

        {/* Main nav items */}
        <div
          className={cn(
            "flex flex-col gap-0.5",
            expanded ? "px-2" : "items-center",
          )}
        >
          <NavItem dest={home} expanded={expanded} />
          <NavItem dest={sandboxes} expanded={expanded} />
          <NavItem dest={experiments} expanded={expanded} />
          <NavItem dest={knowledgeBases} expanded={expanded} />
        </div>

        <div
          className={cn("flex-1", !expanded && "cursor-pointer")}
          onClick={!expanded ? () => setExpanded(true) : undefined}
        />

        {/* Bottom items: artifacts, inbox, settings */}
        <div
          className={cn(
            "flex flex-col gap-0.5 pb-3",
            expanded ? "px-2" : "items-center",
          )}
        >
          <NavItem dest={artifacts} expanded={expanded} />
          <NavItem dest={settings} expanded={expanded} />
        </div>
      </nav>

      {!hideMobileBar && (
        <nav className="md:hidden fixed bottom-0 left-0 right-0 z-nav flex items-stretch border-t bg-card/95 backdrop-blur-xl safe-bottom">
          {[sandboxes, experiments, knowledgeBases, artifacts].map(
            (destination) => (
              <BottomBarItem key={destination.label} {...destination} />
            ),
          )}
        </nav>
      )}
    </>
  );
}

/* ─── Nav item (expanded / collapsed) ─── */

function NavItem({ dest, expanded }: { dest: Destination; expanded: boolean }) {
  const { label, icon: Icon, active, badge, navigate } = dest;

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={navigate}
        title={label}
        aria-label={label}
        className={cn(
          "flex h-10 w-10 items-center justify-center rounded-lg transition-colors",
          active
            ? "text-primary bg-muted"
            : "text-foreground/80 hover:text-foreground hover:bg-muted",
        )}
      >
        <IconWithBadge icon={Icon} badge={badge} />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={navigate}
      className={cn(
        "flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left transition-colors",
        active
          ? "text-primary bg-muted"
          : "text-foreground/80 hover:text-foreground hover:bg-muted",
      )}
    >
      <Icon size={16} className="shrink-0" />
      <span className="flex-1 truncate text-[14px] font-medium">{label}</span>
      {badge > 0 && (
        <Badge
          variant="default"
          className="min-w-[20px] h-[18px] px-1.5 rounded-full text-[10px] font-bold flex items-center justify-center border-0 bg-accent text-white hover:bg-accent"
        >
          {badge > 9 ? "9+" : badge}
        </Badge>
      )}
    </button>
  );
}

/* ─── Mobile bottom bar ─── */

function BottomBarItem({
  label,
  icon: Icon,
  active,
  badge,
  navigate,
}: Destination) {
  return (
    <button
      type="button"
      onClick={navigate}
      className={cn(
        "flex-1 flex flex-col items-center justify-center gap-0.5 py-2 transition-colors",
        active ? "text-primary" : "text-muted-foreground",
      )}
    >
      <IconWithBadge icon={Icon} badge={badge} />
      <span className="text-[10px] font-semibold">{label}</span>
    </button>
  );
}

function IconWithBadge({
  icon: Icon,
  badge,
}: {
  icon: CarbonIconType;
  badge: number;
}) {
  return (
    <span className="relative flex h-5 w-5 items-center justify-center">
      <Icon size={16} />
      {badge > 0 && (
        <Badge
          variant="default"
          className="absolute -top-1.5 -right-1.5 min-w-[16px] h-[16px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center border-0 bg-accent text-white hover:bg-accent"
        >
          {badge > 9 ? "9+" : badge}
        </Badge>
      )}
    </span>
  );
}
