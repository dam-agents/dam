import { ONCE_DELIVERY_WINDOW_MS } from "api-server-api";
import type { ScheduleSpecOnce, ScheduleStatus } from "api-server-api";
import { localToInstant } from "./recurrences.js";

const CREATE_SKEW_MS = 60_000;

export function onceFireAt(
  spec: ScheduleSpecOnce,
  status: ScheduleStatus | undefined,
  now: Date,
): Date | null {
  if (status?.lastRun) return null;
  const at = new Date(spec.at);
  return now < onceExpiry(spec) ? at : null;
}

export function onceExpiry(spec: ScheduleSpecOnce): Date {
  return new Date(new Date(spec.at).getTime() + ONCE_DELIVERY_WINDOW_MS);
}

export function resolveOnceMoment(
  local: string | undefined,
  timezone: string,
  now: Date,
): Date {
  if (local === undefined) return now;
  const at = localToInstant(local, timezone);
  if (at.getTime() < now.getTime() - CREATE_SKEW_MS)
    throw new Error(`${local} ${timezone} is in the past`);
  return at;
}
