// TEST_OVERVIEW: the sentence a person reads in chat when an agent will not start. Whoever writes in a channel need not be the agent's owner, so a refusal says only that the owner's agents are out of room — never the owner's figures, nor advice only the owner can follow.
import { describe, expect, it } from "vitest";

import { classifyWakeFailure } from "../../modules/agents/domain/wake-failure.js";
import { wakeFailureUserCopy } from "../../modules/channels/infrastructure/wake-failure-copy.js";

const notReady = { ready: false, hibernated: false } as const;

describe("wakeFailureUserCopy for a start failure", () => {
  it("names full storage instead of a generic crash", () => {
    const failure = classifyWakeFailure({
      ...notReady,
      agentPodNotReadyReason: "HomeVolumeFull",
    });
    expect(wakeFailureUserCopy(failure)).toContain("its storage is full");
    expect(wakeFailureUserCopy(failure)).not.toContain("crashed");
  });

  // TEST_SCENARIO: whoever wrote in a channel need not own the agent, so a full storage pool is the owner's, not the reader's, and the reader is told to contact the owner.
  it("speaks of the owner's storage, not the reader's", () => {
    const copy = wakeFailureUserCopy(
      classifyWakeFailure({
        ...notReady,
        agentPodNotReadyReason: "MachineStorageFull",
      }),
    );
    expect(copy).toContain("its owner's agents have run out of storage");
    expect(copy).not.toMatch(/\byour\b/i);
  });
});

describe("wakeFailureUserCopy for a refusal", () => {
  it.each([
    "Your VM agents' memory is full (6.0 of 8.0 GiB in use), so this agent can't start yet.",
    "starting this agent would take your running agents to 2/2 CPU and 4Gi/4Gi memory — disable agents you aren't using to free room",
    undefined,
  ])(
    "tells a channel only that the owner's agents are out of room (%s)",
    (overBudgetMessage) => {
      const copy = wakeFailureUserCopy(
        classifyWakeFailure({
          ...notReady,
          overBudget: true,
          overBudgetMessage,
        }),
      );
      expect(copy).toBe(
        "This agent can't start right now: its owner's agents are using all " +
          "the room they have. It may start by itself once room frees up; if it " +
          "doesn't, contact its owner.",
      );
    },
  );
});
