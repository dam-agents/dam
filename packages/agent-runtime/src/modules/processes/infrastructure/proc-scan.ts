import { readdir, readFile, readlink, stat } from "node:fs/promises";
import type { ProcSnapshot, ScannedProcess } from "../domain/snapshot.js";
import { CLK_TCK } from "../domain/snapshot.js";

const CMDLINE_MAX_BYTES = 4096;
const KEEP_VARIABLE = Buffer.from("PLATFORM_KEEP=");
const STARTUP_VARIABLE = Buffer.from("PLATFORM_STARTUP=");

export interface ProcessTable {
  scan(): Promise<ProcSnapshot>;
  bootId(): Promise<string | null>;
}

function variableOf(environ: Buffer, name: Buffer): string | null {
  let at = 0;
  while (at < environ.length) {
    const end = environ.indexOf(0, at);
    const stop = end === -1 ? environ.length : end;
    if (
      stop - at > name.length &&
      environ.subarray(at, at + name.length).equals(name)
    ) {
      return environ.subarray(at + name.length, stop).toString("utf8");
    }
    at = stop + 1;
  }
  return null;
}

async function readMarks(
  dir: string,
): Promise<{ keepMark: string | null; startupItem: string | null }> {
  try {
    const environ = await readFile(`${dir}/environ`);
    return {
      keepMark: variableOf(environ, KEEP_VARIABLE),
      startupItem: variableOf(environ, STARTUP_VARIABLE),
    };
  } catch {
    return { keepMark: null, startupItem: null };
  }
}

async function outputFileOf(dir: string, fd: number): Promise<string | null> {
  try {
    const target = await readlink(`${dir}/fd/${fd}`);
    if (!target.startsWith("/") || target.startsWith("/dev/")) return null;
    if (target.endsWith(" (deleted)")) return null;
    return (await stat(target)).isFile() ? target : null;
  } catch {
    return null;
  }
}

function rssOf(status: string): number {
  const line = status.split("\n").find((l) => l.startsWith("VmRSS:"));
  const kb = line === undefined ? 0 : Number.parseInt(line.slice(6), 10);
  return Number.isFinite(kb) ? kb * 1024 : 0;
}

async function readProcess(
  procRoot: string,
  pid: number,
  scannedAt: number,
  uptimeMs: number,
): Promise<ScannedProcess | null> {
  const dir = `${procRoot}/${pid}`;
  try {
    const [statText, status, cmdlineRaw] = await Promise.all([
      readFile(`${dir}/stat`, "utf8"),
      readFile(`${dir}/status`, "utf8"),
      readFile(`${dir}/cmdline`),
    ]);
    const fields = statText.slice(statText.lastIndexOf(")") + 2).split(" ");
    if (fields[0] === "Z" || fields[0] === "X") return null;
    const cmdline = cmdlineRaw
      .subarray(0, CMDLINE_MAX_BYTES)
      .toString("utf8")
      .replaceAll("\0", " ")
      .trim();
    if (cmdline === "") return null;
    const startTicks = Number(fields[19]);
    const [outputPath, { keepMark, startupItem }] = await Promise.all([
      outputFileOf(dir, 1).then((path) => path ?? outputFileOf(dir, 2)),
      readMarks(dir),
    ]);
    return {
      pid,
      ppid: Number(fields[1]),
      pgrp: Number(fields[2]),
      sid: Number(fields[3]),
      startTicks,
      startedAtMs: Math.round(
        scannedAt - (uptimeMs - (startTicks / CLK_TCK) * 1000),
      ),
      cpuTicks: Number(fields[11]) + Number(fields[12]),
      rssBytes: rssOf(status),
      cmdline,
      outputPath,
      keepMark,
      startupItem,
    };
  } catch {
    return null;
  }
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Reads the pod's process table from /proc for the
 * process inventory. It reads each process's parent, process group, session,
 * start time, CPU ticks, resident memory, command line, and the regular file
 * behind stdout or stderr, if any. A process that vanishes mid-read is
 * skipped. From the environment it takes the PLATFORM_KEEP and
 * PLATFORM_STARTUP values alone and drops every other variable at once,
 * because agents hold credentials there.
 */
export function createProcessTable(procRoot = "/proc"): ProcessTable {
  return {
    async scan() {
      const [entries, uptime] = await Promise.all([
        readdir(procRoot),
        readFile(`${procRoot}/uptime`, "utf8"),
      ]);
      const scannedAt = Date.now();
      const uptimeMs = Number.parseFloat(uptime) * 1000;
      const pids = entries
        .map(Number)
        .filter((pid) => Number.isInteger(pid) && pid > 0);
      const read = await Promise.all(
        pids.map((pid) => readProcess(procRoot, pid, scannedAt, uptimeMs)),
      );
      return {
        scannedAt,
        processes: read.filter((p): p is ScannedProcess => p !== null),
      };
    },

    async bootId() {
      try {
        const id = await readFile(
          `${procRoot}/sys/kernel/random/boot_id`,
          "utf8",
        );
        return id.trim() || null;
      } catch {
        return null;
      }
    },
  };
}
