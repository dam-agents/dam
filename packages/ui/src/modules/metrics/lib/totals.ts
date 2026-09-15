import type { CreditSpend, SpendByDay } from "api-server-api";

export const totalCostUsd = (rows: readonly { costUsd: number }[]): number =>
  rows.reduce((sum, row) => sum + row.costUsd, 0);

export const totalCredits = (
  rows: readonly { credits: CreditSpend[] }[],
): CreditSpend[] => {
  const byUnit = new Map<string, number>();
  for (const row of rows) {
    for (const c of row.credits) {
      byUnit.set(c.unit, (byUnit.get(c.unit) ?? 0) + c.amount);
    }
  }
  return [...byUnit].map(([unit, amount]) => ({ unit, amount }));
};

export const daySeries = (
  days: SpendByDay[],
  unit: string | null,
): { day: string; value: number }[] =>
  days.map((d) => ({
    day: d.day,
    value:
      unit === null
        ? d.costUsd
        : (d.credits.find((c) => c.unit === unit)?.amount ?? 0),
  }));
