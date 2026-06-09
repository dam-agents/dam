import { describe, expect, test } from "vitest";

import { transitionRestartingAgents } from "../../modules/agents/store.js";
import { resolveAgentDisplay } from "../../modules/agents/utils/agent-resolver.js";
import type { AgentView } from "../../types.js";

const agent = (id: string, state: AgentView["state"]): AgentView => ({
  id,
  name: id,
  templateId: null,
  image: "x:latest",
  state,
  contributionFailures: [],
  channels: [],
  allowedUserEmails: [],
});

describe("resolveAgentDisplay", () => {
  test.each([
    ["running", true, "restart"],
    ["error", false, "restart"],
    ["hibernated", true, "start"],
    ["starting", false, null],
    ["hibernating", false, null],
  ] as const)(
    "state=%s → clickable=%s powerAction=%s",
    (state, clickable, powerAction) => {
      const out = resolveAgentDisplay(agent("a", state), new Set());
      expect(out.state).toBe(state);
      expect(out.clickable).toBe(clickable);
      expect(out.powerAction).toBe(powerAction);
    },
  );

  test("restart override: state shows starting and actions are suppressed", () => {
    const out = resolveAgentDisplay(agent("a", "running"), new Set(["a"]));
    expect(out.state).toBe("starting");
    expect(out.clickable).toBe(false);
    expect(out.powerAction).toBe(null);
  });
});

describe("transitionRestartingAgents", () => {
  const NOW = 1_000_000_000_000;
  const entry = (seen: boolean, ageMs = 0) => ({
    seenNonRunning: seen,
    clickedAt: NOW - ageMs,
  });

  test("keeps entry while state still reads running and no dip observed", () => {
    const current = new Map([["a", entry(false)]]);
    const next = transitionRestartingAgents(
      current,
      [agent("a", "running")],
      NOW,
    );
    expect(next.get("a")).toEqual(entry(false));
  });

  test("marks seenNonRunning once the pod goes to starting", () => {
    const current = new Map([["a", entry(false)]]);
    const next = transitionRestartingAgents(
      current,
      [agent("a", "starting")],
      NOW,
    );
    expect(next.get("a")).toEqual(entry(true));
  });

  test("clears entry once running returns after a non-running dip", () => {
    const current = new Map([["a", entry(true)]]);
    const next = transitionRestartingAgents(
      current,
      [agent("a", "running")],
      NOW,
    );
    expect(next.has("a")).toBe(false);
  });

  test("drops entry on error so the real failure surfaces", () => {
    const current = new Map([["a", entry(true)]]);
    const next = transitionRestartingAgents(
      current,
      [agent("a", "error")],
      NOW,
    );
    expect(next.has("a")).toBe(false);
  });

  test("drops entry once it exceeds the TTL, even if state still looks running", () => {
    const current = new Map([["a", entry(false, 121_000)]]);
    const next = transitionRestartingAgents(
      current,
      [agent("a", "running")],
      NOW,
    );
    expect(next.has("a")).toBe(false);
  });

  test("drops entry when the agent disappears", () => {
    const current = new Map([["a", entry(false)]]);
    const next = transitionRestartingAgents(current, [], NOW);
    expect(next.has("a")).toBe(false);
  });
});
