import type { SessionSpend, SessionSpendTotal } from "agent-runtime-api";

export interface SessionSpendRow {
  sessionId: string;
  cost: number;
  startedAt: number;
}

export function spendBySession(
  rows: readonly SessionSpendRow[],
  unit: string,
  platformSessionOf?: (harnessSessionId: string) => string | undefined,
): Map<string, SessionSpend> {
  const bySession = new Map<string, SessionSpend>();
  for (const row of rows) {
    const sessionId = platformSessionOf?.(row.sessionId) ?? row.sessionId;
    bySession.set(sessionId, { unit, cost: row.cost });
  }
  return bySession;
}

export function spendTotal(
  rows: readonly SessionSpendRow[],
  unit: string,
  range: { from: number; to: number },
): SessionSpendTotal {
  const started = rows.filter(
    (row) => row.startedAt >= range.from && row.startedAt < range.to,
  );
  return {
    unit,
    cost: started.reduce((sum, row) => sum + row.cost, 0),
    sessions: started.length,
  };
}
