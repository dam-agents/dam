export interface ThreadEntry<T> {
  ts: string | undefined;
  authorAgentId: string | null;
  message: T;
}

export interface CatchUpSelection {
  readingAgentId: string;
  since: string;
  triggeringTs: string;
}

export function isAfterTs(candidate: string, floor: string): boolean {
  const a = Number(candidate);
  const b = Number(floor);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return candidate > floor;
  return a > b;
}

export function laterTs(a: string, b: string): string {
  return isAfterTs(a, b) ? a : b;
}

export function lastOwnPostTs<T>(
  entries: ThreadEntry<T>[],
  readingAgentId: string,
): string | null {
  let found: string | null = null;
  for (const entry of entries) {
    if (entry.authorAgentId !== readingAgentId || !entry.ts) continue;
    found = found === null ? entry.ts : laterTs(found, entry.ts);
  }
  return found;
}

export function newestTs<T>(entries: ThreadEntry<T>[]): string | null {
  let found: string | null = null;
  for (const entry of entries) {
    if (!entry.ts) continue;
    found = found === null ? entry.ts : laterTs(found, entry.ts);
  }
  return found;
}

export function nextBoundary(
  read: {
    hasMore: boolean;
    newestReadTs: string | null;
    triggeringTs: string;
  },
  stored: string | null,
): string | null {
  const reached = read.hasMore ? read.newestReadTs : read.triggeringTs;
  if (reached === null) return stored;
  if (stored === null) return reached;
  return laterTs(stored, reached);
}

export function foldTailPage<T>(window: T[], page: T[], limit: number): T[] {
  const next = [...window, ...page];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

export function selectUnseen<T>(
  entries: ThreadEntry<T>[],
  selection: CatchUpSelection,
): ThreadEntry<T>[] {
  return entries.filter(
    (entry) =>
      !!entry.ts &&
      entry.ts !== selection.triggeringTs &&
      entry.authorAgentId !== selection.readingAgentId &&
      isAfterTs(entry.ts, selection.since),
  );
}
