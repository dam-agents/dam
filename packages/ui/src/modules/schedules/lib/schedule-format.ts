import { rruleToText } from "api-server-api";

import { sameLocalDay } from "@/lib/format-time";

import type { Schedule } from "../../../types.js";

export function formatRunTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const time = date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  if (sameLocalDay(date, now)) return `today at ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (sameLocalDay(date, yesterday)) return `yesterday at ${time}`;
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

interface LastRunStatus {
  label: string;
  className: string;
}

export function lastRunStatus(lastResult?: string): LastRunStatus | null {
  if (!lastResult) return null;
  if (lastResult === "success")
    return { label: "Succeeded", className: "text-success" };
  if (lastResult.startsWith("held:"))
    return {
      label: `Held: ${lastResult.slice("held:".length).trim()}`,
      className: "text-muted-foreground",
    };
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
    ? `Declined ${times} since the last run · last: ${formatRunTime(status.lastDeclinedAt)}`
    : `Declined ${times} since the last run`;
}

const CLAMP_CHARS = 300;

export function clampText(text: string, max: number = CLAMP_CHARS): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

interface PrecheckAlert {
  text: string;
  reason: string;
  urgent: boolean;
}

export function precheckAlert(schedule: Schedule): PrecheckAlert | null {
  const reason = schedule.status?.lastPrecheckError;
  if (!reason || !schedule.precheck) return null;
  const count = schedule.status?.precheckFailedCount ?? 0;
  const failed =
    count > 1 ? `Precheck failed ${count} times in a row` : "Precheck failed";
  return {
    text: schedule.enabled ? `${failed} — running every time` : failed,
    reason: clampText(reason),
    urgent: schedule.enabled,
  };
}
