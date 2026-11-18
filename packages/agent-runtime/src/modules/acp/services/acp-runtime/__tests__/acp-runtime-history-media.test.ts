import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createWorld, frames, type Client, type Frame } from "./acp-world.js";
import type { HistoryProvider } from "../../../infrastructure/history-provider.js";
import {
  createSessionMediaRoot,
  type SessionMediaStore,
} from "../../../infrastructure/session-media-store.js";

/**
 * TEST_OVERVIEW: images and audio a Session showed survive every replay,
 * however large they are.
 *
 * The Session Transcript keeps the bytes of each inline image or audio block
 * in the runtime's media store on disk and only a key in its capped log, so
 * the log's cap counts text. A reload, a cold fill from the harness's own
 * replay or from the session-history provider, and a page of older history
 * all send the block with its bytes again. Only a block whose bytes the store
 * no longer has shows the `[image not kept in history]` placeholder, and a
 * runtime with no store keeps the old behavior of dropping the bytes over
 * the cap.
 */

const SESSION = "sess-media";
const LARGE_IMAGE = "A".repeat(12 * 1024 * 1024);

const dirs: string[] = [];

function mediaStore(): { store: SessionMediaStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "session-media-"));
  dirs.push(dir);
  return { store: createSessionMediaRoot({ dir, log: () => {} }).store(), dir };
}

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

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

function imageUpdate(data: string): Frame {
  return {
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: SESSION,
      update: {
        sessionUpdate: "user_message_chunk",
        content: { type: "image", data, mimeType: "image/png" },
      },
    },
  };
}

function loadPage(id: number, replayBefore: string): Frame {
  return {
    jsonrpc: "2.0",
    id,
    method: "session/load",
    params: {
      sessionId: SESSION,
      cwd: ".",
      mcpServers: [],
      _meta: { platform: { replayBefore } },
    },
  };
}

function loadTail(id: number): Frame {
  return {
    jsonrpc: "2.0",
    id,
    method: "session/load",
    params: {
      sessionId: SESSION,
      cwd: ".",
      mcpServers: [],
      _meta: { platform: { tail: true } },
    },
  };
}

