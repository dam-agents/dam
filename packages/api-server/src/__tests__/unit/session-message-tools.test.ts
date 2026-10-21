// TEST_OVERVIEW: an agent lists its own Sessions and sends a message into one of them. The message is queued with the sending Session as the platform resolved it, the tool says it is only queued, and it is refused where it could not be delivered.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PodSession, SessionMessageEventPayload } from "agent-runtime-api";
import { describe, expect, it } from "vitest";
import {
  registerSessionMessageTools,
  type SessionMessagePorts,
} from "../../apps/harness-api-server/session-message-tools.js";

function session(over: Partial<PodSession>): PodSession {
  return {
    sessionId: "s",
    mode: "chat",
    type: "regular",
    createdAt: "2026-10-20T10:00:00.000Z",
    updatedAt: "2026-10-20T11:00:00.000Z",
    title: null,
    scheduleId: null,
    threadTs: null,
    seenAt: null,
    runStartedAt: null,
    runTotalMs: null,
    runCount: null,
    running: false,
    ...over,
  };
}

const SESSIONS = [
  session({
    sessionId: "s-slack",
    type: "channel_slack",
    title: "Thread in #dev",
    running: true,
  }),
  session({
    sessionId: "s-dev",
    title: "Implement #42",
    running: true,
    runStartedAt: "2026-10-20T10:30:00.000Z",
  }),
  session({ sessionId: "s-old", title: "Earlier chat" }),
  session({ sessionId: "s-term", mode: "terminal" }),
];

async function harness(over: Partial<SessionMessagePorts> = {}) {
  const delivered: SessionMessageEventPayload[] = [];
  const server = new McpServer({ name: "test", version: "1.0.0" });
  registerSessionMessageTools(server, {
    listSessions: async ({ sessionId }) =>
      sessionId ? SESSIONS.filter((s) => s.sessionId === sessionId) : SESSIONS,
    callerSessionId: async () => "s-slack",
    acceptsSessionMessages: async () => true,
    send: async (payload) => {
      delivered.push(payload);
    },
    ...over,
  });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "c", version: "1.0.0" });
  await client.connect(clientT);
  const call = async (name: string, args: Record<string, unknown>) => {
    const res = (await client.callTool({ name, arguments: args })) as {
      content: { text: string }[];
      isError?: boolean;
    };
    const text = res.content[0]!.text;
    return {
      isError: res.isError === true,
      text,
      body: res.isError ? null : JSON.parse(text),
    };
  };
  return { call, delivered };
}

describe("list_sessions", () => {
  // TEST_SCENARIO: the agent's chat Sessions come back with their running state, the caller's own marked current, terminals left out.
  it("lists chat sessions and marks the caller", async () => {
    const { call } = await harness();
    const { body } = await call("list_sessions", {});
    expect(
      body.sessions.map((s: { sessionId: string }) => s.sessionId),
    ).toEqual(["s-slack", "s-dev", "s-old"]);
    expect(body.sessions[0]).toMatchObject({
      current: true,
      running: true,
      type: "channel_slack",
    });
    expect(body.sessions[1]).toEqual({
      sessionId: "s-dev",
      title: "Implement #42",
      type: "regular",
      running: true,
      runStartedAt: "2026-10-20T10:30:00.000Z",
      lastActivityAt: "2026-10-20T11:00:00.000Z",
    });
  });

  // TEST_SCENARIO: runningOnly keeps the Sessions with a turn in flight.
  it("filters to running sessions", async () => {
    const { call } = await harness();
    const { body } = await call("list_sessions", { runningOnly: true });
    expect(
      body.sessions.map((s: { sessionId: string }) => s.sessionId),
    ).toEqual(["s-slack", "s-dev"]);
  });
});

describe("send_session_message", () => {
  // TEST_SCENARIO: a message to a running Session is queued once with the calling Session as its sender, and the answer says queued, not delivered.
  it("queues the message naming its sender", async () => {
    const { call, delivered } = await harness();
    const { body } = await call("send_session_message", {
      sessionId: "s-dev",
      text: "Stop: the spec changed.",
    });
    expect(body).toMatchObject({
      queued: true,
      sessionId: "s-dev",
      running: true,
    });
    expect(body.sent).toBeUndefined();
    expect(body.failures).toBeUndefined();
    expect(delivered).toEqual([
      {
        sessionId: "s-dev",
        text: "Stop: the spec changed.",
        from: {
          sessionId: "s-slack",
          title: "Thread in #dev",
          type: "channel_slack",
        },
      },
    ]);
  });

  // TEST_SCENARIO: a caller the platform cannot identify still sends, with no sender claimed, and is told a failure cannot reach it.
  it("sends without a sender when the caller is unknown", async () => {
    const { call, delivered } = await harness({
      callerSessionId: async () => null,
    });
    const { body } = await call("send_session_message", {
      sessionId: "s-dev",
      text: "hi",
    });
    expect(delivered[0]!.from).toEqual({});
    expect(body.failures).toContain("cannot be reported back");
  });

  // TEST_SCENARIO: what cannot be delivered is refused with the reason and queues nothing: an unknown Session, a terminal, the caller itself, a runtime too old for the event.
  it.each([
    [{}, "s-gone", "has no session s-gone"],
    [{}, "s-term", "only a chat session takes messages"],
    [{}, "s-slack", "the session making this call"],
    [{ acceptsSessionMessages: async () => false }, "s-dev", "too old"],
  ] as const)(
    "refuses an undeliverable message (%#)",
    async (over, sessionId, reason) => {
      const { call, delivered } = await harness(over);
      const res = await call("send_session_message", { sessionId, text: "hi" });
      expect(res.isError).toBe(true);
      expect(res.text).toContain(reason);
      expect(delivered).toEqual([]);
    },
  );
});
