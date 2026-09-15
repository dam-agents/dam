import type { PrecheckVerdict } from "api-server-api";

export type CounterWrite = { kind: "increment" } | { kind: "set"; value: 0 };

const increment: CounterWrite = { kind: "increment" };
const reset: CounterWrite = { kind: "set", value: 0 };

export interface ScheduleStatusPatch {
  lastFiredAt?: Date;
  lastFiredResult?: string;
  lastDeclinedAt: Date | null;
  declinedCount: CounterWrite;
  lastPrecheckError: string | null;
  precheckFailedCount: CounterWrite;
}

export function statusForVerdict(
  verdict: PrecheckVerdict,
  at: Date,
  detail: string | null,
): ScheduleStatusPatch {
  if (verdict === "declined")
    return {
      lastDeclinedAt: at,
      declinedCount: increment,
      lastPrecheckError: null,
      precheckFailedCount: reset,
    };

  const broke = verdict === "precheck-failed";
  return {
    lastFiredAt: at,
    lastFiredResult: "success",
    lastDeclinedAt: null,
    declinedCount: reset,
    lastPrecheckError: broke ? detail : null,
    precheckFailedCount: broke ? increment : reset,
  };
}
