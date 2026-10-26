import { createContext } from "react";

import { Button } from "@/components/ui/button";

import { useStore } from "../../../store.js";
import type { AgentChange } from "../lib/agent-change.js";
import { SIDE_PANEL_TABS } from "./side-panel-bar.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: whether a transcript shows what an Agent changed
 * on itself. The chat sets it from the experiment's flag, and a delegation
 * transcript sets it false, because the changes in it belong to the sub-agent
 * and no tab of the driver's panel holds them.
 */
export const AgentChangeCards = createContext(false);

/**
 * UNIT_BOUNDARY_DESCRIPTION: the one-click way from the Agent's tool call to
 * the side panel tab that holds the item it made. A schedule is also focused:
 * the panel expands it, opening its Past group when it sits there.
 */
export function AgentChangeCard({ change }: { change: AgentChange }) {
  const setSidePanelTab = useStore((s) => s.setSidePanelTab);
  const setSidePanelFocus = useStore((s) => s.setSidePanelFocus);
  const Icon = SIDE_PANEL_TABS.find(({ tab }) => tab === change.tab)?.icon;
  const title = `${change.verb === "created" ? "Created" : "Changed"} ${change.kind} “${change.name}”`;
  return (
    <Button
      variant="outline"
      size="sm"
      data-testid="agent-change-card"
      className="h-auto w-full justify-start gap-2 py-2 text-left font-normal"
      onClick={() => {
        setSidePanelFocus(
          change.tab === "automations"
            ? { tab: change.tab, id: change.id }
            : null,
        );
        setSidePanelTab(change.tab);
      }}
    >
      {Icon && <Icon size={16} className="shrink-0" aria-hidden />}
      <span className="min-w-0 flex-1 truncate">{title}</span>
      <span className="shrink-0 text-xs text-muted-foreground">Open</span>
    </Button>
  );
}
