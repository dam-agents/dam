import type {
  SpendAmount,
  SpendBreakdown,
  SpendCounts,
  SpendUnit,
} from "api-server-api";

export interface BreakdownRow extends SpendAmount, SpendCounts {
  readonly day: string;
  readonly payer: string;
  readonly connectionId: string;
  readonly providerTemplate: string;
  readonly model: string;
}

type Entry<K extends keyof SpendBreakdown> =
  SpendBreakdown[K] extends readonly (infer E)[] ? E : never;

const UNIT_ORDER: readonly SpendUnit[] = ["usd", "usd_list", "bobcoin", "free"];

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

function zeroCounts(): SpendCounts {
  return {
    calls: 0,
    estimatedCalls: 0,
    uncachedInputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWrite5mTokens: 0,
    cacheWrite1hTokens: 0,
    webSearches: 0,
  };
}

function addCounts(into: SpendCounts, row: SpendCounts): void {
  for (const field of COUNT_FIELDS) into[field] += row[field];
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
    UNIT_ORDER.indexOf(a.unit) - UNIT_ORDER.indexOf(b.unit) ||
    b.costMicros - a.costMicros ||
    label(a).localeCompare(label(b));
}

export function foldBreakdown(input: {
  from: string;
  to: string;
  rows: readonly BreakdownRow[];
  connectionNames: ReadonlyMap<string, string>;
}): SpendBreakdown {
  const { rows } = input;

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
      UNIT_ORDER.indexOf(a.unit) - UNIT_ORDER.indexOf(b.unit),
  );

  const byAgent = group<Entry<"byAgent">>(
    rows,
    (row) => row.payer,
    (row) => ({ agentId: row.payer, unit: row.unit, costMicros: 0, calls: 0 }),
    (into, row) => {
      into.calls += row.calls;
    },
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
    modelTimeMs: 0,
    bySessionType: [],
    byCallingAgent: [],
  };
}
