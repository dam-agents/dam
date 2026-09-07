import { readdirSync, readFileSync } from "node:fs";

export interface ProcEntry {
  pid: number;
  ppid: number;
  name: string;
  rssBytes: number;
}

export function readCgroupBytes(v2: string, v1: string): number | null {
  for (const p of [v2, v1]) {
    try {
      const raw = readFileSync(p, "utf8").trim();
      if (raw === "max") return Infinity;
      const n = Number.parseInt(raw, 10);
      if (Number.isFinite(n)) return n;
    } catch {}
  }
  return null;
}

export function readProcTable(): ProcEntry[] {
  const entries: ProcEntry[] = [];
  let names: string[];
  try {
    names = readdirSync("/proc");
  } catch {
    return entries;
  }
  for (const dir of names) {
    const pid = Number(dir);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    try {
      const status = readFileSync(`/proc/${dir}/status`, "utf8");
      let name = "";
      let ppid = 0;
      let rssBytes = 0;
      for (const line of status.split("\n")) {
        if (line.startsWith("Name:")) name = line.slice(5).trim();
        else if (line.startsWith("PPid:")) ppid = Number(line.slice(5).trim());
        else if (line.startsWith("VmRSS:"))
          rssBytes = Number.parseInt(line.slice(6), 10) * 1024;
      }
      entries.push({ pid, ppid, name, rssBytes });
    } catch {}
  }
  return entries;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Picks which process a memory-pressure reap
 * sacrifices. The root (agent-runtime) and its direct children — the harness,
 * PTY harnesses, the pod service, per-connection sshds — are the supervised
 * platform processes and are never picked; the victim is the largest-RSS
 * descendant at depth two or deeper, a tool process whose death the harness
 * observes as a failed command and can recover from inside the turn. Null when
 * only protected processes remain (the harness itself is the hog) — the caller
 * can only log and let the kernel decide.
 */
export function pickVictim(
  table: ProcEntry[],
  rootPid: number,
): ProcEntry | null {
  const children = new Map<number, ProcEntry[]>();
  for (const e of table) {
    const siblings = children.get(e.ppid) ?? [];
    siblings.push(e);
    children.set(e.ppid, siblings);
  }
  let victim: ProcEntry | null = null;
  const walk = (pid: number, depth: number): void => {
    for (const child of children.get(pid) ?? []) {
      if (depth >= 1 && (victim === null || child.rssBytes > victim.rssBytes))
        victim = child;
      walk(child.pid, depth + 1);
    }
  };
  walk(rootPid, 0);
  return victim;
}

const mib = (n: number) => Math.round(n / 1_048_576);

function sumStatKeys(path: string, keys: string[]): number | null {
  try {
    let total = 0;
    let found = false;
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const [key, value] = line.split(" ");
      if (key !== undefined && keys.includes(key)) {
        total += Number.parseInt(value ?? "0", 10) || 0;
        found = true;
      }
    }
    return found ? total : null;
  } catch {
    return null;
  }
}

function readReclaimableBytes(): number | null {
  const v2 = sumStatKeys("/sys/fs/cgroup/memory.stat", [
    "inactive_file",
    "active_file",
  ]);
  if (v2 !== null) return v2;
  return sumStatKeys("/sys/fs/cgroup/memory/memory.stat", [
    "total_inactive_file",
    "total_active_file",
  ]);
}

export function startMemReaper(opts: {
  thresholdFraction: number;
  log: (msg: string) => void;
  pollMs?: number;
}): void {
  const cgMax = readCgroupBytes(
    "/sys/fs/cgroup/memory.max",
    "/sys/fs/cgroup/memory/memory.limit_in_bytes",
  );
  if (cgMax === null || !Number.isFinite(cgMax) || cgMax >= 1e15) {
    opts.log("no readable cgroup memory limit; reaper disabled");
    return;
  }
  setInterval(() => {
    try {
      const cur = readCgroupBytes(
        "/sys/fs/cgroup/memory.current",
        "/sys/fs/cgroup/memory/memory.usage_in_bytes",
      );
      if (cur === null) return;
      const reclaimable = readReclaimableBytes();
      if (reclaimable === null) return;
      const unreclaimable = Math.max(0, cur - reclaimable);
      if (unreclaimable / cgMax < opts.thresholdFraction) return;
      const usage = `cgroup ${mib(unreclaimable)}(+${mib(reclaimable)} cache)/${mib(cgMax)}MB`;
      const victim = pickVictim(readProcTable(), process.pid);
      if (victim === null) {
        opts.log(`at ${usage} with only protected processes; cannot reap`);
        return;
      }
      try {
        process.kill(victim.pid, "SIGKILL");
        opts.log(
          `killed pid ${String(victim.pid)} (${victim.name}, ${mib(victim.rssBytes)}MB) at ${usage}`,
        );
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== "ESRCH")
          opts.log(
            `failed to kill pid ${String(victim.pid)}: ${String(code ?? err)}`,
          );
      }
    } catch (err) {
      opts.log(`poll failed: ${(err as Error).message}`);
    }
  }, opts.pollMs ?? 2_000).unref();
}
