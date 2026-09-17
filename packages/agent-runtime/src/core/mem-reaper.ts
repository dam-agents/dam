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

export function readMeminfoBytes(
  key: string,
  path = "/proc/meminfo",
): number | null {
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      if (line.startsWith(`${key}:`)) {
        const kb = Number.parseInt(line.slice(key.length + 1), 10);
        if (Number.isFinite(kb)) return kb * 1024;
      }
    }
  } catch {}
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

interface MemSample {
  used: number;
  limit: number;
  text: string;
}

function cgroupUsage(limit: number): MemSample | null {
  const cur = readCgroupBytes(
    "/sys/fs/cgroup/memory.current",
    "/sys/fs/cgroup/memory/memory.usage_in_bytes",
  );
  if (cur === null) return null;
  const reclaimable = readReclaimableBytes();
  if (reclaimable === null) return null;
  const used = Math.max(0, cur - reclaimable);
  return {
    used,
    limit,
    text: `cgroup ${mib(used)}(+${mib(reclaimable)} cache)/${mib(limit)}MB`,
  };
}

function machineUsage(): MemSample | null {
  const total = readMeminfoBytes("MemTotal");
  const available = readMeminfoBytes("MemAvailable");
  if (total === null || available === null || total <= 0) return null;
  const used = Math.max(0, total - available);
  return { used, limit: total, text: `machine ${mib(used)}/${mib(total)}MB` };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Watches memory pressure and sacrifices a tool
 * process before the kernel kills something the agent cannot recover from.
 * Where the ceiling lives depends on how the agent runs. A container is capped
 * by its cgroup, and usage there counts page cache the kernel will hand back
 * under pressure, so the cache is subtracted before comparing. A machine on the
 * vm Backend has no cgroup limit at all — the kernel creates none on a cgroup2
 * root, and the hypervisor is the only ceiling — so the machine's own memory is
 * the limit. That substitution is made only inside a machine, never merely
 * because a cgroup limit is missing: an uncapped container reads its node's
 * memory from /proc/meminfo, where a neighbour's usage would reap this agent's
 * tool process for someone else's appetite. Such a container stays unwatched,
 * as it is today. There the kernel's own MemAvailable estimate is the headroom
 * signal: it already discounts reclaimable cache, which a plain total-minus-free
 * would count as used and reap on an idle guest. Both numbers are re-read every
 * cycle rather than fixed at start, because a balloon device can take memory
 * back from a running guest.
 */
export function startMemReaper(opts: {
  thresholdFraction: number;
  log: (msg: string) => void;
  pollMs?: number;
}): void {
  const cgMax = readCgroupBytes(
    "/sys/fs/cgroup/memory.max",
    "/sys/fs/cgroup/memory/memory.limit_in_bytes",
  );
  const cgLimit =
    cgMax !== null && Number.isFinite(cgMax) && cgMax < 1e15 ? cgMax : null;
  const inMachine = process.env.PLATFORM_VM_PERSIST_PATHS !== undefined;
  if (cgLimit === null && !(inMachine && readMeminfoBytes("MemAvailable"))) {
    opts.log("no readable memory limit; reaper disabled");
    return;
  }
  opts.log(
    cgLimit === null
      ? "no cgroup limit; watching the machine's own memory"
      : `watching the cgroup limit (${mib(cgLimit)}MB)`,
  );
  setInterval(() => {
    try {
      const sample = cgLimit === null ? machineUsage() : cgroupUsage(cgLimit);
      if (sample === null) return;
      if (sample.used / sample.limit < opts.thresholdFraction) return;
      const usage = sample.text;
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
