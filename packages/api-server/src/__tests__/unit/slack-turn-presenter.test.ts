import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { toPromptUpdate } from "../../core/acp-client.js";
import { configureLogger } from "../../core/logger.js";
import {
  createTurnPresenter,
  type TurnPresenterOpts,
} from "../../modules/channels/infrastructure/slack-turn-presenter.js";
import type { SlackGateway } from "../../modules/channels/infrastructure/slack-gateway.js";

configureLogger({ level: "error", write: () => {} });

function spyGateway(overrides?: Partial<SlackGateway>) {
  const gw = {
    setStatus: vi.fn(async () => {}),
    postMessage: vi.fn(async () => {}),
    ...overrides,
  } as unknown as SlackGateway & {
    setStatus: ReturnType<typeof vi.fn>;
    postMessage: ReturnType<typeof vi.fn>;
  };
  return gw;
}

const baseOpts: TurnPresenterOpts = {
  channel: "C1",
  threadTs: "100.1",
  instanceName: "agent-1",
  statusMinIntervalMs: 2_000,
  statusRefreshMs: 0,
};

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

describe("turn presenter — assistant text is not delivered", () => {
  it("never posts or streams on a text update — that's the reply tool's job", async () => {
    const gw = spyGateway();
    const p = createTurnPresenter(gw, baseOpts);

    p.onUpdate({
      kind: "text",
      text: "a long assistant answer that used to stream",
    });
    await p.clearStatus();

    expect(gw.postMessage).not.toHaveBeenCalled();
    expect(gw.setStatus).not.toHaveBeenCalled();
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

    p.onUpdate({ kind: "thought" });
    expect(gw.setStatus).toHaveBeenCalledTimes(1);

    p.onUpdate({ kind: "tool", title: "Read file" });
    p.onUpdate({ kind: "tool", title: "Read file" });
    expect(gw.setStatus).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(gw.setStatus).toHaveBeenCalledTimes(2);
    expect(gw.setStatus.mock.calls[1][0].status).toBe("Read file");

    await p.clearStatus();
    const last = gw.setStatus.mock.calls.at(-1)![0];
    expect(last.status).toBe("");
  });

  it("does not treat assistant text as status activity", async () => {
    const gw = spyGateway();
    const p = createTurnPresenter(gw, baseOpts);
    p.setThinking();
    expect(gw.setStatus).toHaveBeenCalledTimes(1);
    p.onUpdate({ kind: "text", text: "hello" });
    p.onUpdate({ kind: "text", text: " world" });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(gw.setStatus).toHaveBeenCalledTimes(1);
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
    expect(gw.setStatus).toHaveBeenCalledTimes(1);
  });
});
