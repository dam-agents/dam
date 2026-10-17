import { TerminationCode } from "api-server-api";
import { storageFullMessage } from "../../budgets/domain/vm-usage.js";
export type WakeFailureCause =
  | { kind: "not-found" }
  | { kind: "over-budget"; message: string }
  | { kind: "migrating" }
  | { kind: "migration-failed" }
  | { kind: "hibernated-not-scaled" }
  | { kind: "agent-pod-failed"; terminationReason: string }
  | { kind: "agent-pod-not-ready" }
  | { kind: "gateway-not-ready" }
  | { kind: "gateway-pod-failed"; gatewayReason: string }
  | { kind: "reconcile-error"; message: string; backoffExceeded: boolean }
  | { kind: "unknown" };

export interface WakeConditionsSnapshot {
  ready: boolean;
  hibernated: boolean;
  overBudget?: boolean;
  overBudgetMessage?: string;
  error?: string;
  reconciledReason?: string;
  podTerminationReason?: string;
  agentPodNotReadyReason?: string;
  gatewayPodReady?: boolean;
  gatewayPodNotReadyReason?: string;
}

export const POD_FAILURE_REASONS: ReadonlySet<string> = new Set([
  TerminationCode.OutOfMemory,
  TerminationCode.HomeVolumeFull,
  TerminationCode.ImagePullFailure,
  TerminationCode.InvalidImageName,
  TerminationCode.ContainerTerminated,
  TerminationCode.MachineBootFailed,
  TerminationCode.MachineImageUnavailable,
  TerminationCode.MachineRunnerUnschedulable,
  TerminationCode.RunnerOutOfMemory,
  TerminationCode.MachineStorageFull,
]);

export const GATEWAY_FAILURE_REASONS = new Set([
  ...POD_FAILURE_REASONS,
  "StuckOnSupersededRevision",
]);
// UNIT_BOUNDARY_DESCRIPTION: the runner's refusals of a vm machine's start that a wait cannot outgrow: the owner's VM storage is full, the image cannot be pulled or unpacked, or the guest did not boot. A wake fails on one at once rather than at its timeout. An unschedulable runner is left out, because a node can free up or be added while the wake waits. A pull or boot still in progress reads MachineNotReady, so it never matches.
export const REFUSED_START_REASONS: ReadonlySet<string> = new Set([
  TerminationCode.MachineStorageFull,
  TerminationCode.MachineImageUnavailable,
  TerminationCode.MachineBootFailed,
]);

export function classifyWakeFailure(
  s: WakeConditionsSnapshot | null,
): WakeFailureCause {
  if (s === null) return { kind: "not-found" };
  if (s.overBudget)
    return {
      kind: "over-budget",
      message:
        s.overBudgetMessage ||
        "starting this agent would exceed your compute budget — disable agents you aren't using to free room",
    };
  if (s.hibernated) return { kind: "hibernated-not-scaled" };
  if (s.error !== undefined) {
    return {
      kind: "reconcile-error",
      message: s.error,
      backoffExceeded: s.reconciledReason === "BackoffLimitExceeded",
    };
  }
  if (
    s.agentPodNotReadyReason !== undefined &&
    POD_FAILURE_REASONS.has(s.agentPodNotReadyReason)
  ) {
    return {
      kind: "agent-pod-failed",
      terminationReason: s.agentPodNotReadyReason,
    };
  }
  if (s.agentPodNotReadyReason !== undefined) {
    return { kind: "agent-pod-not-ready" };
  }
  if (s.gatewayPodReady === false) {
    if (
      s.gatewayPodNotReadyReason !== undefined &&
      GATEWAY_FAILURE_REASONS.has(s.gatewayPodNotReadyReason)
    ) {
      return {
        kind: "gateway-pod-failed",
        gatewayReason: s.gatewayPodNotReadyReason,
      };
    }
    return { kind: "gateway-not-ready" };
  }
  return { kind: "unknown" };
}

