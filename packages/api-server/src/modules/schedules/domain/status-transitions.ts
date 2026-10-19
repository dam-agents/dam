import { OnceResult, type PrecheckVerdict } from "api-server-api";

export type CounterWrite = { kind: "increment" } | { kind: "set"; value: 0 };

const increment: CounterWrite = { kind: "increment" };
const reset: CounterWrite = { kind: "set", value: 0 };

export interface ScheduleStatusPatch {
  lastFiredAt?: Date;
  lastFiredResult?: string | null;
  lastDeclinedAt: Date | null;
  declinedCount: CounterWrite;
  lastPrecheckError: string | null;
  precheckFailedCount: CounterWrite;
}

const keptResults = new Set<string>([
  OnceResult.Success,
  OnceResult.Delivering,
]);

export function isFailureResult(result?: string | null): boolean {
  if (!result) return false;
  return !keptResults.has(result) && !result.startsWith("held:");
}

export function statusForVerdict(
  verdict: PrecheckVerdict,
  at: Date,
  detail: string | null,
  lastResult?: string | null,
): ScheduleStatusPatch {
  if (verdict === "declined")
    return {
      ...(isFailureResult(lastResult) ? { lastFiredResult: null } : {}),
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
