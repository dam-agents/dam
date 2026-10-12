import { useMemo } from "react";

import type { AgentView } from "../../../types.js";
import { useAppConnections } from "../../connections/api/queries.js";
import { excludeProviderConnections } from "../../sandboxes/lib/provider-connections.js";

const NONE: readonly string[] = [];

export function useAgentConnectionNames(
  agent: AgentView | null,
): readonly string[] {
  const { data: connections } = useAppConnections({ enabled: agent !== null });
  return useMemo(() => {
    if (!agent) return NONE;
    const granted = new Set(agent.grantedConnectionIds);
    return excludeProviderConnections(
      (connections ?? []).filter((c) => granted.has(c.id)),
    ).map((c) => c.name);
  }, [agent, connections]);
}
