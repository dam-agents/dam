import type { AgentView } from "../../../types.js";
import { useAppConnections } from "../../connections/api/queries.js";
import { isDamConnection } from "../../connections/lib/dam-connection.js";

export function useHoldsDamConnection(agent: AgentView | null): boolean {
  const connections = useAppConnections({ enabled: agent !== null }).data;
  if (!agent || !connections) return false;
  const granted = new Set(agent.grantedConnectionIds);
  return connections.some((c) => granted.has(c.id) && isDamConnection(c));
}
