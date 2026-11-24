import type {
  SessionCategory,
  SpendAmount,
  SpendAwaiting,
  SpendBreakdown,
  SpendCounts,
} from "api-server-api";
import { UNIT_RANK } from "./units.js";

export interface BreakdownRow extends SpendAmount, SpendCounts, SpendAwaiting {
  readonly day: string;
  readonly payer: string;
  readonly connectionId: string;
  readonly providerTemplate: string;
  readonly model: string;
  readonly sessionId: string;
  readonly callingAgentId: string;
  readonly durationMs: number;
}

type Entry<K extends keyof SpendBreakdown> =
  SpendBreakdown[K] extends readonly (infer E)[] ? E : never;

type SessionType = Entry<"bySessionType">["category"];

type CallingAgentEntry = Entry<"byCallingAgent">;

const SUB_AGENTS_SHOWN = 5;

const callerOf = (row: BreakdownRow) => row.callingAgentId || row.payer;

type Counts = SpendCounts & SpendAwaiting;

const COUNT_FIELDS = [
  "calls",
  "estimatedCalls",
  "awaitingCalls",
  "uncachedInputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWrite5mTokens",
  "cacheWrite1hTokens",
  "webSearches",
] as const satisfies readonly (keyof Counts)[];

function zeroCounts(): Counts {
  return {
    calls: 0,
    estimatedCalls: 0,
    awaitingCalls: 0,
    uncachedInputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWrite5mTokens: 0,
    cacheWrite1hTokens: 0,
    webSearches: 0,
  };
}

function addCounts(into: Counts, row: Counts): void {
  for (const field of COUNT_FIELDS) into[field] += row[field];
}

function addCalls(
  into: SpendAwaiting & { calls: number },
  row: BreakdownRow,
): void {
  into.calls += row.calls;
  into.awaitingCalls += row.awaitingCalls;
}

function group<T extends SpendAmount>(
  rows: readonly BreakdownRow[],
  keyOf: (row: BreakdownRow) => string,
  start: (row: BreakdownRow) => T,
  add: (into: T, row: BreakdownRow) => void,
): T[] {
  const groups = new Map<string, T>();
  for (const row of rows) {
    const key = `${keyOf(row)}\u0000${row.unit}`;
    let entry = groups.get(key);
    if (!entry) {
      entry = start(row);
      groups.set(key, entry);
    }
    entry.costMicros += row.costMicros;
    add(entry, row);
  }
  return [...groups.values()];
}

function byUnitThenCost<T extends SpendAmount>(
  label: (entry: T) => string,
): (a: T, b: T) => number {
  return (a, b) =>
    UNIT_RANK.indexOf(a.unit) - UNIT_RANK.indexOf(b.unit) ||
    b.costMicros - a.costMicros ||
    label(a).localeCompare(label(b));
}

export interface AgentLabels {
  names: ReadonlyMap<string, string>;
  tasks: ReadonlyMap<string, string>;
}

function callingAgentEntries(
  rows: readonly BreakdownRow[],
): CallingAgentEntry[] {
  return group<CallingAgentEntry>(
    rows,
    callerOf,
    (row) => ({
      agentId: callerOf(row),
      agentName: null,
      agentTask: null,
      unit: row.unit,
      costMicros: 0,
      calls: 0,
      awaitingCalls: 0,
    }),
    addCalls,
  );
}

function rankSubAgents(rows: readonly BreakdownRow[]): string[] {
  const totals = new Map<
    string,
    { dollars: number; bobcoins: number; calls: number }
  >();
  for (const row of rows) {
    const agentId = callerOf(row);
    if (agentId === row.payer) continue;
    const total = totals.get(agentId) ?? { dollars: 0, bobcoins: 0, calls: 0 };
    if (row.unit === "usd" || row.unit === "usd_list")
      total.dollars += row.costMicros;
    if (row.unit === "bobcoin") total.bobcoins += row.costMicros;
    total.calls += row.calls;
    totals.set(agentId, total);
  }
  return [...totals]
    .sort(
      ([aId, a], [bId, b]) =>
        b.dollars - a.dollars ||
        b.bobcoins - a.bobcoins ||
        b.calls - a.calls ||
        aId.localeCompare(bId),
    )
    .map(([agentId]) => agentId);
}

function inRankOrder(
  entries: CallingAgentEntry[],
  ranked: readonly string[],
): CallingAgentEntry[] {
  const rank = new Map(ranked.map((agentId, index) => [agentId, index]));
  return entries.sort(
    (a, b) =>
      (rank.get(a.agentId) ?? -1) - (rank.get(b.agentId) ?? -1) ||
      UNIT_RANK.indexOf(a.unit) - UNIT_RANK.indexOf(b.unit),
  );
}

export function topSubAgents(
  rows: readonly BreakdownRow[],
  limit: number,
): { count: number; rows: CallingAgentEntry[] } {
  const ranked = rankSubAgents(rows);
  const top = ranked.slice(0, limit);
  const kept = new Set(top);
  return {
    count: ranked.length,
    rows: inRankOrder(
      callingAgentEntries(rows.filter((row) => kept.has(callerOf(row)))),
      top,
    ),
  };
}

function capSubAgents(rows: readonly BreakdownRow[]): {
  byCallingAgent: CallingAgentEntry[];
  otherSubAgents: SpendBreakdown["otherSubAgents"];
} {
  const ranked = rankSubAgents(rows);
  const shown = ranked.slice(0, SUB_AGENTS_SHOWN);
  const left = new Set(ranked.slice(SUB_AGENTS_SHOWN));
  return {
    byCallingAgent: inRankOrder(
      callingAgentEntries(rows.filter((row) => !left.has(callerOf(row)))),
      shown,
    ),
    otherSubAgents: {
      count: left.size,
      amounts: group<SpendBreakdown["otherSubAgents"]["amounts"][number]>(
        rows.filter((row) => left.has(callerOf(row))),
        () => "",
        (row) => ({
          unit: row.unit,
          costMicros: 0,
          calls: 0,
          awaitingCalls: 0,
        }),
        addCalls,
      ).sort(byUnitThenCost(() => "")),
    },
  };
}

