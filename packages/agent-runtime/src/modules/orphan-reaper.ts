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
  sweepIfQuiet(): Promise<void>;
}

export interface OrphanReaperOptions {
  isQuiet: () => boolean;
  spared?: () => Set<number>;
  log?: (msg: string) => void;
}

export function createOrphanReaper(opts: OrphanReaperOptions): OrphanReaper {
  const { isQuiet, spared = () => new Set<number>(), log } = opts;

  const selfCgroup = readProcessEntry(process.pid)?.cgroup ?? "";
  if (!selfCgroup) log?.("cannot read own cgroup; not reaping (fail-closed)");

  let sweeping = false;
  let socketsWarned = false;
  const announced = new Set<number>();

  function candidates(): ProcessEntry[] | null {
    const keep = spared();
    const table = readProcessTable();

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

        if (!isQuiet()) {
          log?.("pod became busy during the grace window; not escalating");
          return;
        }

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
