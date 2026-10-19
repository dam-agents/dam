import { nextUtcMidnight, OnceResult, rruleToText } from "api-server-api";
import cronstrue from "cronstrue";

import { sameLocalDay } from "@/lib/format-time";

import type { Schedule } from "../../../types.js";
import { localResetTime } from "../../spend/lib/format.js";
import { scheduleOnceState } from "./once-schedule.js";

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

export const CRON_TIMEZONE = "UTC";

export function cronToText(cron: string): string {
  try {
    return cronstrue.toString(cron, { verbose: false });
  } catch {
    return cron;
  }
}

export function scheduleCadenceText(schedule: Schedule): string {
  switch (schedule.type) {
    case "once": {
      const when = schedule.at
        ? `Once · ${formatRunTime(schedule.at)}`
        : "Once";
      if (schedule.inSession === "continue")
        return `${when} · continues the session that scheduled it`;
      if (schedule.inSession === "report")
        return `${when} · reports back to the session that scheduled it`;
      return when;
    }
    case "rrule":
      return schedule.rrule ? rruleToText(schedule.rrule) : "";
    case "cron":
      return schedule.cron ?? "";
  }
}

export function runNowConfirmText(schedule: Schedule): string {
  const decides = schedule.precheck
    ? "The precheck decides it first, just as it would on a scheduled occurrence."
    : "The task runs once, just as it would on a scheduled occurrence.";
  const cadence = schedule.enabled
    ? "The next run is not moved."
    : "The schedule stays paused afterwards.";
  return `Run "${schedule.name}" now? ${decides} ${cadence}`;
}

export function runNowErrorText(detail: string): string {
  const reset = localResetTime(nextUtcMidnight());
  if (/spend ceiling/i.test(detail))
    return `Couldn't run schedule: the agent's owner reached the spend ceiling for today. The platform operator can raise it; otherwise wait until ${reset} your time.`;
  if (/spend limit/i.test(detail))
    return `Couldn't run schedule: the agent reached its spend limit for today. Continue it on Home, or wait until ${reset} your time.`;
  return detail ? `Couldn't run schedule: ${detail}` : "Couldn't run schedule";
}

export function runNowStartedText(schedule: Schedule): string {
  return schedule.precheck
    ? `Started "${schedule.name}" — the precheck decides next. A run appears under View results only if it allows.`
    : `Started "${schedule.name}" — the run appears under View results.`;
}

export interface LastRunStatus {
  label: string;
  className: string;
  failed: boolean;
}

export function lastRunStatus(lastResult?: string): LastRunStatus | null {
  if (!lastResult) return null;
  if (lastResult === OnceResult.Success)
    return { label: "Succeeded", className: "text-success", failed: false };
  if (lastResult === OnceResult.Delivering)
    return {
      label: "On its way",
      className: "text-muted-foreground",
      failed: false,
    };
  if (lastResult === OnceResult.Missed)
    return {
      label: "Missed: the agent could not take it in time",
      className: "text-danger",
      failed: true,
    };
  if (lastResult.startsWith("held:"))
    return {
      label: `Held: ${lastResult.slice("held:".length).trim()}`,
      className: "text-muted-foreground",
      failed: false,
    };
  return {
    label: `Failed: ${lastResult}`,
    className: "text-danger",
    failed: true,
  };
}

export function cardOutcome(schedule: Schedule): LastRunStatus | null {
  const status = lastRunStatus(schedule.status?.lastResult);
  if (!status) return null;
  if (schedule.type !== "once") return status.failed ? status : null;
  return scheduleOnceState(schedule) === "pending" ? null : status;
}

export interface RunOutcomeLine {
  lastRunText: string | null;
  resultText: string;
  className: string;
}

export function runOutcomeLine(schedule: Schedule): RunOutcomeLine | null {
  const status = lastRunStatus(schedule.status?.lastResult);
  if (!status) return null;
  const lastRun = schedule.status?.lastRun;
  return {
    lastRunText: lastRun ? formatRunTime(lastRun) : null,
    resultText: `Last result: ${status.label}`,
    className: status.className,
  };
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
