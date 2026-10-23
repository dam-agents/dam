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
