// TEST_OVERVIEW: A session's log read as data is projected the way a replay is. A past session opens on it before the chat protocol has loaded the session, showing a long log only from its newest turns, cut where a turn starts.
import { describe, expect, it } from "vitest";

import { framesToMessages } from "../../modules/acp/frames-to-messages.js";

const frame = (
  sessionUpdate: "user_message_chunk" | "agent_message_chunk",
  text: string,
) =>
  JSON.stringify({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "s1",
      update: { sessionUpdate, content: { type: "text", text } },
    },
  });

const turn = (n: number, replyChunks = 1) => [
  frame("user_message_chunk", `ask ${n}`),
  ...Array.from({ length: replyChunks }, () =>
    frame("agent_message_chunk", `r${n}`),
  ),
];

const texts = (lines: string[], turnInFlight = false, tail = 200) =>
  framesToMessages(lines, { tail, turnInFlight }).map((m) => ({
    role: m.role,
    text: m.parts.map((p) => (p.kind === "text" ? p.text : "")).join(""),
    streaming: m.streaming,
  }));

describe("framesToMessages", () => {
  it("projects a short log whole, with the reply settled", () => {
    expect(texts([...turn(1), ...turn(2, 2)])).toEqual([
      { role: "user", text: "ask 1", streaming: false },
      { role: "assistant", text: "r1", streaming: false },
      { role: "user", text: "ask 2", streaming: false },
      { role: "assistant", text: "r2r2", streaming: false },
    ]);
  });

  it("keeps the last reply open while its turn still runs", () => {
    expect(texts(turn(1), true)[1]?.streaming).toBe(true);
  });

  it("starts a long log at the turn before its newest 200 frames", () => {
    const lines = Array.from({ length: 30 }, (_, n) => turn(n, 9)).flat();
    const shown = texts(lines);
    expect(shown[0]).toEqual({
      role: "user",
      text: "ask 10",
      streaming: false,
    });
    expect(shown.filter((m) => m.role === "user")).toHaveLength(20);
  });

  it("projects the whole log when no tail is asked for", () => {
    const lines = Array.from({ length: 30 }, (_, n) => turn(n, 9)).flat();
    expect(framesToMessages(lines)).toHaveLength(60);
  });

  it("closes a reply on the logged end of its turn", () => {
    const ended = JSON.stringify({
      jsonrpc: "2.0",
      method: "platform/turnEnded",
      params: { sessionId: "s1", stopReason: "cancelled", model: "opus" },
    });
    const reply = framesToMessages([...turn(1), ended])[1];
    expect(reply).toMatchObject({ model: "opus", stopped: true });
  });

  it("skips frames it cannot read", () => {
    expect(texts(["not json", "null", ...turn(1)])).toHaveLength(2);
  });
});
