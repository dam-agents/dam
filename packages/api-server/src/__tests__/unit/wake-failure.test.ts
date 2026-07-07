import { describe, it, expect } from "vitest";
import {
  AgentWakeTimeoutError,
  classifyWakeFailure,
  describeWakeFailure,
  isAgentWakeTimeoutError,
  isTransientWakeFailure,
  wakeFailureReasonToken,
  type WakeConditionsSnapshot,
  type WakeFailureCause,
} from "../../modules/agents/domain/wake-failure.js";

const base: WakeConditionsSnapshot = { ready: false, hibernated: false };

describe("classifyWakeFailure", () => {
  const table: Array<{
    name: string;
    snapshot: WakeConditionsSnapshot | null;
    expected: WakeFailureCause;
  }> = [
    {
      name: "CR gone → not-found",
      snapshot: null,
      expected: { kind: "not-found" },
    },
    {
      name: "Ready still Hibernated → scale-up never observed",
      snapshot: { ...base, hibernated: true },
      expected: { kind: "hibernated-not-scaled" },
    },
    {
      name: "Reconciled=False → reconcile-error with message",
      snapshot: { ...base, error: "applying statefulset: forbidden" },
      expected: {
        kind: "reconcile-error",
        message: "applying statefulset: forbidden",
        backoffExceeded: false,
      },
    },
    {
      name: "BackoffLimitExceeded reason marks the reconcile error",
      snapshot: {
        ...base,
        error: "reconcile agent: backoff limit exceeded",
        reconciledReason: "BackoffLimitExceeded",
      },
      expected: {
        kind: "reconcile-error",
        message: "reconcile agent: backoff limit exceeded",
        backoffExceeded: true,
      },
    },
    {
      name: "ImagePullFailure → agent-pod-failed",
      snapshot: { ...base, agentPodNotReadyReason: "ImagePullFailure" },
      expected: {
        kind: "agent-pod-failed",
        terminationReason: "ImagePullFailure",
      },
    },
    {
      name: "OutOfMemory → agent-pod-failed",
      snapshot: { ...base, agentPodNotReadyReason: "OutOfMemory" },
      expected: { kind: "agent-pod-failed", terminationReason: "OutOfMemory" },
    },
    {
      name: "ContainerTerminated → agent-pod-failed",
      snapshot: { ...base, agentPodNotReadyReason: "ContainerTerminated" },
      expected: {
        kind: "agent-pod-failed",
        terminationReason: "ContainerTerminated",
      },
    },
    {
      name: "plain PodNotReady → progressing (slow pull, attach, probes)",
      snapshot: { ...base, agentPodNotReadyReason: "PodNotReady" },
      expected: { kind: "agent-pod-not-ready" },
    },
    {
      name: "agent pod fine, gateway False → gateway-not-ready",
      snapshot: { ...base, gatewayPodReady: false },
      expected: { kind: "gateway-not-ready" },
    },
    {
      name: "nothing diagnostic on the CR → unknown",
      snapshot: base,
      expected: { kind: "unknown" },
    },
  ];

  for (const { name, snapshot, expected } of table) {
    it(name, () => {
      expect(classifyWakeFailure(snapshot)).toEqual(expected);
    });
  }

  it("reconcile-error wins over pod reasons (precedence)", () => {
    expect(
      classifyWakeFailure({
        ...base,
        error: "boom",
        agentPodNotReadyReason: "ImagePullFailure",
      }).kind,
    ).toBe("reconcile-error");
  });
});

describe("wakeFailureReasonToken", () => {
  it("appends the termination reason for pod failures", () => {
    expect(
      wakeFailureReasonToken({
        kind: "agent-pod-failed",
        terminationReason: "ImagePullFailure",
      }),
    ).toBe("wake-timeout:agent-pod-failed:ImagePullFailure");
  });

  it("uses the kind for everything else", () => {
    expect(wakeFailureReasonToken({ kind: "gateway-not-ready" })).toBe(
      "wake-timeout:gateway-not-ready",
    );
  });
});

describe("isTransientWakeFailure", () => {
  it("marks progressing classes transient and hard causes not", () => {
    expect(isTransientWakeFailure({ kind: "agent-pod-not-ready" })).toBe(true);
    expect(isTransientWakeFailure({ kind: "gateway-not-ready" })).toBe(true);
    expect(isTransientWakeFailure({ kind: "unknown" })).toBe(true);
    expect(isTransientWakeFailure({ kind: "not-found" })).toBe(false);
    expect(isTransientWakeFailure({ kind: "hibernated-not-scaled" })).toBe(
      false,
    );
    expect(
      isTransientWakeFailure({
        kind: "agent-pod-failed",
        terminationReason: "OutOfMemory",
      }),
    ).toBe(false);
    expect(
      isTransientWakeFailure({
        kind: "reconcile-error",
        message: "x",
        backoffExceeded: false,
      }),
    ).toBe(false);
  });
});

describe("AgentWakeTimeoutError", () => {
  it("carries a humanized message and the classified failure", () => {
    const err = new AgentWakeTimeoutError({
      agentId: "agent-1",
      timeoutMs: 120_000,
      durationMs: 120_400,
      failure: {
        kind: "agent-pod-failed",
        terminationReason: "ImagePullFailure",
      },
    });
    expect(err.message).toBe(
      "agent agent-1 did not become ready within 120s (the agent image cannot be pulled)",
    );
    expect(isAgentWakeTimeoutError(err)).toBe(true);
    expect(isAgentWakeTimeoutError(new Error("x"))).toBe(false);
  });

  it("never leaks raw controller messages into the description", () => {
    expect(
      describeWakeFailure({
        kind: "reconcile-error",
        message: "secret platform-conn-abc missing",
        backoffExceeded: false,
      }),
    ).not.toContain("platform-conn-abc");
  });
});
