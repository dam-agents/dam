/**
 * Pure process-tree arithmetic over snapshots of the pod's process table.
 *
 * It exists to separate work an agent left running from the infrastructure that
 * was already there. The discriminator is structural, not a guess about what a
 * process *is*: interesting processes appear under the harness **during a
 * turn**, while a harness's own machinery (its per-session subprocesses, the
 * stdio MCP servers it connects) is born with the session, before any prompt is
 * forwarded. The policy built on this lives in
 * services/background-work-tracker.ts.
 */

/**
 * One process in a snapshot. `startTicks` is the kernel's start time in clock
 * ticks since boot; pairing it with the pid yields an identity that survives
 * pid reuse, since a recycled pid always carries a later start time. The unit
 * is never converted to wall clock — every comparison here is between
 * snapshots, so ticks are only ever an opaque identity component.
 */
export interface ProcessEntry {
  pid: number;
  ppid: number;
  startTicks: number;
}

/** Stable identity of a process across snapshots (see `ProcessEntry`). */
export type ProcessKey = string;

export function processKey(
  p: Pick<ProcessEntry, "pid" | "startTicks">,
): ProcessKey {
  return `${p.pid}:${p.startTicks}`;
}

/**
 * Keys of every process transitively descending from `root`; `root` itself is
 * excluded.
 *
 * Ancestry is used only to *identify* candidates, never to decide they are
 * still alive: a background process outlives the shell that launched it and is
 * then reparented onto pid 1, leaving the harness's subtree while continuing to
 * run. Liveness therefore checks `liveKeys` over the whole snapshot.
 */
export function descendantKeys(
  snapshot: readonly ProcessEntry[],
  root: number,
): Set<ProcessKey> {
  const childrenOf = new Map<number, ProcessEntry[]>();
  for (const p of snapshot) {
    const siblings = childrenOf.get(p.ppid);
    if (siblings) siblings.push(p);
    else childrenOf.set(p.ppid, [p]);
  }

  const keys = new Set<ProcessKey>();
  const queue = [root];
  while (queue.length) {
    const parent = queue.pop()!;
    for (const child of childrenOf.get(parent) ?? []) {
      const key = processKey(child);
      // A cycle is impossible in a real process table, but a torn snapshot
      // (pids read at different instants) could imply one — the seen-check
      // keeps the walk finite regardless.
      if (keys.has(key)) continue;
      keys.add(key);
      queue.push(child.pid);
    }
  }
  return keys;
}

/** Every identity present in the snapshot — the liveness set. */
export function liveKeys(snapshot: readonly ProcessEntry[]): Set<ProcessKey> {
  return new Set(snapshot.map(processKey));
}

/**
 * Processes that have appeared *below an existing descendant* of `root` since
 * `baseline` was taken.
 *
 * The "below an existing descendant" part is what keeps sessions apart. A
 * harness runs one subprocess per session and connects that session's MCP
 * servers under it, so a new process hanging **directly** off the harness is
 * another session starting up — not this session's work. Work is started *by* a
 * session, so it always appears under the subprocess that was already serving
 * it when the turn began. Without this, opening a second session moments after
 * the first one's turn would look like the first session spawning work that
 * never ends.
 *
 * Membership is transitive: a job's own children count, since the process that
 * a shell wrapper starts is as much the work as the wrapper.
 */
export function newDescendantsBelowBaseline(
  snapshot: readonly ProcessEntry[],
  root: number,
  baseline: ReadonlySet<ProcessKey>,
): Set<ProcessKey> {
  const byPid = new Map<number, ProcessEntry>();
  for (const p of snapshot) byPid.set(p.pid, p);

  const found = new Set<ProcessKey>();
  for (const p of snapshot) {
    const key = processKey(p);
    if (baseline.has(key)) continue;
    // Walk up to the first process that was already there: a baseline member
    // means this was started under a live session, the root means the harness
    // started it directly (its own machinery), and falling off the tree means
    // it is unrelated. The hop bound keeps a torn snapshot from looping.
    let current = p;
    for (let hops = 0; hops <= snapshot.length; hops += 1) {
      if (current.ppid === root) break;
      const parent = byPid.get(current.ppid);
      if (!parent) break;
      if (baseline.has(processKey(parent))) {
        found.add(key);
        break;
      }
      current = parent;
    }
  }
  return found;
}
