import type {
  SpendAmount,
  SpendSessionRow,
  SpendSessions,
} from "api-server-api";
import { UNIT_RANK } from "./units.js";

export interface SessionLedgerRow extends SpendAmount {
  readonly callingAgentId: string;
  readonly sessionId: string;
  readonly calls: number;
  readonly durationMs: number;
  readonly uncachedInputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWrite5mTokens: number;
  readonly cacheWrite1hTokens: number;
  readonly firstDay: string;
  readonly lastDay: string;
  readonly firstAt?: string;
  readonly lastAt?: string;
}

const earlier = (a: string | undefined, b: string | undefined) =>
  a === undefined || (b !== undefined && b < a) ? b : a;
const later = (a: string | undefined, b: string | undefined) =>
  a === undefined || (b !== undefined && b > a) ? b : a;

const COUNT_FIELDS = [
  "calls",
  "durationMs",
  "uncachedInputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWrite5mTokens",
  "cacheWrite1hTokens",
] as const satisfies readonly (keyof SpendSessionRow &
  keyof SessionLedgerRow)[];

function addAmount(into: SpendAmount[], row: SpendAmount): void {
  const entry = into.find((amount) => amount.unit === row.unit);
  if (entry) entry.costMicros += row.costMicros;
  else into.push({ unit: row.unit, costMicros: row.costMicros });
}

const byUnit = (a: SpendAmount, b: SpendAmount) =>
  UNIT_RANK.indexOf(a.unit) - UNIT_RANK.indexOf(b.unit);

/**
 * UNIT_BOUNDARY_DESCRIPTION: each Session of an agent with the calls the agent
 * made in it, plus the calls of the sub-agents spawned from it, which also
 * show apart. A sub-agent whose spawn recorded no Session adds to none. The
 * newest Sessions come first.
 */
export function foldSessions(input: {
  own: readonly SessionLedgerRow[];
  subAgents: readonly SessionLedgerRow[];
  spawnSessions: ReadonlyMap<string, string | null>;
  sessionIds?: readonly string[];
  limit: number;
}): SpendSessions {
  const wanted = input.sessionIds ? new Set(input.sessionIds) : null;
  const sessions = new Map<string, SpendSessionRow>();
  const add = (
    sessionId: string,
    row: SessionLedgerRow,
    bySubAgent: boolean,
  ) => {
    if (wanted && !wanted.has(sessionId)) return;
    let entry = sessions.get(sessionId);
    if (!entry) {
      entry = {
        sessionId,
        amounts: [],
        subAgentAmounts: [],
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
      sessions.set(sessionId, entry);
    }
    addAmount(entry.amounts, row);
    if (bySubAgent) addAmount(entry.subAgentAmounts, row);
    for (const field of COUNT_FIELDS) entry[field] += row[field];
    if (row.firstDay < entry.firstDay) entry.firstDay = row.firstDay;
    if (row.lastDay > entry.lastDay) entry.lastDay = row.lastDay;
    const firstAt = earlier(entry.firstAt, row.firstAt);
    const lastAt = later(entry.lastAt, row.lastAt);
    if (firstAt !== undefined) entry.firstAt = firstAt;
    if (lastAt !== undefined) entry.lastAt = lastAt;
  };
  for (const row of input.own) add(row.sessionId, row, false);
  for (const row of input.subAgents) {
    const sessionId = input.spawnSessions.get(row.callingAgentId);
    if (sessionId) add(sessionId, row, true);
  }
  const total = (row: SpendSessionRow) =>
    row.amounts.reduce((sum, amount) => sum + amount.costMicros, 0);
  const rows = [...sessions.values()]
    .map((row) => ({
      ...row,
      amounts: row.amounts.sort(byUnit),
      subAgentAmounts: row.subAgentAmounts.sort(byUnit),
    }))
    .sort(
      (a, b) =>
        b.lastDay.localeCompare(a.lastDay) ||
        total(b) - total(a) ||
        a.sessionId.localeCompare(b.sessionId),
    );
  return {
    rows: rows.slice(0, input.limit),
    truncated: rows.length > input.limit,
  };
}
