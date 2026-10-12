// TEST_OVERVIEW: A past session opens on the runtime's own copy of its log, projected the way a replay is, before the chat protocol has loaded it. A long log shows only its newest turns, cut where a turn starts.
import { describe, expect, it } from "vitest";

import { previewFromHistory } from "../../modules/sessions/lib/history-preview.js";

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

const texts = (lines: string[], turnInFlight = false) =>
  previewFromHistory(lines, { turnInFlight }).map((m) => ({
    role: m.role,
    text: m.parts.map((p) => (p.kind === "text" ? p.text : "")).join(""),
    streaming: m.streaming,
  }));

describe("previewFromHistory", () => {
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

  it("skips frames it cannot read", () => {
    expect(texts(["not json", "null", ...turn(1)])).toHaveLength(2);
  });
});
