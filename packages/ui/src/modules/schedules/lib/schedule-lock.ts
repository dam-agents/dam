import type { Schedule } from "../../../types.js";
import { isPastOnce, scheduleOnceState } from "./once-schedule.js";

export type ScheduleLock = "agent-managed" | "once-fired";

export function scheduleLock(schedule: Schedule): ScheduleLock | null {
  if (isPastOnce(schedule) || scheduleOnceState(schedule) === "delivering")
    return "once-fired";
  if (schedule.createdBy === "agent") return "agent-managed";
  return null;
}
