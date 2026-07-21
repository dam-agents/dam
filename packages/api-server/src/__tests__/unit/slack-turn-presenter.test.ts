import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { toPromptUpdate } from "../../core/acp-client.js";
import { configureLogger } from "../../core/logger.js";
import {
  createTurnPresenter,
  type TurnPresenterOpts,
} from "../../modules/channels/infrastructure/slack-turn-presenter.js";
import type { SlackGateway } from "../../modules/channels/infrastructure/slack-gateway.js";

configureLogger({ level: "error", write: () => {} });

/** A spy gateway capturing the exact stream/status/post calls the presenter
 *  makes. Only the methods the presenter uses are implemented. */
function spyGateway(overrides?: Partial<SlackGateway>) {
  let n = 0;
  const gw = {
    startStream: vi.fn(async () => ({ ts: `S${++n}` })),
    appendStream: vi.fn(async () => {}),
    stopStream: vi.fn(async () => {}),
    setStatus: vi.fn(async () => {}),
    postMessage: vi.fn(async () => {}),
    ...overrides,
  } as unknown as SlackGateway & {
    startStream: ReturnType<typeof vi.fn>;
    appendStream: ReturnType<typeof vi.fn>;
    stopStream: ReturnType<typeof vi.fn>;
    setStatus: ReturnType<typeof vi.fn>;
    postMessage: ReturnType<typeof vi.fn>;
  };
  return gw;
}

const baseOpts: TurnPresenterOpts = {
  channel: "C1",
  threadTs: "100.1",
  instanceName: "agent-1",
  recipient: { teamId: "T1", userId: "U1" },
  flushMaxChars: 10,
  flushIntervalMs: 800,
  statusMinIntervalMs: 2_000,
  statusRefreshMs: 0,
};

/** Drain all pending microtasks (the presenter's serialized stream calls run
 *  on the microtask queue). A macrotask boundary flushes them deterministically. */
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("toPromptUpdate mapper", () => {
  it("maps assistant text chunks", () => {
    expect(
      toPromptUpdate({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "hi" },
      }),
    ).toEqual({ kind: "text", text: "hi" });
  });

  it("drops non-text content chunks", () => {
    expect(
      toPromptUpdate({
        sessionUpdate: "agent_message_chunk",
        content: { type: "image" },
      }),
    ).toBeNull();
  });

  it("maps thought chunks", () => {
    expect(toPromptUpdate({ sessionUpdate: "agent_thought_chunk" })).toEqual({
      kind: "thought",
    });
  });

  it("maps tool_call with a title, and null title when absent", () => {
    expect(
      toPromptUpdate({ sessionUpdate: "tool_call", title: "Read file" }),
    ).toEqual({ kind: "tool", title: "Read file" });
    expect(toPromptUpdate({ sessionUpdate: "tool_call" })).toEqual({
      kind: "tool",
      title: null,
    });
  });

  it("maps tool_call_update only when it carries a title", () => {
    expect(
      toPromptUpdate({ sessionUpdate: "tool_call_update", title: "Search" }),
    ).toEqual({ kind: "tool", title: "Search" });
    expect(
      toPromptUpdate({
        sessionUpdate: "tool_call_update",
        status: "completed",
      }),
    ).toBeNull();
  });

  it("ignores unrelated updates", () => {
    expect(toPromptUpdate({ sessionUpdate: "plan" })).toBeNull();
    expect(toPromptUpdate(undefined)).toBeNull();
  });
});

