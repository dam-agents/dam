import { useAgent, useAgentConnections } from "../api/queries.js";
import { ownerName } from "../lib/agent-permissions.js";
import {
  actingConnectionNames,
  type OwnerConnectionsLine,
  ownerConnectionsLine,
} from "../lib/owner-connections.js";

export function useOwnerConnectionsLine(
  agentId: string | null,
): OwnerConnectionsLine | null {
  const agent = useAgent(agentId);
  const editor = agent?.access.role === "editor";
  const { data } = useAgentConnections(editor ? agentId : null);
  if (!agent || !editor || !data) return null;
  return ownerConnectionsLine(
    ownerName(agent.access),
    actingConnectionNames(
      data.connections.flatMap((c) => (c.connection ? [c.connection] : [])),
    ),
  );
}
