import { describe, expect, it } from "vitest";

import { nextAutoWake } from "../../modules/agents/lib/auto-wake.js";

// TEST_OVERVIEW: opening a sleeping agent's chat wakes it once per open. Re-renders and list refetches in the same open do not wake it again, leaving and reopening does, and an agent over its budget or already awake is not woken.

const asleep = { state: "hibernated" as const, overBudget: false };

describe("waking a sleeping agent on open", () => {
  // TEST_SCENARIO: the first render with the agent loaded wakes it; later renders of the same open do not.
  it("wakes once per open", () => {
    const first = nextAutoWake(null, "a1", asleep);
    expect(first).toEqual({ decidedFor: "a1", wake: true });
    expect(nextAutoWake(first.decidedFor, "a1", asleep).wake).toBe(false);
  });

  // TEST_SCENARIO: leaving the chat clears the open, so the next open of the same agent wakes it again.
  it("wakes again after the chat is left and reopened", () => {
    const left = nextAutoWake("a1", null, undefined);
    expect(left.decidedFor).toBeNull();
    expect(nextAutoWake(left.decidedFor, "a1", asleep).wake).toBe(true);
  });

  // TEST_SCENARIO: switching to another agent is a new open of that agent.
  it("wakes the agent switched to", () => {
    expect(nextAutoWake("a1", "a2", asleep)).toEqual({
      decidedFor: "a2",
      wake: true,
    });
  });

  // TEST_SCENARIO: the decision waits until the agent is in the list.
  it("waits for the agent to load", () => {
    expect(nextAutoWake(null, "a1", undefined)).toEqual({
      decidedFor: null,
      wake: false,
    });
  });

  // TEST_SCENARIO: an over-budget or awake agent is not woken, and the open still counts as decided.
  it("leaves over-budget and awake agents alone", () => {
    expect(
      nextAutoWake(null, "a1", { state: "hibernated", overBudget: true }),
    ).toEqual({ decidedFor: "a1", wake: false });
    expect(
      nextAutoWake(null, "a1", { state: "running", overBudget: false }).wake,
    ).toBe(false);
  });
});