describe("turn presenter — streaming", () => {
  it("opens a stream, appends, and closes with the remainder + footer", async () => {
    const gw = spyGateway();
    const p = createTurnPresenter(gw, baseOpts);

    p.onUpdate({ kind: "text", text: "0123456789AB" }); // ≥10 → flush now
    await tick();
    p.onUpdate({ kind: "text", text: "cdefghijklmn" }); // ≥10 → append
    await tick();
    p.onUpdate({ kind: "text", text: " tail" }); // under threshold → buffered
    await p.finish("ignored-when-streaming");

    expect(gw.startStream).toHaveBeenCalledTimes(1);
    expect(gw.startStream.mock.calls[0][0]).toMatchObject({
      channel: "C1",
      threadTs: "100.1",
      recipientTeamId: "T1",
      recipientUserId: "U1",
      markdownText: "0123456789AB",
    });
    expect(gw.appendStream).toHaveBeenCalledTimes(1);
    expect(gw.appendStream.mock.calls[0][0].markdownText).toBe("cdefghijklmn");
    expect(gw.stopStream).toHaveBeenCalledTimes(1);
    expect(gw.stopStream.mock.calls[0][0].markdownText).toBe(" tail");
    // Footer context block is attached at stop.
    expect(gw.stopStream.mock.calls[0][0].blocks).toEqual([
      { type: "context", elements: [{ type: "mrkdwn", text: "_agent-1_" }] },
    ]);
    expect(gw.postMessage).not.toHaveBeenCalled();
  });

  it("flushes a sub-threshold chunk after the interval elapses", async () => {
    vi.useFakeTimers();
    try {
      const gw = spyGateway();
      const p = createTurnPresenter(gw, { ...baseOpts, flushMaxChars: 1000 });
      p.onUpdate({ kind: "text", text: "hi" });
      expect(gw.startStream).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(800);
      expect(gw.startStream).toHaveBeenCalledTimes(1);
      expect(gw.startStream.mock.calls[0][0].markdownText).toBe("hi");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("turn presenter — fallback to a single message", () => {
  it("posts the whole reply when there is no recipient (can't stream)", async () => {
    const gw = spyGateway();
    const p = createTurnPresenter(gw, { ...baseOpts, recipient: undefined });
    p.onUpdate({ kind: "text", text: "some long streamed answer" });
    await p.finish("the full answer");

    expect(gw.startStream).not.toHaveBeenCalled();
    expect(gw.postMessage).toHaveBeenCalledTimes(1);
    expect(gw.postMessage.mock.calls[0][0].text).toBe("the full answer");
  });

  it("posts the whole reply when no chunk ever streamed", async () => {
    const gw = spyGateway();
    const p = createTurnPresenter(gw, baseOpts);
    await p.finish("no-stream answer");
    expect(gw.startStream).not.toHaveBeenCalled();
    expect(gw.postMessage).toHaveBeenCalledTimes(1);
    expect(gw.postMessage.mock.calls[0][0].text).toBe("no-stream answer");
  });

  it("falls back to a message when startStream throws", async () => {
    const gw = spyGateway({
      startStream: vi.fn(async () => {
        throw new Error("missing_scope");
      }),
    });
    const p = createTurnPresenter(gw, baseOpts);
    p.onUpdate({ kind: "text", text: "0123456789AB" });
    await tick();
    await p.finish("full text");

    expect(gw.appendStream).not.toHaveBeenCalled();
    expect(gw.postMessage).toHaveBeenCalledTimes(1);
    expect(gw.postMessage.mock.calls[0][0].text).toBe("full text");
  });

  it("stops the dangling stream and reposts when append throws", async () => {
    const gw = spyGateway({
      appendStream: vi.fn(async () => {
        throw new Error("network");
      }),
    });
    const p = createTurnPresenter(gw, baseOpts);
    p.onUpdate({ kind: "text", text: "0123456789AB" }); // opens stream
    await tick();
    p.onUpdate({ kind: "text", text: "cdefghijklmn" }); // append throws
    await tick();
    await p.finish("full text");

    expect(gw.startStream).toHaveBeenCalledTimes(1);
    expect(gw.stopStream).toHaveBeenCalled(); // dangling close
    expect(gw.postMessage).toHaveBeenCalledTimes(1);
    expect(gw.postMessage.mock.calls[0][0].text).toBe("full text");
  });
});

describe("turn presenter — terminal control", () => {
  it("abortStream finalizes an open stream without reposting", async () => {
    const gw = spyGateway();
    const p = createTurnPresenter(gw, baseOpts);
    p.onUpdate({ kind: "text", text: "0123456789AB" });
    await tick();
    await p.abortStream();

    expect(gw.stopStream).toHaveBeenCalledTimes(1);
    expect(gw.postMessage).not.toHaveBeenCalled();
  });

  it("resetStream abandons the first stream so a retry streams fresh", async () => {
    const gw = spyGateway();
    const p = createTurnPresenter(gw, baseOpts);
    p.onUpdate({ kind: "text", text: "0123456789AB" });
    await tick();
    await p.resetStream();
    expect(gw.stopStream).toHaveBeenCalledTimes(1);

    p.onUpdate({ kind: "text", text: "freshfreshfresh" });
    await tick();
    await p.finish("done");
    expect(gw.startStream).toHaveBeenCalledTimes(2);
    expect(gw.postMessage).not.toHaveBeenCalled();
  });
});

describe("turn presenter — status arc", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("sets thinking immediately, throttles + dedupes tool titles, clears at end", async () => {
    const gw = spyGateway();
    const p = createTurnPresenter(gw, baseOpts);

    p.setThinking();
    expect(gw.setStatus).toHaveBeenCalledTimes(1);
    expect(gw.setStatus.mock.calls[0][0].status).toBe("is thinking…");

    // Same value → deduped (no new call).
    p.onUpdate({ kind: "thought" });
    expect(gw.setStatus).toHaveBeenCalledTimes(1);

    // A tool title within the throttle window is coalesced into a trailing send.
    p.onUpdate({ kind: "tool", title: "Read file" });
    p.onUpdate({ kind: "tool", title: "Read file" }); // dup, ignored
    expect(gw.setStatus).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(gw.setStatus).toHaveBeenCalledTimes(2);
    expect(gw.setStatus.mock.calls[1][0].status).toBe("Read file");

    await p.clearStatus();
    const last = gw.setStatus.mock.calls.at(-1)![0];
    expect(last.status).toBe("");
  });

  it("stops calling setStatus after the first failure", async () => {
    const gw = spyGateway({
      setStatus: vi.fn(async () => {
        throw new Error("not_in_assistant_thread");
      }),
    });
    const p = createTurnPresenter(gw, baseOpts);
    p.setThinking();
    await Promise.resolve();
    p.onUpdate({ kind: "tool", title: "Search" });
    await vi.advanceTimersByTimeAsync(5_000);
    // Latched off after the first failing call.
    expect(gw.setStatus).toHaveBeenCalledTimes(1);
  });
});
