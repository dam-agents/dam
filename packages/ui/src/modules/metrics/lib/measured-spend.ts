import {
  MICROS_PER_UNIT,
  type SpendAmount,
  type SpendBreakdown,
  type SpendByAgent,
  type SpendByDay,
  type SpendBySessionType,
  type SpendCategory,
  type TokenSpendByModel,
} from "api-server-api";

const paidUsd = (row: SpendAmount): number =>
  row.unit === "usd" ? row.costMicros / MICROS_PER_UNIT : 0;

const legacyCategory = (
  category: SpendBreakdown["bySessionType"][number]["category"],
): SpendCategory =>
  category === "subagents" || category === "none" ? "unknown" : category;

function fold<R extends SpendAmount, T extends { costUsd: number }>(
  rows: readonly R[],
  keyOf: (row: R) => string,
  start: (row: R) => T,
  add: (into: T, row: R) => void = () => {},
): T[] {
  const entries = new Map<string, T>();
  for (const row of rows) {
    const key = keyOf(row);
    const entry = entries.get(key) ?? start(row);
    entries.set(key, entry);
    entry.costUsd += paidUsd(row);
    add(entry, row);
  }
  return [...entries.values()].sort((a, b) => b.costUsd - a.costUsd);
}

// UNIT_BOUNDARY_DESCRIPTION: the 0.2.23 spend screens summed the cost each harness reported about itself, which the Model Router no longer carries, so they read the gateway's measured spend (`spend.breakdown`) in their old shape. A dollar is a paid API call (unit `usd`), as the release's own screens count it: calls a subscription covers and Bobcoins add calls and tokens but no dollars. The days are UTC days, and only calls since the measuring start count.
export function legacySpendBreakdown(measured: SpendBreakdown): {
  byModel: TokenSpendByModel[];
  byAgent: SpendByAgent[];
  byDay: SpendByDay[];
  bySessionType: SpendBySessionType[];
  modelTimeMs: number;
} {
  return {
    byModel: fold(
      measured.byModel,
      (row) => row.model,
      (row) => ({
        model: row.model,
        calls: 0,
        uncountedCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        costUsd: 0,
        durationMs: 0,
      }),
      (into, row) => {
        into.calls += row.calls;
        into.inputTokens += row.uncachedInputTokens;
        into.outputTokens += row.outputTokens;
        into.cacheReadTokens += row.cacheReadTokens;
        into.cacheCreationTokens +=
          row.cacheWrite5mTokens + row.cacheWrite1hTokens;
      },
    ),
    byAgent: fold(
      measured.byAgent,
      (row) => row.agentId,
      (row) => ({
        agentId: row.agentId,
        agentName: row.agentName ?? row.agentId,
        costUsd: 0,
      }),
    ),
    byDay: fold(
      measured.byDay,
      (row) => row.day,
      (row) => ({ day: row.day, costUsd: 0 }),
    ),
    bySessionType: fold(
      measured.bySessionType,
      (row) => legacyCategory(row.category),
      (row) => ({ category: legacyCategory(row.category), costUsd: 0 }),
    ),
    modelTimeMs: measured.modelTimeMs,
  };
}
