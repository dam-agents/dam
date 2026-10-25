import type { ScheduleStatus } from "./types.js";

export const ONCE_DELIVERY_WINDOW_MS = 24 * 60 * 60 * 1000;

export const OnceResult = {
  Delivering: "delivering",
  Success: "success",
  Missed: "missed",
} as const;

export type OnceState =
  "pending" | "delivering" | "completed" | "missed" | "failed";

export function onceState(
  status: ScheduleStatus | null | undefined,
): OnceState {
  if (!status?.lastRun) return "pending";
  switch (status.lastResult) {
    case OnceResult.Delivering:
      return "delivering";
    case OnceResult.Success:
      return "completed";
    case OnceResult.Missed:
      return "missed";
    default:
      return "failed";
  }
}

export interface LocalDateTime {
  date: string;
  time: string;
}

export function localDateTimeIn(
  instant: Date,
  timeZone: string,
): LocalDateTime {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const f = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return {
    date: `${f.year}-${f.month}-${f.day}`,
    time: `${f.hour}:${f.minute}`,
  };
}
