import {
  descendantKeys,
  liveKeys,
  newDescendantsBelowBaseline,
  processKey,
  type ProcessKey,
} from "../domain/process-tree.js";
import type { ProcessTable } from "../infrastructure/process-table.js";

/**
 * How long one process may keep its session — and with it the pod — alive.
 *
 * Off by default, because a ceiling cannot tell the case it is meant to catch
 * from the case this whole mechanism exists to protect: work that has not
 * finished yet and work that will never finish look identical from outside. A
 * bound therefore buys a self-healing leak at the price of silently killing
 * genuinely long work — the very failure of #2965, moved from seconds to hours.
 * The platform already takes the other side of this trade for a running
 * Experiment, whose driver stays pinned as long as it reports, however wedged it
 * is, and leaves the decision to a human.
 *
 * What makes that safe is that a hold is visible and always overridable: it is
 * logged with the process holding it, reported on the runtime's status surface,
 * and a hard stop or pause scales the pod down regardless (both bypass the busy
 * probe). An operator who would rather bound it can set a ceiling; past it the
 * session reaps as it did before.
 */
const DEFAULT_HOLD_MAX_MS = 0;

/**
 * How many sessions may hold at once. Each held session pins the harness's
 * per-session subprocess (~300 MB), against an agent pod whose memory limit
 * defaults to 2Gi — so an unbounded number of holds trades a lost background
 * job for an OOM kill that takes down the pod and *every* job in it. When the
 * cap is exceeded the longest-held session is released first.
 */
const DEFAULT_MAX_HELD_SESSIONS = 2;

/**
 * Reuse one snapshot across a burst of *liveness* callers (status probes, reap
 * checks). The two sampling moments — baselining a turn and collecting its work
 * — always read fresh: they are the comparison the whole mechanism rests on, and
 * serving both from one cached read would make a turn look like it started
 * nothing, or a stale baseline attribute infrastructure as work. A scan is well
 * under a millisecond, and each happens once per turn.
 */
const DEFAULT_SNAPSHOT_CACHE_MS = 1_000;

/**
 * How long after a turn ends a newly appeared process still counts as that
 * turn's doing. It covers a harness's trailing work (an async post-tool hook
 * firing after the prompt response) and must outlast the reap's own quiescence
 * delay, so the reap check itself can still attribute a late spawn.
 *
 * It must also *close*: attribution is only meaningful near the turn. A window
 * left open would let a long hold keep absorbing every process born under the
 * harness later — another session's subprocess, its MCP servers — and the hold
 * would then never end.
 */
const DEFAULT_LATE_SPAWN_WINDOW_MS = 5_000;

export interface BackgroundWorkTracker {
  /** A prompt was forwarded: baseline what is already running. */
  turnStarted(sessionId: string): void;
  /** The turn's response landed: anything new under the harness is its work. */
  turnEnded(sessionId: string): void;
  /**
   * Does this session have background work still running? Re-samples first, so
   * a process spawned in the turn's trailing moments is caught too.
   */
  hasLiveWork(sessionId: string): boolean;
  /** Sessions currently holding, after pruning. Drives the runtime's idle flag. */
  heldSessions(): string[];
  /** Session is gone (torn down, deleted) — drop its bookkeeping. */
  forget(sessionId: string): void;
  /** Harness recycled or exited: its children died with it, so nothing is held. */
  clear(): void;
}

export interface BackgroundWorkTrackerDeps {
  processTable: ProcessTable;
  /**
   * Pid of the live harness process. Candidates are the processes it spawns, so
   * `undefined` (no harness running, or a harness the runtime didn't spawn)
   * disables tracking — there is nothing to attribute work to.
   */
  harnessPid: () => number | undefined;
  /** Override the hold ceiling; 0 disables it (unbounded holds). */
  holdMaxMs?: number;
  /** Override the concurrent-hold cap; 0 disables tracking entirely. */
  maxHeldSessions?: number;
  /** Override the snapshot reuse window — exposed for tests. */
  snapshotCacheMs?: number;
  /** Override how long after a turn a new process counts as its work. */
  lateSpawnWindowMs?: number;
  now?: () => number;
  log?: (msg: string) => void;
}

/**
 * Tracks background work an agent leaves running when a turn ends, so the
 * runtime neither reaps the session that owns it nor reports itself idle while
 * it runs.
 *
 * **Why a snapshot diff.** ACP has no liveness concept — a session emits
 * nothing between turns, and `session/close` is specified as safe precisely
 * because the protocol assumes nothing is running. So the signal has to come
 * from the pod itself. Rather than classify processes by identity (the
 * ambiguity that makes a keep-awake signal untrustworthy: a working job looks
 * like an always-on gateway looks like an orphan), this compares two snapshots:
 * what was running under the harness when the prompt was forwarded, and what is
 * running when the turn ends. Infrastructure predates the turn — a harness
 * spawns its per-session subprocess and connects that session's stdio MCP
 * servers when the session is created — so the difference is what the turn
 * started, which is by definition agent-caused. Sessions stay separate because
 * only processes appearing *below an already-running descendant* count; see
 * `newDescendantsBelowBaseline`.
 *
 * **Harness-agnostic.** Nothing here reads harness-specific metadata or argv
 * patterns; any harness whose work is a process born under a session's
 * subprocess during a turn is covered.
 *
 * **Known imprecision.** A process born under this session's subprocess during
 * the turn but not really the agent's work — an MCP server connected lazily on
 * first use, or one that crashed and respawned mid-turn — reads as work. That
 * costs held compute until the process exits (or a configured ceiling lapses);
 * it never loses work. The exact fix is upstream: the adapter already tracks
 * its live background tasks internally (from the CLI's
 * `background_tasks_changed` level signal) and forwarding that set would give an
 * authoritative release edge, making the diff unnecessary.
 */
