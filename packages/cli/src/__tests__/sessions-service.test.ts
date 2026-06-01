import { SessionMode, SessionType, type SessionView } from "api-server-api";
import { describe, expect, it, vi } from "vitest";
import type { AcpSessionClient } from "../modules/chat/infrastructure/acp-session-client.js";
import { createSessionsPort } from "../modules/chat/services/sessions-service.js";

const AGENT = "agent-1";

function session(
  over: Partial<SessionView> & { sessionId: string },
): SessionView {
  return {
    agentId: AGENT,
    type: SessionType.Regular,
    mode: SessionMode.Chat,
    createdAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

function fakeAcp(over: Partial<AcpSessionClient> = {}): AcpSessionClient {
  return {
    list: async () => [],
    setMode: async () => {},
    ...over,
  };
}

describe("createSessionsPort.resolveTerminal", () => {
  it("mints a fresh session for the `new` strategy without touching the agent", async () => {
    const list = vi.fn(async () => [] as SessionView[]);
    const port = createSessionsPort({ acp: fakeAcp({ list }) });

    const r = await port.resolveTerminal(AGENT, { kind: "new" });

    expect(r.ok).toBe(true);
    if (!r.ok || r.value.kind !== "ready") throw new Error("expected ready");
    expect(r.value.terminalPath).toBe(
      `/api/agents/${AGENT}/terminal?sessionId=${encodeURIComponent(r.value.sessionId)}`,
    );
    expect(list).not.toHaveBeenCalled();
  });

  it("adds reset=1 to the terminal path when reset is set", async () => {
    const port = createSessionsPort({ acp: fakeAcp() });
    const r = await port.resolveTerminal(
      AGENT,
      { kind: "new" },
      { reset: true },
    );
    if (!r.ok || r.value.kind !== "ready") throw new Error("expected ready");
    expect(r.value.terminalPath).toContain("&reset=1");
  });

  it("continue with no terminal session reports none", async () => {
    const port = createSessionsPort({
      acp: fakeAcp({
        list: async () => [
          session({ sessionId: "s1", mode: SessionMode.Chat }),
        ],
      }),
    });
    const r = await port.resolveTerminal(AGENT, { kind: "continue" });
    expect(r.ok && r.value.kind).toBe("no-terminal-session");
  });

  it("continue with multiple terminals reports the ambiguity", async () => {
    const port = createSessionsPort({
      acp: fakeAcp({
        list: async () => [
          session({ sessionId: "t1", mode: SessionMode.Terminal }),
          session({ sessionId: "t2", mode: SessionMode.Terminal }),
        ],
      }),
    });
    const r = await port.resolveTerminal(AGENT, { kind: "continue" });
    if (!r.ok || r.value.kind !== "multiple-terminal-sessions")
      throw new Error("expected multiple");
    expect(r.value.sessionIds).toEqual(["t1", "t2"]);
  });

  it("continue resolves the single terminal session, ignoring channel sessions", async () => {
    const port = createSessionsPort({
      acp: fakeAcp({
        list: async () => [
          session({ sessionId: "t1", mode: SessionMode.Terminal }),
          session({
            sessionId: "ch",
            type: SessionType.ChannelSlack,
            mode: SessionMode.Terminal,
          }),
        ],
      }),
    });
    const r = await port.resolveTerminal(AGENT, { kind: "continue" });
    if (!r.ok || r.value.kind !== "ready") throw new Error("expected ready");
    expect(r.value.sessionId).toBe("t1");
  });

  it("resume of an unknown session reports not-found", async () => {
    const port = createSessionsPort({ acp: fakeAcp({ list: async () => [] }) });
    const r = await port.resolveTerminal(AGENT, {
      kind: "resume",
      sessionId: "missing",
    });
    if (!r.ok || r.value.kind !== "session-not-found")
      throw new Error("expected not-found");
    expect(r.value.sessionId).toBe("missing");
  });

  it("resume of a chat session asks for confirmation and does not flip mode", async () => {
    const setMode = vi.fn(async () => {});
    const port = createSessionsPort({
      acp: fakeAcp({
        list: async () => [
          session({ sessionId: "s1", mode: SessionMode.Chat }),
        ],
        setMode,
      }),
    });
    const r = await port.resolveTerminal(AGENT, {
      kind: "resume",
      sessionId: "s1",
    });
    expect(r.ok && r.value.kind).toBe("confirm-mode-switch");
    expect(setMode).not.toHaveBeenCalled();
  });

  it("forced resume of a chat session flips mode over ACP then readies", async () => {
    const setMode = vi.fn(async () => {});
    const port = createSessionsPort({
      acp: fakeAcp({
        list: async () => [
          session({ sessionId: "s1", mode: SessionMode.Chat }),
        ],
        setMode,
      }),
    });
    const r = await port.resolveTerminal(
      AGENT,
      { kind: "resume", sessionId: "s1" },
      { force: true },
    );
    expect(r.ok && r.value.kind).toBe("ready");
    expect(setMode).toHaveBeenCalledWith(AGENT, "s1", SessionMode.Terminal);
  });

  it("resume of an already-terminal session readies without a mode flip", async () => {
    const setMode = vi.fn(async () => {});
    const port = createSessionsPort({
      acp: fakeAcp({
        list: async () => [
          session({ sessionId: "s1", mode: SessionMode.Terminal }),
        ],
        setMode,
      }),
    });
    const r = await port.resolveTerminal(AGENT, {
      kind: "resume",
      sessionId: "s1",
    });
    expect(r.ok && r.value.kind).toBe("ready");
    expect(setMode).not.toHaveBeenCalled();
  });

  it("wraps an unreachable agent as a transport error", async () => {
    const port = createSessionsPort({
      acp: fakeAcp({
        list: async () => {
          throw new Error("connect ECONNREFUSED");
        },
      }),
    });
    const r = await port.resolveTerminal(AGENT, { kind: "continue" });
    if (r.ok) throw new Error("expected failure");
    expect(r.error.kind).toBe("transport");
    expect(r.error.reason).toContain("ECONNREFUSED");
  });
});

describe("createSessionsPort.list", () => {
  it("passes sessions through and surfaces transport failures", async () => {
    const sessions = [session({ sessionId: "s1" })];
    const okPort = createSessionsPort({
      acp: fakeAcp({ list: async () => sessions }),
    });
    const okRes = await okPort.list(AGENT);
    expect(okRes.ok && okRes.value).toEqual(sessions);

    const failPort = createSessionsPort({
      acp: fakeAcp({
        list: async () => {
          throw new Error("boom");
        },
      }),
    });
    const failRes = await failPort.list(AGENT);
    expect(failRes.ok).toBe(false);
  });
});
