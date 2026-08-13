import type { Schedule } from "../../../types.js";

export type ScheduleLock = "agent-managed" | "legacy-cron";

export function scheduleLock(schedule: Schedule): ScheduleLock | null {
  if (schedule.createdBy === "agent") return "agent-managed";
  if (schedule.type !== "rrule") return "legacy-cron";
  return null;
}
