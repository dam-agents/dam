import { useMemo } from "react";

import type { AgentView } from "../../../types.js";
import { useAppConnections } from "../../connections/api/queries.js";
import {
  type ConnectionAccess,
  connectionAccess,
} from "../../connections/lib/access-choice.js";
import { excludeProviderConnections } from "../../sandboxes/lib/provider-connections.js";
import { useSatellites } from "../../satellites/api/queries.js";

export interface SharedAccessChoice {
  name: string;
  access: ConnectionAccess;
}

// UNIT_BOUNDARY_DESCRIPTION: the Agent's connections that are read only or have full access, such as a Slack Account, with the mode of each, so a sharing warning can say what the people it is shared with can do through them. Null while the connections load.
export function useAgentAccessChoices(
  agent: AgentView | null,
): readonly SharedAccessChoice[] | null {
  const connections = useAppConnections({ enabled: agent !== null }).data;
  return useMemo(() => {
    if (!agent || !connections) return null;
    const granted = new Set(agent.grantedConnectionIds);
    return connections.flatMap((c) => {
      const access = granted.has(c.id) ? connectionAccess(c) : null;
      return access ? [{ name: c.name, access }] : [];
    });
  }, [agent, connections]);
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
