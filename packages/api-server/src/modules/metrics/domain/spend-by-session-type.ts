import {
  SESSION_CATEGORIES,
  type CreditSpend,
  type SessionCategory,
  type SpendBySessionType,
  type SpendCategory,
} from "api-server-api";

export interface SessionSpendRow {
  sessionId: string;
  costUsd: number;
  credits: CreditSpend[];
}

const ORDER: readonly SpendCategory[] = [...SESSION_CATEGORIES, "unknown"];

export function spendBySessionType(
  sessions: readonly SessionSpendRow[],
  categories: ReadonlyMap<string, SessionCategory>,
): SpendBySessionType[] {
  const totals = new Map<SpendCategory, number>();
  const credits = new Map<SpendCategory, Map<string, number>>();
  for (const session of sessions) {
    const category = categories.get(session.sessionId) ?? "unknown";
    totals.set(category, (totals.get(category) ?? 0) + session.costUsd);
    const byUnit = credits.get(category) ?? new Map<string, number>();
    for (const c of session.credits) {
      byUnit.set(c.unit, (byUnit.get(c.unit) ?? 0) + c.amount);
    }
    credits.set(category, byUnit);
  }
  const creditsFor = (category: SpendCategory): CreditSpend[] =>
    [...(credits.get(category) ?? new Map<string, number>())].map(
      ([unit, amount]) => ({ unit, amount }),
    );
  return ORDER.filter(
    (category) =>
      (totals.get(category) ?? 0) > 0 || creditsFor(category).length > 0,
  )
    .map((category) => ({
      category,
      costUsd: totals.get(category) ?? 0,
      credits: creditsFor(category),
    }))
    .sort((a, b) => b.costUsd - a.costUsd);
}
