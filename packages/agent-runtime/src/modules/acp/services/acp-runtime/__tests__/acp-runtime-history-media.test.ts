import { describe, expect, it } from "vitest";
import { createWorld, frames, type Client, type Frame } from "./acp-world.js";
import type { HistoryProvider } from "../../../infrastructure/history-provider.js";

/**
 * TEST_OVERVIEW: what the Session Transcript no longer holds is read from the
 * harness's own history, through the session-history provider.
 *
 * Over its cap the log drops the bytes of inline images and audio, keeping a
 * reference to them, and later evicts its oldest entries. A reload, a cold
 * fill, a page of older history and the read of a Session as data then take
 * the bytes from the block with the same content in the harness's history,
 * and a log that evicted its start hands everything before its first whole
 * prompt over to that history, without a gap or a frame sent twice. Only a
 * block the history does not hold, or a harness with no provider, shows the
 * `[image not kept in history]` placeholder.
 */

const SESSION = "sess-media";
const LARGE_IMAGE = "A".repeat(12 * 1024 * 1024);

interface Shown {
  text?: string;
  image?: string;
}

function shown(client: Client): Shown[] {
  return client.saw("session/update").map((frame) => {
    const params = frame.params as {
      update?: { content?: { type?: string; text?: string; data?: string } };
    };
    const content = params.update?.content ?? {};
    return content.type === "image"
      ? { image: content.data }
      : { text: content.text };
  });
}

function textsOf(client: Client): (string | undefined)[] {
  return shown(client).map((s) => s.text ?? s.image);
}

function userChunk(content: unknown, messageId?: string): Frame {
  return {
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: SESSION,
      update: {
        sessionUpdate: "user_message_chunk",
        content,
        ...(messageId !== undefined && { messageId }),
      },
    },
  };
}

function imageUpdate(data: string): Frame {
  return userChunk({ type: "image", data, mimeType: "image/png" });
}

function load(id: number, meta: Record<string, unknown> = {}): Frame {
  return {
    jsonrpc: "2.0",
    id,
    method: "session/load",
    params: {
      sessionId: SESSION,
      cwd: ".",
      mcpServers: [],
      _meta: { platform: meta },
    },
  };
}

function olderOf(client: Client, id: number): string | undefined {
  const reply = client.reply(id) as {
    result?: { _meta?: { platform?: { clipped?: { older?: string } } } };
  };
  return reply.result?._meta?.platform?.clipped?.older;
}

function clippedOf(client: Client, id: number): unknown {
  const reply = client.reply(id) as {
    result?: { _meta?: { platform?: { clipped?: unknown } } };
  };
  return reply.result?._meta?.platform?.clipped;
}

function providerOf(lines: readonly Frame[]): {
  provider: HistoryProvider;
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    provider: {
      fetch(sessionId) {
        calls.push(sessionId);
        return Promise.resolve(lines.map((frame) => JSON.stringify(frame)));
      },
    },
  };
}

function pasteBetweenPrompts(
  world: ReturnType<typeof createWorld>,
  image: string,
): void {
  const alice = world.connect();
  alice.send(frames.newSession(1));
  world.harness().replyTo("session/new", { sessionId: SESSION });
  const prompts: unknown[][] = [
    [{ type: "text", text: "before" }],
    [
      { type: "image", data: image, mimeType: "image/png" },
      { type: "text", text: "look" },
    ],
    [{ type: "text", text: "after" }],
  ];
  prompts.forEach((prompt, i) => {
    alice.send({
      jsonrpc: "2.0",
      id: 10 + i,
      method: "session/prompt",
      params: { sessionId: SESSION, prompt },
    });
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });
  });
}

const PASTE_HISTORY: Frame[] = [
  userChunk({ type: "text", text: "before" }, "h1"),
  userChunk({ type: "image", data: LARGE_IMAGE, mimeType: "image/png" }, "h2"),
  userChunk({ type: "text", text: "look" }, "h2"),
  userChunk({ type: "text", text: "after" }, "h3"),
];

function conversation(turns: number): Frame[] {
  return Array.from({ length: turns }, (_, i) => [
    userChunk({ type: "text", text: `q${i + 1}` }, `u${i + 1}`),
    frames.agentMessage(SESSION, `a${i + 1}`.padEnd(120, "."), `r${i + 1}`),
  ]).flat();
}

