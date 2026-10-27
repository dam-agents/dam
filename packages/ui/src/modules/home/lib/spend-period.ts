export type SpendPeriod = "1d" | "1w" | "1m" | "1y";

export const SPEND_PERIODS: readonly SpendPeriod[] = ["1d", "1w", "1m", "1y"];

const DAYS_BACK: Record<SpendPeriod, number> = {
  "1d": 1,
  "1w": 7,
  "1m": 30,
  "1y": 365,
};

export function spendRange(
  period: SpendPeriod,
  now: Date,
): { from: string; to: string } {
  const to = new Date(now);
  const from = new Date(now);
  from.setDate(from.getDate() - DAYS_BACK[period]);
  return { from: from.toISOString(), to: to.toISOString() };
}
