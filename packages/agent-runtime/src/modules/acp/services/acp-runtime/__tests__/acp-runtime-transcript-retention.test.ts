import { describe, it, expect, afterEach, vi } from "vitest";
import { createWorld, frames, type Client } from "./acp-world.js";

/**
 * TEST_OVERVIEW: the idle reap frees the harness's per-session subprocess but
 * keeps the runtime's transcript warm for a bounded, memory-budgeted window.
 *
 * When the last viewer leaves, the reap sends session/close (freeing the
 * expensive harness subprocess) and marks the session harness-cold, but the
 * in-memory log survives: a viewer returning within the window is served
 * from memory with no harness involvement, and the first prompt rehydrates
 * the harness through the existing held-prompt machinery. The window is
 * bounded twice — by time (transcriptRetainMs) and by a global byte budget
 * that evicts the oldest retained transcript first. Re-engaging cancels the
 * pending forget, and an explicit session reset still forgets immediately.
 */

const SESSION = "sess-retained";

function replayedTexts(client: Client, sessionId = SESSION): string[] {
  return client
    .saw("session/update")
    .filter(
      (frame) =>
        (frame.params as { sessionId?: string }).sessionId === sessionId,
    )
    .map((frame) => {
      const params = frame.params as {
        update?: { content?: { text?: string } };
      };
      return params.update?.content?.text ?? "";
    });
}

function loadedSessionIds(world: ReturnType<typeof createWorld>): string[] {
  return world
    .harness()
    .received("session/load")
    .map((frame) => (frame.params as { sessionId?: string }).sessionId ?? "");
}

function warmSession(
  world: ReturnType<typeof createWorld>,
  sessionId: string,
  texts: string[],
): Client {
  const viewer = world.connect();
  viewer.send(frames.newSession(1));
  world.harness().replyTo("session/new", { sessionId });
  for (const text of texts) {
    world.harness().emit(frames.agentMessage(sessionId, text));
  }
  return viewer;
}

describe("acp-runtime: warm transcript retention", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * TEST_SCENARIO: The last viewer leaves and the reap fires. The harness
   * session must be closed — the subprocess is the expensive part — but a
   * viewer returning within the window must be served the whole conversation
   * from the retained transcript, with the harness never asked to load. The
   * first prompt then rehydrates the harness before being forwarded.
   */
  it("should serve a re-open from the retained transcript after the reap closed the harness session", () => {
    const world = createWorld({ idleReapDelayMs: 0 });
    const alice = warmSession(world, SESSION, ["m1", "m2"]);

    alice.disconnect();
    expect(
      world
        .harness()
        .received("session/close")
        .map((frame) => frame.params),
    ).toEqual([{ sessionId: SESSION }]);

    const bob = world.connect();
    bob.send(frames.loadSession(1, SESSION));
    expect(world.harness().received("session/load")).toEqual([]);
    expect(replayedTexts(bob)).toEqual(["m1", "m2"]);
    expect(bob.reply(1)).toMatchObject({ result: { sessionId: SESSION } });

    bob.send(frames.prompt(2, SESSION, "hello again"));
    expect(world.harness().received("session/prompt")).toEqual([]);
    expect(world.harness().received("session/load")).toHaveLength(1);
    world
      .harness()
      .replyToSession("session/load", SESSION, { sessionId: SESSION });
    expect(world.harness().received("session/prompt")).toHaveLength(1);
  });

  /**
   * TEST_SCENARIO: Retention is a window, not forever. Once it expires the
   * transcript is forgotten, and the next open is an ordinary cold bootstrap
   * that asks the harness.
   */
  it("should forget the transcript when the retention window expires", () => {
    vi.useFakeTimers();
    const world = createWorld({
      idleReapDelayMs: 0,
      transcriptRetainMs: 60_000,
    });
    const alice = warmSession(world, SESSION, ["m1"]);

    alice.disconnect();
    vi.advanceTimersByTime(60_000);

    const bob = world.connect();
    bob.send(frames.loadSession(1, SESSION));
    expect(world.harness().received("session/load")).toHaveLength(1);
  });

  /**
   * TEST_SCENARIO: A viewer returning within the window must cancel the
   * pending forget — a conversation being read may not vanish under its
   * reader when the timer fires.
   */
  it("should cancel the pending forget when a viewer re-engages", () => {
    vi.useFakeTimers();
    const world = createWorld({
      idleReapDelayMs: 0,
      transcriptRetainMs: 60_000,
    });
    const alice = warmSession(world, SESSION, ["m1"]);

    alice.disconnect();
    const bob = world.connect();
    bob.send(frames.loadSession(1, SESSION));
    vi.advanceTimersByTime(120_000);

    const carol = world.connect();
    carol.send(frames.loadSession(1, SESSION));
    expect(world.harness().received("session/load")).toEqual([]);
    expect(replayedTexts(carol)).toEqual(["m1"]);
  });

  /**
   * TEST_SCENARIO: Retained transcripts share one byte budget. When a newly
   * retained session pushes the total over it, the oldest retained
   * transcript is evicted — never the newest — so a busy sandbox cannot
   * accumulate unbounded warm history.
   */
  it("should evict the oldest retained transcript over the byte budget", () => {
    const world = createWorld({
      idleReapDelayMs: 0,
      transcriptRetainBytesCap: 1,
    });
    const alice = warmSession(world, "sess-a", ["a1"]);
    const bob = warmSession(world, "sess-b", ["b1"]);

    alice.disconnect();
    bob.disconnect();

    const carol = world.connect();
    carol.send(frames.loadSession(1, "sess-a"));
    carol.send(frames.loadSession(2, "sess-b"));

    expect(loadedSessionIds(world)).toEqual(["sess-a"]);
    expect(replayedTexts(carol, "sess-b")).toEqual(["b1"]);
  });

  /**
   * TEST_SCENARIO: An explicit session reset means "forget this" — it must
   * clear the retained transcript immediately, without sending a second
   * session/close for a session the harness already released.
   */
  it("should forget a retained transcript on explicit reset without a second close", () => {
    const world = createWorld({ idleReapDelayMs: 0 });
    const alice = warmSession(world, SESSION, ["m1"]);

    alice.disconnect();
    world.runtime.resetSession(SESSION);
    expect(world.harness().received("session/close")).toHaveLength(1);

    const bob = world.connect();
    bob.send(frames.loadSession(1, SESSION));
    expect(world.harness().received("session/load")).toHaveLength(1);
  });
});
