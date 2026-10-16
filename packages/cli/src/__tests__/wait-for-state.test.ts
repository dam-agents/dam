// TEST_OVERVIEW: waitForRunning ends on running, error, or a refused start. A refusal already standing before the wait counts only once the wait saw another state or a short grace passed, because a restart's first poll can still read the previous attempt's denial.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentView } from "../modules/agent/domain/agent-view.js";
import type { AgentService } from "../modules/agent/services/agent-service.js";
import { waitForRunning } from "../modules/agent/services/wait-for-state.js";

function serviceReturning(states: AgentView["state"][]): AgentService {
  let i = 0;
  return {
    list: vi.fn(),
    runtimeFleet: vi.fn(),
    deleteAgent: vi.fn(),
    restart: vi.fn(),
    setDisabled: vi.fn(),
    get: vi.fn(async () => {
      const state = states[Math.min(i++, states.length - 1)]!;
      return {
        ok: true as const,
        value: {
          id: "a",
          name: "a",
          templateId: null,
          image: "i",
          state,
          channels: [],
        },
      };
    }),
  };
}

async function settle(promise: Promise<unknown>) {
  await vi.runAllTimersAsync();
  return promise;
}

describe("waitForRunning refusals", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** TEST_SCENARIO: A restart of a parked agent first reads the old denial;
   * once room frees and the agent runs, the wait reports ready, not refused. */
  it("rides through a standing denial that clears within the grace", async () => {
    const svc = serviceReturning(["over_budget", "over_budget", "running"]);
    const result = await settle(
      waitForRunning(svc, "a", {
        timeoutSeconds: 60,
        graceSeconds: 0,
        initialState: "over_budget",
      }),
    );
    expect(result).toMatchObject({ kind: "ready" });
  });

  /** TEST_SCENARIO: A denial that stands past the grace is this attempt's
   * own, so the wait ends refused well before its timeout. */
  it("reports a standing denial as refused once the grace passes", async () => {
    const svc = serviceReturning(["over_budget"]);
    const result = await settle(
      waitForRunning(svc, "a", {
        timeoutSeconds: 120,
        graceSeconds: 0,
        initialState: "over_budget",
      }),
    );
    expect(result).toMatchObject({ kind: "refused" });
    expect(vi.mocked(svc.get).mock.calls.length).toBeLessThan(10);
  });

  /** TEST_SCENARIO: A wait that saw the agent starting reads a later
   * over_budget as its own refusal and stops at once. */
  it("stops at once on over_budget after another state", async () => {
    const svc = serviceReturning(["starting", "over_budget"]);
    const result = await settle(
      waitForRunning(svc, "a", { timeoutSeconds: 120, graceSeconds: 0 }),
    );
    expect(result).toMatchObject({ kind: "refused" });
    expect(svc.get).toHaveBeenCalledTimes(2);
  });
});
