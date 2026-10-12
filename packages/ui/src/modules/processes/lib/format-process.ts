import { formatBytes } from "../../../lib/format-size.js";
import { formatDuration } from "../../../lib/format-time.js";

export function formatRunTime(startedAt: string, now: Date): string {
  return formatDuration(now.getTime() - Date.parse(startedAt));
}

export function formatCpu(cpuPercent: number | null): string | null {
  if (cpuPercent === null) return null;
  return `${cpuPercent < 10 ? cpuPercent.toFixed(1) : Math.round(cpuPercent)}% CPU`;
}

export function formatMemory(rssBytes: number | null): string | null {
  return rssBytes === null ? null : formatBytes(rssBytes);
}
