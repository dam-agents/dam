import type { BackgroundWorkItem } from "agent-runtime-api";

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
  /**
   * Kill switch. `false` refuses every hold, so an install that finds the
   * behaviour surprising can turn it off without a new image; sessions then reap
   * on idleness exactly as they did before the contract existed.
   */
  enabled?: boolean;
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
 * — deliberately, because every bound available here is a worse failure than the
 * one it prevents. A timer cannot tell unfinished work from work that will never
 * finish; a cap on concurrent holds can only be enforced by reaping a session,
 * which kills the very work being protected, and it would guard a boundary the
 * platform does not otherwise defend (an open tab pins the same subprocess, with
 * no cap at all). What keeps a hold honest instead is that it is never silent or
 * final: it is logged with what it is for, published on the runtime's status
 * surface, and a hard stop or pause reclaims the pod regardless.
 */
export function createBackgroundWorkRegistry(
  deps: BackgroundWorkRegistryDeps = {},
): BackgroundWorkRegistry {
  const enabled = deps.enabled ?? true;

  /** Session → the set it last reported. */
  const holds = new Map<string, BackgroundWorkItem[]>();

  function describe(items: BackgroundWorkItem[]): string {
    return items
      .map((i) => i.description ?? i.command ?? i.id)
      .join(", ")
      .slice(0, 300);
  }

  return {
    report(sessionId, items) {
      const held = holds.has(sessionId);
      if (!items.length) {
        if (held) {
          holds.delete(sessionId);
          deps.log?.(`background work in session ${sessionId} is done`);
        }
        return;
      }
      if (!enabled) return;
      holds.set(sessionId, items);
      if (!held) {
        deps.log?.(
          `holding session ${sessionId} for background work: ${describe(items)}`,
        );
      }
    },

    hasWork(sessionId) {
      return holds.has(sessionId);
    },

    held() {
      return [...holds.entries()].map(([sessionId, items]) => ({
        sessionId,
        items,
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
