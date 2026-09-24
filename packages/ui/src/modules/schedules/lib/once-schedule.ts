import { type OnceState, onceState } from "api-server-api";

import type { Schedule } from "../../../types.js";

export function scheduleOnceState(schedule: Schedule): OnceState | null {
  return schedule.type === "once" ? onceState(schedule.status) : null;
}

export function isUpcoming(schedule: Schedule): boolean {
  const state = scheduleOnceState(schedule);
  if (state === null) return schedule.enabled;
  return state === "pending" || state === "delivering";
}

export function isPastOnce(schedule: Schedule): boolean {
  return schedule.type === "once" && !isUpcoming(schedule);
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