export function wakeFailureReasonToken(c: WakeFailureCause): string {
  switch (c.kind) {
    case "agent-pod-failed":
      return `wake-timeout:agent-pod-failed:${c.terminationReason}`;
    case "gateway-pod-failed":
      return `wake-timeout:gateway-pod-failed:${c.gatewayReason}`;
    case "over-budget":
      return "wake-rejected:over-budget";
    case "migrating":
      return "wake-rejected:migrating";
    case "migration-failed":
      return "wake-rejected:migration-failed";
    default:
      return `wake-timeout:${c.kind}`;
  }
}

export function isTransientWakeFailure(c: WakeFailureCause): boolean {
  return (
    c.kind === "agent-pod-not-ready" ||
    c.kind === "gateway-not-ready" ||
    c.kind === "unknown"
  );
}

export function describeWakeFailure(c: WakeFailureCause): string {
  switch (c.kind) {
    case "not-found":
      return "the agent no longer exists";
    case "over-budget":
      return c.message;
    case "migrating":
      return "the agent is moving to the new runtime";
    case "migration-failed":
      return "the agent's move to the new runtime failed, and it stays asleep until its owner retries or aborts the move";
    case "hibernated-not-scaled":
      return "the platform didn't start it";
    case "agent-pod-failed":
      switch (c.terminationReason) {
        case "OutOfMemory":
          return "the agent ran out of memory";
        case "HomeVolumeFull":
          return "the agent's storage is full";
        case "ImagePullFailure":
          return "the agent image cannot be pulled";
        case "InvalidImageName":
          return "the agent image reference is invalid";
        case "MachineImageUnavailable":
          return "the agent image is not available";
        case "MachineBootFailed":
          return "its VM didn't boot";
        case "MachineRunnerUnschedulable":
          return "no server can run it right now — tell an admin";
        case "RunnerOutOfMemory":
          return "its owner's VM agents ran out of memory together and all restarted — disabling agents that aren't in use frees memory";
        case "MachineStorageFull":
          return storageFullMessage();
        default:
          return "the agent crashed while starting";
      }
    case "agent-pod-not-ready":
      return "the agent is still starting";
    case "gateway-not-ready":
      return "the agent's gateway is still starting";
    case "gateway-pod-failed":
      switch (c.gatewayReason) {
        case "StuckOnSupersededRevision":
          return "the agent's gateway is stuck on an outdated configuration and has not been replaced yet";
        case "OutOfMemory":
          return "the agent's gateway ran out of memory";
        case "ImagePullFailure":
        case "InvalidImageName":
          return "the agent's gateway image cannot be pulled";
        default:
          return "the agent's gateway crashed while starting";
      }
    case "reconcile-error":
      return "the agent's configuration could not be applied";
    case "unknown":
      return "no failure cause was reported";
  }
}

export class AgentWakeTimeoutError extends Error {
  readonly agentId: string;
  readonly timeoutMs: number;
  readonly durationMs: number;
  readonly failure: WakeFailureCause;

  constructor(args: {
    agentId: string;
    timeoutMs: number;
    durationMs: number;
    failure: WakeFailureCause;
  }) {
    super(
      args.durationMs < args.timeoutMs ||
        args.failure.kind === "over-budget" ||
        args.failure.kind === "migrating" ||
        args.failure.kind === "migration-failed"
        ? `agent ${args.agentId} was not started: ${describeWakeFailure(args.failure)}`
        : `agent ${args.agentId} did not become ready within ` +
            `${Math.round(args.timeoutMs / 1000)}s (${describeWakeFailure(args.failure)})`,
    );
    this.name = "AgentWakeTimeoutError";
    this.agentId = args.agentId;
    this.timeoutMs = args.timeoutMs;
    this.durationMs = args.durationMs;
    this.failure = args.failure;
  }
}

export function isAgentWakeTimeoutError(
  e: unknown,
): e is AgentWakeTimeoutError {
  return e instanceof AgentWakeTimeoutError;
}
