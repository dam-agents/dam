// The pod's process table, read from `/proc` — the images ship no `ps`.
import { readFileSync, readdirSync, readlinkSync } from "node:fs";

export interface ProcessEntry {
  pid: number;
  ppid: number;
  pgid: number;
  /** The teardown scope — job control fragments pgid, sid holds. */
  sid: number;
  /** `D` is uninterruptible I/O: no signal lands until it completes. */
  state: string;
  /** Ownership marker: survives re-parenting and `setsid`. */
  cgroup: string;
  /** Distinguishes a pid from its reuse. */
  startTime: number;
  cmdline: string;
}

const numeric = /^\d+$/;

function readCgroup(pid: number): string {
  try {
    const first =
      readFileSync(`/proc/${pid}/cgroup`, "utf8").split("\n")[0] ?? "";
    // v2 only: under v1 undelegated controllers report `/` for every service.
    return first.startsWith("0::") ? first : "";
  } catch {
    return "";
  }
}

function readCmdline(pid: number, comm: string): string {
  try {
    const raw = readFileSync(`/proc/${pid}/cmdline`, "utf8");
    // Newlines inside an entry would split a logged row.
    const flat = raw.replace(/[\0\n\t]/g, " ").trim();
    return flat.length > 0 ? flat : `[${comm}]`;
  } catch {
    return `[${comm}]`;
  }
}

export function readProcessEntry(pid: number): ProcessEntry | null {
  let stat: string;
  try {
    stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  } catch {
    return null;
  }
  // comm is unquoted and may hold spaces and parens: split after the last ") ".
  const cut = stat.lastIndexOf(") ");
  if (cut < 0) return null;
  const open = stat.indexOf(" (");
  const comm = open >= 0 ? stat.slice(open + 2, cut) : "";
  const fields = stat.slice(cut + 2).split(" ");
  if (fields.length < 4) return null;

  const [state, ppid, pgid, sid] = fields;
  const parsed = {
    pid,
    ppid: Number(ppid),
    pgid: Number(pgid),
    sid: Number(sid),
  };
  if (
    !Number.isInteger(parsed.ppid) ||
    !Number.isInteger(parsed.pgid) ||
    !Number.isInteger(parsed.sid)
  )
    return null;

  return {
    ...parsed,
    state: state ?? "",
    cgroup: readCgroup(pid),
    // stat field 22, less the stripped "pid (comm) " prefix.
    startTime: Number(fields[19] ?? 0) || 0,
    cmdline: readCmdline(pid, comm),
  };
}

/** Every readable process; entries that vanish mid-read are skipped. */
export function readProcessTable(): ProcessEntry[] {
  let names: string[];
  try {
    names = readdirSync("/proc");
  } catch {
    return [];
  }
  const out: ProcessEntry[] = [];
  for (const name of names) {
    if (!numeric.test(name)) continue;
    const entry = readProcessEntry(Number(name));
    if (entry) out.push(entry);
  }
  return out;
}

/** A socket table, `""` when the address family is absent, `null` when it exists
 *  but could not be trusted — every table always prints its header. */
function socketTable(name: string, header: string): string | null {
  let text: string;
  try {
    text = readFileSync(`/proc/net/${name}`, "utf8");
  } catch (err) {
    const absent = (err as NodeJS.ErrnoException).code === "ENOENT";
    return absent ? "" : null;
  }
  return text.trimStart().startsWith(header) ? text : null;
}

/** Every socket in this netns that something can still connect to, by inode.
 *  Each source fails closed on its own: one unreadable table would otherwise
 *  make everything it holds look unreachable, and reachable is what spares. */
function listeningSockets(): Map<number, string> | null {
  // Without /proc/net every family looks absent, which must not read as "no
  // listeners" — this is what makes the per-family ENOENT above safe.
  try {
    readdirSync("/proc/net");
  } catch {
    return null;
  }

  const out = new Map<number, string>();
  const unix = socketTable("unix", "Num");
  if (unix === null) return null;
  // SO_ACCEPTCON (0x10000) in the hex Flags column marks a unix listener.
  for (const line of unix.split("\n")) {
    const f = line.trim().split(/\s+/);
    if (f.length < 7 || (parseInt(f[3] ?? "", 16) & 0x10000) === 0) continue;
    out.set(Number(f[6]), f[7] ?? "a unix socket");
  }
  for (const proto of ["tcp", "tcp6"]) {
    const text = socketTable(proto, "sl");
    if (text === null) return null;
    for (const line of text.split("\n")) {
      const f = line.trim().split(/\s+/);
      // 0A is TCP_LISTEN; an outbound connection is 01 and never qualifies.
      if (f.length < 10 || f[3] !== "0A") continue;
      const port = parseInt((f[1] ?? "").split(":")[1] ?? "", 16);
      out.set(Number(f[9]), `${proto} port ${port}`);
    }
  }
  return out;
}

/** Which of `pids` something can still reach. `null` = the socket tables were
 *  unreadable, so reachability cannot be judged at all. */
export function listeningPids(
  pids: readonly number[],
): Map<number, string> | null {
  if (pids.length === 0) return new Map();
  const listeners = listeningSockets();
  if (!listeners) return null;

  const out = new Map<number, string>();
  for (const pid of pids) {
    let fds: string[];
    try {
      fds = readdirSync(`/proc/${pid}/fd`);
    } catch {
      // Vanished, or another user's. Either way not ours to judge — keep it.
      out.set(pid, "a socket we cannot inspect");
      continue;
    }
    for (const fd of fds) {
      let link: string;
      try {
        link = readlinkSync(`/proc/${pid}/fd/${fd}`);
      } catch {
        continue;
      }
      const inode = /^socket:\[(\d+)\]$/.exec(link)?.[1];
      const where = inode === undefined ? undefined : listeners.get(+inode);
      if (where !== undefined) {
        out.set(pid, where);
        break;
      }
    }
  }
  return out;
}

/** Orphans ours to kill: init also parents the runtime, so cgroup decides. */
export function reapableOrphans(
  table: readonly ProcessEntry[],
  opts: { selfPid: number; selfCgroup: string },
): ProcessEntry[] {
  if (!opts.selfCgroup) return [];
  return table.filter(
    (p) =>
      p.ppid === 1 &&
      p.pid !== 1 &&
      p.pid !== opts.selfPid &&
      p.cgroup === opts.selfCgroup,
  );
}
