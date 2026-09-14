import { rruleToText } from "api-server-api";

import type { Schedule } from "../../../types.js";

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function formatRunTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const time = date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  const dayDiff = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (dayDiff === 0) return `today at ${time}`;
  if (dayDiff === 1) return `yesterday at ${time}`;
  const day = date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
  return `${day} at ${time}`;
}

export function scheduleCadenceText(schedule: Schedule): string {
  if (schedule.type === "rrule" && schedule.rrule)
    return rruleToText(schedule.rrule);
  return schedule.cron ?? "";
}

export interface LastRunStatus {
  label: string;
  className: string;
}

export function lastRunStatus(lastResult?: string): LastRunStatus | null {
  if (!lastResult) return null;
  if (lastResult === "success")
    return { label: "Succeeded", className: "text-success" };
  return { label: `Failed: ${lastResult}`, className: "text-destructive" };
}

export function declinedSummary(status?: {
  declinedCount?: number;
  lastDeclinedAt?: string;
}): string | null {
  const count = status?.declinedCount ?? 0;
  if (count === 0) return null;
  const times = count === 1 ? "once" : `${count} times`;
  return status?.lastDeclinedAt
    ? `Declined ${times} · last: ${formatRunTime(status.lastDeclinedAt)}`
    : `Declined ${times}`;
}

const CLAMP_CHARS = 300;

export function clampText(text: string, max: number = CLAMP_CHARS): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}
