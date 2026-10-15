export type SpendPeriod = "1d" | "1w" | "1m" | "1y";

export const SPEND_PERIODS: readonly SpendPeriod[] = ["1d", "1w", "1m", "1y"];

const DAYS: Record<SpendPeriod, number> = {
  "1d": 1,
  "1w": 7,
  "1m": 30,
  "1y": 365,
};

const DAY_MS = 86_400_000;

function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function spendDays(
  period: SpendPeriod,
  now: Date,
): { from: string; to: string } {
  return {
    from: utcDay(new Date(now.getTime() - (DAYS[period] - 1) * DAY_MS)),
    to: utcDay(now),
  };
}
