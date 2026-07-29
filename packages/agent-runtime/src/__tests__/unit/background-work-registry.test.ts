import { describe, it, expect } from "vitest";
import { createBackgroundWorkRegistry } from "../../modules/acp/services/background-work-registry.js";

const job = (id: string, description?: string) => ({ id, description });

function setup(
  overrides: Parameters<typeof createBackgroundWorkRegistry>[0] = {},
) {
  let clock = 1_000;
  const logs: string[] = [];
  const registry = createBackgroundWorkRegistry({
    now: () => clock,
    log: (m) => logs.push(m),
    ...overrides,
  });
  return {
    registry,
    logs,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe("createBackgroundWorkRegistry", () => {
  it("holds a session that reports work, and releases it on an empty report", () => {
    const { registry } = setup();

    registry.report("s1", [job("t1", "training run")]);
    expect(registry.hasWork("s1")).toBe(true);
    expect(registry.held()).toEqual([
      { sessionId: "s1", items: [job("t1", "training run")] },
    ]);

    registry.report("s1", []);
    expect(registry.hasWork("s1")).toBe(false);
    expect(registry.held()).toEqual([]);
  });

  it("treats each report as the whole truth, not a delta", () => {
    // A reporter that loses track of what it said before must still converge.
    const { registry } = setup();

    registry.report("s1", [job("t1"), job("t2")]);
    registry.report("s1", [job("t2")]);

    expect(registry.held()[0]!.items).toEqual([job("t2")]);
  });

  it("keeps sessions apart", () => {
    const { registry } = setup({ maxHeldSessions: 5 });

    registry.report("s1", [job("t1")]);
    registry.report("s2", []);

    expect(registry.hasWork("s1")).toBe(true);
    expect(registry.hasWork("s2")).toBe(false);
  });

  it("holds for as long as the work is reported, with no time bound", () => {
    // A bound cannot tell unfinished work from work that will never finish, so
    // the hold outlives any timer; a human or an empty report ends it.
    const { registry, advance } = setup();

    registry.report("s1", [job("t1")]);
    advance(30 * 24 * 60 * 60 * 1000);
    registry.report("s1", [job("t1")]);

    expect(registry.hasWork("s1")).toBe(true);
  });

  it("caps concurrent holds, releasing the longest-held session first", () => {
    // Each held session keeps a harness subprocess alive; the pod's memory limit
    // is what this protects, and an OOM would kill every job in the pod.
    const { registry, advance, logs } = setup({ maxHeldSessions: 1 });

    registry.report("s1", [job("t1")]);
    advance(1_000);
    registry.report("s2", [job("t2")]);

    expect(registry.hasWork("s1")).toBe(false);
    expect(registry.hasWork("s2")).toBe(true);
    expect(logs.join("\n")).toContain("more than 1 sessions holding");
  });

  it("does not restart a session's age when it re-reports the same work", () => {
    // Otherwise a chatty reporter would always look youngest and the cap would
    // evict a quieter session that is still working.
    const { registry, advance } = setup({ maxHeldSessions: 1 });

    registry.report("s1", [job("t1")]);
    advance(1_000);
    registry.report("s2", [job("t2")]);
    advance(1_000);
    registry.report("s2", [job("t2")]); // s2 re-reports; it is still the newest
    registry.report("s1", [job("t1")]); // s1 comes back, now the newest

    expect(registry.hasWork("s1")).toBe(true);
    expect(registry.hasWork("s2")).toBe(false);
  });

  it("refuses every hold when the cap is zero, the feature's kill switch", () => {
    const { registry } = setup({ maxHeldSessions: 0 });

    registry.report("s1", [job("t1")]);

    expect(registry.hasWork("s1")).toBe(false);
  });

  it("names what a hold is for, so an awake sandbox is explainable", () => {
    const { registry, logs } = setup();

    registry.report("s1", [job("t1", "nightly training sweep")]);

    expect(logs.join("\n")).toContain("nightly training sweep");
  });

  it("logs a hold once, not on every report", () => {
    const { registry, logs } = setup();

    registry.report("s1", [job("t1", "x")]);
    registry.report("s1", [job("t1", "x")]);
    registry.report("s1", [job("t1", "x")]);

    expect(logs.filter((l) => l.includes("holding session"))).toHaveLength(1);
  });

  it("drops a session's hold when the session is torn down", () => {
    const { registry } = setup();

    registry.report("s1", [job("t1")]);
    registry.forget("s1");

    expect(registry.hasWork("s1")).toBe(false);
  });

  it("drops every hold when the harness goes away with its children", () => {
    const { registry } = setup({ maxHeldSessions: 5 });

    registry.report("s1", [job("t1")]);
    registry.report("s2", [job("t2")]);
    registry.clear();

    expect(registry.held()).toEqual([]);
  });
});
