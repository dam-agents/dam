import { describe, it, expect } from "vitest";
import { createWorld, frames, type Client, type Frame } from "./acp-world.js";

/**
 * TEST_OVERVIEW: opening a conversation replays its newest tail, not the whole
 * history — but only for clients that ask for it.
 *
 * A session/load carrying `_meta.platform.tail` receives the newest
 * replayTailEvents entries; the load response then carries
 * `_meta.platform.clipped` with the sequence number the cut ends at, and a
 * later load naming that cursor in `_meta.platform.replayBefore` is served
 * the older range, page by page. A load without the tail opt-in replays
 * everything the log holds — the ACP v1 contract for unknown clients —
 * clipped only by the log's own eviction, which the response reports as
 * `clipped` without a cursor. Cursors are only meaningful within one
 * transcript's lifetime, so a page request against a cold transcript is
 * refused instead of guessed at.
 */

const SESSION = "sess-history";

interface ReplayedUpdate {
  kind: string;
  text?: string;
}

function replayedUpdates(client: Client): ReplayedUpdate[] {
  return client.saw("session/update").map((frame) => {
    const params = frame.params as {
      update?: { sessionUpdate?: string; content?: { text?: string } };
    };
    const update = params.update ?? {};
    return {
      kind: update.sessionUpdate ?? "unknown",
      ...(update.content?.text !== undefined
        ? { text: update.content.text }
        : {}),
    };
  });
}

function clippedOf(client: Client, id: number): unknown {
  const reply = client.reply(id) as
    | { result?: { _meta?: { platform?: { clipped?: unknown } } } }
    | undefined;
  return reply?.result?._meta?.platform?.clipped;
}

function loadTail(id: number, sessionId: string): Frame {
  return {
    jsonrpc: "2.0",
    id,
    method: "session/load",
    params: {
      sessionId,
      cwd: ".",
      mcpServers: [],
      _meta: { platform: { tail: true } },
    },
  };
}

function loadPage(id: number, sessionId: string, replayBefore: number): Frame {
  return {
    jsonrpc: "2.0",
    id,
    method: "session/load",
    params: {
      sessionId,
      cwd: ".",
      mcpServers: [],
      _meta: { platform: { replayBefore } },
    },
  };
}

function warmTranscript(
  world: ReturnType<typeof createWorld>,
  texts: string[],
): Client {
  const alice = world.connect();
  alice.send(frames.newSession(1));
  world.harness().replyTo("session/new", { sessionId: SESSION });
  for (const text of texts) {
    world.harness().emit(frames.agentMessage(SESSION, text));
  }
  return alice;
}

