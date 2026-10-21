// TEST_OVERVIEW: a start that never came up leaves the runner's own explanation on the StartFailed condition, which hibernation does not touch. The Agent view must carry that failure while it is the current spec's, so a user who opens an agent that was put to sleep after a failed boot reads why it never ran, and must drop it once the spec changed or the failure is gone.
import type { RuntimeFeatures } from "agent-runtime-api";
import { toAgentView } from "api-server-api";
import { describe, expect, it } from "vitest";

import {
  assembleAgent,
  parseInfraAgent,
} from "../../modules/agents/infrastructure/agent-mappers.js";

function agentWithStartFailure(
  generation: number,
  conditions: { reason: string; message: string; observedGeneration: number },
) {
  return {
    metadata: { name: "a", generation },
    status: {
      conditions: [
        { type: "Ready", status: "False", reason: "Hibernated" },
        {
          type: "AgentPodReady",
          status: "False",
          reason: "Hibernated",
        },
        { type: "StartFailed", status: "True", ...conditions },
      ],
    },
  };
}

const view = (
  generation: number,
  conditions: Parameters<typeof agentWithStartFailure>[1],
) =>
  toAgentView(
    assembleAgent(
      parseInfraAgent(agentWithStartFailure(generation, conditions)),
      [],
      [],
      { container: 60, vm: 5 },
      false,
      undefined,
      {} as RuntimeFeatures,
      [],
      [],
    ),
  );

describe("startFailure", () => {
  // TEST_SCENARIO: a hibernated agent carries the failure that ended its start, so the app can say why it never came up.
  it("reports the failure of the current spec's start", () => {
    const got = view(3, {
      reason: "NeverReady",
      message: "the machine ran for 2m0s without answering",
      observedGeneration: 3,
    });
    expect(got.startFailure).toEqual({
      reason: "NeverReady",
      message: "the machine ran for 2m0s without answering",
    });
  });

  // TEST_SCENARIO: a failure the agent has already left behind is not the current start's, so it is not reported: one observed on an older generation belongs to the spec the user changed, and a condition that is no longer True belongs to a start that recovered.
  it("drops a failure of an older spec or one that cleared", () => {
    expect(
      view(3, {
        reason: "NeverReady",
        message: "the machine ran for 2m0s without answering",
        observedGeneration: 2,
      }).startFailure,
    ).toBeUndefined();
    const cleared = parseInfraAgent({
      metadata: { name: "a", generation: 3 },
      status: {
        conditions: [{ type: "Ready", status: "True", reason: "AllPodsReady" }],
      },
    });
    expect(cleared.startFailure).toBeUndefined();
  });
});
