// TEST_OVERVIEW: what a user sees when a vm agent's machine will not start. The controller publishes why on the Agent's readiness condition; a reason that needs a person has to read as an error rather than as an agent still coming up, or the chat view spins forever with its message box disabled and no way to retry.
import { describe, expect, it } from "vitest";

import {
  computeAgentState,
  type InfraAgent,
} from "../../modules/agents/infrastructure/agent-mappers.js";

function notReady(reason?: string): InfraAgent {
  return {
    ready: false,
    hibernated: false,
    overBudget: false,
    agentPodReady: false,
    gatewayPodReady: true,
    agentPodNotReadyReason: reason,
  } as InfraAgent;
}

describe("computeAgentState with a machine reason", () => {
  it("reads a machine that will not boot as an error, not as one still starting", () => {
    expect(computeAgentState(notReady("MachineBootFailed"))).toBe("error");
  });

  it("reads an image the runner cannot get as an error", () => {
    expect(computeAgentState(notReady("MachineImageUnavailable"))).toBe(
      "error",
    );
  });

  it("reads a machine pinned to an address its gateway no longer has as an error", () => {
    expect(computeAgentState(notReady("MachineEgressChanged"))).toBe("error");
  });

  it("leaves a machine that is merely coming up as starting", () => {
    expect(computeAgentState(notReady("MachineNotReady"))).toBe("starting");
    expect(computeAgentState(notReady())).toBe("starting");
  });
});
