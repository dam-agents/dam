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
  const navExpanded = useStore((s) => s.navExpanded);
  const setNavExpanded = useStore((s) => s.setNavExpanded);
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
          "hidden md:flex flex-col h-full bg-card border-r border-border shrink-0 transition-[width]",
          navExpanded ? "w-[232px] px-2" : "w-[56px] items-center",
        )}
        data-testid="app-sidebar"
      >
        <div
          className={cn(
            "flex pt-2",
            navExpanded
              ? "w-full items-center justify-between gap-2"
              : "flex-col items-center gap-1",
          )}
        >
          <button
            type="button"
            onClick={sandboxes.navigate}
            aria-label={getBrand().name}
            className="rounded-lg p-1 text-foreground/80 transition-colors hover:bg-muted hover:text-foreground"
          >
            <BrandLogo />
          </button>
          <Tooltip
            content={navExpanded ? "Collapse navigation" : "Expand navigation"}
            side="right"
          >
            <button
              type="button"
              onClick={() => setNavExpanded(!navExpanded)}
              aria-label={
                navExpanded ? "Collapse navigation" : "Expand navigation"
              }
              aria-expanded={navExpanded}
              className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {navExpanded ? <Close size={16} /> : <SidePanelOpen size={16} />}
            </button>
          </Tooltip>
        </div>
        <div
          className={cn(
            "flex flex-col gap-1",
            navExpanded ? "w-full mt-2" : "items-center",
          )}
        >
          <RailItem {...sandboxes} expanded={navExpanded} />
          <RailItem {...codingAgents} expanded={navExpanded} />
          <RailItem {...experiments} expanded={navExpanded} />
          <RailItem {...knowledgeBases} expanded={navExpanded} />
        </div>
        <div className="flex-1" />
        <div
          className={cn(
            "flex flex-col gap-1 mb-2",
            navExpanded ? "w-full" : "items-center",
          )}
        >
          <RailItem {...inbox} expanded={navExpanded} />
          <RailItem {...artifacts} expanded={navExpanded} />
          <RailItem {...settings} expanded={navExpanded} />
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
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-10 items-center rounded-lg transition-colors",
        expanded ? "w-full gap-3 px-3" : "w-10 justify-center",
        active
          ? "text-primary bg-muted"
          : "text-foreground/80 hover:text-foreground hover:bg-muted",
      )}
    >
      <IconWithBadge icon={Icon} badge={badge} />
      {expanded && <span className="truncate text-sm">{label}</span>}
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
