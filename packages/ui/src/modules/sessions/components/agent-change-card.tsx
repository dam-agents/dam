import { Button } from "@/components/ui/button";

import { useStore } from "../../../store.js";
import type { AgentChange } from "../lib/agent-change.js";
import { SIDE_PANEL_TABS } from "./side-panel-bar.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the one-click way from the Agent's tool call to
 * the item it made, in the side panel tab that holds it. It opens the tab the
 * change belongs to and points the panel at the item's id, so the panel shows
 * the new schedule rather than the top of a list.
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
      aria-label={`Open ${change.kind} ${change.name}`}
      className="h-auto w-full justify-start gap-2 py-2 text-left font-normal"
      onClick={() => {
        setSidePanelFocus({ tab: change.tab, id: change.id });
        setSidePanelTab(change.tab);
      }}
    >
      {Icon && <Icon size={16} className="shrink-0" aria-hidden />}
      <span className="min-w-0 flex-1 truncate">{title}</span>
      <span className="shrink-0 text-xs text-muted-foreground">Open</span>
    </Button>
  );
}
