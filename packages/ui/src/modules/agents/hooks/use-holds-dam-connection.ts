import type { AgentView } from "../../../types.js";
import { useAppConnections } from "../../connections/api/queries.js";
import {
  type DamHold,
  isDamConnection,
} from "../../connections/lib/dam-connection.js";

export function useHoldsDamConnection(agent: AgentView | null): DamHold {
  const { data } = useAppConnections({ enabled: agent !== null });
  if (!agent || !data) return "unknown";
  const granted = new Set(agent.grantedConnectionIds);
  return data.some((c) => granted.has(c.id) && isDamConnection(c))
    ? "held"
    : "not-held";
}
