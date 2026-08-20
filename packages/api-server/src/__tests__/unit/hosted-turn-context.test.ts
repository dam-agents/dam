import { describe, expect, it } from "vitest";
import {
  buildTurnContext,
  type TurnEvent,
} from "../../modules/hosted-harness/domain/events.js";

// TEST_OVERVIEW: the Turn Event Log context builder — compaction supersession
// and dangling tool-call detection for turn resume.

let nextId = 1;
function event(
  kind: TurnEvent["kind"],
  payload: unknown,
  turnId = "t1",
): TurnEvent {
  return {
    id: nextId++,
    sessionId: "s1",
    turnId,
    seq: nextId,
    kind,
    payload,
    createdAt: new Date(),
  };
}

describe("buildTurnContext", () => {
  // TEST_SCENARIO: plain conversation maps events to context messages in order
  it("maps events to messages", () => {
    const ctx = buildTurnContext([
      event("user-message", { text: "hi", source: "user" }),
      event("assistant-message", { text: "hello" }),
      event("turn-end", { status: "done" }),
    ]);
    expect(ctx.messages).toEqual([
      { role: "user", text: "hi" },
      { role: "assistant", text: "hello" },
    ]);
    expect(ctx.danglingToolCalls).toEqual([]);
  });

  // TEST_SCENARIO: a tool call without a result is reported dangling (resume path)
  it("detects dangling tool calls", () => {
    const ctx = buildTurnContext([
      event("user-message", { text: "run it" }),
      event("tool-call", { callId: "c1", tool: "bash", args: { cmd: "ls" } }),
    ]);
    expect(ctx.danglingToolCalls).toEqual([
      { callId: "c1", tool: "bash", args: { cmd: "ls" } },
    ]);
  });

  // TEST_SCENARIO: the latest compaction supersedes covered events for the LLM
  // context while later events survive
  it("applies the latest compaction", () => {
    const early = event("user-message", { text: "old stuff" });
    const compaction = event("compaction", {
      summary: "we discussed old stuff",
      coversThroughEventId: early.id,
    });
    const late = event("user-message", { text: "new question" });
    const ctx = buildTurnContext([early, compaction, late]);
    expect(ctx.messages).toHaveLength(2);
    expect(ctx.messages[0]).toMatchObject({ role: "user" });
    expect((ctx.messages[0] as { text: string }).text).toContain(
      "we discussed old stuff",
    );
    expect(ctx.messages[1]).toEqual({ role: "user", text: "new question" });
  });

  // TEST_SCENARIO: a resolved tool call round-trips as call + result messages
  it("pairs tool calls with results", () => {
    const ctx = buildTurnContext([
      event("tool-call", { callId: "c1", tool: "bash", args: {} }),
      event("tool-result", { callId: "c1", output: "ok" }),
    ]);
    expect(ctx.messages).toEqual([
      { role: "assistant-tool-call", callId: "c1", tool: "bash", args: {} },
      { role: "tool-result", callId: "c1", output: "ok", isError: false },
    ]);
    expect(ctx.danglingToolCalls).toEqual([]);
  });
});
