export const SESSION_COST_PAGE_SIZE = 50;

const CLOCK_SKEW_MS = 5 * 60_000;

export interface SessionCostPage {
  sessionIds: string[];
  from?: string;
}

interface ListedSession {
  sessionId: string;
  createdAt: string;
}

function earliestStart(sessions: readonly ListedSession[]): string | undefined {
  let earliest = Infinity;
  for (const s of sessions) {
    const at = Date.parse(s.createdAt);
    if (Number.isNaN(at)) return undefined;
    earliest = Math.min(earliest, at);
  }
  return new Date(earliest - CLOCK_SKEW_MS).toISOString();
}

export function sessionCostPages(
  sessions: readonly ListedSession[],
  pageSize = SESSION_COST_PAGE_SIZE,
): SessionCostPage[] {
  const pages: SessionCostPage[] = [];
  for (let i = 0; i < sessions.length; i += pageSize) {
    const chunk = sessions.slice(i, i + pageSize);
    const from = earliestStart(chunk);
    pages.push({
      sessionIds: chunk.map((s) => s.sessionId).sort(),
      ...(from === undefined ? {} : { from }),
    });
  }
  return pages;
}
