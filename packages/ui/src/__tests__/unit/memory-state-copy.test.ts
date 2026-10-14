// TEST_OVERVIEW: what a user reads about a VM agent refused for memory or storage, or put to sleep: the badge says "Waiting for memory" rather than "Over budget" for a VM agent and keeps "Over budget" for a container agent, an agent refused a start reads "Can't start" rather than "Error" on its badge and overlay, the row's state word takes its colour from what the agent is doing, a sleeping agent reads "Pausing" then "Paused", and the overlay falls back to the VM memory sentence when the refusal carries no message of its own.
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

describe("memory and paused copy", () => {
  // TEST_SCENARIO: a refused VM agent waits for memory; a container agent is over its budget.
  it("labels a refused agent by its backend", () => {
    expect(badgeLabel("over_budget", true, false)).toBe("Waiting for memory");
    expect(badgeLabel("over_budget", false, false)).toBe("Over budget");
  });

  // TEST_SCENARIO: an agent refused a start, by full storage or a boot that never came up, reads "Can't start"; any other error still reads "Error".
  it("calls a refused start can't start, not an error", () => {
    expect(badgeLabel("error", true, true)).toBe("Can't start");
    expect(badgeLabel("error", false, true)).toBe("Can't start");
    expect(badgeLabel("error", true, false)).toBe("Error");
    expect(badgeLabel("running", true, true)).toBe("Running");
  });

  // TEST_SCENARIO: the row's state word is green at work or holding background work, blue when idle, red when failed or refused, and the line's own colour when paused or starting.
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
  it("calls a sleeping agent pausing, then paused", () => {
    expect(badgeLabel("hibernating", true, false)).toBe("Pausing");
    expect(badgeLabel("hibernated", true, false)).toBe("Paused");
  });

  // TEST_SCENARIO: a VM refusal with no message still says memory is full and how to free it; a message of its own wins.
  it("falls back to the VM memory sentence", () => {
    expect(overlayDescription("over_budget", agent({ vm: true }))).toBe(
      "Your VM agents' memory is full. It starts once room frees up — or pause an agent you aren't using.",
    );
    expect(
      overlayDescription(
        "over_budget",
        agent({
          vm: true,
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
        agent({ vm: true, podTerminationCode: "MachineStorageFull" }),
      ),
    ).toBe("This agent can't start right now.");
    expect(overlayDescription("error", agent({ vm: true }))).toBe(
      "The agent hit an error and isn't running.",
    );
  });
});