export function createBackgroundWorkTracker(
  deps: BackgroundWorkTrackerDeps,
): BackgroundWorkTracker {
  const holdMaxMs = deps.holdMaxMs ?? DEFAULT_HOLD_MAX_MS;
  const maxHeldSessions = deps.maxHeldSessions ?? DEFAULT_MAX_HELD_SESSIONS;
  const snapshotCacheMs = deps.snapshotCacheMs ?? DEFAULT_SNAPSHOT_CACHE_MS;
  const lateSpawnWindowMs =
    deps.lateSpawnWindowMs ?? DEFAULT_LATE_SPAWN_WINDOW_MS;
  const now = deps.now ?? (() => Date.now());

  /** Session → harness descendants that existed when its turn was forwarded. */
  const baselines = new Map<string, Set<ProcessKey>>();
  /** Session → when attribution to its last turn closes (see the window above). */
  const attributionUntil = new Map<string, number>();
  /** Session → tracked work, each stamped with when it was first seen. */
  const holds = new Map<string, Map<ProcessKey, number>>();

  let cached: {
    at: number;
    snapshot: ReturnType<ProcessTable["read"]>;
  } | null = null;

  function snapshot(opts: { fresh?: boolean } = {}) {
    const at = now();
    if (!opts.fresh && cached && at - cached.at < snapshotCacheMs)
      return cached.snapshot;
    const read = deps.processTable.read();
    cached = { at, snapshot: read };
    return read;
  }

  /** Fold anything new under the harness into `sessionId`'s hold. */
  function collect(sessionId: string): void {
    const until = attributionUntil.get(sessionId);
    if (until === undefined) return;
    if (now() > until) {
      // Attribution window closed — the baseline can no longer tell this
      // turn's work from anything else the harness has started since.
      attributionUntil.delete(sessionId);
      baselines.delete(sessionId);
      return;
    }
    const baseline = baselines.get(sessionId);
    const root = deps.harnessPid();
    // No baseline means no turn ran under the current harness: without one,
    // every long-lived infrastructure process would read as new work.
    if (!baseline || root === undefined) return;

    const table = snapshot({ fresh: true });
    const born = newDescendantsBelowBaseline(table, root, baseline);
    const at = now();
    let hold = holds.get(sessionId);
    for (const key of born) {
      hold ??= new Map();
      if (hold.has(key)) continue;
      hold.set(key, at);
      // Name the process, so a sandbox staying awake is explainable without
      // shelling into it.
      const entry = table.find((p) => processKey(p) === key);
      deps.log?.(
        `holding session ${sessionId} for background work: ${entry?.comm ?? "?"} (${key})`,
      );
    }
    if (hold) holds.set(sessionId, hold);
  }

  /** Forget a session entirely: no hold, and no way to rebuild one. */
  function release(sessionId: string): void {
    baselines.delete(sessionId);
    attributionUntil.delete(sessionId);
    holds.delete(sessionId);
  }

  /** Drop dead processes, expired holds, and holds over the cap. */
  function prune(): void {
    if (!holds.size) return;
    const live = liveKeys(snapshot());
    const at = now();

    for (const [sessionId, hold] of holds) {
      for (const [key, firstSeen] of hold) {
        if (!live.has(key)) {
          hold.delete(key);
          continue;
        }
        if (holdMaxMs > 0 && at - firstSeen > holdMaxMs) {
          hold.delete(key);
          deps.log?.(
            `background work in session ${sessionId} held past the ${Math.round(
              holdMaxMs / 60_000,
            )}min ceiling — releasing (process ${key} still running)`,
          );
        }
      }
      if (!hold.size) holds.delete(sessionId);
    }

    if (maxHeldSessions > 0 && holds.size > maxHeldSessions) {
      // Longest-held first: it has had the most time to finish, and is the
      // likeliest to be a leak rather than live work.
      const byAge = [...holds.entries()]
        .map(([sessionId, hold]) => ({
          sessionId,
          oldest: Math.min(...hold.values()),
        }))
        .sort((a, b) => a.oldest - b.oldest);
      for (const { sessionId } of byAge.slice(
        0,
        holds.size - maxHeldSessions,
      )) {
        // Release for good: dropping the hold alone would let a collect still
        // inside the attribution window rebuild it with fresh timestamps, making
        // the evicted session the *youngest* and pushing the eviction onto a
        // genuinely older session that is still working.
        release(sessionId);
        deps.log?.(
          `background work in session ${sessionId} released — more than ${maxHeldSessions} sessions holding at once`,
        );
      }
    }
  }

  return {
    turnStarted(sessionId) {
      if (maxHeldSessions === 0) return;
      const root = deps.harnessPid();
      attributionUntil.delete(sessionId);
      if (root === undefined) {
        baselines.delete(sessionId);
        return;
      }
      baselines.set(sessionId, descendantKeys(snapshot({ fresh: true }), root));
    },

    turnEnded(sessionId) {
      if (!baselines.has(sessionId)) return;
      attributionUntil.set(sessionId, now() + lateSpawnWindowMs);
      collect(sessionId);
    },

    hasLiveWork(sessionId) {
      collect(sessionId);
      prune();
      return (holds.get(sessionId)?.size ?? 0) > 0;
    },

    heldSessions() {
      prune();
      return [...holds.keys()];
    },

    forget(sessionId) {
      release(sessionId);
    },

    clear() {
      baselines.clear();
      attributionUntil.clear();
      holds.clear();
    },
  };
}
