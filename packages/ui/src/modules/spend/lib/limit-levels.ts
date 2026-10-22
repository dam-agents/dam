import type {
  SpendCeilingView,
  SpendLimitState,
  SpendLimitView,
  SpendStatus,
  SpendUnit,
} from "api-server-api";

import { percentOfLimit } from "./copy.js";

export type LevelKind =
  "agent-connection" | "all-connection" | "agent" | "total" | "ceiling";

export interface LevelConnection {
  id: string;
  name: string;
  templateId: string;
}

export interface Level {
  key: string;
  kind: LevelKind;
  connection: LevelConnection | null;
  unit: SpendUnit;
  amountMicros: number;
  extensions: number;
  effectiveMicros: number;
  spentMicros: number;
  leftMicros: number;
  state: SpendLimitState;
  mineMicros: number | null;
  stopsFirst: boolean;
}

export type LevelGroup = "provider" | "every";

export interface GroupedLevel {
  level: Level;
  group: LevelGroup;
}

function fromLimit(
  limit: SpendLimitView,
  kind: LevelKind,
  connection: LevelConnection | null,
  mineMicros: number | null,
): Level {
  return {
    key: limit.id,
    kind,
    connection,
    unit: limit.unit,
    amountMicros: limit.amountMicros,
    extensions: limit.extensions,
    effectiveMicros: limit.effectiveMicros,
    spentMicros: limit.spentMicros,
    leftMicros: limit.leftMicros,
    state: limit.state,
    mineMicros,
    stopsFirst: false,
  };
}

function fromCeiling(
  ceiling: SpendCeilingView,
  mineMicros: number | null,
): Level {
  return {
    key: "ceiling",
    kind: "ceiling",
    connection: null,
    unit: "usd",
    amountMicros: ceiling.amountMicros,
    extensions: 0,
    effectiveMicros: ceiling.amountMicros,
    spentMicros: ceiling.spentMicros,
    leftMicros: Math.max(0, ceiling.amountMicros - ceiling.spentMicros),
    state: ceiling.state,
    mineMicros,
    stopsFirst: false,
  };
}

function spentOn(
  totals: SpendStatus["spentByConnection"],
  connectionId: string,
  unit: SpendUnit,
): number {
  return totals
    .filter(
      (total) => total.connectionId === connectionId && total.unit === unit,
    )
    .reduce((sum, total) => sum + total.costMicros, 0);
}

function paidSpend(status: SpendStatus): number {
  return status.spent.find((total) => total.unit === "usd")?.costMicros ?? 0;
}

function findLimit(
  status: SpendStatus,
  match: (limit: SpendLimitView) => boolean,
): SpendLimitView | undefined {
  return status.limits.find(match);
}

const NARROWNESS: readonly LevelKind[] = [
  "agent-connection",
  "agent",
  "all-connection",
  "total",
  "ceiling",
];

function markStopsFirst(current: Level | null, others: Level[]): Level[] {
  const all = current ? [current, ...others] : others;
  if (all.length < 2) return others;
  const first = all.reduce((best, next) =>
    next.leftMicros < best.leftMicros ||
    (next.leftMicros === best.leftMicros &&
      NARROWNESS.indexOf(next.kind) < NARROWNESS.indexOf(best.kind))
      ? next
      : best,
  );
  return others.map((level) =>
    level === first ? { ...level, stopsFirst: true } : level,
  );
}

export interface LevelsView {
  current: Level | null;
  others: GroupedLevel[];
}

/** UNIT_BOUNDARY_DESCRIPTION: the total daily limit, as Settings › Usage owns it; only the ceiling also counts its calls. */
export function totalLevels(status: SpendStatus): LevelsView {
  const owner = findLimit(status, (limit) => limit.scope.kind === "owner");
  const current = owner ? fromLimit(owner, "total", null, null) : null;
  const ceiling = status.ceiling ? [fromCeiling(status.ceiling, null)] : [];
  return {
    current,
    others: markStopsFirst(current, ceiling).map((level) => ({
      level,
      group: "every" as const,
    })),
  };
}

/** UNIT_BOUNDARY_DESCRIPTION: an owner's limit for all agents on one Connection, as Settings › Providers owns it. A dollar Connection is also counted by the total and the ceiling; a subscription or Bob one by nothing else. */
export function allAgentsConnectionLevels(
  status: SpendStatus,
  connection: LevelConnection,
  unit: SpendUnit,
): LevelsView {
  const limit = findLimit(
    status,
    (view) =>
      view.scope.kind === "owner-connection" &&
      view.scope.connectionId === connection.id,
  );
  const current = limit
    ? fromLimit(limit, "all-connection", connection, null)
    : null;
  const above: Level[] = [];
  if (unit === "usd") {
    const owner = findLimit(status, (view) => view.scope.kind === "owner");
    if (owner) above.push(fromLimit(owner, "total", null, null));
    if (status.ceiling) above.push(fromCeiling(status.ceiling, null));
  }
  return {
    current,
    others: markStopsFirst(current, above).map((level) => ({
      level,
      group: "every" as const,
    })),
  };
}

