// Reaps work that detached before teardown could reach it; only quiet makes it safe.
import {
  listeningPids,
  readProcessEntry,
  readProcessTable,
  reapableOrphans,
  type ProcessEntry,
} from "../core/process-table.js";
import {
  TEARDOWN_GRACE_MS,
  sendSignal,
  sleep,
} from "../core/supervised-process.js";

export interface OrphanReaper {
  /** The caller owns the schedule. */
  sweepIfQuiet(): Promise<void>;
}

export interface OrphanReaperOptions {
  /** Nothing running at all — see the call site for what composes it. */
  isQuiet: () => boolean;
  /** Re-read each sweep. */
  spared?: () => Set<number>;
  log?: (msg: string) => void;
}

export function createOrphanReaper(opts: OrphanReaperOptions): OrphanReaper {
  const { isQuiet, spared = () => new Set<number>(), log } = opts;

  const selfCgroup = readProcessEntry(process.pid)?.cgroup ?? "";
  if (!selfCgroup) log?.("cannot read own cgroup; not reaping (fail-closed)");

  let sweeping = false;
  let socketsWarned = false;
  /** Reachable pids already announced, so a daemon is logged once, not hourly. */
  const announced = new Set<number>();

  /** `null` = reachability is unknowable right now, so nothing may be reaped. */
  function candidates(): ProcessEntry[] | null {
    const keep = spared();
    const table = readProcessTable();

    // A declared process leads the session `platform-bg` made for it, so that
    // session is the work: its children are not orphans, but a grandchild whose
    // parent exited is. Never a child of ours — the harness and every PTY lead a
    // session too, and one stray declaration must not shield all of it.
    const keptSessions = new Set(
      table
        .filter(
          (p) => keep.has(p.pid) && p.sid === p.pid && p.ppid !== process.pid,
        )
        .map((p) => p.sid),
    );
    const orphans = reapableOrphans(table, {
      selfPid: process.pid,
      selfCgroup,
    }).filter((p) => !keep.has(p.pid) && !keptSessions.has(p.sid));
    if (orphans.length === 0) return [];

    // A process still listening is a service something means to come back to;
    // a leak is what nothing can reach any more.
    const reachable = listeningPids(orphans.map((p) => p.pid));
    if (!reachable) {
      if (!socketsWarned) {
        socketsWarned = true;
        log?.("cannot read the socket tables; not reaping (fail-closed)");
      }
      return null;
    }
    for (const pid of announced) if (!reachable.has(pid)) announced.delete(pid);
    for (const [pid, where] of reachable) {
      if (announced.has(pid)) continue;
      announced.add(pid);
      log?.(`keeping ${pid} — listening on ${where}`);
    }
    return orphans.filter((p) => !reachable.has(p.pid));
  }

  return {
    async sweepIfQuiet() {
      if (!selfCgroup || sweeping || !isQuiet()) return;
      const found = candidates();
      if (!found || found.length === 0) return;

      sweeping = true;
      try {
        log?.(
          `pod is quiet with ${found.length} orphaned process(es); reaping`,
        );
        for (const p of found) {
          log?.(`  reaping ${p.pid} (${p.state}) ${p.cmdline}`);
          sendSignal(p.pid, "SIGTERM");
        }

        await sleep(TEARDOWN_GRACE_MS);

        // Work arriving revokes the premise the sweep started on.
        if (!isQuiet()) {
          log?.("pod became busy during the grace window; not escalating");
          return;
        }

        // A pid that exited during the window may have been reused.
        const recheck = candidates();
        if (!recheck) return;
        const stillOurs = new Map(recheck.map((p) => [p.pid, p.startTime]));
        const remaining = found.filter(
          (p) => stillOurs.get(p.pid) === p.startTime,
        );
        for (const p of remaining) sendSignal(p.pid, "SIGKILL");
        if (remaining.length > 0) {
          const stuck = remaining.filter((p) => p.state === "D").length;
          log?.(
            `force-killed ${remaining.length} orphan(s)` +
              (stuck > 0 ? ` — ${stuck} stuck in uninterruptible I/O` : ""),
          );
        }
      } finally {
        sweeping = false;
      }
    },
  };
}
