import { describe, it, expect } from "vitest";
import { createThreadSupersede } from "../../modules/channels/domain/thread-supersede.js";

/**
 * TEST_OVERVIEW: The rule that keeps one Agent from acting on a message twice
 * at once — in a turn outside any thread, and in the thread a reply opened
 * under it. A reply supersedes that Agent's turns on the thread's opener: a
 * turn carrying the opener alone is cancelled, one carrying more runs to its
 * end, and the thread's turn waits for both and is handed what they ran and
 * posted. A turn not started yet learns the opener is superseded. Other
 * Agents, other channels and the thread's own session are left alone.
 */

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("createThreadSupersede", () => {
  /**
   * TEST_SCENARIO: The reported case: a read-along turn on a task is running
   * when a reply in its thread asks the Agent to take it. The read-along turn
   * is cancelled, and the thread's turn waits until it has really stopped, so
   * the two never act at the same time.
   */
  it("cancels a turn carrying the opener alone and waits for it to end", async () => {
    const supersede = createThreadSupersede();
    let cancelled = 0;
    const held = supersede.hold("agent-1", {
      channel: "C1",
      sessionKey: "ambient:C1",
      carries: () => ["100.1"],
      cancel: () => {
        cancelled += 1;
      },
    });
    held.noteTool("gh issue create");

    const waiting = supersede.supersede("agent-1", {
      channel: "C1",
      rootTs: "100.1",
      sessionKey: "C1:100.1",
    });
    expect(waiting).not.toBeNull();
    expect(cancelled).toBe(1);

    let settled = false;
    void waiting!.then(() => {
      settled = true;
    });
    await tick();
    expect(settled).toBe(false);

    held.noteReplies(["Filed #1"]);
    held.end();
    expect(await waiting).toEqual([
      { cancelled: true, tools: ["gh issue create"], replies: ["Filed #1"] },
    ]);
  });

  /**
   * TEST_SCENARIO: A turn that also carries other messages must not be
   * cancelled — those would be dropped — but the thread's turn still waits for
   * it, so the two do not overlap.
   */
  it("waits for, but does not cancel, a turn carrying more than the opener", async () => {
    const supersede = createThreadSupersede();
    let cancelled = 0;
    const held = supersede.hold("agent-1", {
      channel: "C1",
      sessionKey: "ambient:C1",
      carries: () => ["100.1", "100.2"],
      cancel: () => {
        cancelled += 1;
      },
    });

    const waiting = supersede.supersede("agent-1", {
      channel: "C1",
      rootTs: "100.1",
      sessionKey: "C1:100.1",
    });
    expect(cancelled).toBe(0);
    held.end();
    expect(await waiting).toEqual([
      { cancelled: false, tools: [], replies: [] },
    ]);
  });

  /**
   * TEST_SCENARIO: Only the replying Agent's turns on that very opener are
   * touched. Another Agent reading along keeps its turn, a turn on another
   * message or channel is unrelated, and a turn in the thread's own session is
   * already serialized with it.
   */
  it("leaves other agents, other messages and the thread's own session alone", () => {
    const supersede = createThreadSupersede();
    let cancelled = 0;
    const cancel = () => {
      cancelled += 1;
    };
    supersede.hold("agent-2", {
      channel: "C1",
      sessionKey: "ambient:C1",
      carries: () => ["100.1"],
      cancel,
    });
    supersede.hold("agent-1", {
      channel: "C1",
      sessionKey: "ambient:C1",
      carries: () => ["100.9"],
      cancel,
    });
    supersede.hold("agent-1", {
      channel: "C2",
      sessionKey: "ambient:C2",
      carries: () => ["100.1"],
      cancel,
    });
    supersede.hold("agent-1", {
      channel: "C1",
      sessionKey: "C1:100.1",
      carries: () => ["100.1"],
      cancel,
    });

    expect(
      supersede.supersede("agent-1", {
        channel: "C1",
        rootTs: "100.1",
        sessionKey: "C1:100.1",
      }),
    ).toBeNull();
    expect(cancelled).toBe(0);
  });

  /**
   * TEST_SCENARIO: When the reply lands before the read-along turn has
   * started, there is nothing to cancel; the queued turn must instead learn
   * that the opener is now the thread's, for this Agent only.
   */
  it("marks the opener superseded for a turn not started yet", () => {
    const supersede = createThreadSupersede();
    expect(supersede.isSuperseded("agent-1", "C1", "100.1")).toBe(false);

    supersede.supersede("agent-1", {
      channel: "C1",
      rootTs: "100.1",
      sessionKey: "C1:100.1",
    });

    expect(supersede.isSuperseded("agent-1", "C1", "100.1")).toBe(true);
    expect(supersede.isSuperseded("agent-2", "C1", "100.1")).toBe(false);
    expect(supersede.isSuperseded("agent-1", "C2", "100.1")).toBe(false);
  });

  /**
   * TEST_SCENARIO: A second reply in the same thread must not cancel the
   * earlier turn twice or wait on a turn that has already ended.
   */
  it("cancels once, and forgets a turn once it ended", async () => {
    const supersede = createThreadSupersede();
    let cancelled = 0;
    const held = supersede.hold("agent-1", {
      channel: "C1",
      sessionKey: "ambient:C1",
      carries: () => ["100.1"],
      cancel: () => {
        cancelled += 1;
      },
    });
    const thread = { channel: "C1", rootTs: "100.1", sessionKey: "C1:100.1" };

    const first = supersede.supersede("agent-1", thread);
    const second = supersede.supersede("agent-1", thread);
    expect(cancelled).toBe(1);
    held.end();
    await Promise.all([first, second]);

    expect(supersede.supersede("agent-1", thread)).toBeNull();
  });
});
