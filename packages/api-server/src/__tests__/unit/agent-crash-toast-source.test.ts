// TEST_OVERVIEW: what makes the UI announce "<agent> crashed". It fires on podTerminationReason, which is derived from the AgentPodReady condition — and the vm backend publishes a message on that condition for ordinary progressing states, so deriving it from "a message is present" turned every VM runner start into a crash toast. That cause is cleared once the restarted agent is ready again, so the UI also watches the restart count and its cause, and both must reach the agent view.
import type { RuntimeFeatures } from "agent-runtime-api";
import { toAgentView } from "api-server-api";
import { describe, expect, it } from "vitest";

import {
  assembleAgent,
  parseInfraAgent,
} from "../../modules/agents/infrastructure/agent-mappers.js";

function agentWith(reason: string, message: string, status = "False") {
  return {
    metadata: { name: "a" },
    status: {
      conditions: [
        { type: "AgentPodReady", status, reason, message },
        { type: "GatewayPodReady", status: "True", reason: "PodReady" },
      ],
    },
  };
}

describe("podTerminationReason", () => {
  it("stays unset while a vm agent waits for its owner's runner", () => {
    const infra = parseInfraAgent(
      agentWith("MachineNotReady", "the owner's VM runner is still starting"),
    );
    expect(infra.podTerminationReason).toBeUndefined();
  });

  it("stays unset for a machine that is merely booting", () => {
    const infra = parseInfraAgent(
      agentWith("MachineNotReady", "machine is creating"),
    );
    expect(infra.podTerminationReason).toBeUndefined();
  });

  it("reports a machine that failed to boot", () => {
    const infra = parseInfraAgent(
      agentWith("MachineBootFailed", "smolvm machine start: exit status 1"),
    );
    expect(infra.podTerminationReason).toBe(
      "smolvm machine start: exit status 1",
    );
  });

  it("still reports a container agent that was OOM-killed", () => {
    const infra = parseInfraAgent(
      agentWith("OutOfMemory", "out of memory (OOMKilled)"),
    );
    expect(infra.podTerminationReason).toBe("out of memory (OOMKilled)");
  });
});

function viewOf(status: Record<string, unknown>) {
  const infra = parseInfraAgent({ metadata: { name: "a" }, status });
  return toAgentView(
    assembleAgent(
      infra,
      [],
      [],
      60,
      false,
      undefined,
      {} as RuntimeFeatures,
      [],
      [],
    ),
  );
}

describe("restart count on the agent view", () => {
  // TEST_SCENARIO: the agent was OOM-killed and is ready again, so its AgentPodReady condition no longer names a cause. The restart count and its cause are then the only sign, and the view must carry both.
  it("carries an OOM restart through to the view after the agent recovered", () => {
    const view = viewOf({
      conditions: [
        { type: "AgentPodReady", status: "True", reason: "PodReady" },
        { type: "GatewayPodReady", status: "True", reason: "PodReady" },
        { type: "Ready", status: "True", reason: "AllPodsReady" },
      ],
      agentPodRestarts: 2,
      agentPodRestartReason: "OutOfMemory",
    });
    expect(view).toMatchObject({
      state: "running",
      podRestarts: 2,
      podRestartReason: "OutOfMemory",
    });
    expect(view.podTerminationReason).toBeUndefined();
  });

  // TEST_SCENARIO: a pod that never restarted publishes no count. The view must say zero, so the UI has a baseline to compare the next refresh with.
  it("reports zero restarts when status has none", () => {
    const view = viewOf({ conditions: [] });
    expect(view.podRestarts).toBe(0);
    expect(view.podRestartReason).toBeUndefined();
  });
});
