import type { ToolMode } from "api-server-api";
import { useMemo } from "react";
import { match } from "ts-pattern";

import type { AgentView } from "../../../types.js";
import { useAppConnections } from "../../connections/api/queries.js";
import { useToolApprovalOffered } from "../../connections/hooks/use-tool-approval-offered.js";
import {
  accessSummary,
  type AccessTone,
} from "../../connections/lib/grant-tool-access.js";
import { shownToolMode } from "../../connections/lib/tool-mode.js";
import { excludeProviderConnections } from "../../sandboxes/lib/provider-connections.js";
import { useSatellites } from "../../satellites/api/queries.js";
import { useAgentConnections } from "../api/queries.js";

export type ToolReach = "reads" | "asks" | "writes";

export interface SharedToolAccess {
  name: string;
  reach: ToolReach;
}

function reachOfMode(mode: ToolMode): ToolReach {
  return match(mode)
    .with("read-only", () => "reads" as const)
    .with("needs-approval", () => "asks" as const)
    .with("allow-all", () => "writes" as const)
    .exhaustive();
}

function reachOfTone(tone: AccessTone): ToolReach {
  return match(tone)
    .with("quiet", () => "reads" as const)
    .with("asks", () => "asks" as const)
    .with("writes", () => "writes" as const)
    .exhaustive();
}

// UNIT_BOUNDARY_DESCRIPTION: the Agent's MCP connections that say what their tools let it do, with how far each reaches, so a sharing warning can say what the people it is shared with can do through them. While the `mcp-tool-approval` feature is off it reads each connection's mode, as a Slack Account names it; with the feature on it reads this Agent's own grant of each connection. Null while the connections load.
export function useAgentToolAccess(
  agent: AgentView | null,
): readonly SharedToolAccess[] | null {
  const connections = useAppConnections({ enabled: agent !== null }).data;
  const toolApproval = useToolApprovalOffered();
  const grants = useAgentConnections(
    toolApproval && agent ? agent.id : null,
  ).data;
  return useMemo(() => {
    if (!agent || !connections) return null;
    if (toolApproval) {
      if (!grants) return null;
      const byId = new Map(connections.map((c) => [c.id, c]));
      return grants.connections.flatMap(({ connectionId, toolAccess }) => {
        const connection = byId.get(connectionId);
        if (!connection || !toolAccess) return [];
        const tools = connection.toolAccess?.tools ?? null;
        const { tone } = accessSummary(toolAccess, tools);
        return [{ name: connection.name, reach: reachOfTone(tone) }];
      });
    }
    const granted = new Set(agent.grantedConnectionIds);
    return connections.flatMap((c) => {
      const mode = granted.has(c.id) ? shownToolMode(c, false) : null;
      return mode ? [{ name: c.name, reach: reachOfMode(mode) }] : [];
    });
  }, [agent, connections, grants, toolApproval]);
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
