export type WakeFailureCause =
  | { kind: "not-found" }
  | { kind: "over-budget"; message: string }
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

const POD_FAILURE_REASONS = new Set([
  "OutOfMemory",
  "ImagePullFailure",
  "InvalidImageName",
  "ContainerTerminated",
]);

const GATEWAY_FAILURE_REASONS = new Set([
  ...POD_FAILURE_REASONS,
  "StuckOnSupersededRevision",
]);

export function classifyWakeFailure(
  s: WakeConditionsSnapshot | null,
): WakeFailureCause {
  if (s === null) return { kind: "not-found" };
  if (s.overBudget)
    return { kind: "over-budget", message: s.overBudgetMessage ?? "" };
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
      return (
        c.message ||
        "starting this agent would exceed your compute budget — stop a running sandbox to free room"
      );
    case "hibernated-not-scaled":
      return "scale-up was never started";
    case "agent-pod-failed":
      switch (c.terminationReason) {
        case "OutOfMemory":
          return "the agent ran out of memory";
        case "ImagePullFailure":
          return "the agent image cannot be pulled";
        case "InvalidImageName":
          return "the agent image reference is invalid";
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
      args.failure.kind === "over-budget"
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
