import type { ScheduleStatus } from "./types.js";

export const ONCE_DELIVERY_WINDOW_MS = 24 * 60 * 60 * 1000;

export const OnceResult = {
  Delivering: "delivering",
  Success: "success",
  Missed: "missed",
} as const;

export type OnceState =
  | "pending"
  | "delivering"
  | "completed"
  | "missed"
  | "failed";

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

export function isOnceFinished(
  status: ScheduleStatus | null | undefined,
): boolean {
  const state = onceState(status);
  return state !== "pending" && state !== "delivering";
}
