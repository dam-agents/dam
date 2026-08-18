import {
  Book,
  type CarbonIconType,
  Chemistry,
  Close,
  ContainerSoftware,
  Email,
  Folders,
  Home,
  Settings,
  SidePanelOpen,
} from "@carbon/icons-react";

import { BrandLogo } from "@/components/brand-logo";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { getBrand } from "../brand.js";
import { useApprovalsForOwner } from "../modules/approvals/api/queries.js";
import { useStore } from "../store.js";

const EMPTY: never[] = [];

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
  const navigateToExperiments = useStore((s) => s.navigateToExperiments);
  const navigateToKnowledgeBases = useStore((s) => s.navigateToKnowledgeBases);

  const { data: approvals = EMPTY } = useApprovalsForOwner();
  const pendingCount = approvals.filter((r) => r.status === "pending").length;

  const sandboxes: Destination = {
    label: "Home",
    icon: Home,
    active: view === "list",
    badge: 0,
    navigate: () => setView("list"),
  };
  const codingAgents: Destination = {
    label: "Coding agents",
    icon: ContainerSoftware,
    active: view === "coding-agents",
    badge: 0,
    navigate: () => setView("coding-agents"),
  };
  const experiments: Destination = {
    label: "Experiments",
    icon: Chemistry,
    active: view === "experiments",
    badge: 0,
    navigate: navigateToExperiments,
  };
  const knowledgeBases: Destination = {
    label: "Knowledge bases",
    icon: Book,
    active:
      view === "knowledge-bases" ||
      view === "knowledge-base-chat" ||
      view === "knowledge-base-config",
    badge: 0,
    navigate: navigateToKnowledgeBases,
  };
  const artifacts: Destination = {
    label: "Artifacts",
    icon: Folders,
    active: view === "artifacts",
    badge: 0,
    navigate: () => setView("artifacts"),
  };
  const inbox: Destination = {
    label: "Inbox",
    icon: Email,
    active: view === "inbox",
    badge: pendingCount,
    navigate: () => setView("inbox"),
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
                <Close size={16} />
              ) : (
                <>
                  <BrandLogo className="opacity-0 transition-opacity hover-capable:opacity-100 group-hover:opacity-0 group-focus-visible:opacity-0" />
                  <SidePanelOpen
                    size={20}
                    className="absolute transition-opacity hover-capable:opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
                  />
                </>
              )}
            </button>
          </Tooltip>
        </div>
        <div className="mt-px flex flex-col gap-px">
          <RailItem {...sandboxes} expanded={expandedNav} />
          <RailItem {...codingAgents} expanded={expandedNav} />
          <RailItem {...experiments} expanded={expandedNav} />
          <RailItem {...knowledgeBases} expanded={expandedNav} />
        </div>
        <div className="flex-1" />
        <div className="mb-2 flex flex-col gap-px">
          <RailItem {...inbox} expanded={expandedNav} />
          <RailItem {...artifacts} expanded={expandedNav} />
          <RailItem {...settings} expanded={expandedNav} />
        </div>
      </nav>

      {!hideMobileBar && (
        <nav className="md:hidden fixed bottom-0 left-0 right-0 z-nav flex items-stretch border-t bg-card/95 backdrop-blur-xl safe-bottom">
          {[
            sandboxes,
            codingAgents,
            experiments,
            knowledgeBases,
            inbox,
            artifacts,
            settings,
          ].map((destination) => (
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
      <IconWithBadge icon={Icon} badge={badge} />
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
}: {
  icon: CarbonIconType;
  badge: number;
}) {
  return (
    <span className="relative flex h-5 w-5 items-center justify-center">
      <Icon size={20} />
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
