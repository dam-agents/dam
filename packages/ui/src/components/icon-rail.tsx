import {
  Book,
  type CarbonIconType,
  Chemistry,
  Email,
  Folders,
  Home,
  Settings,
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
    label: "Email",
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
        className="hidden md:flex flex-col items-center h-full w-[56px] bg-card border-r border-border shrink-0"
        data-testid="app-sidebar"
      >
        <div className="flex items-center justify-center pt-2">
          <button
            type="button"
            onClick={sandboxes.navigate}
            aria-label={getBrand().name}
            className="rounded-lg p-1 text-foreground/80 transition-colors hover:bg-muted hover:text-foreground"
          >
            <BrandLogo />
          </button>
        </div>
        <div className="flex flex-col items-center gap-1">
          <RailItem {...sandboxes} />
          <RailItem {...experiments} />
          <RailItem {...knowledgeBases} />
          <RailItem {...artifacts} />
        </div>
        <div className="flex-1" />
        {/* Email is grouped with Settings at the bottom, per the redesign (Figma 152:4567). */}
        <div className="flex flex-col items-center gap-1 mb-2">
          <RailItem {...inbox} />
          <RailItem {...settings} />
        </div>
      </nav>

      {!hideMobileBar && (
        <nav className="md:hidden fixed bottom-0 left-0 right-0 z-nav flex items-stretch border-t bg-card/95 backdrop-blur-xl safe-bottom">
          {[
            sandboxes,
            experiments,
            knowledgeBases,
            artifacts,
            inbox,
            settings,
          ].map((destination) => (
            <BottomBarItem key={destination.label} {...destination} />
          ))}
        </nav>
      )}
    </>
  );
}

function RailItem({ label, icon: Icon, active, badge, navigate }: Destination) {
  return (
    <Tooltip content={label} side="right">
      <button
        type="button"
        onClick={navigate}
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
