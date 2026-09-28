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

export interface TailFold<T> {
  window: T[];
  seen: Set<string>;
  opener: T | null;
  trimmed: boolean;
  reachedBefore: boolean;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Folds the pages of a thread read into one window
 * of at most `limit` messages, and is where a caller picks which window. With
 * no `before` the window is the thread's end; with one it is the messages
 * immediately older than that ts, which is how a reader walks a long thread
 * backwards a window at a time. The message that opened the thread is kept
 * aside under `opener` whatever the window holds, because it frames every
 * other line and is the first thing a tail drops. Two flags carry what the
 * window alone cannot say: `trimmed`, that messages fell off its front, which
 * is the only thing telling a capped window apart from a thread that happened
 * to be that long; and `reachedBefore`, that this page already ran past the
 * boundary, so the pages after it hold nothing a backward read wants and the
 * caller can stop asking the messenger for them.
 */
function foldTailPage<T extends { ts?: string }>(
  state: TailFold<T>,
  page: readonly T[],
  args: { limit: number; opener?: string; before?: string },
): TailFold<T> {
  const seen = new Set(state.seen);
  let opener = state.opener;
  let reachedBefore = state.reachedBefore;
  const fresh: T[] = [];
  for (const entry of page) {
    if (
      opener === null &&
      args.opener !== undefined &&
      entry.ts === args.opener
    )
      opener = entry;
    const wanted =
      args.before === undefined ||
      entry.ts === undefined ||
      isAfterTs(args.before, entry.ts);
    if (!wanted) reachedBefore = true;
    if (entry.ts !== undefined) {
      if (seen.has(entry.ts)) continue;
      seen.add(entry.ts);
    }
    if (wanted) fresh.push(entry);
  }
  const next = [...state.window, ...fresh];
  const over = next.length - args.limit;
  const dropped = over > 0 ? next.slice(0, over) : [];
  return {
    window: over > 0 ? next.slice(over) : next,
    seen,
    opener,
    trimmed: state.trimmed || dropped.some((entry) => entry.ts !== args.opener),
    reachedBefore,
  };
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

/**
 * UNIT_BOUNDARY_DESCRIPTION: Walks a thread's pages into one window, and owns
 * when to stop walking: the boundary was passed, the messenger ran out of
 * pages, or the page ceiling was reached, which is the one ending that leaves
 * the thread's newest messages unread and is reported as `hasMore` so a caller
 * never mistakes that window for the thread's end. The caller supplies only the
 * reading, so the real messenger and the fake one cannot disagree about where a
 * window ends or about which of those endings happened. They did disagree while
 * each kept its own copy of this loop, and a fake that ends a walk differently
 * from the messenger it stands in for makes every test written against it
 * worthless.
 */
export async function foldThreadPages<T extends { ts?: string }, C>(
  args: { limit: number; maxPages: number; opener?: string; before?: string },
  readPage: (
    from: C | undefined,
  ) => Promise<{ messages: readonly T[]; next: C | undefined }>,
): Promise<{
  messages: T[];
  opener: T | null;
  hasEarlier: boolean;
  hasMore: boolean;
}> {
  let fold: TailFold<T> = {
    window: [],
    seen: new Set(),
    opener: null,
    trimmed: false,
    reachedBefore: false,
  };
  let from: C | undefined;
  for (let page = 0; page < args.maxPages; page += 1) {
    const read = await readPage(from);
    fold = foldTailPage(fold, read.messages, {
      limit: args.limit,
      ...(args.opener !== undefined ? { opener: args.opener } : {}),
      ...(args.before !== undefined ? { before: args.before } : {}),
    });
    if (fold.reachedBefore || read.next === undefined)
      return {
        messages: fold.window,
        opener: fold.opener,
        hasEarlier: fold.trimmed,
        hasMore: false,
      };
    from = read.next;
  }
  return {
    messages: fold.window,
    opener: fold.opener,
    hasEarlier: fold.trimmed,
    hasMore: true,
  };
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
