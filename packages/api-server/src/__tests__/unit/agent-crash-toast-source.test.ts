// TEST_OVERVIEW: what makes the UI announce "<agent> crashed". It fires on podTerminationReason, which is derived from the AgentPodReady condition — and the vm backend publishes a message on that condition for ordinary progressing states, so deriving it from "a message is present" turned every VM runner start into a crash toast.
import { describe, expect, it } from "vitest";

import { parseInfraAgent } from "../../modules/agents/infrastructure/agent-mappers.js";

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
