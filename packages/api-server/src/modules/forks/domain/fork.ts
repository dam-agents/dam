import type { ForkFailureReason } from "../../../events.js";

export type ForeignSub = string & { readonly __brand: "ForeignSub" };

export function toForeignSub(sub: string): ForeignSub {
  if (sub.length === 0) throw new Error("ForeignSub cannot be empty");
  return sub as ForeignSub;
}

export type ForkPhase = "Pending" | "Ready" | "Failed" | "Completed";

export interface ForkSpec {
  readonly instanceId: string;
  readonly foreignSub: ForeignSub;
  readonly sessionId?: string;
}

export interface ForkStatus {
  readonly phase: ForkPhase;
  readonly podIP?: string;
  readonly error?: { reason: ForkFailureReason; detail?: string };
}

export interface Fork {
  readonly forkId: string;
  readonly replyId: string;
  readonly spec: ForkSpec;
  readonly status: ForkStatus;
}

export function createFork(args: {
  forkId: string;
  replyId: string;
  spec: ForkSpec;
}): Fork {
  return {
    forkId: args.forkId,
    replyId: args.replyId,
    spec: args.spec,
    status: { phase: "Pending" },
  };
}

export type ForkTransitionError =
  | { kind: "IllegalTransition"; from: ForkPhase; to: ForkPhase }
  | { kind: "MissingPodIP" };

export type TransitionResult =
  | { ok: true; fork: Fork }
  | { ok: false; error: ForkTransitionError };

function illegal(from: ForkPhase, to: ForkPhase): TransitionResult {
  return { ok: false, error: { kind: "IllegalTransition", from, to } };
}

export function markReady(fork: Fork, podIP: string): TransitionResult {
  if (fork.status.phase !== "Pending") return illegal(fork.status.phase, "Ready");
  if (podIP.length === 0) return { ok: false, error: { kind: "MissingPodIP" } };
  return { ok: true, fork: { ...fork, status: { phase: "Ready", podIP } } };
}

export function markFailed(
  fork: Fork,
  reason: ForkFailureReason,
  detail?: string,
): TransitionResult {
  if (fork.status.phase !== "Pending" && fork.status.phase !== "Ready") {
    return illegal(fork.status.phase, "Failed");
  }
  return {
    ok: true,
    fork: { ...fork, status: { phase: "Failed", error: { reason, detail } } },
  };
}

export function markCompleted(fork: Fork): TransitionResult {
  if (fork.status.phase !== "Ready") return illegal(fork.status.phase, "Completed");
  return { ok: true, fork: { ...fork, status: { phase: "Completed" } } };
}

export function isTerminal(fork: Fork): boolean {
  return fork.status.phase === "Failed" || fork.status.phase === "Completed";
}
