import type { SpendUnit } from "./units.js";

export interface CallAmounts {
  readonly costMicros: number;
  readonly uncachedInputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWrite5mTokens: number;
  readonly cacheWrite1hTokens: number;
  readonly webSearches: number;
  readonly calls: number;
  readonly estimatedCalls: number;
}

export const AMOUNT_FIELDS = [
  "costMicros",
  "uncachedInputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWrite5mTokens",
  "cacheWrite1hTokens",
  "webSearches",
  "calls",
  "estimatedCalls",
] as const satisfies readonly (keyof CallAmounts)[];

export interface SpendRow {
  readonly day: string;
  readonly payer: string;
  readonly ownerSub: string;
  readonly connectionId: string;
  readonly model: string;
  readonly provider: string;
  readonly unit: SpendUnit;
}

export type DayCounter =
  | {
      readonly scope: "agent";
      readonly day: string;
      readonly agentId: string;
      readonly unit: SpendUnit;
    }
  | {
      readonly scope: "owner";
      readonly day: string;
      readonly ownerSub: string;
      readonly unit: SpendUnit;
    }
  | {
      readonly scope: "connection";
      readonly day: string;
      readonly agentId: string;
      readonly connectionId: string;
    };

export const UNKNOWN_CONNECTION = "unknown";
export const UNKNOWN_MODEL = "unknown";

export function mapAmounts(
  value: (field: keyof CallAmounts) => number,
): CallAmounts {
  return {
    costMicros: value("costMicros"),
    uncachedInputTokens: value("uncachedInputTokens"),
    outputTokens: value("outputTokens"),
    cacheReadTokens: value("cacheReadTokens"),
    cacheWrite5mTokens: value("cacheWrite5mTokens"),
    cacheWrite1hTokens: value("cacheWrite1hTokens"),
    webSearches: value("webSearches"),
    calls: value("calls"),
    estimatedCalls: value("estimatedCalls"),
  };
}

export function amountsDelta(
  next: CallAmounts,
  previous: CallAmounts,
): CallAmounts {
  return mapAmounts((field) => next[field] - previous[field]);
}

export function isZero(amounts: CallAmounts): boolean {
  return AMOUNT_FIELDS.every((field) => amounts[field] === 0);
}

export function dayCountersOf(row: SpendRow): readonly DayCounter[] {
  return [
    { scope: "agent", day: row.day, agentId: row.payer, unit: row.unit },
    { scope: "owner", day: row.day, ownerSub: row.ownerSub, unit: row.unit },
    {
      scope: "connection",
      day: row.day,
      agentId: row.payer,
      connectionId: row.connectionId,
    },
  ];
}

export function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

export function daysBefore(day: string, days: number): string {
  const at = new Date(`${day}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() - days);
  return utcDay(at);
}
