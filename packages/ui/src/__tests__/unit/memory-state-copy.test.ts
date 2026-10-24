// TEST_OVERVIEW: what a user reads about an agent refused for memory or storage, or put to sleep: the badge says "Waiting for memory" rather than "Over budget", an agent refused a start reads "Can't start" rather than "Error" on its badge and overlay, the row's state word takes its colour from what the agent is doing, a sleeping agent reads "Falling asleep" then "Sleeping", the overlay falls back to the VM memory sentence when the refusal carries no message of its own, and an agent put to sleep after a start that never came up says why.
import { describe, expect, it } from "vitest";

import { overlayDescription } from "../../modules/agents/lib/overlay-copy.js";
import { badgeLabel } from "../../modules/agents/lib/state-label.js";
import {
  STATUS_TONE,
  statusTone,
} from "../../modules/agents/lib/status-tone.js";
import type { AgentView } from "../../types.js";

const agent = (over: Partial<AgentView>) =>
  ({ workspaceFailures: [], ...over }) as AgentView;

describe("memory and sleep copy", () => {
  // TEST_SCENARIO: an agent refused for its owner's memory waits for it, which is no budget of its own.
  it("labels a refused agent as waiting for memory", () => {
    expect(badgeLabel("over_budget", false)).toBe("Waiting for memory");
  });

  // TEST_SCENARIO: an agent refused a start, by full storage or a boot that never came up, reads "Can't start"; any other error still reads "Error".
  it("calls a refused start can't start, not an error", () => {
    expect(badgeLabel("error", true)).toBe("Can't start");
    expect(badgeLabel("error", false)).toBe("Error");
    expect(badgeLabel("running", true)).toBe("Running");
  });

  // TEST_SCENARIO: the row's state word is green at work or holding background work, blue when idle, red when failed or refused, and the line's own colour when sleeping or starting.
  it("colours the row's state word by what the agent is doing", () => {
    expect(statusTone("running", true, 0)).toBe(STATUS_TONE.working);
    expect(statusTone("running", undefined, 0)).toBe(STATUS_TONE.working);
    expect(statusTone("running", false, 0)).toBe(STATUS_TONE.idle);
    expect(statusTone("running", false, 2)).toBe(STATUS_TONE.working);
    expect(statusTone("error", undefined, 0)).toBe(STATUS_TONE.failed);
    expect(statusTone("over_budget", undefined, 0)).toBe(STATUS_TONE.waiting);
    expect(statusTone("hibernated", undefined, 0)).toBe("");
    expect(statusTone("starting", undefined, 0)).toBe("");
  });

  // TEST_SCENARIO: an agent going to sleep and one asleep use the same word.
  it("calls a sleeping agent falling asleep, then sleeping", () => {
    expect(badgeLabel("hibernating", false)).toBe("Falling asleep");
    expect(badgeLabel("hibernated", false)).toBe("Sleeping");
  });

  // TEST_SCENARIO: an agent that was put to sleep after a start that never came up carries that failure, so its overlay says why it never ran instead of only that it sleeps; an agent with no failed start keeps the sleeping sentence.
  it("says why a slept agent never came up", () => {
    expect(
      overlayDescription(
        "hibernated",
        agent({
          startFailure: {
            reason: "NeverReady",
            message: "the machine ran for 2m0s without answering",
          },
        }),
      ),
    ).toBe(
      "The agent is asleep, but its last start never finished: the machine ran for 2m0s without answering. Start it to try again.",
    );
    expect(
      overlayDescription(
        "hibernated",
        agent({
          startFailure: {
            reason: "BootFailed",
            message: "It stopped as it started: no space left on device.",
          },
        }),
      ),
    ).toBe(
      "The agent is asleep, but its last start never finished: It stopped as it started: no space left on device. Start it to try again.",
    );
    expect(overlayDescription("hibernated", agent({}))).toBe(
      "The agent is sleeping. Wake it to pick up where you left off.",
    );
  });

  // TEST_SCENARIO: a VM refusal with no message still says memory is full and how to free it; a message of its own wins.
  it("falls back to the VM memory sentence", () => {
    expect(overlayDescription("over_budget", agent({}))).toBe(
      "Your VM agents' memory is full. It starts once room frees up — or disable an agent you aren't using.",
    );
    expect(
      overlayDescription(
        "over_budget",
        agent({
          overBudgetMessage: "your VM agents' memory is full",
        }),
      ),
    ).toBe("Your VM agents' memory is full.");
  });

  // TEST_SCENARIO: a start the runner refused, such as for full storage, is no error the agent hit; any other error keeps the error sentence.
  it("says a refused start can't start", () => {
    expect(
      overlayDescription(
        "error",
        agent({ podTerminationCode: "MachineStorageFull" }),
      ),
    ).toBe("This agent can't start right now.");
    expect(overlayDescription("error", agent({}))).toBe(
      "The agent hit an error and isn't running.",
    );
  });
});
