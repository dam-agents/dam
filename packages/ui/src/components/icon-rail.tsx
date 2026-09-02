import {
  Book,
  Box,
  type CarbonIconType,
  ChevronLeft,
  ChevronRight,
  EdgeDevice,
  Folders,
  Home,
  Settings,
} from "@carbon/icons-react";

import { BrandLogo } from "@/components/brand-logo";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { getBrand } from "../brand.js";
import { useStore } from "../store.js";

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
} = {}) {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const expandedNav = useStore((s) => s.sidebarExpanded);
  const setExpandedNav = useStore((s) => s.setSidebarExpanded);
  const navigateToSettings = useStore((s) => s.navigateToSettings);
  const sandboxes: Destination = {
    label: "Home",
    icon: Home,
    active: view === "home",
    badge: 0,
    navigate: () => setView("home"),
  };
  const agents: Destination = {
    label: "Agents",
    icon: EdgeDevice,
    active: view === "agents" || view === "agent-new",
    badge: 0,
    navigate: () => setView("agents"),
  };
  const knowledgeBases: Destination = {
    label: "Knowledge",
    icon: Book,
    active: view === "knowledge-bases" || view === "knowledge-base-config",
    badge: 0,
    navigate: () => setView("knowledge-bases"),
  };
  const packs: Destination = {
    label: "Presets",
    icon: Box,
    active: view === "packs",
    badge: 0,
    navigate: () => setView("packs"),
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
          "hidden md:flex flex-col h-full px-2 bg-card border-r border-border shrink-0 transition-[width]",
          expandedNav ? "w-[232px]" : "w-[56px]",
        )}
        data-testid="app-sidebar"
      >
        <div
          className={cn(
            "flex items-center pt-2",
            expandedNav ? "w-full justify-between gap-2" : "justify-center",
          )}
        >
          {expandedNav && (
            <button
              type="button"
              onClick={sandboxes.navigate}
              aria-label={getBrand().name}
              className="rounded-lg p-1 text-foreground/80 transition-colors hover:bg-muted hover:text-foreground"
            >
              <BrandLogo />
            </button>
          )}
          <Tooltip
            content={expandedNav ? "Collapse navigation" : "Expand navigation"}
            side="right"
          >
            <button
              type="button"
              onClick={() => setExpandedNav(!expandedNav)}
              aria-label={
                expandedNav ? "Collapse navigation" : "Expand navigation"
              }
              aria-expanded={expandedNav}
              className={cn(
                "group relative flex items-center justify-center rounded-lg transition-colors hover:bg-muted hover:text-foreground",
                expandedNav
                  ? "p-1.5 text-muted-foreground"
                  : "h-10 w-10 text-foreground/80",
              )}
            >
              {expandedNav ? (
                <ChevronLeft size={16} />
              ) : (
                <>
                  <BrandLogo className="opacity-0 transition-opacity hover-capable:opacity-100 group-hover:opacity-0 group-focus-visible:opacity-0" />
                  <ChevronRight
                    size={16}
                    className="absolute transition-opacity hover-capable:opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
                  />
                </>
              )}
            </button>
          </Tooltip>
        </div>
        <div className="mt-px flex flex-col gap-px">
          <RailItem {...sandboxes} expanded={expandedNav} />
          <RailItem {...agents} expanded={expandedNav} />
          <RailItem {...knowledgeBases} expanded={expandedNav} />
          <RailItem {...packs} expanded={expandedNav} />
        </div>
        <div className="flex-1" />
        <div className="mb-2 flex flex-col gap-px">
          <RailItem {...artifacts} expanded={expandedNav} />
          <RailItem {...settings} expanded={expandedNav} />
        </div>
      </nav>

      {!hideMobileBar && (
        <nav className="md:hidden fixed bottom-0 left-0 right-0 z-nav flex items-stretch border-t bg-card/95 backdrop-blur-xl safe-bottom">
          {[sandboxes, agents, knowledgeBases, packs].map((destination) => (
            <BottomBarItem key={destination.label} {...destination} />
          ))}
        </nav>
      )}
    </>
  );
}

function RailItem({
  label,
  icon: Icon,
  active,
  badge,
  navigate,
  expanded,
}: Destination & { expanded: boolean }) {
  const button = (
    <button
      type="button"
      onClick={navigate}
      aria-label={
        badge > 0 ? `${label}, ${badge} pending` : expanded ? undefined : label
      }
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-[34px] w-full items-center gap-3 rounded-lg px-2.5 transition-colors",
        active
          ? "text-primary bg-muted"
          : "text-foreground/80 hover:text-foreground hover:bg-muted",
      )}
    >
      <IconWithBadge icon={Icon} badge={badge} size={16} />
      {expanded && (
        <span className="truncate text-sm font-medium">{label}</span>
      )}
    </button>
  );
  if (expanded) return button;
  return (
    <Tooltip content={label} side="right">
      {button}
    </Tooltip>
  );
}

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
  size = 20,
}: {
  icon: CarbonIconType;
  badge: number;
  size?: number;
}) {
  return (
    <span className="relative flex items-center justify-center">
      <Icon size={size} />
      {badge > 0 && (
        <Badge
          variant="default"
          className="absolute -top-1.5 -right-1.5 min-w-4 h-4 px-1 rounded-full text-[10px] font-bold flex items-center justify-center border-0 bg-accent text-white hover:bg-accent"
        >
          {badge > 9 ? "9+" : badge}
        </Badge>
      )}
    </span>
  );
}
