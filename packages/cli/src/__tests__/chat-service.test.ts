import { describe, expect, it, vi } from "vitest";

const calls: string[] = [];
vi.mock("../modules/chat/infrastructure/terminal-bridge.js", () => ({
  connectTerminalBridge: vi.fn(async ({ title }: { title?: string }) => {
    calls.push(title === undefined ? "bridge" : `bridge ${title}`);
    return { kind: "exited", code: 0 };
  }),
}));

import { attachNotice, attachTitle } from "../modules/chat/commands/chat.js";
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
          serverRecommendedClient: undefined,
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
      updateIdentity: vi.fn(),
      unlockedCharacters: vi.fn(),
      customAvatarsEnabled: vi.fn(),
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
      onAttach: (sessionId) => {
        calls.push(`attach ${sessionId}`);
      },
    });

    expect(result.ok).toBe(true);
    expect(calls).toEqual(["attach s-1", "bridge"]);
  });

  // TEST_SCENARIO: the agent's full-screen view covered the notice within half a second (#5217). The terminal must not attach until the pause after the notice settles, and the bridge gets the title that keeps the hint on show.
  it("attaches only once the notice's pause settles, with the title", async () => {
    calls.length = 0;
    const chat = service(async () => ({
      ok: true,
      value: { kind: "ready", sessionId: "s-1", terminalPath: "/term" },
    }));

    const result = await chat.run({
      agentRef: AGENT_ID,
      strategy: { kind: "new" },
      onAttach: async () => {
        calls.push("notice");
        await new Promise((r) => setTimeout(r, 10));
        calls.push("paused");
      },
      title: (sessionId) => `title ${sessionId}`,
    });

    expect(result.ok).toBe(true);
    expect(calls).toEqual(["notice", "paused", "bridge title s-1"]);
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
      onAttach: (sessionId) => {
        calls.push(`attach ${sessionId}`);
      },
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

  it("keeps how to leave and how to come back in the title", () => {
    const title = attachTitle("my-agent", "s-1");
    expect(title).toContain("close the terminal");
    expect(title).toContain("Ctrl+C");
    expect(title).toContain("dam chat my-agent --resume s-1");
  });
});