describe("acp-runtime: history replay", () => {
  /**
   * TEST_SCENARIO: Six messages have accumulated and the tail cap is three.
   * A viewer that opts into the tail must receive exactly the newest three,
   * and the load response must carry the cursor naming where the skipped
   * history ends, so the viewer knows older history exists and can page it.
   */
  it("should replay only the newest tail to an opted-in viewer, with a cursor on the response", () => {
    const world = createWorld({ replayTailEvents: 3 });
    warmTranscript(world, ["m1", "m2", "m3", "m4", "m5", "m6"]);

    const bob = world.connect();
    bob.send(loadTail(1, SESSION));

    expect(replayedUpdates(bob)).toEqual([
      { kind: "agent_message_chunk", text: "m4" },
      { kind: "agent_message_chunk", text: "m5" },
      { kind: "agent_message_chunk", text: "m6" },
    ]);
    expect(bob.reply(1)).toMatchObject({ result: { sessionId: SESSION } });
    expect(clippedOf(bob, 1)).toEqual({ olderBefore: 4 });
  });

  /**
   * TEST_SCENARIO: A load without the tail opt-in is an ordinary ACP client.
   * Per the v1 contract it must receive the entire conversation, however
   * long, with no clip metadata — the cap must not exist for it.
   */
  it("should replay everything to a client that does not opt in", () => {
    const world = createWorld({ replayTailEvents: 3 });
    warmTranscript(world, ["m1", "m2", "m3", "m4", "m5", "m6"]);

    const bob = world.connect();
    bob.send(frames.loadSession(1, SESSION));

    expect(replayedUpdates(bob).map((u) => u.text)).toEqual([
      "m1",
      "m2",
      "m3",
      "m4",
      "m5",
      "m6",
    ]);
    expect(clippedOf(bob, 1)).toBeUndefined();
  });

  /**
   * TEST_SCENARIO: A conversation short enough to fit under the cap replays
   * whole even for an opted-in viewer, with no clip metadata — the cap must
   * be invisible until it actually cuts something.
   */
  it("should replay a short conversation in full without clip metadata", () => {
    const world = createWorld({ replayTailEvents: 3 });
    warmTranscript(world, ["m1", "m2"]);

    const bob = world.connect();
    bob.send(loadTail(1, SESSION));

    expect(replayedUpdates(bob).map((u) => u.text)).toEqual(["m1", "m2"]);
    expect(clippedOf(bob, 1)).toBeUndefined();
  });

  /**
   * TEST_SCENARIO: The viewer follows the cursor back through an
   * eight-message history with a cap of three. Each page returns the three
   * entries before the cursor and its response carries the next cursor,
   * until the final page reaches the genuine start of the conversation,
   * whose response carries no clip metadata — the viewer can tell "more
   * above" from "this is the beginning".
   */
  it("should page older history back to the start, cursor by cursor", () => {
    const world = createWorld({ replayTailEvents: 3 });
    warmTranscript(world, ["m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8"]);

    const bob = world.connect();
    bob.send(loadTail(1, SESSION));
    expect(clippedOf(bob, 1)).toEqual({ olderBefore: 6 });

    const carol = world.connect();
    carol.send(loadPage(1, SESSION, 6));
    expect(replayedUpdates(carol).map((u) => u.text)).toEqual([
      "m3",
      "m4",
      "m5",
    ]);
    expect(clippedOf(carol, 1)).toEqual({ olderBefore: 3 });

    carol.send(loadPage(2, SESSION, 3));
    expect(
      replayedUpdates(carol)
        .slice(3)
        .map((u) => u.text),
    ).toEqual(["m1", "m2"]);
    expect(clippedOf(carol, 2)).toBeUndefined();
  });

  /**
   * TEST_SCENARIO: Paging must not disturb the live view. A page request
   * replays old entries to the asking channel only, and that channel's live
   * cursor stays where it was — new messages still arrive exactly once.
   */
  it("should keep live fan-out intact for a viewer that paged back", () => {
    const world = createWorld({ replayTailEvents: 3 });
    warmTranscript(world, ["m1", "m2", "m3", "m4", "m5", "m6"]);

    const bob = world.connect();
    bob.send(loadTail(1, SESSION));
    bob.send(loadPage(2, SESSION, 4));

    world.harness().emit(frames.agentMessage(SESSION, "m7"));

    expect(replayedUpdates(bob).map((u) => u.text)).toEqual([
      "m4",
      "m5",
      "m6",
      "m1",
      "m2",
      "m3",
      "m7",
    ]);
  });

  /**
   * TEST_SCENARIO: The transcript evicts oldest entries past its byte cap.
   * When paging bottoms out at the eviction floor, the last page's response
   * reports clipped without a cursor: older history existed but is gone, and
   * the viewer must not be offered a "load more" that cannot load.
   */
  it("should mark the eviction floor as clipped without a cursor", () => {
    const entryBytes = JSON.stringify(
      frames.agentMessage(SESSION, "m1"),
    ).length;
    const world = createWorld({
      replayTailEvents: 2,
      logBytesCap: entryBytes * 4,
    });
    warmTranscript(world, ["m1", "m2", "m3", "m4", "m5", "m6"]);

    const bob = world.connect();
    bob.send(loadTail(1, SESSION));
    const clipped = clippedOf(bob, 1) as { olderBefore?: number };
    expect(clipped.olderBefore).toBeDefined();

    bob.send(loadPage(2, SESSION, clipped.olderBefore!));
    expect(clippedOf(bob, 2)).toEqual({});
  });

  /**
   * TEST_SCENARIO: The pod restarted, so the transcript is cold and a saved
   * cursor names entries this transcript never held. The runtime must refuse
   * the page rather than bootstrap and serve arbitrary entries under a stale
   * numbering.
   */
  it("should refuse a page request against a cold transcript", () => {
    const world = createWorld({ replayTailEvents: 3 });

    const bob = world.connect();
    bob.send(loadPage(1, SESSION, 42));

    expect(bob.reply(1)).toMatchObject({
      error: { code: -32602 },
    });
    expect(world.harness().received("session/load")).toEqual([]);
  });

  /**
   * TEST_SCENARIO: First open after a pod restart. The runtime asks the
   * harness once, the harness replays the whole conversation, and none of
   * that replay may reach the viewer live — every opted-in viewer gets the
   * capped tail from the transcript only after the harness finishes, so a
   * long replay costs the wire only the tail.
   */
  it("should fill a cold transcript silently and serve viewers the capped tail", () => {
    const world = createWorld({ replayTailEvents: 2 });

    const bob = world.connect();
    bob.send(loadTail(1, SESSION));

    const carol = world.connect();
    carol.send(loadTail(1, SESSION));

    expect(world.harness().received("session/load")).toHaveLength(1);
    const forwarded = world.harness().received("session/load")[0];
    expect((forwarded?.params as { cwd?: string }).cwd).toBe("/workspace");

    for (const text of ["m1", "m2", "m3", "m4"]) {
      world.harness().emit(frames.agentMessage(SESSION, text));
    }
    expect(replayedUpdates(bob)).toEqual([]);
    expect(replayedUpdates(carol)).toEqual([]);

    world
      .harness()
      .replyTo("session/load", { sessionId: SESSION, modes: null });

    for (const viewer of [bob, carol]) {
      expect(replayedUpdates(viewer).map((u) => u.text)).toEqual(["m3", "m4"]);
      expect(viewer.reply(1)).toMatchObject({
        result: { sessionId: SESSION },
      });
      expect(clippedOf(viewer, 1)).toEqual({ olderBefore: 3 });
    }
  });
});
