import { describe, expect, it, vi } from "vitest";

const calls: string[] = [];
vi.mock("../modules/chat/infrastructure/terminal-bridge.js", () => ({
  connectTerminalBridge: vi.fn(async () => {
    calls.push("bridge");
    return { kind: "exited", code: 0 };
  }),
}));

import { attachNotice } from "../modules/chat/commands/chat.js";
import { createChatService } from "../modules/chat/services/chat-service.js";
import type { SessionsPort } from "../modules/chat/services/sessions-service.js";

const AGENT_ID = "agent-0123456789abcdef";

function service(resolveTerminal: SessionsPort["resolveTerminal"]) {
  return createChatService({
    compatService: {
      check: async () => ({
        ok: true,
        value: {
          kind: "ok",
          localCli: "1.0.0",
          serverVersion: "1.0.0",
          serverMinClient: undefined,
        },
      }),
    },
    configService: {
      getResolved: async () => ({
        ok: true,
        value: { server: "http://localhost:4444" },
      }),
      set: vi.fn(),
    },
    tokenProvider: {
      getValidAccessToken: async () => ({ ok: true, value: "t" }),
    } as never,
    createAgentService: () => ({
      list: vi.fn(),
      get: async () => ({ ok: true, value: { id: AGENT_ID } as never }),
      deleteAgent: vi.fn(),
      restart: vi.fn(),
      setDisabled: vi.fn(),
      runtimeFleet: vi.fn(),
    }),
    createSessionsPort: () => ({ list: vi.fn(), resolveTerminal }),
    confirmModeSwitch: async () => false,
    isTty: true,
  });
}

describe("dam chat attach notice (#4007)", () => {
  it("tells the user the session before the terminal attaches", async () => {
    calls.length = 0;
    const chat = service(async () => ({
      ok: true,
      value: { kind: "ready", sessionId: "s-1", terminalPath: "/term" },
    }));

    const result = await chat.run({
      agentRef: AGENT_ID,
      strategy: { kind: "new" },
      onAttach: (sessionId) => calls.push(`attach ${sessionId}`),
    });

    expect(result.ok).toBe(true);
    expect(calls).toEqual(["attach s-1", "bridge"]);
  });

  it("says nothing when no session resolves", async () => {
    calls.length = 0;
    const chat = service(async () => ({
      ok: true,
      value: { kind: "no-terminal-session" },
    }));

    const result = await chat.run({
      agentRef: AGENT_ID,
      strategy: { kind: "continue" },
      onAttach: (sessionId) => calls.push(`attach ${sessionId}`),
    });

    expect(result.ok).toBe(false);
    expect(calls).toEqual([]);
  });

  it("says how to leave and how to come back", () => {
    const notice = attachNotice("my-agent", "s-1");
    expect(notice).toContain("close this terminal");
    expect(notice).toContain("Ctrl+C");
    expect(notice).toContain("dam chat my-agent --resume s-1");
  });
});
