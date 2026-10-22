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

  it("reads a runner that cannot reach its node's image cache as an error", () => {
    expect(computeAgentState(notReady("MachineImageCacheUnreachable"))).toBe(
      "error",
    );
  });

  it("reads a runner no node can place as an error", () => {
    expect(computeAgentState(notReady("MachineRunnerUnschedulable"))).toBe(
      "error",
    );
  });

  it("reads a machine refused for its owner's full storage as an error", () => {
    expect(computeAgentState(notReady("MachineStorageFull"))).toBe("error");
  });

  it("reads a runner whose node the cluster has lost as an error, not as one still starting", () => {
    expect(computeAgentState(notReady("MachineRunnerNodeLost"))).toBe("error");
  });

  // TEST_SCENARIO: a start held past the bound ends in a state of its own rather than waiting for ever, and it names a person's problem: the node never reported the grant, so only an admin can check the cluster.
  it("reads a grant the node never reported as an error once the hold ends, not as one still waiting", () => {
    expect(computeAgentState(notReady("MachineAllocationUnreadable"))).toBe(
      "error",
    );
  });

  // TEST_SCENARIO: a start waiting for the node is pinned in both spellings it reaches the state machine in: the controller's own on Ready, and the runner's on the Agent pod condition, whose `Machine` prefix is what every terminal machine reason carries.
  it("leaves a start waiting for the node to grant its runner memory as starting", () => {
    expect(computeAgentState(notReady("AwaitingAllocation"))).toBe("starting");
    expect(computeAgentState(notReady("MachineAwaitingAllocation"))).toBe(
      "starting",
    );
  });

  // TEST_SCENARIO: a start held back by the machines a runner restart is still bringing back is a start in progress: nothing is refused, and the owner's pool holds it once they have settled.
  it("leaves a start waiting for its owner's warm-up as starting", () => {
    expect(computeAgentState(notReady("AwaitingWarmUp"))).toBe("starting");
  });

  it("leaves a machine that is merely coming up as starting", () => {
    expect(computeAgentState(notReady("MachineNotReady"))).toBe("starting");
    expect(computeAgentState(notReady())).toBe("starting");
  });

  it("leaves a machine rebooting after its runner's OOM kill as starting", () => {
    expect(computeAgentState(notReady("RunnerOutOfMemory"))).toBe("starting");
  });

  it("reads a machine its hibernation is still stopping as hibernating, not as starting", () => {
    expect(computeAgentState(notReady("MachineStopping"))).toBe("hibernating");
  });
});
