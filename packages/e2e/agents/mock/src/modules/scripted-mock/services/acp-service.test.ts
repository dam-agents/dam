// TEST_OVERVIEW: the scripted harness keeps a closed session's user messages and replies so a later session/load can rebuild the conversation after the runtime releases its live log.
import { describe, expect, it } from "vitest";

import type { JsonRpcFrame } from "../domain/frames.js";
import { createInitialState } from "../domain/state.js";
import { startAcpService } from "./acp-service.js";

function mockHarness(
  toolCall: { name: string; arguments: Record<string, unknown> } | null = null,
  callTool: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ text: string; result: unknown }> = async () => ({
    text: "",
    result: {},
  }),
  env: Record<string, string> = {},
  fetched: { url: string; headers?: Record<string, string> }[] = [],
) {
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
    proxyFetch: async (request) => {
      fetched.push(request);
      return { status: 200, body: "" };
    },
    processRunner: { run: async () => ({ code: 0, output: "" }) },
    slackReply: async () => {},
    callTool,
    toolCall,
    readEnv: (name) => env[name],
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

describe("scripted platform tool call", () => {
  // TEST_SCENARIO: an agent given MOCK_TOOL_CALL calls that platform tool on every turn before its scripted answer, and reports the call as a real harness does: a tool_call update, then a completed tool_call_update carrying the tool's text, so the runtime can attribute what the tool made to the session.
  it("calls the tool, then reports it completed before the answer", async () => {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const harness = mockHarness(
      { name: "create_artifact", arguments: { title: "Weekly report" } },
      async (name, args) => {
        calls.push({ name, args });
        return { text: "created artifact a1", result: { ok: true } };
      },
    );
    await harness.request(1, "session/new");
    const sessionId = (harness.sent[0] as { result: { sessionId: string } })
      .result.sessionId;
    harness.state.scriptEntries = [
      {
        sessionUpdate: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "done" },
        },
      },
    ];
    await harness.request(2, "session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: "publish the report" }],
    });
    expect(calls).toEqual([
      { name: "create_artifact", args: { title: "Weekly report" } },
    ]);
    const updates = harness.sent
      .filter((f) => "method" in f && f.method === "session/update")
      .map(
        (f) =>
          (f as { params: { update: Record<string, unknown> } }).params.update,
      );
    expect(updates.map((u) => u.sessionUpdate)).toEqual([
      "tool_call",
      "tool_call_update",
      "agent_message_chunk",
    ]);
    expect(updates[1]).toMatchObject({
      status: "completed",
      content: [{ content: { text: "created artifact a1" } }],
    });
  });

  // TEST_SCENARIO: a tool call the server refuses is reported as a failed tool_call_update with the server's message, and the turn still ends with its scripted answer, so an example fails on what the tool did not make rather than on a hung turn.
  it("reports a refused call as failed and still answers", async () => {
    const harness = mockHarness(
      { name: "create_artifact", arguments: {} },
      async () => {
        throw new Error("title is required");
      },
    );
    await harness.request(1, "session/new");
    const sessionId = (harness.sent[0] as { result: { sessionId: string } })
      .result.sessionId;
    await harness.request(2, "session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: "publish" }],
    });
    const failed = harness.sent
      .filter((f) => "method" in f && f.method === "session/update")
      .map(
        (f) =>
          (f as { params: { update: Record<string, unknown> } }).params.update,
      )
      .find((u) => u.sessionUpdate === "tool_call_update");
    expect(failed).toMatchObject({
      status: "failed",
      content: [{ content: { text: "title is required" } }],
    });
    expect(harness.sent.at(-1)).toMatchObject({
      id: 2,
      result: { stopReason: "end_turn" },
    });
  });
});

describe("scripted environment reads", () => {
  const replyOf = (sent: JsonRpcFrame[]) =>
    sent
      .map(
        (f) =>
          (f as { params?: { update?: { content?: { text?: string } } } })
            .params?.update?.content?.text,
      )
      .filter((t): t is string => t !== undefined)
      .join("");

  // TEST_SCENARIO: an example reads what a variable holds in the harness process: __ENV__ answers its value, or says it is unset.
  it("answers a variable's value, or that it is unset", async () => {
    const harness = mockHarness(null, undefined, { WEATHER_UNITS: "metric" });
    await harness.request(1, "session/new");
    const { sessionId } = (harness.sent[0] as { result: { sessionId: string } })
      .result;
    await harness.request(2, "session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: "__ENV__ WEATHER_UNITS" }],
    });
    expect(replyOf(harness.sent)).toBe("[env WEATHER_UNITS] metric");
    harness.sent.length = 0;
    await harness.request(3, "session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: "__ENV__ MISSING_ONE" }],
    });
    expect(replyOf(harness.sent)).toBe("[env MISSING_ONE unset]");
  });

  // TEST_SCENARIO: a fetch header written as $NAME carries the value the harness holds in NAME, as a tool reading its environment sends it.
  it("sends the value a $NAME header names", async () => {
    const fetched: { url: string; headers?: Record<string, string> }[] = [];
    const harness = mockHarness(
      null,
      undefined,
      { ECHO_KEY: "platform:conn:abc" },
      fetched,
    );
    await harness.request(1, "session/new");
    const { sessionId } = (harness.sent[0] as { result: { sessionId: string } })
      .result;
    await harness.request(2, "session/prompt", {
      sessionId,
      prompt: [
        {
          type: "text",
          text: "__FETCH__ https://echo.test/headers x-api-key:$ECHO_KEY",
        },
      ],
    });
    expect(fetched).toEqual([
      {
        url: "https://echo.test/headers",
        headers: { "x-api-key": "platform:conn:abc" },
      },
    ]);
  });
});
