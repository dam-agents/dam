import { describe, expect, test } from "vitest";

import {
  transitionPausingAgents,
  transitionRestartingAgents,
} from "../../modules/agents/store.js";
import { resolveAgentDisplay } from "../../modules/agents/utils/agent-resolver.js";
import type { AgentView } from "../../types.js";

const agent = (id: string, state: AgentView["state"]): AgentView => ({
  id,
  name: id,
  templateId: null,
  templateUpdate: null,
  kbTemplateId: null,
  image: "x:latest",
  hibernationTimeoutMin: 60,
  grantedSecretIds: [],
  grantedConnectionIds: [],
  stopRequested: false,
  overBudget: false,
  size: {},
  state,
  contributionFailures: [],
  channels: [],
  spawnedBy: null,
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

  test("pause override: running agent shows hibernating and actions are suppressed", () => {
    const out = resolveAgentDisplay(
      agent("a", "running"),
      new Set(),
      new Set(["a"]),
    );
    expect(out.state).toBe("hibernating");
    expect(out.clickable).toBe(false);
    expect(out.powerAction).toBe(null);
  });

  test("pause override only applies while running — a hibernated agent keeps Start", () => {
    const out = resolveAgentDisplay(
      agent("a", "hibernated"),
      new Set(),
      new Set(["a"]),
    );
    expect(out.state).toBe("hibernated");
    expect(out.powerAction).toBe("start");
  });

  test("restart wins over pause when an id is in both sets", () => {
    const out = resolveAgentDisplay(
      agent("a", "running"),
      new Set(["a"]),
      new Set(["a"]),
    );
    expect(out.state).toBe("starting");
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

  test("drops entry when the budget gate parks the agent — the denial is the attempt's outcome", () => {
    const current = new Map([["a", entry(false)]]);
    const parked = { ...agent("a", "starting"), overBudget: true };
    const next = transitionRestartingAgents(current, [parked], NOW);
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

describe("transitionPausingAgents", () => {
  const NOW = 1_000_000_000_000;
  const entry = (ageMs = 0) => ({ clickedAt: NOW - ageMs });

  test("keeps entry while the poll still reads running", () => {
    const current = new Map([["a", entry()]]);
    const next = transitionPausingAgents(current, [agent("a", "running")], NOW);
    expect(next.get("a")).toEqual(entry());
  });

  test("drops entry once the pod reports down — the real hibernated state carries the pill", () => {
    const current = new Map([["a", entry()]]);
    const next = transitionPausingAgents(
      current,
      [agent("a", "hibernating")],
      NOW,
    );
    expect(next.has("a")).toBe(false);
  });

  test("drops entry on error so the real failure surfaces", () => {
    const current = new Map([["a", entry()]]);
    const next = transitionPausingAgents(current, [agent("a", "error")], NOW);
    expect(next.has("a")).toBe(false);
  });

  test("drops entry once it exceeds the TTL, even if state still looks running", () => {
    const current = new Map([["a", entry(31_000)]]);
    const next = transitionPausingAgents(current, [agent("a", "running")], NOW);
    expect(next.has("a")).toBe(false);
  });

  test("drops entry when the agent disappears", () => {
    const current = new Map([["a", entry()]]);
    const next = transitionPausingAgents(current, [], NOW);
    expect(next.has("a")).toBe(false);
  });

  test("returns the same reference when membership is unchanged (skips a re-render)", () => {
    const current = new Map([["a", entry()]]);
    const next = transitionPausingAgents(current, [agent("a", "running")], NOW);
    expect(next).toBe(current);
  });

  test("returns a new map when an entry is dropped", () => {
    const current = new Map([
      ["a", entry()],
      ["b", entry()],
    ]);
    const next = transitionPausingAgents(
      current,
      [agent("a", "running"), agent("b", "hibernated")],
      NOW,
    );
    expect(next).not.toBe(current);
    expect([...next.keys()]).toEqual(["a"]);
  });
});
