import {
  Activity,
  Branch,
  type CarbonIconType,
  Folders,
  Globe,
  Notification,
  Task,
} from "@carbon/icons-react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { ArtifactIcon } from "../../artifacts/lib/artifact-icon.js";
import type { SidePanelTab } from "../lib/side-panel.js";

export const SIDE_PANEL_TABS: readonly {
  tab: SidePanelTab;
  label: string;
  icon: CarbonIconType;
}[] = [
  { tab: "artifacts", label: "Artifacts", icon: ArtifactIcon },
  { tab: "files", label: "Files", icon: Folders },
  { tab: "changes", label: "Changes", icon: Branch },
  { tab: "browser", label: "Browser", icon: Globe },
  { tab: "processes", label: "Processes", icon: Activity },
  { tab: "getting-started", label: "Get started", icon: Task },
  { tab: "approvals", label: "Approvals", icon: Notification },
];

const APP_TABS: ReadonlySet<SidePanelTab> = new Set([
  "getting-started",
  "approvals",
]);

export interface SidePanelBadge {
  count: number;
  label: string;
  tone?: "warning";
}

export interface SidePanelTabProps {
  active: SidePanelTab | null;
  onSelect: (tab: SidePanelTab) => void;
  badges?: Partial<Record<SidePanelTab, SidePanelBadge>>;
  icons?: Partial<Record<SidePanelTab, ReactNode>>;
}

export function SidePanelTabButtons({
  tabs,
  active,
  onSelect,
  badges = {},
  icons = {},
  placement = "rail",
}: SidePanelTabProps & {
  tabs: readonly (typeof SIDE_PANEL_TABS)[number][];
  placement?: "rail" | "top-bar";
}) {
  const rail = placement === "rail";
  return tabs.map(({ tab, label, icon: Icon }) => {
    const badge = badges[tab];
    const shown = badge && badge.count > 0 ? badge : null;
    return (
      <Tooltip
        key={tab}
        content={shown?.label ?? label}
        side={rail ? "left" : "bottom"}
      >
        <Button
          variant="ghost"
          size={rail ? "icon" : "icon-sm"}
          aria-label={shown?.label ?? label}
          aria-pressed={active === tab}
          data-testid={`side-panel-tab-${tab}`}
          className={cn(
            "relative text-muted-foreground",
            rail
              ? "h-12 w-12 rounded-none hover:bg-transparent focus-visible:ring-inset focus-visible:ring-offset-0"
              : cn("[&_svg]:size-4", active === tab && "bg-muted"),
            active === tab && "text-foreground",
            rail &&
              active === tab &&
              "before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-foreground",
          )}
          onClick={() => onSelect(tab)}
        >
          {icons[tab] ?? <Icon size={rail ? 24 : 16} />}
          {shown && (
            <Badge
              data-testid={`side-panel-badge-${tab}`}
              className={cn(
                "absolute flex items-center justify-center rounded-full border-0 font-bold text-white",
                rail
                  ? "top-2 right-1.5 h-[18px] min-w-[18px] px-1 text-[11px]"
                  : "-top-1 -right-1 h-4 min-w-4 px-1 text-[10px]",
                shown.tone === "warning"
                  ? "bg-warning hover:bg-warning"
                  : "bg-accent hover:bg-accent",
              )}
            >
              {shown.count > 9 ? "9+" : shown.count}
            </Badge>
          )}
        </Button>
      </Tooltip>
    );
  });
}

export function appSidePanelTabs(hidden: ReadonlySet<SidePanelTab>) {
  return SIDE_PANEL_TABS.filter(
    ({ tab }) => APP_TABS.has(tab) && !hidden.has(tab),
  );
}

export function SidePanelBar({
  hidden,
  className,
  ...props
}: SidePanelTabProps & {
  hidden: ReadonlySet<SidePanelTab>;
  className?: string;
}) {
  return (
    <nav
      aria-label="Side panel"
      data-testid="side-panel-bar"
      className={cn(
        "box-content flex w-12 shrink-0 flex-col border-l border-border bg-background py-1",
        className,
      )}
    >
      <SidePanelTabButtons
        tabs={SIDE_PANEL_TABS.filter(
          ({ tab }) => !APP_TABS.has(tab) && !hidden.has(tab),
        )}
        {...props}
      />
      <div className="mt-auto flex flex-col">
        <SidePanelTabButtons tabs={appSidePanelTabs(hidden)} {...props} />
      </div>
    </nav>
  );
}
