import type { Schedule } from "../../../types.js";

/** Why the schedule form can't open a schedule. */
export type ScheduleLock = "agent-managed" | "legacy-cron";

/**
 * Agent-created outranks the cron format: an agent can create either format,
 * and asking it in chat is the way out whichever one it picked. A user's own
 * cron schedule predates the rrule editor, which would rewrite its timing
 * rather than show it.
 */
export function scheduleLock(schedule: Schedule): ScheduleLock | null {
  if (schedule.createdBy === "agent") return "agent-managed";
  if (schedule.type !== "rrule") return "legacy-cron";
  return null;
}
