import { describe, expect, test } from "vitest";

import { resolveAgentDisplay } from "../../modules/agents/utils/agent-resolver.js";
import { transitionRestartingInstances } from "../../modules/instances/store.js";
import type { AgentView, InstanceView } from "../../types.js";

const agent = (id: string): AgentView => ({
  id, name: id, templateId: null, image: "x:latest",
});

const inst = (id: string, agentId: string, state: InstanceView["state"]): InstanceView => ({
  id, name: id, agentId, state, channels: [], allowedUserEmails: [],
});

describe("resolveAgentDisplay", () => {
  test("returns no-instance when the agent has no instances", () => {
    const out = resolveAgentDisplay(agent("a"), [], new Set());
    expect(out).toEqual({ instance: null, state: "no-instance", clickable: false, powerAction: null });
  });

  test("picks the lowest-id instance when multiple exist", () => {
    const i1 = inst("i-002", "a", "running");
    const i2 = inst("i-001", "a", "error");
    const out = resolveAgentDisplay(agent("a"), [i1, i2], new Set());
    expect(out.instance?.id).toBe("i-001");
    expect(out.state).toBe("error");
  });

  test("ignores instances belonging to other agents", () => {
    const out = resolveAgentDisplay(
      agent("a"),
      [inst("i-1", "other", "running")],
      new Set(),
    );
    expect(out.state).toBe("no-instance");
  });

  test.each([
    ["running", true, "restart"],
    ["error", false, "restart"],
    ["hibernated", true, "start"],
    ["starting", false, null],
    ["hibernating", false, null],
  ] as const)("state=%s → clickable=%s powerAction=%s", (state, clickable, powerAction) => {
    const out = resolveAgentDisplay(
      agent("a"),
      [inst("i-1", "a", state)],
      new Set(),
    );
    expect(out.state).toBe(state);
    expect(out.clickable).toBe(clickable);
    expect(out.powerAction).toBe(powerAction);
  });

  test("restart override: state flips to restarting and actions are suppressed", () => {
    const i = inst("i-1", "a", "running");
    const out = resolveAgentDisplay(agent("a"), [i], new Set(["i-1"]));
    expect(out.state).toBe("restarting");
    expect(out.clickable).toBe(false);
    expect(out.powerAction).toBe(null);
  });
});

describe("transitionRestartingInstances", () => {
  const NOW = 1_000_000_000_000;
  const entry = (seen: boolean, ageMs = 0) => ({ seenNonRunning: seen, clickedAt: NOW - ageMs });

  test("keeps entry while state still reads running and no dip observed", () => {
    const current = new Map([["i-1", entry(false)]]);
    const next = transitionRestartingInstances(current, [inst("i-1", "a", "running")], NOW);
    expect(next.get("i-1")).toEqual(entry(false));
  });

  test("marks seenNonRunning once the pod goes to starting", () => {
    const current = new Map([["i-1", entry(false)]]);
    const next = transitionRestartingInstances(current, [inst("i-1", "a", "starting")], NOW);
    expect(next.get("i-1")).toEqual(entry(true));
  });

  test("clears entry once running returns after a non-running dip", () => {
    const current = new Map([["i-1", entry(true)]]);
    const next = transitionRestartingInstances(current, [inst("i-1", "a", "running")], NOW);
    expect(next.has("i-1")).toBe(false);
  });

  test("drops entry on error so the real failure surfaces", () => {
    const current = new Map([["i-1", entry(true)]]);
    const next = transitionRestartingInstances(current, [inst("i-1", "a", "error")], NOW);
    expect(next.has("i-1")).toBe(false);
  });

  test("drops entry once it exceeds the TTL, even if state still looks running", () => {
    const current = new Map([["i-1", entry(false, 121_000)]]);
    const next = transitionRestartingInstances(current, [inst("i-1", "a", "running")], NOW);
    expect(next.has("i-1")).toBe(false);
  });

  test("drops entry when the instance disappears", () => {
    const current = new Map([["i-1", entry(false)]]);
    const next = transitionRestartingInstances(current, [], NOW);
    expect(next.has("i-1")).toBe(false);
  });
});
