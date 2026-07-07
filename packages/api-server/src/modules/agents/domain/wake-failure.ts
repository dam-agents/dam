/** Classification of a wake that did not reach Ready within the budget.
 *
 * The wake primitive polls only the boolean Ready condition; when the
 * deadline expires, the same Agent CR carries the controller's full
 * diagnosis (Ready reason, pod termination cause, gateway readiness,
 * reconcile errors). Classifying that snapshot is what turns "did not
 * become ready within 120s" into something a caller can act on and a
 * user can understand. The snapshot is the controller's last report,
 * not ground truth — a wedged reconciler freezes it, which is exactly
 * what `hibernated-not-scaled` captures.
 */

export type WakeFailureCause =
  | { kind: "not-found" }
  /** Ready reason still Hibernated at the deadline: scale-up was never
   *  observed (controller down, reconcile wedged, K8s API stalled). */
  | { kind: "hibernated-not-scaled" }
  /** The agent pod terminated abnormally; `terminationReason` is the
   *  controller-classified condition reason (OutOfMemory,
   *  ImagePullFailure, InvalidImageName, ContainerTerminated). */
  | { kind: "agent-pod-failed"; terminationReason: string }
  /** Pods exist and are progressing with no failure cause — the
   *  retriable class (slow image pull, volume attach, probes). */
  | { kind: "agent-pod-not-ready" }
  | { kind: "gateway-not-ready" }
  | { kind: "reconcile-error"; message: string; backoffExceeded: boolean }
  | { kind: "unknown" };

/** Condition snapshot the classifier consumes. Structural, so the
 *  infrastructure `InfraAgent` satisfies it without this domain file
 *  importing infrastructure types. */
export interface WakeConditionsSnapshot {
  ready: boolean;
  hibernated: boolean;
  /** Reconciled=False message. */
  error?: string;
  /** Reconciled condition reason when False. */
  reconciledReason?: string;
  /** AgentPodReady=False message (humanized termination cause). */
  podTerminationReason?: string;
  /** AgentPodReady condition reason token when False. */
  agentPodNotReadyReason?: string;
  /** GatewayPodReady condition is True. */
  gatewayPodReady?: boolean;
}

/** AgentPodReady reason tokens the controller stamps for abnormal
 *  termination (everything else is plain not-ready-yet). */
const POD_FAILURE_REASONS = new Set([
  "OutOfMemory",
  "ImagePullFailure",
  "InvalidImageName",
  "ContainerTerminated",
]);

export function classifyWakeFailure(
  s: WakeConditionsSnapshot | null,
): WakeFailureCause {
  if (s === null) return { kind: "not-found" };
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
  if (s.gatewayPodReady === false) return { kind: "gateway-not-ready" };
  return { kind: "unknown" };
}

/** Low-cardinality slug for events, audit lines, and log queries. */
export function wakeFailureReasonToken(c: WakeFailureCause): string {
  switch (c.kind) {
    case "agent-pod-failed":
      return `wake-timeout:agent-pod-failed:${c.terminationReason}`;
    default:
      return `wake-timeout:${c.kind}`;
  }
}

/** Progressing-without-a-failure-cause classes, where waiting longer or
 *  retrying is a sensible response. Hard causes need intervention. */
export function isTransientWakeFailure(c: WakeFailureCause): boolean {
  return (
    c.kind === "agent-pod-not-ready" ||
    c.kind === "gateway-not-ready" ||
    c.kind === "unknown"
  );
}

/** Short human cause fragment for error messages and logs. Never
 *  interpolates raw controller messages — those can carry resource
 *  names and belong in logs, not user-facing strings. */
export function describeWakeFailure(c: WakeFailureCause): string {
  switch (c.kind) {
    case "not-found":
      return "the agent no longer exists";
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
    case "reconcile-error":
      return "the agent's configuration could not be applied";
    case "unknown":
      return "no failure cause was reported";
  }
}

/** Thrown by the wake primitive when the Ready condition does not turn
 *  True within the budget. `failure` (not ES2022 `Error.cause`) carries
 *  the classified snapshot; the message stays humanized so callers that
 *  surface it verbatim still improve. */
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
      `agent ${args.agentId} did not become ready within ` +
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
