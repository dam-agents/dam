export interface ThreadEntry<T> {
  ts: string | undefined;
  authorAgentId: string | null;
  message: T;
}

export interface CatchUpSelection {
  readingAgentId: string;
  since: string;
  until: string;
  batchTs: string[];
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

export function earlierTs(a: string, b: string): string {
  return isAfterTs(a, b) ? b : a;
}

export function newestOf(tss: readonly string[]): string | null {
  let found: string | null = null;
  for (const ts of tss) found = found === null ? ts : laterTs(found, ts);
  return found;
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
    coveredUpTo: string;
  },
  stored: string | null,
): string | null {
  const capped =
    read.newestReadTs === null
      ? null
      : earlierTs(read.newestReadTs, read.coveredUpTo);
  const reached = read.hasMore ? capped : read.coveredUpTo;
  if (reached === null) return stored;
  if (stored === null) return reached;
  return laterTs(stored, reached);
}

export interface TailFold<T> {
  window: T[];
  seen: Set<string>;
}

export function emptyTailFold<T>(): TailFold<T> {
  return { window: [], seen: new Set() };
}

export function foldTailPage<T extends { ts?: string }>(
  state: TailFold<T>,
  page: T[],
  limit: number,
): TailFold<T> {
  const seen = new Set(state.seen);
  const fresh: T[] = [];
  for (const entry of page) {
    if (entry.ts !== undefined) {
      if (seen.has(entry.ts)) continue;
      seen.add(entry.ts);
    }
    fresh.push(entry);
  }
  const next = [...state.window, ...fresh];
  return {
    window: next.length > limit ? next.slice(next.length - limit) : next,
    seen,
  };
}

export function selectUnseen<T>(
  entries: ThreadEntry<T>[],
  selection: CatchUpSelection,
): ThreadEntry<T>[] {
  const carried = new Set(selection.batchTs);
  return entries.filter(
    (entry) =>
      !!entry.ts &&
      !carried.has(entry.ts) &&
      entry.authorAgentId !== selection.readingAgentId &&
      isAfterTs(entry.ts, selection.since) &&
      !isAfterTs(entry.ts, selection.until),
  );
}
