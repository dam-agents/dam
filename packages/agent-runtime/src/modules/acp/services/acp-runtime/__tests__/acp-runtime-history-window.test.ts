import { describe, it, expect } from "vitest";
import { createWorld, frames, type Client, type Frame } from "./acp-world.js";
import type {
  HistoryProvider,
  HistoryWindowAsk,
} from "../../../infrastructure/history-provider.js";

/**
 * TEST_OVERVIEW: a cold tail load reads only the newest part of the harness's
 * own history, when the image's history provider can read it in windows.
 *
 * A long session's history costs its whole length to read, while the viewer
 * is shown only its newest tail. So a cold load that opts into the tail asks
 * the provider for the newest window alone, fills the Session Transcript with
 * it, and answers with a cursor that pages the older part from the provider,
 * window by window, until its start. A whole load of such a log, and a read
 * of more of it than it holds, go to the provider for the part before it, and
 * a fill that keeps the conversation reads it whole.
 */

const SESSION = "sess-window";

function line(text: string): string {
  return JSON.stringify(frames.agentMessage(SESSION, text, text));
}

function windowedProvider(history: string[]) {
  const asks: (HistoryWindowAsk | "whole")[] = [];
  const all = history.map(line);
  const provider: HistoryProvider = {
    fetch: () => {
      asks.push("whole");
      return Promise.resolve(all);
    },
    window: (_sessionId, ask) => {
      asks.push(ask);
      const end = ask.before === undefined ? all.length : Number(ask.before);
      const start = Math.max(0, end - ask.frames);
      return Promise.resolve({
        lines: all.slice(start, end),
        older: start === 0 ? null : String(start),
      });
    },
  };
  return { provider, asks };
}

function texts(client: Client, id?: number): (string | undefined)[] {
  return client
    .saw("session/update")
    .filter(
      (f) =>
        id === undefined ||
        (f.params as { _meta?: { platform?: { replayFor?: string } } })._meta
          ?.platform?.replayFor === `t${id}`,
    )
    .map(
      (f) =>
        (f.params as { update?: { content?: { text?: string } } }).update
          ?.content?.text,
    );
}

function load(id: number, platform: Record<string, unknown>): Frame {
  return {
    jsonrpc: "2.0",
    id,
    method: "session/load",
    params: {
      sessionId: SESSION,
      cwd: ".",
      mcpServers: [],
      _meta: { platform: { loadToken: `t${id}`, ...platform } },
    },
  };
}

function olderOf(client: Client, id: number): string | undefined {
  return (
    client.reply(id) as {
      result?: { _meta?: { platform?: { clipped?: { older?: string } } } };
    }
  ).result?._meta?.platform?.clipped?.older;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0));
}

describe("acp-runtime: windowed session history", () => {
  // TEST_SCENARIO: a cold tail load of a long session reads the newest window alone, never the whole history, and still answers with a cursor to the older part.
  it("fills a cold tail load from the newest window", async () => {
    const { provider, asks } = windowedProvider(["m1", "m2", "m3", "m4", "m5"]);
    const world = createWorld({
      replayTailEvents: 2,
      historyProvider: provider,
    });
    const bob = world.connect();
    bob.send(load(1, { tail: true }));
    await settle();

    expect(asks).toEqual([{ frames: 2 }]);
    expect(texts(bob)).toEqual(["m4", "m5"]);
    expect(olderOf(bob, 1)).toEqual(expect.any(String));
  });

  // TEST_SCENARIO: paging back past the log's start reads the next older window from the provider, until the conversation's start, where no cursor is left.
  it("pages the older part from the provider down to its start", async () => {
    const { provider, asks } = windowedProvider(["m1", "m2", "m3", "m4", "m5"]);
    const world = createWorld({
      replayTailEvents: 2,
      historyProvider: provider,
    });
    const bob = world.connect();
    bob.send(load(1, { tail: true }));
    await settle();

    bob.send(load(2, { replayBefore: olderOf(bob, 1) }));
    await settle();
    expect(texts(bob, 2)).toEqual(["m2", "m3"]);
    bob.send(load(3, { replayBefore: olderOf(bob, 2) }));
    await settle();
    expect(texts(bob, 3)).toEqual(["m1"]);
    expect(olderOf(bob, 3)).toBeUndefined();
    expect(asks.slice(1)).toEqual([
      { frames: 2, before: "3" },
      { frames: 2, before: "1" },
    ]);
  });

  // TEST_SCENARIO: a viewer that asks for the whole conversation of a log filled from its newest window gets the part before the window too, so it never misses history it did not opt out of.
  it("replays the part before the window to a whole load", async () => {
    const { provider } = windowedProvider(["m1", "m2", "m3", "m4"]);
    const world = createWorld({
      replayTailEvents: 2,
      historyProvider: provider,
    });
    world.connect().send(load(1, { tail: true }));
    await settle();

    const ann = world.connect();
    ann.send(load(2, {}));
    await settle();
    expect(texts(ann)).toEqual(["m1", "m2", "m3", "m4"]);
    expect(olderOf(ann, 2)).toBeUndefined();
  });

  // TEST_SCENARIO: a load without the tail opt-in keeps the whole conversation, so it reads the whole history as before.
  it("reads the whole history for a load that does not opt into the tail", async () => {
    const { provider, asks } = windowedProvider(["m1", "m2", "m3"]);
    const world = createWorld({
      replayTailEvents: 2,
      historyProvider: provider,
    });
    const bob = world.connect();
    bob.send(load(1, {}));
    await settle();
    expect(asks).toEqual(["whole"]);
    expect(texts(bob)).toEqual(["m1", "m2", "m3"]);
  });

  // TEST_SCENARIO: a provider that cannot read the window is an accelerator that failed, so the fill reads the whole history instead.
  it("falls back to the whole history when the window cannot be read", async () => {
    const { provider, asks } = windowedProvider(["m1", "m2", "m3"]);
    provider.window = () => Promise.resolve(null);
    const world = createWorld({
      replayTailEvents: 2,
      historyProvider: provider,
    });
    const bob = world.connect();
    bob.send(load(1, { tail: true }));
    await settle();
    expect(asks).toEqual(["whole"]);
    expect(texts(bob)).toEqual(["m2", "m3"]);
  });
});
