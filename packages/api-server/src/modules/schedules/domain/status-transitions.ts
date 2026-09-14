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

/**
 * UNIT_BOUNDARY_DESCRIPTION: The one place that says what each Precheck verdict
 * does to a Schedule's status, so the rules are readable and testable instead of
 * living inside two SQL `set` blocks nothing can reach. The two counters
 * deliberately reset on different events: a **decline** count answers "has this
 * check found anything since work last happened?", so a run clears it; a
 * **failure** count answers "is this check broken, or did it hiccup?", so only
 * the script running and returning a verdict at all clears it — a run cannot,
 * because a broken Precheck is what let that run happen and the count would
 * read one forever. Increments stay symbolic: the caller owns how a counter is
 * raised, this owns when.
 */
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
