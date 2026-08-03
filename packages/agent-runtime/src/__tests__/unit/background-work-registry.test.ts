import { describe, it, expect } from "vitest";
import { createBackgroundWorkRegistry } from "../../modules/acp/services/background-work-registry.js";

const job = (id: string, description?: string) => ({ id, description });

function setup(
  overrides: Parameters<typeof createBackgroundWorkRegistry>[0] = {},
) {
  const logs: string[] = [];
  const registry = createBackgroundWorkRegistry({
    log: (m) => logs.push(m),
    ...overrides,
  });
  return { registry, logs };
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
    const { registry } = setup();

    registry.report("s1", [job("t1")]);
    registry.report("s2", []);

    expect(registry.hasWork("s1")).toBe(true);
    expect(registry.hasWork("s2")).toBe(false);
  });

  it("holds for as long as the work is reported, with nothing timing it out", () => {
    // No bound can tell unfinished work from work that will never finish, so a
    // hold ends on an empty report or a teardown — never on a clock.
    const { registry } = setup();

    for (let report = 0; report < 100; report += 1) {
      registry.report("s1", [job("t1")]);
    }

    expect(registry.hasWork("s1")).toBe(true);
  });

  it("refuses every hold when disabled, the feature's kill switch", () => {
    const { registry } = setup({ enabled: false });

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
    const { registry } = setup();

    registry.report("s1", [job("t1")]);
    registry.report("s2", [job("t2")]);
    registry.clear();

    expect(registry.held()).toEqual([]);
  });
});