function warmFrom(
  world: ReturnType<typeof createWorld>,
  lines: readonly Frame[],
): void {
  const alice = world.connect();
  alice.send(frames.newSession(1));
  world.harness().replyTo("session/new", { sessionId: SESSION });
  for (const line of lines) world.harness().emit(line);
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const ALL_TEXTS = (turns: number) =>
  Array.from({ length: turns }, (_, i) => [
    `q${i + 1}`,
    `a${i + 1}`.padEnd(120, "."),
  ]).flat();

describe("acp-runtime: media and older history from the harness history", () => {
  /**
   * TEST_SCENARIO: A user pastes an image larger than the whole log cap
   * between two prompts, then reloads. The log dropped the bytes, so the
   * reload reads the harness history once and shows the image from it,
   * with every prompt around it.
   */
  it("should show a pasted image larger than the log cap after a reload", async () => {
    const { provider, calls } = providerOf(PASTE_HISTORY);
    const world = createWorld({ historyProvider: provider });
    pasteBetweenPrompts(world, LARGE_IMAGE);

    const bob = world.connect();
    bob.send(load(1));
    await settle();

    expect(shown(bob)).toEqual([
      { text: "before" },
      { image: LARGE_IMAGE },
      { text: "look" },
      { text: "after" },
    ]);
    expect(calls).toEqual([SESSION]);
    expect(clippedOf(bob, 1)).toBeUndefined();
  });

  /**
   * TEST_SCENARIO: A reload whose replay holds no dropped image must not
   * read the harness history at all, since everything it shows is in memory.
   */
  it("should not read the history for a reload the log can serve alone", async () => {
    const { provider, calls } = providerOf(PASTE_HISTORY);
    const world = createWorld({ historyProvider: provider });
    pasteBetweenPrompts(world, "SMALL-IMAGE");

    const bob = world.connect();
    bob.send(load(1));
    await settle();

    expect(shown(bob)).toContainEqual({ image: "SMALL-IMAGE" });
    expect(calls).toEqual([]);
  });

  /**
   * TEST_SCENARIO: The harness history does not hold the dropped image —
   * the bytes are really gone. Only then does the reload show the
   * placeholder, and the text around it stays.
   */
  it("should show the placeholder when the history lacks the image", async () => {
    const { provider } = providerOf(PASTE_HISTORY.filter((_, i) => i !== 1));
    const world = createWorld({ historyProvider: provider });
    pasteBetweenPrompts(world, LARGE_IMAGE);

    const bob = world.connect();
    bob.send(load(1));
    await settle();

    expect(textsOf(bob)).toEqual([
      "before",
      "[image not kept in history]",
      "look",
      "after",
    ]);
  });

  /**
   * TEST_SCENARIO: A cold load served by the session-history provider. The
   * fill itself drops the oversized image from the log, and the waiting
   * viewer must still get it, from the lines of that same fill, with no
   * second read of the history.
   */
  it("should show an oversized image from a provider fill without a second read", async () => {
    const { provider, calls } = providerOf([
      frames.agentMessage(SESSION, "m1", "m1"),
      imageUpdate(LARGE_IMAGE),
      frames.agentMessage(SESSION, "m2", "m2"),
    ]);
    const world = createWorld({ historyProvider: provider });

    const bob = world.connect();
    bob.send(frames.loadSession(1, SESSION));
    await settle();

    expect(shown(bob)).toEqual([
      { text: "m1" },
      { image: LARGE_IMAGE },
      { text: "m2" },
    ]);
    expect(calls).toEqual([SESSION]);
  });

  /**
   * TEST_SCENARIO: The dropped image sits above the replayed tail, so the
   * viewer reaches it by paging older history. The page reads the harness
   * history and carries the bytes.
   */
  it("should show a dropped image on a page of older history", async () => {
    const { provider } = providerOf(PASTE_HISTORY);
    const world = createWorld({
      historyProvider: provider,
      replayTailEvents: 3,
    });
    pasteBetweenPrompts(world, LARGE_IMAGE);

    const bob = world.connect();
    bob.send(load(1, { tail: true }));
    await settle();
    expect(textsOf(bob)).toEqual(["after"]);

    const carol = world.connect();
    carol.send(load(1, { replayBefore: olderOf(bob, 1) }));
    await settle();
    expect(shown(carol)).toEqual([{ image: LARGE_IMAGE }, { text: "look" }]);
  });

  /**
   * TEST_SCENARIO: A long Session evicted the start of its log. A viewer
   * that opts into the tail pages back past the log's start: the pages then
   * come from the harness history, and the whole conversation shows once,
   * in order, down to its real start.
   */
  it("should page past the eviction floor into the harness history", async () => {
    const history = conversation(8);
    const { provider } = providerOf(history);
    const world = createWorld({
      historyProvider: provider,
      logBytesCap: 1500,
      replayTailEvents: 4,
    });
    warmFrom(world, history);

    const bob = world.connect();
    bob.send(load(1, { tail: true }));
    await settle();
    const pages = [textsOf(bob)];
    let older = olderOf(bob, 1);
    for (let id = 2; older !== undefined && id < 20; id++) {
      const pager = world.connect();
      pager.send(load(id, { replayBefore: older }));
      await settle();
      pages.unshift(textsOf(pager));
      older = olderOf(pager, id);
      if (older === undefined) expect(clippedOf(pager, id)).toBeUndefined();
    }

    expect(pages.flat()).toEqual(ALL_TEXTS(8));
  });

  /**
   * TEST_SCENARIO: A tail viewer stays open while so many turns arrive live
   * that the log evicts past the cursor its load handed out. Paging from that
   * cursor must be refused as expired, so the client reloads, rather than
   * hand over to the history at the new log start and send again the turns
   * the viewer already shows.
   */
  it("should refuse a log cursor that eviction passed", async () => {
    const history = conversation(16);
    const { provider } = providerOf(history);
    const world = createWorld({
      historyProvider: provider,
      logBytesCap: 3000,
      replayTailEvents: 4,
    });
    warmFrom(world, history.slice(0, 16));

    const bob = world.connect();
    bob.send(load(1, { tail: true }));
    await settle();
    const older = olderOf(bob, 1);
    expect(older).toBeDefined();
    for (const line of history.slice(16)) world.harness().emit(line);

    const pager = world.connect();
    pager.send(load(2, { replayBefore: older! }));
    await settle();

    expect(textsOf(pager)).toEqual([]);
    expect(pager.reply(2)).toMatchObject({
      error: { message: "replay window expired; load the session again" },
    });
  });

  /**
   * TEST_SCENARIO: A client that does not opt into the tail loads a Session
   * whose log evicted its start. It must get the whole conversation, the
   * older part from the harness history, with no clip.
   */
  it("should replay the whole conversation to a full load of an evicted log", async () => {
    const history = conversation(8);
    const { provider } = providerOf(history);
    const world = createWorld({ historyProvider: provider, logBytesCap: 1500 });
    warmFrom(world, history);

    const bob = world.connect();
    bob.send(load(1));
    await settle();

    expect(textsOf(bob)).toEqual(ALL_TEXTS(8));
    expect(clippedOf(bob, 1)).toBeUndefined();
  });

  /**
   * TEST_SCENARIO: A harness with no session-history provider keeps
   * today's behavior: a full load of an evicted log starts at the eviction
   * floor and reports the clip without a cursor.
   */
  it("should start at the eviction floor when there is no provider", () => {
    const history = conversation(8);
    const world = createWorld({ logBytesCap: 1500 });
    warmFrom(world, history);

    const bob = world.connect();
    bob.send(load(1));

    const texts = textsOf(bob);
    expect(texts.length).toBeLessThan(ALL_TEXTS(8).length);
    expect(ALL_TEXTS(8).slice(-texts.length)).toEqual(texts);
    expect(clippedOf(bob, 1)).toEqual({});
  });

  /**
   * TEST_SCENARIO: The Session read as data, as the UI reads its tail while
   * a load runs, says when it needs the harness history and, given it,
   * carries the dropped image's bytes.
   */
  it("should fill the Session read as data from the history it is given", () => {
    const { provider } = providerOf(PASTE_HISTORY);
    const world = createWorld({ historyProvider: provider });
    pasteBetweenPrompts(world, LARGE_IMAGE);

    const bare = world.runtime.sessionFrames(SESSION);
    expect(bare.needsHistory).toBe(true);
    expect(bare.frames.some((f) => f.includes(LARGE_IMAGE))).toBe(false);
    expect(bare.frames.some((f) => f.includes("not kept in history"))).toBe(
      true,
    );

    const filled = world.runtime.sessionFrames(SESSION, {
      history: PASTE_HISTORY.map((frame) => JSON.stringify(frame)),
    });
    expect(filled.frames.some((f) => f.includes(LARGE_IMAGE))).toBe(true);

    const tail = world.runtime.sessionFrames(SESSION, { tail: 1 });
    expect(tail.truncated).toBe(true);
    expect(tail.needsHistory).toBe(false);
  });
});
