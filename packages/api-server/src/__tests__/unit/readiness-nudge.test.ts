import { afterEach, describe, expect, it, vi } from "vitest";

import { createReadyNudge } from "../../modules/agents/infrastructure/readiness-nudge.js";
import type { KubeObject } from "../../modules/agents/infrastructure/k8s.js";

// TEST_OVERVIEW: the per-wake readiness nudge — a targeted watch on the one Agent CR being waked lets the wake poll's sleep resolve the moment the object changes, while the sleep's own timeout keeps every wait bounded, so a dropped watch only degrades to the plain poll cadence.

afterEach(() => {
  vi.useRealTimers();
});

const harness = () => {
  let onEvent: (phase: string, obj: KubeObject) => void = () => {};
  let stopped = 0;
  const nudge = createReadyNudge(
    {
      watchCustomObject: (_plural, _name, handler) => {
        onEvent = handler;
        return () => {
          stopped += 1;
        };
      },
    },
    "agents",
    "agent-a",
  );
  return {
    nudge,
    fire: () => onEvent("MODIFIED", {} as KubeObject),
    stopCount: () => stopped,
  };
};

describe("createReadyNudge", () => {
  // TEST_SCENARIO: a watch event during a wait resolves it immediately — the poll re-reads truth right away instead of sleeping out its interval.
  it("resolves a pending wait on a watch event", async () => {
    vi.useFakeTimers();
    const h = harness();
    let settled = false;
    const wait = h.nudge.wait(60_000).then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    h.fire();
    await wait;
    expect(settled).toBe(true);
  });

  // TEST_SCENARIO: an event arriving between waits is latched — the next wait returns immediately, so a flip during predicate evaluation is never missed.
  it("latches an event that arrives before the next wait", async () => {
    const h = harness();
    h.fire();
    await expect(h.nudge.wait(60_000)).resolves.toBeUndefined();
  });

  // TEST_SCENARIO: with no events the wait resolves at its timeout — a dead watch degrades to the plain poll cadence, never a hang.
  it("resolves at the timeout without events", async () => {
    vi.useFakeTimers();
    const h = harness();
    let settled = false;
    const wait = h.nudge.wait(1_000).then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await wait;
    expect(settled).toBe(true);
  });

  // TEST_SCENARIO: stop closes the underlying watch exactly once — a finished wake leaves no connection behind.
  it("stop closes the watch", () => {
    const h = harness();
    h.nudge.stop();
    expect(h.stopCount()).toBe(1);
  });
});
