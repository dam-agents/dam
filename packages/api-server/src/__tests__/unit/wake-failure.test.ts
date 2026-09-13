// TEST_OVERVIEW: why an agent did not come up, read off its record when a wake times out. The record carries several partial facts — placement, node liveness, a supervisor's error, the sandbox's own state — and the classifier turns them into one cause the caller can act on. Getting the ranking wrong tells an owner to fix an image when the install is merely full, or to wait when nothing will ever happen.
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
    { name: "record gone", snapshot: null, expected: { kind: "not-found" } },
    {
      name: "still hibernated: nothing ever started it",
      snapshot: { ...base, hibernated: true },
      expected: { kind: "hibernated-not-started" },
    },
    {
      name: "no node has room",
      snapshot: { ...base, noCapacityMessage: "No node has 4 Gi free." },
      expected: { kind: "no-capacity", message: "No node has 4 Gi free." },
    },
    {
      name: "placed on a node that stopped heartbeating",
      snapshot: { ...base, assignedNode: "node-2", supervised: false },
      expected: { kind: "node-unreachable" },
    },
    {
      name: "image pull failure is its own cause",
      snapshot: {
        ...base,
        error: "pulling img: 401",
        errorReason: "ImagePullFailure",
      },
      expected: {
        kind: "sandbox-failed",
        terminationReason: "ImagePullFailure",
      },
    },
    {
      name: "any other reconcile error",
      snapshot: { ...base, error: "nft failed", errorReason: "ReconcileError" },
      expected: { kind: "reconcile-error", message: "nft failed" },
    },
    {
      name: "sandbox stopped on its own",
      snapshot: { ...base, sandboxNotReadyReason: "ContainerTerminated" },
      expected: {
        kind: "sandbox-failed",
        terminationReason: "ContainerTerminated",
      },
    },
    {
      name: "sandbox merely not up yet",
      snapshot: { ...base, sandboxNotReadyReason: "SandboxNotReady" },
      expected: { kind: "sandbox-not-ready" },
    },
    {
      name: "sandbox fine, gateway not up",
      snapshot: { ...base, gatewayReady: false },
      expected: { kind: "gateway-not-ready" },
    },
    {
      name: "nothing diagnostic",
      snapshot: base,
      expected: { kind: "unknown" },
    },
  ];

  for (const { name, snapshot, expected } of table) {
    it(name, () => {
      expect(classifyWakeFailure(snapshot)).toEqual(expected);
    });
  }

  // TEST_SCENARIO: an unplaced agent has no node, so "the node is not answering" must not be said of it.
  it("does not blame a node an unplaced agent does not have", () => {
    expect(
      classifyWakeFailure({ ...base, assignedNode: null, supervised: false })
        .kind,
    ).toBe("unknown");
  });

  it("ranks a reconcile error above the sandbox's own state", () => {
    expect(
      classifyWakeFailure({
        ...base,
        error: "boom",
        sandboxNotReadyReason: "ContainerTerminated",
      }).kind,
    ).toBe("reconcile-error");
  });
});

describe("wakeFailureReasonToken", () => {
  it("appends the termination reason for sandbox failures", () => {
    expect(
      wakeFailureReasonToken({
        kind: "sandbox-failed",
        terminationReason: "ImagePullFailure",
      }),
    ).toBe("wake-timeout:sandbox-failed:ImagePullFailure");
  });

  it("uses the kind for everything else", () => {
    expect(wakeFailureReasonToken({ kind: "gateway-not-ready" })).toBe(
      "wake-timeout:gateway-not-ready",
    );
  });
});

describe("isTransientWakeFailure", () => {
  it("marks what waiting can fix transient and the rest not", () => {
    expect(isTransientWakeFailure({ kind: "sandbox-not-ready" })).toBe(true);
    expect(isTransientWakeFailure({ kind: "gateway-not-ready" })).toBe(true);
    expect(isTransientWakeFailure({ kind: "node-unreachable" })).toBe(true);
    expect(isTransientWakeFailure({ kind: "no-capacity", message: "" })).toBe(
      true,
    );
    expect(isTransientWakeFailure({ kind: "unknown" })).toBe(true);
    expect(isTransientWakeFailure({ kind: "not-found" })).toBe(false);
    expect(isTransientWakeFailure({ kind: "hibernated-not-started" })).toBe(
      false,
    );
    expect(
      isTransientWakeFailure({
        kind: "sandbox-failed",
        terminationReason: "ContainerTerminated",
      }),
    ).toBe(false);
    expect(
      isTransientWakeFailure({ kind: "reconcile-error", message: "x" }),
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
        kind: "sandbox-failed",
        terminationReason: "ImagePullFailure",
      },
    });
    expect(err.message).toBe(
      "agent agent-1 did not become ready within 120s (the agent image cannot be pulled)",
    );
    expect(isAgentWakeTimeoutError(err)).toBe(true);
    expect(isAgentWakeTimeoutError(new Error("x"))).toBe(false);
  });

  it("never leaks raw reconcile messages into the description", () => {
    expect(
      describeWakeFailure({
        kind: "reconcile-error",
        message: "secret platform-conn-abc missing",
      }),
    ).not.toContain("platform-conn-abc");
  });
});
