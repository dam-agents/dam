import {
  Activity,
  Box,
  Branch,
  type CarbonIconType,
  Folders,
  Globe,
} from "@carbon/icons-react";

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

export function SidePanelBar({
  active,
  hidden,
  onSelect,
  className,
}: {
  active: SidePanelTab | null;
  hidden: ReadonlySet<SidePanelTab>;
  onSelect: (tab: SidePanelTab) => void;
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
        ({ tab, label, icon: Icon }) => (
          <Tooltip key={tab} content={label} side="left">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={label}
              aria-pressed={active === tab}
              data-testid={`side-panel-tab-${tab}`}
              className={cn(
                "text-muted-foreground",
                active === tab && "bg-muted text-foreground",
              )}
              onClick={() => onSelect(tab)}
            >
              <Icon size={16} />
            </Button>
          </Tooltip>
        ),
      )}
    </nav>
  );
}
