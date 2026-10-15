import {
  Activity,
  Box,
  Branch,
  type CarbonIconType,
  Folders,
  Globe,
} from "@carbon/icons-react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import type { SidePanelTab } from "../lib/side-panel.js";

const TABS: readonly {
  tab: SidePanelTab;
  label: string;
  icon: CarbonIconType;
}[] = [
  { tab: "files", label: "Files", icon: Folders },
  { tab: "changes", label: "Changes", icon: Branch },
  { tab: "artifacts", label: "Artifacts", icon: Box },
  { tab: "browser", label: "Browser", icon: Globe },
  { tab: "processes", label: "Processes", icon: Activity },
];

// A count on a tab's icon, such as the processes running now; `label` names
// the tab with its count for screen readers and the tooltip.
export interface SidePanelBadge {
  count: number;
  label: string;
}

export function SidePanelBar({
  active,
  hidden,
  onSelect,
  badges = {},
  footer,
  className,
}: {
  active: SidePanelTab | null;
  hidden: ReadonlySet<SidePanelTab>;
  onSelect: (tab: SidePanelTab) => void;
  badges?: Partial<Record<SidePanelTab, SidePanelBadge>>;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <nav
      aria-label="Side panel"
      data-testid="side-panel-bar"
      className={cn(
        "flex w-11 shrink-0 flex-col items-center gap-1 border-l border-border bg-background py-2",
        className,
      )}
    >
      {TABS.filter(({ tab }) => !hidden.has(tab)).map(
        ({ tab, label, icon: Icon }) => {
          const badge = badges[tab];
          const shown = badge && badge.count > 0 ? badge : null;
          return (
            <Tooltip key={tab} content={shown?.label ?? label} side="left">
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
                <Icon size={16} />
                {shown && (
                  <Badge
                    data-testid={`side-panel-badge-${tab}`}
                    className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full border-0 bg-accent px-1 text-[10px] font-bold text-white hover:bg-accent"
                  >
                    {shown.count > 9 ? "9+" : shown.count}
                  </Badge>
                )}
              </Button>
            </Tooltip>
          );
        },
      )}
      {footer && <div className="mt-auto">{footer}</div>}
    </nav>
  );
}
