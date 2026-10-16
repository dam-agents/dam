import type {
  AgentSpend,
  SpendAmount,
  SpendCounts,
  SubAgentSpendRow,
} from "api-server-api";
import { UNIT_RANK } from "./units.js";

export interface AgentLedgerRow extends SpendAmount, SpendCounts {
  readonly callingAgentId: string;
  readonly sessionId: string;
  readonly model: string;
  readonly durationMs: number;
  readonly firstDay: string;
  readonly lastDay: string;
}

const COUNT_FIELDS = [
  "calls",
  "estimatedCalls",
  "uncachedInputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWrite5mTokens",
  "cacheWrite1hTokens",
  "webSearches",
] as const satisfies readonly (keyof SpendCounts)[];

function counted<T extends SpendAmount & SpendCounts>(
  rows: readonly AgentLedgerRow[],
  keyOf: (row: AgentLedgerRow) => string,
  start: (row: AgentLedgerRow) => T,
): T[] {
  const groups = new Map<string, T>();
  for (const row of rows) {
    const key = `${keyOf(row)}\u0000${row.unit}`;
    const entry = groups.get(key) ?? start(row);
    groups.set(key, entry);
    entry.costMicros += row.costMicros;
    for (const field of COUNT_FIELDS) entry[field] += row[field];
  }
  return [...groups.values()].sort(
    (a, b) =>
      UNIT_RANK.indexOf(a.unit) - UNIT_RANK.indexOf(b.unit) ||
      b.costMicros - a.costMicros,
  );
}

const zeroCounts = (): SpendCounts => ({
  calls: 0,
  estimatedCalls: 0,
  uncachedInputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWrite5mTokens: 0,
  cacheWrite1hTokens: 0,
  webSearches: 0,
});

export function foldAgentTotals(
  rows: readonly AgentLedgerRow[],
): Pick<AgentSpend, "totals" | "byModel" | "modelTimeMs"> {
  return {
    totals: counted(
      rows,
      () => "",
      (row) => ({ unit: row.unit, costMicros: 0, ...zeroCounts() }),
    ),
    byModel: counted(
      rows,
      (row) => row.model,
      (row) => ({
        model: row.model,
        unit: row.unit,
        costMicros: 0,
        ...zeroCounts(),
      }),
    ),
    modelTimeMs: rows.reduce((sum, row) => sum + row.durationMs, 0),
  };
}

export function countSessions(
  rows: readonly AgentLedgerRow[],
  agentId: string,
): number {
  return new Set(
    rows
      .filter((row) => row.callingAgentId === agentId && row.sessionId)
      .map((row) => row.sessionId),
  ).size;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: one row per sub-agent with the calls it made
 * itself, keyed by its own agent id, so a sub-agent it spawned has a row of
 * its own. The newest come first.
 */
export function foldSubAgents(
  rows: readonly AgentLedgerRow[],
  limit: number,
): { rows: SubAgentSpendRow[]; truncated: boolean } {
  const byAgent = new Map<string, SubAgentSpendRow>();
  for (const row of rows) {
    const entry = byAgent.get(row.callingAgentId) ?? {
      agentId: row.callingAgentId,
      models: [],
      amounts: [],
      calls: 0,
      durationMs: 0,
      uncachedInputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: 0,
      firstDay: row.firstDay,
      lastDay: row.lastDay,
    };
    byAgent.set(row.callingAgentId, entry);
    if (!entry.models.includes(row.model)) entry.models.push(row.model);
    const amount = entry.amounts.find((a) => a.unit === row.unit);
    if (amount) amount.costMicros += row.costMicros;
    else entry.amounts.push({ unit: row.unit, costMicros: row.costMicros });
    entry.calls += row.calls;
    entry.durationMs += row.durationMs;
    entry.uncachedInputTokens += row.uncachedInputTokens;
    entry.outputTokens += row.outputTokens;
    entry.cacheReadTokens += row.cacheReadTokens;
    entry.cacheWrite5mTokens += row.cacheWrite5mTokens;
    entry.cacheWrite1hTokens += row.cacheWrite1hTokens;
    if (row.firstDay < entry.firstDay) entry.firstDay = row.firstDay;
    if (row.lastDay > entry.lastDay) entry.lastDay = row.lastDay;
  }
  const total = (row: SubAgentSpendRow) =>
    row.amounts.reduce((sum, a) => sum + a.costMicros, 0);
  const sorted = [...byAgent.values()].sort(
    (a, b) =>
      b.lastDay.localeCompare(a.lastDay) ||
      total(b) - total(a) ||
      a.agentId.localeCompare(b.agentId),
  );
  return { rows: sorted.slice(0, limit), truncated: sorted.length > limit };
}
