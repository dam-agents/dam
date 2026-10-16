import type { SpendAmount, SpendUnit } from "api-server-api";

export const VISIBLE_MICROS = 5_000;

export type UnitAmounts = Record<SpendUnit, number>;

function noAmounts(): UnitAmounts {
  return { usd: 0, usd_list: 0, bobcoin: 0, free: 0 };
}

export function unitTotals(rows: readonly SpendAmount[]): UnitAmounts {
  const totals = noAmounts();
  for (const row of rows) totals[row.unit] += row.costMicros;
  return totals;
}

export function amountsBy<T extends SpendAmount>(
  rows: readonly T[],
  keyOf: (row: T) => string,
): Map<string, UnitAmounts> {
  const byKey = new Map<string, UnitAmounts>();
  for (const row of rows) {
    const key = keyOf(row);
    const amounts = byKey.get(key) ?? noAmounts();
    amounts[row.unit] += row.costMicros;
    byKey.set(key, amounts);
  }
  return byKey;
}

export function isMostlyPlanUse(amounts: UnitAmounts): boolean {
  return amounts.usd_list >= VISIBLE_MICROS && amounts.usd_list > amounts.usd;
}
