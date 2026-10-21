export const SIDEBAR_SESSION_STEP = 5;

function activityTime(at: string | null | undefined): number {
  const time = at ? Date.parse(at) : Number.NaN;
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

export function newestFirst<T>(
  sessions: readonly T[],
  activityAtOf: (session: T) => string | null | undefined,
  idOf: (session: T) => string,
): T[] {
  return [...sessions].sort((a, b) => {
    const [atA, atB] = [
      activityTime(activityAtOf(a)),
      activityTime(activityAtOf(b)),
    ];
    if (atA !== atB) return atA > atB ? -1 : 1;
    const [idA, idB] = [idOf(a), idOf(b)];
    return idA < idB ? -1 : idA > idB ? 1 : 0;
  });
}

export function sidebarSessionWindow<T>(
  sessions: readonly T[],
  limit: number,
  isActive: (session: T) => boolean,
): T[] {
  const head = sessions.slice(0, limit);
  if (head.some(isActive)) return head;
  const active = sessions.find(isActive);
  return active ? [...head, active] : head;
}

export function viewMore({
  total,
  shown,
  limit,
  hasNextPage,
  isFetchingNextPage,
}: {
  total: number;
  shown: number;
  limit: number;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
}): { more: boolean; limit: number; fetchNextPage: boolean } {
  const next = limit + SIDEBAR_SESSION_STEP;
  return {
    more: total > shown || hasNextPage,
    limit: next,
    fetchNextPage: hasNextPage && !isFetchingNextPage && total < next,
  };
}

export function nextSessionCursor<C>(
  pages: readonly {
    sessions: readonly { sessionId: string }[];
    nextCursor: C | null;
  }[],
  lastCursor: C | null,
): C | null {
  const last = pages[pages.length - 1];
  if (!last?.nextCursor) return null;
  if (
    lastCursor &&
    JSON.stringify(lastCursor) === JSON.stringify(last.nextCursor)
  )
    return null;
  const seen = new Set(
    pages.slice(0, -1).flatMap((p) => p.sessions.map((s) => s.sessionId)),
  );
  return last.sessions.some((s) => !seen.has(s.sessionId))
    ? last.nextCursor
    : null;
}
