import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureLogger } from "../../core/logger.js";
import type { AcpTurnStatus } from "../../core/acp-client.js";
import {
  createTurnRecovery,
  type WatchedTurn,
} from "../../modules/channels/infrastructure/turn-recovery.js";

/**
 * TEST_OVERVIEW: The turn-recovery watcher. After a failed relay watch it
 * polls the runtime's turn status and fires the recovery nudge exactly once,
 * when the turn has ended with nothing delivered — never for a turn still
 * running (which only keeps the watch alive), never for a delivered answer,
 * and never after the watch was dismissed. A pod that cannot be reached
 * twice in a row counts as ended, because the idle checker never hibernates
 * a pod under a running turn.
 */

configureLogger({ level: "error", write: () => {} });

const POLL_MS = 2 * 60_000;

function scripted(seq: AcpTurnStatus[]) {
  let i = 0;
  return async () => seq[Math.min(i++, seq.length - 1)]!;
}

function makeTurn(over?: Partial<WatchedTurn>) {
  const calls = { recover: 0, stillRunning: 0 };
  const turn: WatchedTurn = {
    instanceName: "agent-1",
    sessionId: "s-1",
    isDelivered: () => false,
    onStillRunning: () => {
      calls.stillRunning += 1;
    },
    recover: async () => {
      calls.recover += 1;
    },
    ...over,
  };
  return { turn, calls };
}

describe("turn recovery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * TEST_SCENARIO: The turn is still running. Each poll must only keep the
   * watch (and the caller's turn bookkeeping) alive — recovering here would
   * nudge an agent that is still working.
   */
  it("keeps polling a running turn without recovering", async () => {
    const recovery = createTurnRecovery({
      turnStatus: scripted(["pending", "pending"]),
    });
    const { turn, calls } = makeTurn();
    recovery.watch(turn);
    await vi.advanceTimersByTimeAsync(2 * POLL_MS);
    expect(calls.stillRunning).toBe(2);
    expect(calls.recover).toBe(0);
    recovery.stop();
  });

  /**
   * TEST_SCENARIO: The turn ends with nothing delivered. Recovery must fire —
   * and only once, however long the clock keeps running afterwards.
   */
  it("recovers exactly once when the turn ends undelivered", async () => {
    const recovery = createTurnRecovery({
      turnStatus: scripted(["pending", "ended"]),
    });
    const { turn, calls } = makeTurn();
    recovery.watch(turn);
    await vi.advanceTimersByTimeAsync(5 * POLL_MS);
    expect(calls.recover).toBe(1);
    recovery.stop();
  });

  /**
   * TEST_SCENARIO: The answer arrived on its own — a late reply, or a later
   * turn on the same session. A nudge now would produce a duplicate post.
   */
  it("never recovers a delivered turn", async () => {
    const recovery = createTurnRecovery({ turnStatus: scripted(["ended"]) });
    const { turn, calls } = makeTurn({ isDelivered: () => true });
    recovery.watch(turn);
    await vi.advanceTimersByTimeAsync(2 * POLL_MS);
    expect(calls.recover).toBe(0);
    recovery.stop();
  });

  /**
   * TEST_SCENARIO: The pod is gone — hibernated after the turn ended, since
   * the idle checker never hibernates under a running turn. One failed poll
   * could be a blip; the second confirms the turn is over.
   */
  it("treats a twice-unreachable pod as an ended turn", async () => {
    const recovery = createTurnRecovery({
      turnStatus: () => Promise.reject(new Error("no pod")),
    });
    const { turn, calls } = makeTurn();
    recovery.watch(turn);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(calls.recover).toBe(0);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(calls.recover).toBe(1);
    recovery.stop();
  });

  /**
   * TEST_SCENARIO: A later turn on the same session succeeded, so the worker
   * dismissed the watch. The old turn's nudge must never fire after that.
   */
  it("never recovers after a dismissal", async () => {
    const recovery = createTurnRecovery({ turnStatus: scripted(["ended"]) });
    const { turn, calls } = makeTurn();
    recovery.watch(turn);
    recovery.dismiss("agent-1", "s-1");
    await vi.advanceTimersByTimeAsync(2 * POLL_MS);
    expect(calls.recover).toBe(0);
    recovery.stop();
  });
});
