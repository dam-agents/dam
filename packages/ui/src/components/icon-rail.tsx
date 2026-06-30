import {
  type CarbonIconType,
  Chemistry,
  Email as Inbox,
  Home,
  Settings,
} from "@carbon/icons-react";

import { BrandLogo } from "@/components/brand-logo";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import { getBrand } from "../brand.js";
import { useApprovalsForOwner } from "../modules/approvals/api/queries.js";
import { isShowExperimentsEnabled } from "../modules/experiments/internal-only.js";
import { useStore } from "../store.js";

const EMPTY: never[] = [];

interface Destination {
  label: string;
  icon: CarbonIconType;
  active: boolean;
  badge: number;
  navigate: () => void;
}

export function IconRail() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const navigateToSettings = useStore((s) => s.navigateToSettings);
  const navigateToExperiments = useStore((s) => s.navigateToExperiments);

  const { data: approvals = EMPTY } = useApprovalsForOwner();
  const pendingCount = approvals.filter((r) => r.status === "pending").length;
  const showExperiments = isShowExperimentsEnabled();

  const home: Destination = {
    label: "Home",
    icon: Home,
    active: view === "list",
    badge: 0,
    navigate: () => setView("list"),
  };
  const experiments: Destination = {
    label: "Experiments",
    icon: Chemistry,
    active:
      view === "experiments" ||
      view === "experiment-new" ||
      view === "experiment-detail",
    badge: 0,
    navigate: navigateToExperiments,
  };
  const inbox: Destination = {
    label: "Inbox",
    icon: Inbox,
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
        className="hidden md:flex flex-col items-center h-full w-[56px] bg-card shrink-0"
        data-testid="app-sidebar"
      >
        <div className="flex items-center justify-center pt-2">
          <button
            type="button"
            onClick={home.navigate}
            title={getBrand().name}
            aria-label={getBrand().name}
            className="rounded-lg p-1 text-foreground/80 transition-colors hover:bg-muted hover:text-foreground"
          >
            <BrandLogo />
          </button>
        </div>
        <div className="flex flex-col items-center gap-1">
          <RailItem {...home} />
          {showExperiments && <RailItem {...experiments} />}
        </div>
        <div className="flex-1" />
        {/* Inbox is grouped with Settings at the bottom, per the redesign (Figma 152:4567). */}
        <div className="flex flex-col items-center gap-1 mb-2">
          <RailItem {...inbox} />
          <RailItem {...settings} />
        </div>
      </nav>

      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 flex items-stretch border-t bg-card/95 backdrop-blur-xl safe-bottom">
        {[home, ...(showExperiments ? [experiments] : []), inbox, settings].map(
          (destination) => (
            <BottomBarItem key={destination.label} {...destination} />
          ),
        )}
      </nav>
    </>
  );
}

function RailItem({ label, icon: Icon, active, badge, navigate }: Destination) {
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
          className="absolute -top-1.5 -right-1.5 min-w-[16px] h-[16px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center border-0"
        >
          {badge > 9 ? "9+" : badge}
        </Badge>
      )}
    </span>
  );
}
