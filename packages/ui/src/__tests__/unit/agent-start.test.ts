// TEST_OVERVIEW: a prompt typed while the agent starts is held until the agent is operable. The hold covers the starting and preparing-workspace states, ends when the agent becomes operable, and fails when the agent leaves those states another way, so the message shows as undelivered instead of waiting forever. An agent that is not starting gives no hold, so the send goes out as before.
import { describe, expect, test } from "vitest";

import {
  AGENT_DID_NOT_START,
  type AgentReadiness,
  agentReadiness,
  askAgainWhenReady,
  untilAgentReady,
} from "../../modules/agents/lib/agent-start.js";

function source(initial: AgentReadiness) {
  let now = initial;
  const listeners = new Set<() => void>();
  return {
    read: () => now,
    subscribe: (onChange: () => void) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    set: (next: AgentReadiness) => {
      now = next;
      for (const l of [...listeners]) l();
    },
    listeners,
  };
}

describe("agent readiness", () => {
  // TEST_SCENARIO: preparing the workspace counts as starting although the Ready condition is already true, because a prompt must not race the seed or install.
  test("starting and preparing the workspace both hold a prompt", () => {
    for (const state of ["starting", "preparing_workspace"] as const)
      expect(agentReadiness({ state, overBudget: false }, false, false)).toBe(
        "starting",
      );
    expect(
      agentReadiness({ state: "running", overBudget: false }, true, false),
    ).toBe("ready");
  });

  // TEST_SCENARIO: opening the chat of a hibernated agent wakes it, and the agent list still says hibernated until the next poll; a prompt sent in that gap is held, not sent to a sleeping agent.
  test("a wake the person started counts as starting", () => {
    expect(
      agentReadiness({ state: "hibernated", overBudget: false }, false, true),
    ).toBe("starting");
  });

  // TEST_SCENARIO: an agent over its budget, hibernated or failed never becomes ready on its own, so a held prompt is failed.
  test("an agent that cannot come up is down", () => {
    expect(
      agentReadiness({ state: "starting", overBudget: true }, false, false),
    ).toBe("down");
    for (const state of ["hibernated", "error", "migrating"] as const)
      expect(agentReadiness({ state, overBudget: false }, false, false)).toBe(
        "down",
      );
    expect(agentReadiness(undefined, false, false)).toBe("down");
  });
});

describe("untilAgentReady", () => {
  // TEST_SCENARIO: an agent that is already operable, or not starting at all, gives no hold; the send path stays as before.
  test("no hold unless the agent is starting", () => {
    expect(untilAgentReady(() => "ready", source("ready").subscribe)).toBe(
      null,
    );
    expect(untilAgentReady(() => "down", source("down").subscribe)).toBe(null);
  });

  // TEST_SCENARIO: the hold ends when the agent becomes operable, and stops listening.
  test("resolves when the agent becomes ready", async () => {
    const s = source("starting");
    const hold = untilAgentReady(s.read, s.subscribe);
    s.set("starting");
    s.set("ready");
    await expect(hold).resolves.toBeUndefined();
    expect(s.listeners.size).toBe(0);
  });

  // TEST_SCENARIO: the agent fails or goes to sleep while a prompt is held; the hold fails with a reason the chat shows on the undelivered message.
  test("rejects when the agent stops starting without becoming ready", async () => {
    const s = source("starting");
    const hold = untilAgentReady(s.read, s.subscribe);
    s.set("down");
    await expect(hold).rejects.toThrow(AGENT_DID_NOT_START);
    expect(s.listeners.size).toBe(0);
  });
});

describe("askAgainWhenReady", () => {
  // TEST_SCENARIO: the sidebar asks for the session list while the agent starts; when the relay refuses that ask or its hold fails, the list is asked for again once the agent is ready, so the sidebar does not stay empty.
  test("asks again once the agent is ready after a failed early ask", async () => {
    const s = source("starting");
    let calls = 0;
    const asked = askAgainWhenReady(
      async () => {
        if (++calls === 1) throw new Error("agent not ready");
        return "list";
      },
      () => untilAgentReady(s.read, s.subscribe),
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toBe(1);
    s.set("ready");
    await expect(asked).resolves.toBe("list");
    expect(calls).toBe(2);
  });

  // TEST_SCENARIO: an agent that is not starting gives nothing to wait for, so the failure stands and the query's own retry takes over.
  test("keeps the failure when the agent is not starting", async () => {
    const asked = askAgainWhenReady(
      () => Promise.reject(new Error("boom")),
      () => untilAgentReady(() => "down", source("down").subscribe),
    );
    await expect(asked).rejects.toThrow("boom");
  });
});
