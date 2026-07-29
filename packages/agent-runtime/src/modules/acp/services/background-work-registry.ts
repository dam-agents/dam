import type { BackgroundWorkItem } from "agent-runtime-api";

/**
 * How many sessions may hold at once. Each held session keeps the harness's
 * per-session subprocess alive (~300 MB), against an agent pod whose memory
 * limit defaults to 2Gi — so an unbounded number of holds would trade a lost
 * background job for an OOM kill that takes down the pod and *every* job in it.
 * Over the cap the longest-held session is released first: it has had the most
 * time to finish, and is the likeliest to be a reporter that stopped reporting.
 */
const DEFAULT_MAX_HELD_SESSIONS = 2;

export interface HeldSession {
  sessionId: string;
  items: BackgroundWorkItem[];
}

export interface BackgroundWorkRegistry {
  /** Record a session's complete in-flight set; empty releases the hold. */
  report(sessionId: string, items: BackgroundWorkItem[]): void;
  /** Is this session holding? Consulted before closing an idle session. */
  hasWork(sessionId: string): boolean;
  /** Everything currently held — drives the runtime's idle flag and status. */
  held(): HeldSession[];
  /** Session is gone: whatever it was running went with its subprocess. */
  forget(sessionId: string): void;
  /** Harness recycled or exited: same, for every session it served. */
  clear(): void;
}

export interface BackgroundWorkRegistryDeps {
  /** Override the concurrent-hold cap; 0 refuses every hold. */
  maxHeldSessions?: number;
  now?: () => number;
  log?: (msg: string) => void;
}

/**
 * Holds the background work sessions report, so the runtime neither closes a
 * session whose work is still running nor reports itself idle underneath it.
 *
 * **Why the harness reports rather than the platform detecting.** ACP has no
 * liveness concept: a session emits nothing between turns, and `session/close`
 * is specified as safe *because* the protocol assumes nothing is running (v2
 * states this outright — a session reads `idle` while background activity
 * continues, and close cancels any ongoing work). The platform could infer
 * liveness from the pod's process table, but only by guessing which processes
 * are work and which are the harness's own machinery — a guess that is wrong in
 * both directions and whose failures are silent. The harness already knows,
 * exactly, so the contract asks it.
 *
 * **Levels, not edges.** A report is a session's whole in-flight set (see
 * `backgroundWorkReportSchema`). A missed report is corrected by the next one in
 * whichever direction it was wrong, so no reporter has to be reliable twice.
 *
 * **Failure posture.** A reporter that stops reporting while its last set was
 * non-empty holds its session until the session is torn down for another reason
 * — deliberately, because the alternative is a timer that cannot tell unfinished
 * work from work that will never finish. Holds are logged with what they are for
 * and published on the runtime's status surface, a hard stop or pause reclaims
 * the pod regardless, and the concurrent-hold cap bounds the memory cost.
 */
export function createBackgroundWorkRegistry(
  deps: BackgroundWorkRegistryDeps = {},
): BackgroundWorkRegistry {
  const maxHeldSessions = deps.maxHeldSessions ?? DEFAULT_MAX_HELD_SESSIONS;
  const now = deps.now ?? (() => Date.now());

  /** Session → its reported set plus when it first became non-empty. */
  const holds = new Map<
    string,
    { items: BackgroundWorkItem[]; heldSince: number }
  >();

  function describe(items: BackgroundWorkItem[]): string {
    return items
      .map((i) => i.description ?? i.command ?? i.id)
      .join(", ")
      .slice(0, 300);
  }

  /** Keep the newest holds when over the cap; releasing frees a subprocess. */
  function enforceCap(): void {
    if (maxHeldSessions <= 0 || holds.size <= maxHeldSessions) return;
    const oldestFirst = [...holds.entries()].sort(
      (a, b) => a[1].heldSince - b[1].heldSince,
    );
    for (const [sessionId] of oldestFirst.slice(
      0,
      holds.size - maxHeldSessions,
    )) {
      holds.delete(sessionId);
      deps.log?.(
        `background work in session ${sessionId} released — more than ${maxHeldSessions} sessions holding at once`,
      );
    }
  }

  return {
    report(sessionId, items) {
      const previous = holds.get(sessionId);
      if (!items.length) {
        if (previous) {
          holds.delete(sessionId);
          deps.log?.(`background work in session ${sessionId} is done`);
        }
        return;
      }
      if (maxHeldSessions <= 0) return;
      holds.set(sessionId, {
        items,
        heldSince: previous?.heldSince ?? now(),
      });
      if (!previous) {
        deps.log?.(
          `holding session ${sessionId} for background work: ${describe(items)}`,
        );
      }
      enforceCap();
    },

    hasWork(sessionId) {
      return holds.has(sessionId);
    },

    held() {
      return [...holds.entries()].map(([sessionId, hold]) => ({
        sessionId,
        items: hold.items,
      }));
    },

    forget(sessionId) {
      holds.delete(sessionId);
    },

    clear() {
      holds.clear();
    },
  };
}
