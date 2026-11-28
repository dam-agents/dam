import type { AgentView } from "../../../types.js";
import {
  type DamHold,
  isDamConnection,
} from "../../connections/lib/dam-connection.js";
import { useAgentConnections } from "../api/queries.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: whether an Agent holds the Connection that drives
 * this install, read from the Agent's own grants rather than from the viewer's
 * library — an editor looking at someone else's Agent must not read their own
 * Connections and call the Agent safe. A grant whose Connection has not arrived,
 * or a read that failed, is `unknown`, which every warning treats as held. A
 * grant with the Agent's own scope reaches the platform with the Agent's own
 * key, not the owner's, so it does not count as holding it.
 */
export function useHoldsDamConnection(agent: AgentView | null): DamHold {
  const { data } = useAgentConnections(agent?.id ?? null);
  if (!agent || !data) return "unknown";
  const known = data.connections.filter((c) => c.connection !== undefined);
  if (known.length < data.connections.length) return "unknown";
  return known.some(
    (c) =>
      c.connection && isDamConnection(c.connection) && c.scope === undefined,
  )
    ? "held"
    : "not-held";
}