export function labelAgents(
  breakdown: SpendBreakdown,
  labels: AgentLabels,
): SpendBreakdown {
  return {
    ...breakdown,
    byAgent: breakdown.byAgent.map((entry) => ({
      ...entry,
      agentName: labels.names.get(entry.agentId) ?? null,
    })),
    byCallingAgent: labelCallingAgents(breakdown.byCallingAgent, labels),
  };
}

export function labelCallingAgents(
  entries: readonly CallingAgentEntry[],
  labels: AgentLabels,
): CallingAgentEntry[] {
  return entries.map((entry) => ({
    ...entry,
    agentName: labels.names.get(entry.agentId) ?? null,
    agentTask: labels.tasks.get(entry.agentId) ?? null,
  }));
}

export function agentIdsOf(entries: readonly { agentId: string }[]): string[] {
  return [...new Set(entries.map((entry) => entry.agentId))];
}

export function agentNames(sources: {
  subAgentNames: ReadonlyMap<string, string>;
  liveNames: ReadonlyMap<string, string>;
  lastKnownNames: ReadonlyMap<string, string>;
}): ReadonlyMap<string, string> {
  return new Map([
    ...sources.lastKnownNames,
    ...sources.liveNames,
    ...sources.subAgentNames,
  ]);
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the scope is what the rows are: every agent of
 * the owner, the calls one agent pays for, or the calls one agent made (a
 * sub-agent's own page). A call whose calling agent is not its payer is a
 * sub-agent's, except in the caller scope, where every row is that agent's.
 * Other calls take their Session's kind; a call with no Session, or one the
 * directory does not know, has none. A row from before the calling agent was
 * recorded counts for its payer. In the driver's scope, the calling agents keep
 * the driver and the five sub-agents with the most dollars (paid plus
 * subscription value), then Bobcoins, then calls, and the rest is summed; the
 * longer list of sub-agents uses the same order, so it continues the five.
 */
export function foldBreakdown(input: {
  from: string;
  to: string;
  rows: readonly BreakdownRow[];
  connectionNames: ReadonlyMap<string, string>;
  sessionCategories: ReadonlyMap<string, SessionCategory>;
  scope: "owner" | "payer" | "caller";
}): SpendBreakdown {
  const { rows } = input;
  const sessionTypeOf = (row: BreakdownRow): SessionType =>
    input.scope !== "caller" && callerOf(row) !== row.payer
      ? "subagents"
      : (input.sessionCategories.get(row.sessionId) ?? "none");

  const totals = group<Entry<"totals">>(
    rows,
    () => "",
    (row) => ({ unit: row.unit, costMicros: 0, ...zeroCounts() }),
    addCounts,
  ).sort(byUnitThenCost(() => ""));

  const byDay = group<Entry<"byDay">>(
    rows,
    (row) => row.day,
    (row) => ({ day: row.day, unit: row.unit, costMicros: 0 }),
    () => {},
  ).sort(
    (a, b) =>
      a.day.localeCompare(b.day) ||
      UNIT_RANK.indexOf(a.unit) - UNIT_RANK.indexOf(b.unit),
  );

  const byAgent = group<Entry<"byAgent">>(
    rows,
    (row) => row.payer,
    (row) => ({
      agentId: row.payer,
      agentName: null,
      unit: row.unit,
      costMicros: 0,
      calls: 0,
      awaitingCalls: 0,
    }),
    addCalls,
  ).sort(byUnitThenCost((entry) => entry.agentId));

  const byModel = group<Entry<"byModel">>(
    rows,
    (row) => row.model,
    (row) => ({
      model: row.model,
      unit: row.unit,
      costMicros: 0,
      ...zeroCounts(),
    }),
    addCounts,
  ).sort(byUnitThenCost((entry) => entry.model));

  const byConnection = group<Entry<"byConnection">>(
    rows,
    (row) => `${row.connectionId}\u0000${row.providerTemplate}`,
    (row) => ({
      connectionId: row.connectionId,
      providerTemplate: row.providerTemplate,
      connectionName: input.connectionNames.get(row.connectionId) ?? null,
      unit: row.unit,
      costMicros: 0,
      ...zeroCounts(),
    }),
    addCounts,
  ).sort(byUnitThenCost((entry) => entry.connectionId));

  return {
    from: input.from,
    to: input.to,
    totals,
    byDay,
    byAgent,
    byModel,
    byConnection,
    modelTimeMs: rows.reduce((sum, row) => sum + row.durationMs, 0),
    bySessionType: group<Entry<"bySessionType">>(
      rows,
      sessionTypeOf,
      (row) => ({
        category: sessionTypeOf(row),
        unit: row.unit,
        costMicros: 0,
        awaitingCalls: 0,
      }),
      (into, row) => {
        into.awaitingCalls += row.awaitingCalls;
      },
    ).sort(byUnitThenCost((entry) => entry.category)),
    ...(input.scope === "payer"
      ? capSubAgents(rows)
      : {
          byCallingAgent:
            input.scope === "owner"
              ? []
              : callingAgentEntries(rows).sort(
                  byUnitThenCost((entry) => entry.agentId),
                ),
          otherSubAgents: { count: 0, amounts: [] },
        }),
  };
}
