import {
  Activity,
  Book,
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
import { RAIL_BADGE, railIndicator, railTile } from "@/components/ui/rail-tile";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { DOCS_URL } from "../../../constants.js";
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
        {rail ? (
          <button
            type="button"
            aria-label={shown?.label ?? label}
            aria-pressed={active === tab}
            data-testid={`side-panel-tab-${tab}`}
            className={railTile(active === tab)}
            onClick={() => onSelect(tab)}
          >
            <span
              aria-hidden
              className={railIndicator("right", active === tab)}
            />
            {icons[tab] ?? <Icon size={20} />}
            {shown && (
              <span
                data-testid={`side-panel-badge-${tab}`}
                className={cn(
                  RAIL_BADGE,
                  shown.tone === "warning" ? "bg-warning" : "bg-accent",
                )}
              >
                {shown.count > 9 ? "9+" : shown.count}
              </span>
            )}
          </button>
        ) : (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={shown?.label ?? label}
            aria-pressed={active === tab}
            data-testid={`side-panel-tab-${tab}`}
            className={cn(
              "relative text-muted-foreground",
              active === tab && "bg-muted text-foreground",
            )}
            onClick={() => onSelect(tab)}
          >
            {icons[tab] ?? <Icon size={16} />}
            {shown && (
              <Badge
                data-testid={`side-panel-badge-${tab}`}
                className={cn(
                  "absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full border-0 px-1 text-[10px] font-bold text-white",
                  shown.tone === "warning"
                    ? "bg-warning hover:bg-warning"
                    : "bg-accent hover:bg-accent",
                )}
              >
                {shown.count > 9 ? "9+" : shown.count}
              </Badge>
            )}
          </Button>
        )}
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
        "flex w-[60px] shrink-0 flex-col items-center gap-2 border-l border-border bg-chrome py-3",
        className,
      )}
    >
      <SidePanelTabButtons
        tabs={SIDE_PANEL_TABS.filter(
          ({ tab }) => !APP_TABS.has(tab) && !hidden.has(tab),
        )}
        {...props}
      />
      <div className="mt-auto flex flex-col items-center gap-2">
        <SidePanelTabButtons
          tabs={appSidePanelTabs(hidden).filter((t) => t.tab !== "approvals")}
          {...props}
        />
        <DocsLink />
        <SidePanelTabButtons
          tabs={appSidePanelTabs(hidden).filter((t) => t.tab === "approvals")}
          {...props}
        />
      </div>
    </nav>
  );
}

function DocsLink() {
  return (
    <Tooltip content="Documentation" side="left">
      <a
        href={DOCS_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Documentation"
        data-testid="side-panel-docs"
        className={railTile(false)}
      >
        <span aria-hidden className={railIndicator("right", false)} />
        <Book size={20} />
      </a>
    </Tooltip>
  );
}
