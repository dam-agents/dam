export const CLK_TCK = 100;

export interface ScannedProcess {
  pid: number;
  ppid: number;
  pgrp: number;
  sid: number;
  startTicks: number;
  startedAtMs: number;
  cpuTicks: number;
  rssBytes: number;
  cmdline: string;
  outputPath: string | null;
  keepMark: string | null;
}

export interface ProcSnapshot {
  scannedAt: number;
  processes: ScannedProcess[];
}

export function procKey(p: Pick<ScannedProcess, "pid" | "startTicks">): string {
  return `${p.pid}:${p.startTicks}`;
}