function olderOf(client: Client, id: number): string {
  const reply = client.reply(id) as {
    result?: { _meta?: { platform?: { clipped?: { older?: string } } } };
  };
  const older = reply.result?._meta?.platform?.clipped?.older;
  expect(typeof older).toBe("string");
  return older!;
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
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

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("acp-runtime: media in history", () => {
  /**
   * TEST_SCENARIO: A user pastes an image larger than the whole log cap
   * between two text prompts, then reloads. The reload must show the image
   * with its bytes and every prompt around it, and report no clip, since
   * the image's bytes never counted against the cap.
   */
  it("should show a pasted image larger than the log cap after a reload", () => {
    const { store } = mediaStore();
    const world = createWorld({ sessionMedia: store });
    pasteBetweenPrompts(world, LARGE_IMAGE);

    const bob = world.connect();
    bob.send(frames.loadSession(1, SESSION));

    expect(shown(bob)).toEqual([
      { text: "before" },
      { image: LARGE_IMAGE },
      { text: "look" },
      { text: "after" },
    ]);
    const reply = bob.reply(1) as {
      result?: { _meta?: { platform?: { clipped?: unknown } } };
    };
    expect(reply.result?._meta?.platform?.clipped).toBeUndefined();
  });

  /**
   * TEST_SCENARIO: A cold load where the harness replays an image larger
   * than the log cap, as after an agent restart. The viewer must get the
   * image, and a second viewer loading from the warm log must get it too,
   * now read back from the store.
   */
  it("should show an oversized image from a cold harness replay, and on the next load", () => {
    const { store } = mediaStore();
    const world = createWorld({ sessionMedia: store });
    const bob = world.connect();
    bob.send(frames.loadSession(1, SESSION));

    world.harness().emit(frames.agentMessage(SESSION, "m1", "m1"));
    world.harness().emit(imageUpdate(LARGE_IMAGE));
    world.harness().emit(frames.agentMessage(SESSION, "m2", "m2"));
    world
      .harness()
      .replyTo("session/load", { sessionId: SESSION, modes: null });

    const expected = [{ text: "m1" }, { image: LARGE_IMAGE }, { text: "m2" }];
    expect(shown(bob)).toEqual(expected);

    const carol = world.connect();
    carol.send(frames.loadSession(1, SESSION));
    expect(shown(carol)).toEqual(expected);
  });

  /**
   * TEST_SCENARIO: A cold load served by the session-history provider, which
   * reads the harness's history from disk with the image's bytes in it. The
   * fill must not turn the image into the placeholder.
   */
  it("should show an oversized image from a session-history provider fill", async () => {
    const { store } = mediaStore();
    const historyProvider: HistoryProvider = {
      fetch: () =>
        Promise.resolve([
          JSON.stringify(frames.agentMessage(SESSION, "m1", "m1")),
          JSON.stringify(imageUpdate(LARGE_IMAGE)),
          JSON.stringify(frames.agentMessage(SESSION, "m2", "m2")),
        ]),
    };
    const world = createWorld({ sessionMedia: store, historyProvider });

    const bob = world.connect();
    bob.send(frames.loadSession(1, SESSION));
    await settle();

    expect(shown(bob)).toEqual([
      { text: "m1" },
      { image: LARGE_IMAGE },
      { text: "m2" },
    ]);
  });

  /**
   * TEST_SCENARIO: The image sits above the replayed tail, so the viewer
   * reaches it by paging older history. The page must carry the bytes.
   */
  it("should show an image on a page of older history", () => {
    const { store } = mediaStore();
    const world = createWorld({ sessionMedia: store, replayTailEvents: 2 });
    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    world.harness().emit(imageUpdate(LARGE_IMAGE));
    for (const text of ["m1", "m2", "m3"]) {
      world.harness().emit(frames.agentMessage(SESSION, text, text));
    }

    const bob = world.connect();
    bob.send(loadTail(1));
    expect(shown(bob)).toEqual([{ text: "m2" }, { text: "m3" }]);

    const carol = world.connect();
    carol.send(loadPage(1, olderOf(bob, 1)));
    expect(shown(carol)).toEqual([{ image: LARGE_IMAGE }, { text: "m1" }]);
  });

  /**
   * TEST_SCENARIO: The UI reads a loaded Session's newest tail as data while
   * the load runs. That read must carry the image's bytes too, and the whole
   * read must carry them for an image above the tail.
   */
  it("should put the bytes back into the Session read as data", () => {
    const { store } = mediaStore();
    const world = createWorld({ sessionMedia: store });
    pasteBetweenPrompts(world, LARGE_IMAGE);

    const whole = world.runtime.sessionFrames(SESSION);
    expect(whole.frames.some((f) => f.includes(LARGE_IMAGE))).toBe(true);
    expect(whole.frames.some((f) => f.includes("mediaRef"))).toBe(false);

    const tail = world.runtime.sessionFrames(SESSION, 1);
    expect(tail.truncated).toBe(true);
    expect(tail.frames.some((f) => f.includes("after"))).toBe(true);
    expect(tail.frames.some((f) => f.includes(LARGE_IMAGE))).toBe(false);
  });

  /**
   * TEST_SCENARIO: The machine's disk guard emptied the cache folder, so the
   * store no longer has the image's bytes. Only then does the reload show
   * the placeholder, and the text around it stays.
   */
  it("should show the placeholder only once the store has lost the bytes", () => {
    const { store, dir } = mediaStore();
    const world = createWorld({ sessionMedia: store });
    pasteBetweenPrompts(world, LARGE_IMAGE);
    rmSync(dir, { recursive: true, force: true });

    const bob = world.connect();
    bob.send(frames.loadSession(1, SESSION));

    expect(shown(bob)).toEqual([
      { text: "before" },
      { text: "[image not kept in history]" },
      { text: "look" },
      { text: "after" },
    ]);
  });

  /**
   * TEST_SCENARIO: The text history outgrows the log cap and the entry that
   * held the image is evicted. Nothing refers to its file any more, so the
   * file must go, while an image a kept entry still shows stays.
   */
  it("should delete an image's file once its entry is evicted", () => {
    const { store, dir } = mediaStore();
    const world = createWorld({ sessionMedia: store, logBytesCap: 4096 });
    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    world.harness().emit(imageUpdate("OLD-IMAGE"));
    expect(filesUnder(dir)).toHaveLength(1);

    for (let i = 0; i < 40; i++) {
      world
        .harness()
        .emit(frames.agentMessage(SESSION, `t${i}`.padEnd(200, "."), `m${i}`));
    }
    world.harness().emit(imageUpdate("NEW-IMAGE"));

    expect(filesUnder(dir)).toHaveLength(1);
    const bob = world.connect();
    bob.send(frames.loadSession(1, SESSION));
    expect(shown(bob)).toContainEqual({ image: "NEW-IMAGE" });
    expect(shown(bob)).not.toContainEqual({ image: "OLD-IMAGE" });
  });

  /**
   * TEST_SCENARIO: A Session the runtime tears down, as an idle one, takes
   * its media folder with it: the next load fills the log again from its
   * source and writes the bytes anew.
   */
  it("should delete a Session's media when the runtime resets it", () => {
    const { store, dir } = mediaStore();
    const world = createWorld({ sessionMedia: store });
    pasteBetweenPrompts(world, LARGE_IMAGE);
    expect(filesUnder(dir)).toHaveLength(1);

    world.runtime.resetSession(SESSION);

    expect(filesUnder(dir)).toEqual([]);
  });
});
