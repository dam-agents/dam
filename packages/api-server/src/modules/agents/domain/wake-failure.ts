export type WakeFailureCause =
  | { kind: "not-found" }
  | { kind: "over-budget"; message: string }
  | { kind: "hibernated-not-started" }
  | { kind: "sandbox-failed"; terminationReason: string }
  | { kind: "sandbox-not-ready" }
  | { kind: "gateway-not-ready" }
  | { kind: "gateway-failed"; gatewayReason: string }
  | { kind: "reconcile-error"; message: string; backoffExceeded: boolean }
  | { kind: "unknown" };

export interface WakeConditionsSnapshot {
  ready: boolean;
  hibernated: boolean;
  overBudget?: boolean;
  overBudgetMessage?: string;
  error?: string;
  errorReason?: string;
  sandboxTerminationReason?: string;
  sandboxNotReadyReason?: string;
  gatewayReady?: boolean;
  gatewayNotReadyReason?: string;
}

const SANDBOX_FAILURE_REASONS = new Set([
  "OutOfMemory",
  "ImagePullFailure",
  "InvalidImageName",
  "ContainerTerminated",
]);

export function classifyWakeFailure(
  s: WakeConditionsSnapshot | null,
): WakeFailureCause {
  if (s === null) return { kind: "not-found" };
  if (s.overBudget)
    return { kind: "over-budget", message: s.overBudgetMessage ?? "" };
  if (s.hibernated) return { kind: "hibernated-not-started" };
  if (s.error !== undefined) {
    return {
      kind: "reconcile-error",
      message: s.error,
      backoffExceeded: s.errorReason === "BackoffLimitExceeded",
    };
  }
  if (
    s.sandboxNotReadyReason !== undefined &&
    SANDBOX_FAILURE_REASONS.has(s.sandboxNotReadyReason)
  ) {
    return {
      kind: "sandbox-failed",
      terminationReason: s.sandboxNotReadyReason,
    };
  }
  if (s.sandboxNotReadyReason !== undefined) {
    return { kind: "sandbox-not-ready" };
  }
  if (s.gatewayReady === false) {
    if (
      s.gatewayNotReadyReason !== undefined &&
      SANDBOX_FAILURE_REASONS.has(s.gatewayNotReadyReason)
    ) {
      return {
        kind: "gateway-failed",
        gatewayReason: s.gatewayNotReadyReason,
      };
    }
    return { kind: "gateway-not-ready" };
  }
  return { kind: "unknown" };
}

export function wakeFailureReasonToken(c: WakeFailureCause): string {
  switch (c.kind) {
    case "sandbox-failed":
      return `wake-timeout:sandbox-failed:${c.terminationReason}`;
    case "gateway-failed":
      return `wake-timeout:gateway-failed:${c.gatewayReason}`;
    case "over-budget":
      return "wake-rejected:over-budget";
    default:
      return `wake-timeout:${c.kind}`;
  }
}

export function isTransientWakeFailure(c: WakeFailureCause): boolean {
  return (
    c.kind === "sandbox-not-ready" ||
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
        "starting this agent would exceed your compute budget — stop a running agent to free room"
      );
    case "hibernated-not-started":
      return "the sandbox was never started";
    case "sandbox-failed":
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
    case "sandbox-not-ready":
      return "the agent is still starting";
    case "gateway-not-ready":
      return "the agent's gateway is still starting";
    case "gateway-failed":
      switch (c.gatewayReason) {
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
