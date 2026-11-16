// TEST_OVERVIEW: the scripted harness keeps a closed session's user messages and replies so a later session/load can rebuild the conversation after the runtime releases its live log.
import { describe, expect, it } from "vitest";

import type { JsonRpcFrame } from "../domain/frames.js";
import { createInitialState } from "../domain/state.js";
import { startAcpService } from "./acp-service.js";

function mockHarness() {
  const sent: JsonRpcFrame[] = [];
  const responses = new Map<number, () => void>();
  let receive!: (line: string) => void;
  const state = createInitialState();
  startAcpService({
    channel: {
      send: (frame) => {
        sent.push(frame);
        if ("id" in frame && typeof frame.id === "number") {
          responses.get(frame.id)?.();
          responses.delete(frame.id);
        }
      },
      onLine: (handler) => {
        receive = handler;
      },
    },
    state,
    workspace: { writeFile: async () => {} },
    proxyFetch: async () => ({ status: 200, body: "" }),
    processRunner: { run: async () => ({ code: 0, output: "" }) },
    slackReply: async () => {},
  });
  const request = async (id: number, method: string, params = {}) => {
    const replied = new Promise<void>((resolve) => responses.set(id, resolve));
    receive(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    await replied;
  };
  return { state, sent, request };
}

describe("scripted mock session history", () => {
  // TEST_SCENARIO: two accepted prompts run while a viewer leaves. Closing the harness session releases its live state but a later load replays both user messages and their answers in order.
  it("replays the conversation after session/close", async () => {
    const harness = mockHarness();
    await harness.request(1, "session/new");
    const created = harness.sent[0] as { result: { sessionId: string } };
    const sessionId = created.result.sessionId;
    for (const [index, text] of ["first", "queued follow-up"].entries()) {
      harness.state.scriptEntries = [
        {
          sessionUpdate: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: `answer to ${text}` },
          },
        },
      ];
      await harness.request(index + 2, "session/prompt", {
        sessionId,
        prompt: [{ type: "text", text }],
      });
    }
    await harness.request(4, "session/close", { sessionId });
    harness.sent.length = 0;
    await harness.request(5, "session/load", { sessionId });
    expect(harness.sent).toEqual([
      ...[
        "first",
        "answer to first",
        "queued follow-up",
        "answer to queued follow-up",
      ].map((text, index) => ({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId,
          update: {
            sessionUpdate:
              index % 2 === 0 ? "user_message_chunk" : "agent_message_chunk",
            content: { type: "text", text },
          },
        },
      })),
      { jsonrpc: "2.0", id: 5, result: {} },
    ]);
    harness.sent.length = 0;
    await harness.request(6, "session/load", { sessionId });
    expect(harness.sent).toHaveLength(5);
  });

  // TEST_SCENARIO: closing one session does not erase its listing or copy another session's conversation into its replay.
  it("keeps closed sessions listed and their histories separate", async () => {
    const harness = mockHarness();
    await harness.request(1, "session/new");
    await harness.request(2, "session/new");
    const [first, second] = harness.sent as { result: { sessionId: string } }[];
    const sessionId = first.result.sessionId;
    await harness.request(3, "session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: "only in first" }],
    });
    await harness.request(4, "session/close", { sessionId });
    harness.sent.length = 0;
    await harness.request(5, "session/list");
    expect(harness.sent[0]).toEqual({
      jsonrpc: "2.0",
      id: 5,
      result: {
        sessions: [{ sessionId }, { sessionId: second.result.sessionId }],
      },
    });
    harness.sent.length = 0;
    await harness.request(6, "session/load", {
      sessionId: second.result.sessionId,
    });
    expect(harness.sent).toEqual([{ jsonrpc: "2.0", id: 6, result: {} }]);
  });
});
