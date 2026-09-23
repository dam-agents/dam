import type { Schedule } from "../../../types.js";
import { isPastOnce, scheduleOnceState } from "./once-schedule.js";

export type ScheduleLock = "agent-managed" | "legacy-cron" | "once-fired";

export function scheduleLock(schedule: Schedule): ScheduleLock | null {
  if (isPastOnce(schedule) || scheduleOnceState(schedule) === "delivering")
    return "once-fired";
  if (schedule.createdBy === "agent") return "agent-managed";
  if (schedule.type === "cron") return "legacy-cron";
  return null;
}
