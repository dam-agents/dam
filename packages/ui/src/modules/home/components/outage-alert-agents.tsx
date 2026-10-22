import type { OutageAlertAgent } from "api-server-api";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import type { AgentView } from "../../../types.js";
import { OutageAlertAgentRow } from "./outage-alert-agent-row.js";

const SHOWN_AGENTS = 5;

interface Props {
  agents: readonly OutageAlertAgent[];
  agentOf: (agentId: string) => AgentView | undefined;
  switchable: boolean;
}

export function OutageAlertAgents({ agents, agentOf, switchable }: Props) {
  const [showAll, setShowAll] = useState(false);
  const rows = agents
    .map((agent) => {
      const live = agentOf(agent.agentId);
      return { agent, name: live?.name ?? agent.name, avatar: live?.avatar };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const shown = showAll ? rows : rows.slice(0, SHOWN_AGENTS);

  return (
    <div className="mt-3 rounded-md border border-border/50 bg-muted/40 px-2.5 py-1.5">
      <ul className="flex flex-col gap-1.5">
        {shown.map((row) => (
          <OutageAlertAgentRow
            key={row.agent.agentId}
            agent={row.agent}
            name={row.name}
            avatar={row.avatar}
            switchable={switchable}
          />
        ))}
      </ul>
      {rows.length > SHOWN_AGENTS && (
        <Button
          variant="link"
          size="inline"
          onClick={() => setShowAll((all) => !all)}
          className="mt-1.5 text-sm"
        >
          {showAll ? "Show less" : `Show all ${rows.length} agents`}
        </Button>
      )}
    </div>
  );
}
