import { rruleToText } from "api-server-api";

import type { Schedule } from "../../../types.js";

/** Coarse "in N min / h / d" relative to now, for surfacing a schedule's next
 *  run at a glance. The absolute time stays available on hover/title. */
export function relativeFromNow(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return "due";
  const min = Math.round(diff / 60_000);
  if (min < 1) return "< 1 min";
  if (min < 60) return `in ${min} min`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `in ${hr} h`;
  const d = Math.round(hr / 24);
  return `in ${d} d`;
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** A run's timestamp as "today at 7:30 AM" / "yesterday at 7:30 AM", falling
 *  back to "Jul 13 at 7:30 AM" (with the year once it differs from now). */
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

/** Human cadence line for a schedule's card face. */
export function scheduleCadenceText(schedule: Schedule): string {
  if (schedule.type === "rrule" && schedule.rrule)
    return rruleToText(schedule.rrule);
  return schedule.cron ?? "";
}

export interface LastRunStatus {
  label: string;
  className: string;
}

/** Maps a schedule's most-recent `status.lastResult` to a coloured label.
 *  `lastResult` is one of "success", "skipped: quiet hours", or an error
 *  message. */
export function lastRunStatus(lastResult?: string): LastRunStatus | null {
  if (!lastResult) return null;
  if (lastResult === "success")
    return { label: "Succeeded", className: "text-success" };
  if (lastResult === "skipped: quiet hours")
    return {
      label: "Skipped (quiet hours)",
      className: "text-muted-foreground",
    };
  return { label: `Failed: ${lastResult}`, className: "text-destructive" };
}
