import {
  SESSION_CATEGORIES,
  type SessionCategory,
  type SpendBySessionType,
  type SpendCategory,
} from "api-server-api";

export interface SessionSpendRow {
  sessionId: string;
  costUsd: number;
}

const ORDER: readonly SpendCategory[] = [...SESSION_CATEGORIES, "unknown"];

export function spendBySessionType(
  sessions: readonly SessionSpendRow[],
  categories: ReadonlyMap<string, SessionCategory>,
): SpendBySessionType[] {
  const totals = new Map<SpendCategory, number>();
  for (const session of sessions) {
    const category = categories.get(session.sessionId) ?? "unknown";
    totals.set(category, (totals.get(category) ?? 0) + session.costUsd);
  }
  return ORDER.filter((category) => (totals.get(category) ?? 0) > 0)
    .map((category) => ({ category, costUsd: totals.get(category) ?? 0 }))
    .sort((a, b) => b.costUsd - a.costUsd);
}
