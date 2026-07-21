import type { ForkFailureReason } from "../../../events.js";

export type ForeignSub = string & { readonly __brand: "ForeignSub" };

export function toForeignSub(sub: string): ForeignSub {
  if (sub.length === 0) throw new Error("ForeignSub cannot be empty");
  return sub as ForeignSub;
}

/** Mirrors the Fork CR's status phase. `Hibernated` is the parked middle of
 *  the two-tier idle policy (#2843): pods torn down, identity retained, a
 *  fresh activity bump wakes it. `Completed` is legacy — per-turn forks were
 *  completed at turn end; durable forks never enter it. */
export type ForkPhase =
  | "Pending"
  | "Ready"
  | "Hibernated"
  | "Failed"
  | "Completed";

export interface ForkSpec {
  readonly agentId: string;
  readonly foreignSub: ForeignSub;
}

export interface ForkStatus {
  readonly phase: ForkPhase;
  readonly podIP?: string;
  readonly error?: { reason: ForkFailureReason; detail?: string };
}

/** Phases from which a fork can never serve a turn again — the slot must be
 *  cleared and rebuilt rather than resurfacing a stale failure. */
export function isDefunct(status: ForkStatus | null): boolean {
  return status?.phase === "Failed" || status?.phase === "Completed";
}
