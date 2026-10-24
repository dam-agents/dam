import {
  Branch,
  type CarbonIconType,
  ChatOperational,
  Cloud,
  DataStructured,
  DocumentAttachment,
  EventSchedule,
  Folder,
  Gears,
  KeyValues,
  LogoSlack,
  MachineLearningModel,
  Model,
  Network_2,
  Notification,
  PricingQuickProposal,
  Task,
  Wikis,
} from "@carbon/icons-react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  RAIL_BADGE,
  RAIL_COLUMN,
  RAIL_GAP,
  RAIL_GLYPH,
  railTile,
} from "@/components/ui/rail-tile";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { ArtifactIcon } from "../../artifacts/lib/artifact-icon.js";
import type { SidePanelTab } from "../lib/side-panel.js";

// UNIT_BOUNDARY_DESCRIPTION: the tiled rail is the Unified right toolbar's own surface, so its Artifacts tile draws the document icon whatever shell the page has; every other button that opens the panel, and every artifact link and list, keeps the layout's own icon.
export const SIDE_PANEL_TABS: readonly {
  tab: SidePanelTab;
  label: string;
  icon: CarbonIconType;
  tileIcon?: CarbonIconType;
}[] = [
  {
    tab: "artifacts",
    label: "Artifacts",
    icon: ArtifactIcon,
    tileIcon: DocumentAttachment,
  },
  { tab: "files", label: "Files", icon: Folder },
  { tab: "changes", label: "Changes", icon: Branch },
  { tab: "browser", label: "Browser", icon: Wikis },
  { tab: "processes", label: "Processes", icon: Gears },
  { tab: "agent", label: "Spending", icon: PricingQuickProposal },
  { tab: "environments", label: "Environments", icon: Cloud },
  { tab: "connections", label: "Connections", icon: DataStructured },
  { tab: "channels", label: "Channels", icon: LogoSlack },
  { tab: "skills", label: "Skills", icon: MachineLearningModel },
  { tab: "schedules", label: "Schedules", icon: EventSchedule },
  { tab: "providers", label: "Providers", icon: Model },
  { tab: "network", label: "Network access", icon: Network_2 },
  { tab: "environment", label: "Environment variables", icon: KeyValues },
  { tab: "chat-forms", label: "Chat forms", icon: ChatOperational },
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
  tone?: "warning" | "neutral";
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
  tiles = false,
}: SidePanelTabProps & {
  tabs: readonly (typeof SIDE_PANEL_TABS)[number][];
  placement?: "rail" | "top-bar";
  tiles?: boolean;
}) {
  const rail = placement === "rail";
  return tabs.map(({ tab, label, icon: Icon, tileIcon }) => {
    const TileIcon = tileIcon ?? Icon;
    const badge = badges[tab];
    const shown = badge && badge.count > 0 ? badge : null;
    const content = shown?.label ?? label;
    const control =
      rail && tiles ? (
        <button
          type="button"
          aria-label={shown?.label ?? label}
          aria-pressed={active === tab}
          data-testid={`side-panel-tab-${tab}`}
          className={railTile(active === tab)}
          onClick={() => onSelect(tab)}
        >
          {icons[tab] ?? <TileIcon size={RAIL_GLYPH} />}
          {shown && (
            <span
              data-testid={`side-panel-badge-${tab}`}
              className={cn(
                RAIL_BADGE,
                shown.tone === "warning"
                  ? "bg-warning"
                  : shown.tone === "neutral"
                    ? "bg-muted-foreground"
                    : "bg-accent",
              )}
            >
              {shown.count > 9 ? "9+" : shown.count}
            </span>
          )}
        </button>
      ) : (
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
                  ? "top-2 right-[3px] h-[18px] min-w-[18px] px-1 text-[11px]"
                  : "-top-1 -right-1 h-4 min-w-4 px-1 text-[10px]",
                shown.tone === "warning"
                  ? "bg-warning hover:bg-warning"
                  : shown.tone === "neutral"
                    ? "bg-muted-foreground hover:bg-muted-foreground"
                    : "bg-accent hover:bg-accent",
              )}
            >
              {shown.count > 9 ? "9+" : shown.count}
            </Badge>
          )}
        </Button>
      );
    // UNIT_BOUNDARY_DESCRIPTION: every icon in the bar names its panel in a tooltip, the tiled rail's too, since a tile's glyph alone does not say which panel it opens.
    return (
      <Tooltip key={tab} content={content} side={rail ? "left" : "bottom"}>
        {control}
      </Tooltip>
    );
  });
}

export function appSidePanelTabs(
  hidden: ReadonlySet<SidePanelTab>,
  withArtifacts = false,
) {
  return SIDE_PANEL_TABS.filter(
    ({ tab }) =>
      (APP_TABS.has(tab) || (withArtifacts && tab === "artifacts")) &&
      !hidden.has(tab),
  );
}

export function SidePanelBar({
  hidden,
  className,
  tiles = false,
  ...props
}: SidePanelTabProps & {
  hidden: ReadonlySet<SidePanelTab>;
  className?: string;
  tiles?: boolean;
}) {
  const appTabs = appSidePanelTabs(hidden);
  return (
    <nav
      aria-label="Side panel"
      data-testid="side-panel-bar"
      className={cn(
        tiles
          ? cn(
              "w-14 min-h-0 shrink-0 overflow-y-auto border-l border-border bg-chrome",
              RAIL_COLUMN,
            )
          : "box-content flex w-12 shrink-0 flex-col border-l border-border bg-background py-1",
        className,
      )}
    >
      <SidePanelTabButtons
        tabs={SIDE_PANEL_TABS.filter(
          ({ tab }) => !APP_TABS.has(tab) && !hidden.has(tab),
        )}
        tiles={tiles}
        {...props}
      />
      <div
        className={cn(
          "mt-auto flex flex-col",
          tiles && cn("items-center", RAIL_GAP),
        )}
      >
        {tiles ? (
          <>
            <SidePanelTabButtons
              tabs={appTabs.filter((t) => t.tab !== "approvals")}
              tiles
              {...props}
            />
            <SidePanelTabButtons
              tabs={appTabs.filter((t) => t.tab === "approvals")}
              tiles
              {...props}
            />
          </>
        ) : (
          <SidePanelTabButtons tabs={appTabs} {...props} />
        )}
      </div>
    </nav>
  );
}
