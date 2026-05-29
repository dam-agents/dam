import { describe, expect, it } from "vitest";
import { createInitialState } from "../../modules/scripted-mock/domain/state.js";
import { startAcpService } from "../../modules/scripted-mock/services/acp-service.js";
import { createScriptedMockService } from "../../modules/scripted-mock/services/control-service.js";
import type { JsonRpcFrame } from "../../modules/scripted-mock/domain/frames.js";
import type { AcpChannel } from "../../modules/scripted-mock/services/ports.js";

function makeFakeChannel(): {
  channel: AcpChannel;
  sent: JsonRpcFrame[];
  pushLine: (line: string) => void;
} {
  const sent: JsonRpcFrame[] = [];
  const handlers: ((line: string) => void)[] = [];
  return {
    channel: {
      send: (frame) => {
        sent.push(frame);
      },
      onLine: (handler) => {
        handlers.push(handler);
      },
    },
    sent,
    pushLine: (line) => {
      for (const h of handlers) h(line);
    },
  };
}

const req = (id: number, method: string, params?: unknown) =>
  JSON.stringify({ jsonrpc: "2.0", id, method, params });

describe("startAcpService", () => {
  it("responds to initialize with protocol version and close capability", () => {
    const state = createInitialState();
    const fc = makeFakeChannel();
    startAcpService({ channel: fc.channel, state });

    fc.pushLine(req(1, "initialize", { protocolVersion: 1 }));

    expect(fc.sent).toHaveLength(1);
    expect(fc.sent[0]).toMatchObject({
      id: 1,
      result: {
        protocolVersion: 1,
        agentCapabilities: { sessionCapabilities: { close: {} } },
      },
    });
  });

  it("session/new returns a generated sessionId", () => {
    const state = createInitialState();
    const fc = makeFakeChannel();
    startAcpService({
      channel: fc.channel,
      state,
      newSessionId: () => "fixed-sid",
    });

    fc.pushLine(req(2, "session/new", { cwd: "." }));

    expect(fc.sent[0]).toEqual({
      jsonrpc: "2.0",
      id: 2,
      result: { sessionId: "fixed-sid" },
    });
  });

  it("session/prompt records the prompt and emits scripted updates then end_turn", async () => {
    const state = createInitialState();
    const control = createScriptedMockService(state);
    control.setScript({
      entries: [
        {
          sessionUpdate: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Hello" },
          },
        },
      ],
      stopReason: "end_turn",
    });
    const fc = makeFakeChannel();
    startAcpService({
      channel: fc.channel,
      state,
      now: () => new Date("2026-05-28T00:00:00Z"),
    });

    fc.pushLine(
      req(3, "session/prompt", {
        sessionId: "s1",
        prompt: [{ type: "text", text: "hi" }],
      }),
    );

    await new Promise((r) => setTimeout(r, 0));

    expect(fc.sent).toHaveLength(2);
    expect(fc.sent[0]).toMatchObject({
      method: "session/update",
      params: {
        sessionId: "s1",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Hello" },
        },
      },
    });
    expect(fc.sent[1]).toMatchObject({
      id: 3,
      result: { stopReason: "end_turn" },
    });

    const { prompts } = control.getReceivedPrompts();
    expect(prompts).toEqual([
      {
        sessionId: "s1",
        receivedAt: "2026-05-28T00:00:00.000Z",
        prompt: [{ type: "text", text: "hi" }],
      },
    ]);
  });

  it("session/prompt without sessionId returns an error", async () => {
    const state = createInitialState();
    const fc = makeFakeChannel();
    startAcpService({ channel: fc.channel, state });

    fc.pushLine(req(4, "session/prompt", { prompt: [] }));

    await new Promise((r) => setTimeout(r, 0));
    expect(fc.sent[0]).toMatchObject({
      id: 4,
      error: { code: -32602, message: "missing sessionId" },
    });
  });

  it("reset clears script and received prompts", () => {
    const state = createInitialState();
    const control = createScriptedMockService(state);
    control.setScript({
      entries: [{ sessionUpdate: { sessionUpdate: "agent_message_chunk" } }],
      stopReason: "cancelled",
    });
    state.receivedPrompts.push({
      sessionId: "x",
      receivedAt: "now",
      prompt: null,
    });

    control.reset();

    expect(state.scriptEntries).toEqual([]);
    expect(state.scriptStopReason).toBe("end_turn");
    expect(control.getReceivedPrompts().prompts).toEqual([]);
  });
});
