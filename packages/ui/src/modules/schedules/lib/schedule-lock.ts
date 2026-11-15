import type { Schedule } from "../../../types.js";
import { isPastOnce, scheduleOnceState } from "./once-schedule.js";

export type ScheduleLock = "agent-managed" | "once-fired" | "runs-once";

/* UNIT_BOUNDARY_DESCRIPTION: why a schedule's editor does not open. Without the one-time-tasks feature the UI has no editor for a one-time task, so one an agent or the API made reads as a locked row the owner can only delete, as before the feature. */
export function scheduleLock(
  schedule: Schedule,
  oneTimeTasks: boolean,
): ScheduleLock | null {
  if (schedule.type === "once" && !oneTimeTasks) return "runs-once";
  if (isPastOnce(schedule) || scheduleOnceState(schedule) === "delivering")
    return "once-fired";
  if (schedule.createdBy === "agent") return "agent-managed";
  return null;
}
