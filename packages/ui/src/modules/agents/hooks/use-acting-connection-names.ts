import { useAgentConnections } from "../api/queries.js";
import { actingConnectionNames } from "../lib/owner-connections.js";

export function useActingConnectionNames(
  agentId: string | null,
): string[] | null {
  const { data } = useAgentConnections(agentId);
  if (!data) return null;
  return actingConnectionNames(
    data.connections.flatMap((c) => (c.connection ? [c.connection] : [])),
  );
}