/** UNIT_BOUNDARY_DESCRIPTION: one agent's limit on one Connection, as the agent's Providers section owns it, and every other limit that counts the same calls. */
export function agentConnectionLevels(
  status: SpendStatus,
  agentId: string,
  connection: LevelConnection,
  unit: SpendUnit,
): LevelsView {
  const mineHere = spentOn(status.spentByConnection, connection.id, unit);
  const own = findLimit(
    status,
    (view) =>
      view.scope.kind === "connection" &&
      view.scope.agentId === agentId &&
      view.scope.connectionId === connection.id,
  );
  const current = own
    ? fromLimit(own, "agent-connection", connection, null)
    : null;
  const above: GroupedLevel[] = [];
  const all = findLimit(
    status,
    (view) =>
      view.scope.kind === "owner-connection" &&
      view.scope.connectionId === connection.id,
  );
  if (all) {
    above.push({
      level: fromLimit(all, "all-connection", connection, mineHere),
      group: "provider",
    });
  }
  if (unit === "usd") {
    const mineAll = paidSpend(status);
    const agent = findLimit(
      status,
      (view) => view.scope.kind === "agent" && view.scope.agentId === agentId,
    );
    if (agent)
      above.push({
        level: fromLimit(agent, "agent", null, null),
        group: "every",
      });
    const owner = findLimit(status, (view) => view.scope.kind === "owner");
    if (owner)
      above.push({
        level: fromLimit(owner, "total", null, mineAll),
        group: "every",
      });
    if (status.ceiling)
      above.push({
        level: fromCeiling(status.ceiling, mineAll),
        group: "every",
      });
  }
  return { current, others: regroup(current, above) };
}

/** UNIT_BOUNDARY_DESCRIPTION: one agent's limit across providers, as the agent's Usage section owns it; each provider's limits count part of its calls, and the total and the ceiling count them all. */
export function agentLevels(
  status: SpendStatus,
  agentId: string,
  connections: readonly (LevelConnection & { unit: SpendUnit })[],
): LevelsView {
  const agent = findLimit(
    status,
    (view) => view.scope.kind === "agent" && view.scope.agentId === agentId,
  );
  const current = agent ? fromLimit(agent, "agent", null, null) : null;
  const others: GroupedLevel[] = [];
  for (const connection of connections) {
    const mineHere = spentOn(
      status.spentByConnection,
      connection.id,
      connection.unit,
    );
    const own = findLimit(
      status,
      (view) =>
        view.scope.kind === "connection" &&
        view.scope.agentId === agentId &&
        view.scope.connectionId === connection.id,
    );
    if (own) {
      others.push({
        level: fromLimit(own, "agent-connection", connection, null),
        group: "provider",
      });
    }
    const all = findLimit(
      status,
      (view) =>
        view.scope.kind === "owner-connection" &&
        view.scope.connectionId === connection.id,
    );
    if (all) {
      others.push({
        level: fromLimit(all, "all-connection", connection, mineHere),
        group: "provider",
      });
    }
  }
  const mineAll = paidSpend(status);
  const owner = findLimit(status, (view) => view.scope.kind === "owner");
  if (owner)
    others.push({
      level: fromLimit(owner, "total", null, mineAll),
      group: "every",
    });
  if (status.ceiling)
    others.push({
      level: fromCeiling(status.ceiling, mineAll),
      group: "every",
    });
  const dollars = others.filter(({ group }) => group === "every");
  const marked = markStopsFirst(
    current,
    dollars.map(({ level }) => level),
  );
  return {
    current,
    others: others.map((entry) => {
      const index = dollars.indexOf(entry);
      return index === -1 ? entry : { ...entry, level: marked[index]! };
    }),
  };
}

function regroup(current: Level | null, above: GroupedLevel[]): GroupedLevel[] {
  const marked = markStopsFirst(
    current,
    above.map(({ level }) => level),
  );
  return above.map((entry, index) => ({ ...entry, level: marked[index]! }));
}

export function levelPercent(level: Level): number {
  return percentOfLimit(level.spentMicros, level.effectiveMicros);
}
