import { useMemo } from "react";

import type { AgentView } from "../../../types.js";
import { useAppConnections } from "../../connections/api/queries.js";
import { excludeProviderConnections } from "../../sandboxes/lib/provider-connections.js";
import { useSatellites } from "../../satellites/api/queries.js";

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
