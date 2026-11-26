import type {
  SpendCeilingView,
  SpendLimitView,
  SpendStoppedAgent,
  SpendStoppedLimit,
} from "api-server-api";

import { NARROWNESS } from "./binding.js";
import type { SpendUnit } from "./units.js";

export interface DayRefusal {
  readonly payerAgentId: string;
  readonly connectionId: string;
  readonly sessionId: string;
  readonly unit: SpendUnit;
}

interface Reached extends SpendStoppedLimit {
  readonly rank: number;
}

function fromLimit(
  limit: SpendLimitView,
  names: ReadonlyMap<string, string>,
): Reached {
  const connectionId =
    limit.scope.kind === "connection" || limit.scope.kind === "owner-connection"
      ? limit.scope.connectionId
      : null;
  return {
    kind: limit.scope.kind,
    limitId: limit.id,
    connectionId,
    connectionName: connectionId ? (names.get(connectionId) ?? null) : null,
    unit: limit.unit,
    amountMicros: limit.amountMicros,
    leftMicros: limit.leftMicros,
    rank: NARROWNESS.indexOf(limit.scope.kind),
  };
}

function fromCeiling(ceiling: SpendCeilingView): Reached {
  return {
    kind: "ceiling",
    limitId: null,
    connectionId: null,
    connectionName: null,
    unit: "usd",
    amountMicros: ceiling.amountMicros,
    leftMicros: Math.max(0, ceiling.amountMicros - ceiling.spentMicros),
    rank: NARROWNESS.indexOf("ceiling"),
  };
}

function counts(
  limit: SpendLimitView,
  agentId: string,
  refusal: DayRefusal,
): boolean {
  const { scope } = limit;
  switch (scope.kind) {
    case "connection":
      return (
        scope.agentId === agentId &&
        scope.connectionId === refusal.connectionId &&
        limit.unit === refusal.unit
      );
    case "owner-connection":
      return (
        scope.connectionId === refusal.connectionId &&
        limit.unit === refusal.unit
      );
    case "agent":
      return scope.agentId === agentId && refusal.unit === "usd";
    case "owner":
      return refusal.unit === "usd";
  }
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: whether a limit has stopped one agent today: a
 * call of its sessions was refused today, and a limit that counts that call
 * is still reached. A limit the owner raised, removed or continued past no
 * longer stops it. The limit named is the reached one with the least left,
 * then the one set closest to the agent, as for the binding limit.
 */
export function stoppedAgent(input: {
  agentId: string;
  refusals: readonly DayRefusal[];
  limits: readonly SpendLimitView[];
  ceiling: SpendCeilingView | null;
  connectionNames: ReadonlyMap<string, string>;
}): SpendStoppedAgent | null {
  const { agentId, refusals, limits, ceiling, connectionNames } = input;
  const reached: Reached[] = [];
  for (const refusal of refusals) {
    for (const limit of limits) {
      if (limit.state === "reached" && counts(limit, agentId, refusal))
        reached.push(fromLimit(limit, connectionNames));
    }
    if (ceiling?.state === "reached" && refusal.unit === "usd")
      reached.push(fromCeiling(ceiling));
  }
  const [first] = reached.sort(
    (a, b) => a.leftMicros - b.leftMicros || a.rank - b.rank,
  );
  if (!first) return null;
  const { rank: _rank, ...limit } = first;
  return {
    agentId,
    sessionIds: [...new Set(refusals.map((r) => r.sessionId).filter(Boolean))],
    limit,
  };
}
