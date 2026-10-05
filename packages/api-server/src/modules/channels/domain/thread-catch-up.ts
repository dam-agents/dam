export interface ThreadEntry<T> {
  ts: string | undefined;
  authorAgentId: string | null;
  message: T;
}

export interface CatchUpSelection {
  readingAgentId: string;
  since: string;
  until: string;
  carried: readonly string[];
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

function newestOf(tss: readonly (string | undefined)[]): string | null {
  let found: string | null = null;
  for (const ts of tss) {
    if (ts === undefined) continue;
    found = found === null ? ts : laterTs(found, ts);
  }
  return found;
}

export function lastOwnPostTs<T>(
  entries: readonly ThreadEntry<T>[],
  readingAgentId: string,
): string | null {
  return newestOf(
    entries
      .filter((entry) => entry.authorAgentId === readingAgentId)
      .map((entry) => entry.ts),
  );
}

export function newestTs<T>(entries: readonly ThreadEntry<T>[]): string | null {
  return newestOf(entries.map((entry) => entry.ts));
}

export function aboveBoundary(
  tss: readonly string[],
  boundary: string | null,
): string[] {
  return boundary === null
    ? [...tss]
    : tss.filter((ts) => isAfterTs(ts, boundary));
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
      : isAfterTs(read.newestReadTs, read.coveredUpTo)
        ? read.coveredUpTo
        : read.newestReadTs;
  const reached = read.hasMore ? capped : read.coveredUpTo;
  if (reached === null) return stored;
  if (stored === null) return reached;
  return laterTs(stored, reached);
}

export interface ThreadCursor {
  threadTs: string;
  before: string;
}

const CURSOR_SEPARATOR = ":";
const CURSOR_TS = /^\d+\.\d+$/;

/**
 * UNIT_BOUNDARY_DESCRIPTION: The handle one window of a thread hands its reader
 * to reach the window before it. It names a thread and a boundary inside it,
 * and deliberately nothing else: a reader holds this handle and can rewrite it,
 * so anything the platform would have to believe on being handed it back does
 * not belong here. A position is safe to take on trust because the read
 * re-derives everything else from the thread itself, and because the worst a
 * rewritten position can do is ask for another window of a thread its holder
 * was already offered. Naming the thread is what makes a handle from elsewhere
 * refusable, since nothing else distinguishes one.
 */
export function formatThreadCursor(cursor: ThreadCursor): string {
  return `${cursor.threadTs}${CURSOR_SEPARATOR}${cursor.before}`;
}

export function parseThreadCursor(raw: string): ThreadCursor | null {
  const parts = raw.split(CURSOR_SEPARATOR);
  const [threadTs, before] = parts;
  if (parts.length !== 2 || threadTs === undefined || before === undefined)
    return null;
  if (!CURSOR_TS.test(threadTs) || !CURSOR_TS.test(before)) return null;
  return { threadTs, before };
}

export function selectUnseen<T>(
  entries: ThreadEntry<T>[],
  selection: CatchUpSelection,
): ThreadEntry<T>[] {
  const carried = new Set(selection.carried);
  return entries.filter(
    (entry) =>
      !!entry.ts &&
      !carried.has(entry.ts) &&
      entry.authorAgentId !== selection.readingAgentId &&
      isAfterTs(entry.ts, selection.since) &&
      !isAfterTs(entry.ts, selection.until),
  );
}
