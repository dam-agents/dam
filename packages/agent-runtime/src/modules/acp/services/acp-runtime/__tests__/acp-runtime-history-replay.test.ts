import { describe, it, expect } from "vitest";
import { createWorld, frames, type Client, type Frame } from "./acp-world.js";

/**
 * TEST_OVERVIEW: opening a conversation replays its newest tail, not the whole
 * history.
 *
 * The Session Transcript caps what a fresh viewer receives to the last
 * replayTailEvents entries, marks the cut with a clipped-replay warning that
 * carries the sequence number the skipped history ends at, and serves the
 * older ranges on demand when a session/load names that cursor in
 * `_meta.platform.replayBefore`. A cold transcript (first attach after a pod
 * restart) is filled by one silent harness load whose replay reaches no
 * channel; every viewer is then served the same capped tail. Cursors are only
 * meaningful within one transcript's lifetime, so a page request against a
 * cold transcript is refused instead of guessed at.
 */

const SESSION = "sess-history";

interface ReplayedUpdate {
  kind: string;
  text?: string;
  olderBefore?: number;
}

function replayedUpdates(client: Client): ReplayedUpdate[] {
  return client.saw("session/update").map((frame) => {
    const params = frame.params as {
      update?: {
        sessionUpdate?: string;
        content?: { text?: string };
        _meta?: { platform?: { olderBefore?: number } };
      };
    };
    const update = params.update ?? {};
    return {
      kind: update.sessionUpdate ?? "unknown",
      ...(update.content?.text !== undefined
        ? { text: update.content.text }
        : {}),
      ...(update._meta?.platform?.olderBefore !== undefined
        ? { olderBefore: update._meta.platform.olderBefore }
        : {}),
    };
  });
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
   * A fresh viewer must receive exactly the newest three, preceded by a
   * clipped-replay warning whose cursor names the first replayed entry, so
   * the viewer knows older history exists and where it ends.
   */
  it("should replay only the newest tail to a fresh viewer, with a cursor to the rest", () => {
    const world = createWorld({ replayTailEvents: 3 });
    warmTranscript(world, ["m1", "m2", "m3", "m4", "m5", "m6"]);

    const bob = world.connect();
    bob.send(frames.loadSession(1, SESSION));

    expect(replayedUpdates(bob)).toEqual([
      { kind: "platform_clipped_replay", olderBefore: 4 },
      { kind: "agent_message_chunk", text: "m4" },
      { kind: "agent_message_chunk", text: "m5" },
      { kind: "agent_message_chunk", text: "m6" },
    ]);
    expect(bob.reply(1)).toMatchObject({ result: { sessionId: SESSION } });
  });

  /**
   * TEST_SCENARIO: A conversation short enough to fit under the cap replays
   * whole, with no clipped-replay warning — the cap must be invisible until
   * it actually cuts something.
   */
  it("should replay a short conversation in full without a clipped marker", () => {
    const world = createWorld({ replayTailEvents: 3 });
    warmTranscript(world, ["m1", "m2"]);

    const bob = world.connect();
    bob.send(frames.loadSession(1, SESSION));

    expect(replayedUpdates(bob)).toEqual([
      { kind: "agent_message_chunk", text: "m1" },
      { kind: "agent_message_chunk", text: "m2" },
    ]);
  });

  /**
   * TEST_SCENARIO: The viewer follows the cursor back through an
   * eight-message history with a cap of three. Each page returns the three
   * entries before the cursor and a new cursor, until the final page reaches
   * the genuine start of the conversation, which carries no marker — the
   * viewer can tell "more above" from "this is the beginning".
   */
  it("should page older history back to the start, cursor by cursor", () => {
    const world = createWorld({ replayTailEvents: 3 });
    warmTranscript(world, ["m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8"]);

    const bob = world.connect();
    bob.send(frames.loadSession(1, SESSION));
    expect(replayedUpdates(bob)[0]).toEqual({
      kind: "platform_clipped_replay",
      olderBefore: 6,
    });

    const carol = world.connect();
    carol.send(loadPage(1, SESSION, 6));
    expect(replayedUpdates(carol)).toEqual([
      { kind: "platform_clipped_replay", olderBefore: 3 },
      { kind: "agent_message_chunk", text: "m3" },
      { kind: "agent_message_chunk", text: "m4" },
      { kind: "agent_message_chunk", text: "m5" },
    ]);
    expect(carol.reply(1)).toMatchObject({ result: { sessionId: SESSION } });

    carol.send(loadPage(2, SESSION, 3));
    expect(replayedUpdates(carol).slice(4)).toEqual([
      { kind: "agent_message_chunk", text: "m1" },
      { kind: "agent_message_chunk", text: "m2" },
    ]);
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
    bob.send(frames.loadSession(1, SESSION));
    bob.send(loadPage(2, SESSION, 4));

    world.harness().emit(frames.agentMessage(SESSION, "m7"));

    const texts = replayedUpdates(bob)
      .filter((u) => u.text !== undefined)
      .map((u) => u.text);
    expect(texts).toEqual(["m4", "m5", "m6", "m1", "m2", "m3", "m7"]);
  });

  /**
   * TEST_SCENARIO: The transcript evicts oldest entries past its byte cap.
   * When paging bottoms out at the eviction floor, the last page carries a
   * clipped-replay warning without a cursor: older history existed but is
   * gone, and the viewer must not be offered a "load more" that cannot load.
   */
  it("should mark the eviction floor with a cursor-less clipped marker", () => {
    const entryBytes = JSON.stringify(
      frames.agentMessage(SESSION, "m1"),
    ).length;
    const world = createWorld({
      replayTailEvents: 2,
      logBytesCap: entryBytes * 4,
    });
    warmTranscript(world, ["m1", "m2", "m3", "m4", "m5", "m6"]);

    const bob = world.connect();
    bob.send(frames.loadSession(1, SESSION));
    const first = replayedUpdates(bob);
    expect(first[0]?.kind).toBe("platform_clipped_replay");
    const cursor = first[0]?.olderBefore;
    expect(cursor).toBeDefined();

    bob.send(loadPage(2, SESSION, cursor!));
    const paged = replayedUpdates(bob).slice(first.length);
    expect(paged[0]).toEqual({ kind: "platform_clipped_replay" });
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
   * that replay may reach the viewer live — the viewer gets the capped tail
   * from the transcript only after the harness finishes, so a long replay
   * costs the wire only the tail.
   */
  it("should fill a cold transcript silently and serve viewers the capped tail", () => {
    const world = createWorld({ replayTailEvents: 2 });

    const bob = world.connect();
    bob.send(frames.loadSession(1, SESSION));

    const carol = world.connect();
    carol.send(frames.loadSession(1, SESSION));

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
      expect(replayedUpdates(viewer)).toEqual([
        { kind: "platform_clipped_replay", olderBefore: 3 },
        { kind: "agent_message_chunk", text: "m3" },
        { kind: "agent_message_chunk", text: "m4" },
      ]);
      expect(viewer.reply(1)).toMatchObject({
        result: { sessionId: SESSION },
      });
    }
  });
});
