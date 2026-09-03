/** TEST_OVERVIEW: dispatch jobs coalesce per agent. A plain dispatch and the
 *  boot catch-up that hello enqueues carry distinct deduplication keys, and a
 *  dispatch arriving while one is active is kept to run once after it, so one
 *  agent never holds more than one queued job per key in the shared queue. */
import { describe, it, expect } from "vitest";
import { stateJobOptions } from "../../modules/runtime-delivery/infrastructure/state-queue.js";

describe("runtime state-queue job options", () => {
  /** TEST_SCENARIO: plain dispatches for one agent share a key; one that
   *  arrives during an active job is kept and runs after it, so a change that
   *  races an in-flight delivery still lands without waiting for the sweep. */
  it("deduplicates plain dispatches on the agent id", () => {
    expect(stateJobOptions("agent-a").deduplication).toEqual({
      id: "agent-a",
      keepLastIfActive: true,
    });
  });

  /** TEST_SCENARIO: a plain dispatch exits clean on an agent that is not Ready
   *  yet, so it must never absorb the boot catch-up that retries until Ready —
   *  the catch-up coalesces on its own key. */
  it("keeps the boot catch-up on its own key", () => {
    expect(
      stateJobOptions("agent-a", { retryUntilReady: true }).deduplication,
    ).toEqual({ id: "agent-a:boot", keepLastIfActive: true });
  });
});
