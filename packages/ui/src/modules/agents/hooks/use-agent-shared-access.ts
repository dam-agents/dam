import type { ToolMode } from "api-server-api";
import { useMemo } from "react";

import type { AgentView } from "../../../types.js";
import { useAppConnections } from "../../connections/api/queries.js";
import { useToolApprovalOffered } from "../../connections/hooks/use-tool-approval-offered.js";
import { shownToolMode } from "../../connections/lib/tool-mode.js";
import { excludeProviderConnections } from "../../sandboxes/lib/provider-connections.js";
import { useSatellites } from "../../satellites/api/queries.js";

export interface SharedToolMode {
  name: string;
  mode: ToolMode;
}

// UNIT_BOUNDARY_DESCRIPTION: the Agent's connections whose rows name a tool mode, such as a Slack Account, with the mode of each, so a sharing warning can say what the people it is shared with can do through them. Null while the connections load.
export function useAgentToolModes(
  agent: AgentView | null,
): readonly SharedToolMode[] | null {
  const connections = useAppConnections({ enabled: agent !== null }).data;
  const toolApproval = useToolApprovalOffered();
  return useMemo(() => {
    if (!agent || !connections) return null;
    const granted = new Set(agent.grantedConnectionIds);
    return connections.flatMap((c) => {
      const mode = granted.has(c.id) ? shownToolMode(c, toolApproval) : null;
      return mode ? [{ name: c.name, mode }] : [];
    });
  }, [agent, connections, toolApproval]);
}

export function useAgentSharedAccess(
  agent: AgentView | null,
): readonly string[] | null {
  const connections = useAppConnections({ enabled: agent !== null }).data;
  const satellites = useSatellites().data;
  return useMemo(() => {
    if (!agent || !connections || !satellites) return null;
    const granted = new Set(agent.grantedConnectionIds);
    return [
      ...excludeProviderConnections(
        connections.filter((c) => granted.has(c.id)),
      ).map((c) => c.name),
      ...satellites
        .filter((s) => s.grantedAgentIds.includes(agent.id))
        .map((s) => s.name),
    ];
  }, [agent, connections, satellites]);
}
