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
 * when the work is over and no reply landed after the agent was last seen
 * working — never for a turn still running (which only keeps the watch
 * alive), never when the agent's last act was delivering, and never after
 * the watch was dismissed. The work counts as over only on a positive
 * signal: the runtime says so, or the platform reports the pod gone (the
 * idle checker never hibernates a pod under a running turn); an unreachable
 * but running pod is unknown and just keeps being polled.
 */

configureLogger({ level: "error", write: () => {} });

const POLL_MS = 2 * 60_000;
const WINDOW_MS = 2 * 60 * 60_000;

function scripted(seq: AcpTurnStatus[]) {
  let i = 0;
  return async () => seq[Math.min(i++, seq.length - 1)]!;
}

function makeTurn(over?: Partial<WatchedTurn>) {
  const calls = { recover: 0, stillRunning: 0 };
  const turn: WatchedTurn = {
    instanceName: "agent-1",
    sessionId: "s-1",
    deliveredSince: () => false,
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
      podGone: async () => false,
    });
    const { turn, calls } = makeTurn();
    recovery.watch(turn);
    await vi.advanceTimersByTimeAsync(2 * POLL_MS);
    expect(calls.stillRunning).toBe(2);
    expect(calls.recover).toBe(0);
    recovery.stop();
  });

  /**
   * TEST_SCENARIO: The work ends and the only reply predates the last alive
   * report — an acknowledgement the agent worked on past, not the answer.
   * Recovery must fire, and only once, however long the clock runs on.
   */
  it("recovers exactly once when the turn ends with no reply after last-alive", async () => {
    const postAt = Date.now() - 10 * 60_000;
    const recovery = createTurnRecovery({
      turnStatus: scripted(["pending", "ended"]),
      podGone: async () => false,
    });
    const { turn, calls } = makeTurn({
      deliveredSince: (sinceMs) => postAt > sinceMs,
    });
    recovery.watch(turn);
    await vi.advanceTimersByTimeAsync(5 * POLL_MS);
    expect(calls.recover).toBe(1);
    recovery.stop();
  });

  /**
   * TEST_SCENARIO: A reply landed after the agent was last seen working —
   * its last act was delivering, so that reply is the answer and a nudge
   * would produce a duplicate post.
   */
  it("never recovers when the agent stopped working after its reply", async () => {
    const postAt = Date.now() + POLL_MS + 60_000;
    const recovery = createTurnRecovery({
      turnStatus: scripted(["pending", "ended"]),
      podGone: async () => false,
    });
    const { turn, calls } = makeTurn({
      deliveredSince: (sinceMs) => postAt > sinceMs,
    });
    recovery.watch(turn);
    await vi.advanceTimersByTimeAsync(5 * POLL_MS);
    expect(calls.recover).toBe(0);
    recovery.stop();
  });

  /**
   * TEST_SCENARIO: The answer landed seconds before the relay lost the turn
   * — the agent stopped working right after its reply. The watch starts from
   * the relay's last observation of the turn, with grace for the frames that
   * trail a post, so this turn counts as delivered and is never nudged.
   */
  it("never recovers a turn whose answer landed just before the abandon", async () => {
    const postAt = Date.now() - 30_000;
    const recovery = createTurnRecovery({
      turnStatus: scripted(["ended"]),
      podGone: async () => false,
    });
    const { turn, calls } = makeTurn({
      lastSeenWorkingAt: Date.now() - 25_000,
      deliveredSince: (sinceMs) => postAt > sinceMs,
    });
    recovery.watch(turn);
    await vi.advanceTimersByTimeAsync(2 * POLL_MS);
    expect(calls.recover).toBe(0);
    recovery.stop();
  });

  /**
   * TEST_SCENARIO: The pod cannot be reached and the platform reports it
   * gone — hibernated after the turn ended, since the idle checker never
   * hibernates under a running turn. That is a positive ending.
   */
  it("treats an unreachable pod the platform reports gone as an ended turn", async () => {
    const recovery = createTurnRecovery({
      turnStatus: () => Promise.reject(new Error("no pod")),
      podGone: async () => true,
    });
    const { turn, calls } = makeTurn();
    recovery.watch(turn);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(calls.recover).toBe(1);
    recovery.stop();
  });

  /**
   * TEST_SCENARIO: The pod cannot be reached but the platform says it is
   * running — a saturated or briefly unreachable pod mid-work. A failed read
   * is unknown, never an ending: nudging here would queue a duplicate answer
   * behind the running turn.
   */
  it("keeps polling an unreachable pod that is still running", async () => {
    const recovery = createTurnRecovery({
      turnStatus: () => Promise.reject(new Error("timeout")),
      podGone: async () => false,
    });
    const { turn, calls } = makeTurn();
    recovery.watch(turn);
    await vi.advanceTimersByTimeAsync(5 * POLL_MS);
    expect(calls.recover).toBe(0);
    recovery.stop();
  });

  /**
   * TEST_SCENARIO: A session that never shows life runs out the rolling
   * window — the watch gives up without recovering, and no further polls
   * fire. This is the only way a watch ends on time alone.
   */
  it("expires a never-alive session at the window without recovering", async () => {
    let polls = 0;
    const recovery = createTurnRecovery({
      turnStatus: async () => {
        polls += 1;
        return "unknown";
      },
      podGone: async () => false,
    });
    const { turn, calls } = makeTurn();
    recovery.watch(turn);
    await vi.advanceTimersByTimeAsync(WINDOW_MS + 10 * POLL_MS);
    const pollsAtExpiry = polls;
    await vi.advanceTimersByTimeAsync(10 * POLL_MS);
    expect(calls.recover).toBe(0);
    expect(polls).toBe(pollsAtExpiry);
    recovery.stop();
  });

  /**
   * TEST_SCENARIO: A later turn on the same session succeeded, so the worker
   * dismissed the watch. The old turn's nudge must never fire after that.
   */
  it("never recovers after a dismissal", async () => {
    const recovery = createTurnRecovery({
      turnStatus: scripted(["ended"]),
      podGone: async () => false,
    });
    const { turn, calls } = makeTurn();
    recovery.watch(turn);
    recovery.dismiss("agent-1", "s-1");
    await vi.advanceTimersByTimeAsync(2 * POLL_MS);
    expect(calls.recover).toBe(0);
    recovery.stop();
  });
});
