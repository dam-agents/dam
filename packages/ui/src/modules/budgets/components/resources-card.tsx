import { useState } from "react";

import { Tabs } from "@/components/ui/tabs";

import {
  browserStorage,
  safeGetItem,
  safeSetItem,
} from "../../../lib/safe-storage.js";
import type { AgentView } from "../../../types.js";
import {
  RESOURCES_VIEW_KEY,
  type ResourcesView,
  resourcesView,
} from "../lib/resources-view.js";
import { ComputeUsage } from "./compute-usage.js";
import { PoolUsage } from "./pool-usage.js";
import { RequestMoreLink } from "./request-more-link.js";

const TITLES: Record<ResourcesView, string> = {
  vm: "VM agents",
  container: "Container agents",
};

const PANEL_ID = "home-resources-panel";

interface Props {
  agents: readonly AgentView[];
  workingAgentIds: ReadonlySet<string>;
}

export function ResourcesCard({ agents, workingAgentIds }: Props) {
  const [remembered, setRemembered] = useState(() =>
    safeGetItem(browserStorage, RESOURCES_VIEW_KEY),
  );
  const { view, switchable } = resourcesView(agents, remembered);
  const choose = (next: ResourcesView) => {
    setRemembered(next);
    safeSetItem(browserStorage, RESOURCES_VIEW_KEY, next);
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 text-sm">
        {switchable ? (
          <Tabs
            tabs={(["vm", "container"] as const).map((value) => ({
              value,
              label: TITLES[value],
              panelId: `${PANEL_ID}-${value}`,
            }))}
            value={view}
            onValueChange={choose}
            variant="pill"
            size="sm"
            ariaLabel="Resources by kind of agent"
            className="whitespace-nowrap"
          />
        ) : (
          <span className="text-foreground">{TITLES[view]}</span>
        )}
        <RequestMoreLink />
      </div>
      <div
        id={`${PANEL_ID}-${view}`}
        role={switchable ? "tabpanel" : undefined}
        aria-labelledby={switchable ? `${PANEL_ID}-${view}-tab` : undefined}
      >
        {view === "vm" ? (
          <PoolUsage agents={agents} />
        ) : (
          <ComputeUsage agents={agents} workingAgentIds={workingAgentIds} />
        )}
      </div>
    </div>
  );
}
