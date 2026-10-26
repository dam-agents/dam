import {
  AiLabel,
  Automatic,
  Branch,
  type CarbonIconType,
  Cloud,
  DocumentAttachment,
  Folder,
  Gears,
  Notification,
  Task,
  ToolsAlt,
  WifiController,
  Wikis,
} from "@carbon/icons-react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FOCUS_RING } from "@/components/ui/focus-ring";
import {
  ACTIVE_ITEM,
  RAIL_BADGE,
  RAIL_COLUMN,
  RAIL_GAP,
  RAIL_GLYPH,
  SQUIRCLE,
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
  { tab: "environments", label: "Environments", icon: Cloud },
  { tab: "models", label: "Models", icon: AiLabel },
  { tab: "services", label: "Services", icon: WifiController },
  { tab: "skills", label: "Skills", icon: ToolsAlt },
  { tab: "automations", label: "Automations", icon: Automatic },
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
          className={cn(
            "group flex w-full flex-col items-center gap-1 rounded-lg text-muted-foreground hover:text-foreground",
            FOCUS_RING,
            active === tab && "text-foreground",
          )}
          onClick={() => onSelect(tab)}
        >
          <span
            className={cn(
              "relative flex size-9 items-center justify-center rounded-lg transition-colors",
              SQUIRCLE,
              active === tab ? ACTIVE_ITEM : "group-hover:bg-muted/60",
            )}
          >
            {icons[tab] ?? <TileIcon size={RAIL_GLYPH} />}
            {shown && (
              <span
                data-testid={`side-panel-badge-${tab}`}
                className={cn(
                  RAIL_BADGE,
                  "-top-1 -right-1.5",
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
          </span>
          <span className="w-full text-center text-[10px] leading-tight font-medium break-words">
            {label}
          </span>
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
    // UNIT_BOUNDARY_DESCRIPTION: an icon names its panel in a tooltip; a tile prints its name under the glyph, so its tooltip is hidden while it would only repeat the label, and every tile keeps the same wrapper so a badge appearing does not remount the focused button.
    return (
      <Tooltip
        key={tab}
        content={content}
        side={rail ? "left" : "bottom"}
        className={rail && tiles && content === label ? "hidden" : undefined}
      >
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
              "w-[68px] min-h-0 shrink-0 overflow-y-auto border-l border-border bg-chrome px-1",
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
          tiles && cn("w-full items-center", RAIL_GAP),
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
