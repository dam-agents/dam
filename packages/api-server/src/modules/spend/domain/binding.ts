import type {
  SpendBinding,
  SpendBindingCandidate,
  SpendBindingKind,
  SpendCeilingView,
  SpendLimitView,
} from "api-server-api";
import type { SpendUnit } from "./units.js";

export interface GrantedConnection {
  readonly connectionId: string;
  readonly name: string;
  readonly unit: SpendUnit;
}

const NARROWNESS: readonly SpendBindingKind[] = [
  "connection",
  "agent",
  "owner-connection",
  "owner",
  "ceiling",
];

function candidateOf(limit: SpendLimitView): SpendBindingCandidate {
  return {
    kind: limit.scope.kind,
    limitId: limit.id,
    leftMicros: limit.leftMicros,
  };
}

function ceilingCandidate(ceiling: SpendCeilingView): SpendBindingCandidate {
  return {
    kind: "ceiling",
    limitId: null,
    leftMicros: Math.max(0, ceiling.amountMicros - ceiling.spentMicros),
  };
}

function bindingFrom(
  connection: { id: string; name: string } | null,
  unit: SpendUnit,
  candidates: readonly SpendBindingCandidate[],
): SpendBinding | null {
  const ranked = [...candidates].sort(
    (a, b) =>
      a.leftMicros - b.leftMicros ||
      NARROWNESS.indexOf(a.kind) - NARROWNESS.indexOf(b.kind),
  );
  const [stopsFirst, ...others] = ranked;
  if (!stopsFirst) return null;
  return {
    connectionId: connection?.id ?? null,
    connectionName: connection?.name ?? null,
    unit,
    leftMicros: stopsFirst.leftMicros,
    stopsFirst,
    others,
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: for one agent, which limit stops its calls first,
 * per Connection it holds and for its dollar spend across Connections: the
 * limit with the least left today among those that count those calls. A
 * dollar Connection is counted by its own limits, the agent limit, the own
 * limit and the ceiling; a subscription or Bob Connection only by its own
 * limits, because the others count dollars alone. No limit, no row.
 */
export function bindingOf(input: {
  agentId: string;
  limits: readonly SpendLimitView[];
  ceiling: SpendCeilingView | null;
  connections: readonly GrantedConnection[];
}): SpendBinding[] {
  const { agentId, limits, ceiling, connections } = input;
  const dollarWide: SpendBindingCandidate[] = [
    ...limits
      .filter(
        (limit) =>
          (limit.scope.kind === "agent" && limit.scope.agentId === agentId) ||
          limit.scope.kind === "owner",
      )
      .map(candidateOf),
    ...(ceiling ? [ceilingCandidate(ceiling)] : []),
  ];
  const perConnection = connections.flatMap(({ connectionId, name, unit }) => {
    if (unit === "free") return [];
    const own = limits
      .filter(
        (limit) =>
          limit.unit === unit &&
          ((limit.scope.kind === "connection" &&
            limit.scope.agentId === agentId &&
            limit.scope.connectionId === connectionId) ||
            (limit.scope.kind === "owner-connection" &&
              limit.scope.connectionId === connectionId)),
      )
      .map(candidateOf);
    const binding = bindingFrom(
      { id: connectionId, name },
      unit,
      unit === "usd" ? [...own, ...dollarWide] : own,
    );
    return binding ? [binding] : [];
  });
  const acrossConnections = bindingFrom(null, "usd", dollarWide);
  return acrossConnections
    ? [...perConnection, acrossConnections]
    : perConnection;
}
