import { readdirSync, readFileSync } from "node:fs";

import type { ProcessEntry } from "../domain/process-tree.js";

/**
 * Port: a snapshot of every process in the pod's PID namespace.
 *
 * The runtime shares that namespace with the harness and everything it spawns,
 * so a snapshot is the one authority on whether work an agent started is still
 * running — ACP carries no such signal (a session reports nothing between
 * prompt turns, and `session/close` assumes nothing is running).
 */
export interface ProcessTable {
  read(): ProcessEntry[];
}

/**
 * `/proc`-backed table. Reads are best-effort by design: a process that exits
 * between the directory listing and its `stat` read is simply not in the
 * snapshot, which is the correct answer.
 */
export function createProcFsProcessTable(
  opts: { procRoot?: string } = {},
): ProcessTable {
  const root = opts.procRoot ?? "/proc";
  return {
    read() {
      const entries: ProcessEntry[] = [];
      let names: string[];
      try {
        names = readdirSync(root);
      } catch {
        // No procfs (non-Linux dev host) — an empty table disables tracking
        // rather than failing a caller in the reap path.
        return entries;
      }
      for (const name of names) {
        if (!/^\d+$/.test(name)) continue;
        let stat: string;
        try {
          stat = readFileSync(`${root}/${name}/stat`, "utf8");
        } catch {
          continue;
        }
        const entry = parseProcStat(stat);
        if (entry) entries.push(entry);
      }
      return entries;
    },
  };
}

/**
 * Parse one `/proc/<pid>/stat` line.
 *
 * The second field is the executable name wrapped in parens and may itself
 * contain spaces or parens (`(my (odd) proc)`), so the numeric fields are
 * counted from the **last** `)`: after it come `state`, `ppid`, … and
 * `starttime`, which is field 22 of the line and therefore index 19 once the
 * first three are gone.
 *
 * Exported for tests — the field arithmetic is the only fragile part of this
 * adapter.
 */
export function parseProcStat(line: string): ProcessEntry | null {
  const close = line.lastIndexOf(")");
  if (close < 0) return null;
  const pid = Number(line.slice(0, line.indexOf(" ")));
  const fields = line.slice(close + 2).split(" ");
  const ppid = Number(fields[1]);
  const startTicks = Number(fields[19]);
  if (
    !Number.isInteger(pid) ||
    !Number.isInteger(ppid) ||
    !Number.isInteger(startTicks)
  ) {
    return null;
  }
  return { pid, ppid, startTicks };
}
