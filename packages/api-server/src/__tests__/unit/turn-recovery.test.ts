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
 * judged by how the work ended, never by timing: a turn that ended
 * in-process made its full disposition and is recovered only when it
 * delivered nothing; an interrupted turn (boot recovery gave it up) never
 * completed, so it is recovered unless its silence was deliberate. The work
 * is over only on a positive signal — one of those statuses, or the platform
 * reporting the pod gone (the idle checker never hibernates a pod under a
 * running turn); a failed read is unknown and just keeps being polled. Every
 * way a watch ends fires onDone — after the recovery where one runs, so a
 * reply landing mid-recovery stays markable — and caller bookkeeping cannot
 * outlive the watch.
 */

configureLogger({ level: "error", write: () => {} });

const POLL_MS = 2 * 60_000;
const WINDOW_MS = 2 * 60 * 60_000;

function scripted(seq: AcpTurnStatus[]) {
  let i = 0;
  return async () => seq[Math.min(i++, seq.length - 1)]!;
}

function makeTurn(over?: Partial<WatchedTurn>) {
  const events: string[] = [];
  const turn: WatchedTurn = {
    instanceName: "agent-1",
    sessionId: "s-1",
    isDelivered: () => false,
    recover: async (end) => {
      events.push(`recover:${end}`);
    },
    onDone: () => {
      events.push("done");
    },
    ...over,
  };
  return { turn, events };
}

describe("turn recovery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * TEST_SCENARIO: The turn is still running. Polls must only keep the watch
   * alive — recovering here would nudge an agent that is still working.
   */
  it("keeps polling a running turn without recovering", async () => {
    const recovery = createTurnRecovery({
      turnStatus: scripted(["pending", "pending"]),
      podGone: async () => false,
    });
    const { turn, events } = makeTurn();
    recovery.watch(turn);
    await vi.advanceTimersByTimeAsync(2 * POLL_MS);
    expect(events).toEqual([]);
    recovery.stop();
  });

  /**
   * TEST_SCENARIO: The turn ended in-process having delivered nothing — the
   * lost answer this feature exists to recover. Recovery fires as a clean
   * end, exactly once, however long the clock runs on.
   */
  it("recovers an ended turn that delivered nothing, exactly once", async () => {
    const recovery = createTurnRecovery({
      turnStatus: scripted(["pending", "ended"]),
      podGone: async () => false,
    });
    const { turn, events } = makeTurn();
    recovery.watch(turn);
    await vi.advanceTimersByTimeAsync(5 * POLL_MS);
    expect(events).toEqual(["recover:clean", "done"]);
    recovery.stop();
  });

  /**
   * TEST_SCENARIO: The turn ended in-process and posted along the way. An
   * ended turn made its full disposition — whenever its reply landed, it is
   * the answer, and a nudge would produce a duplicate.
   */
  it("never recovers an ended turn that delivered", async () => {
    const recovery = createTurnRecovery({
      turnStatus: scripted(["pending", "ended"]),
      podGone: async () => false,
    });
    const { turn, events } = makeTurn({
      isDelivered: (end) => end === "clean",
    });
    recovery.watch(turn);
    await vi.advanceTimersByTimeAsync(5 * POLL_MS);
    expect(events).toEqual(["done"]);
    recovery.stop();
  });

  /**
   * TEST_SCENARIO: The turn was interrupted — the pod died mid-work twice
   * and the runtime gave up. An interim post is a partial, not the answer,
   * so recovery fires despite it; only a deliberate decline keeps silent.
   */
  it("recovers an interrupted turn past its interim post", async () => {
    const recovery = createTurnRecovery({
      turnStatus: scripted(["pending", "interrupted"]),
      podGone: async () => false,
    });
    const { turn, events } = makeTurn({
      isDelivered: (end) => end === "clean",
    });
    recovery.watch(turn);
    await vi.advanceTimersByTimeAsync(3 * POLL_MS);
    expect(events).toEqual(["recover:interrupted", "done"]);
    recovery.stop();
  });

  /**
   * TEST_SCENARIO: The interrupted turn's silence was deliberate — the agent
   * declined or handed the message off. Nothing to recover.
   */
  it("never recovers an interrupted turn that declined", async () => {
    const recovery = createTurnRecovery({
      turnStatus: scripted(["interrupted"]),
      podGone: async () => false,
    });
    const { turn, events } = makeTurn({ isDelivered: () => true });
    recovery.watch(turn);
    await vi.advanceTimersByTimeAsync(2 * POLL_MS);
    expect(events).toEqual(["done"]);
    recovery.stop();
  });

  /**
   * TEST_SCENARIO: The pod cannot be reached and the platform reports it
   * gone — hibernated after the turn ended, since the idle checker never
   * hibernates under a running turn. Treated as a clean ending.
   */
  it("treats an unreachable pod the platform reports gone as an ended turn", async () => {
    const recovery = createTurnRecovery({
      turnStatus: () => Promise.reject(new Error("no pod")),
      podGone: async () => true,
    });
    const { turn, events } = makeTurn();
    recovery.watch(turn);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(events).toEqual(["recover:clean", "done"]);
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
    const { turn, events } = makeTurn();
    recovery.watch(turn);
    await vi.advanceTimersByTimeAsync(5 * POLL_MS);
    expect(events).toEqual([]);
    recovery.stop();
  });

  /**
   * TEST_SCENARIO: A session that never shows life runs out the rolling
   * window — the watch gives up without recovering, no further polls fire,
   * and onDone releases the caller's bookkeeping.
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
    const { turn, events } = makeTurn();
    recovery.watch(turn);
    await vi.advanceTimersByTimeAsync(WINDOW_MS + 10 * POLL_MS);
    const pollsAtExpiry = polls;
    await vi.advanceTimersByTimeAsync(10 * POLL_MS);
    expect(events).toEqual(["done"]);
    expect(polls).toBe(pollsAtExpiry);
    recovery.stop();
  });

  /**
   * TEST_SCENARIO: A later turn on the same session succeeded, so the worker
   * dismissed the watch. The old turn's nudge must never fire after that,
   * and the dismissal releases the caller's bookkeeping.
   */
  it("never recovers after a dismissal", async () => {
    const recovery = createTurnRecovery({
      turnStatus: scripted(["ended"]),
      podGone: async () => false,
    });
    const { turn, events } = makeTurn();
    recovery.watch(turn);
    recovery.dismiss("agent-1", "s-1");
    await vi.advanceTimersByTimeAsync(2 * POLL_MS);
    expect(events).toEqual(["done"]);
    recovery.stop();
  });
});
