import { describe, expect, it } from "vitest";
import { ClientSideConnection } from "@agentclientprotocol/sdk/dist/acp.js";
import type { Stream } from "@agentclientprotocol/sdk/dist/stream.js";
import type { AnyMessage } from "@agentclientprotocol/sdk/dist/jsonrpc.js";
import { attachHostedAcp } from "../../modules/hosted-harness/services/acp-facade.js";
import type { HostedSessionsService } from "../../modules/hosted-harness/services/hosted-sessions-service.js";
import type {
  HostedSessionRow,
  TurnLogRepository,
} from "../../modules/hosted-harness/infrastructure/turn-log-repository.js";
import type { TurnEvent } from "../../modules/hosted-harness/domain/events.js";

// TEST_OVERVIEW: the ACP facade — hosted sessions served to a real ACP client (the same SDK the UI uses): new/list/prompt with streamed updates, history replay, turn end.

function streamPair(): { client: Stream; server: Stream } {
  const a = new TransformStream<AnyMessage, AnyMessage>();
  const b = new TransformStream<AnyMessage, AnyMessage>();
  return {
    client: { readable: b.readable, writable: a.writable },
    server: { readable: a.readable, writable: b.writable },
  };
}

function fakeSessions(): {
  service: HostedSessionsService;
  events: TurnEvent[];
  endTurn: () => void;
} {
  let nextId = 1;
  const events: TurnEvent[] = [];
  const session: HostedSessionRow = {
    id: "hs-1",
    agentId: "agent-1",
    owner: "o1",
    title: null,
    mode: "chat",
    scheduleId: null,
    lastSeenAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  let running = false;
  const push = (kind: TurnEvent["kind"], payload: unknown) =>
    events.push({
      id: nextId++,
      sessionId: "hs-1",
      turnId: "t1",
      seq: nextId,
      kind,
      payload,
      createdAt: new Date(),
    });
  const service: HostedSessionsService = {
    createSession: async () => session,
    listSessions: async () => [session],
    getSession: async () => session,
    deleteSession: async () => {},
    prompt: async ({ text }) => {
      running = true;
      push("user-message", { text, source: "user" });
      setTimeout(() => {
        push("assistant-message", { text: "the answer" });
        push("turn-end", { status: "done" });
        running = false;
      }, 50);
      return { turnId: "t1" };
    },
    interrupt: async () => true,
    listEvents: async (_sid, afterId = 0) =>
      events.filter((e) => e.id > afterId),
    turnInFlight: async () => running,
    recordSeen: async () => {},
    setMode: async () => {},
  };
  return { service, events, endTurn: () => {} };
}

async function connect(service: HostedSessionsService) {
  const { client, server } = streamPair();
  attachHostedAcp({
    stream: server,
    agentId: "agent-1",
    sessions: service,
    isClientOpen: () => true,
    log: () => {},
  });
  const updates: { sessionId: string; update: unknown }[] = [];
  const connection = new ClientSideConnection(
    () => ({
      requestPermission: async () => ({
        outcome: { outcome: "cancelled" as const },
      }),
      sessionUpdate: async (params) => {
        updates.push({ sessionId: params.sessionId, update: params.update });
      },
      writeTextFile: async () => ({}),
      readTextFile: async () => ({ content: "" }),
      extNotification: async () => {},
    }),
    client,
  );
  await connection.initialize({ protocolVersion: 1, clientCapabilities: {} });
  return { connection, updates };
}

describe("hosted ACP facade", () => {
  // TEST_SCENARIO: session/new returns the hosted session id and session/list carries platform meta
  it("creates and lists sessions", async () => {
    const { service } = fakeSessions();
    const { connection } = await connect(service);
    const s = await connection.newSession({ cwd: ".", mcpServers: [] });
    expect(s.sessionId).toBe("hs-1");
    const list = await connection.listSessions({ cwd: "." });
    expect(list.sessions).toHaveLength(1);
    const meta = (
      list.sessions[0] as unknown as {
        _meta: { platform: { mode: string; running: boolean } };
      }
    )._meta.platform;
    expect(meta.mode).toBe("chat");
    expect(meta.running).toBe(false);
  });

  // TEST_SCENARIO: session/prompt streams the assistant reply as update notifications and resolves with end_turn when the turn-end event lands
  it("streams a prompted turn to completion", async () => {
    const { service } = fakeSessions();
    const { connection, updates } = await connect(service);
    const r = await connection.prompt({
      sessionId: "hs-1",
      prompt: [{ type: "text", text: "question" }],
    });
    expect(r.stopReason).toBe("end_turn");
    const kinds = updates.map(
      (u) => (u.update as { sessionUpdate: string }).sessionUpdate,
    );
    expect(kinds).toContain("agent_message_chunk");
    expect(kinds).not.toContain("user_message_chunk");
  });

  // TEST_SCENARIO: session/load replays the full history including the prompt echo
  it("replays history on load", async () => {
    const { service } = fakeSessions();
    const { connection, updates } = await connect(service);
    await connection.prompt({
      sessionId: "hs-1",
      prompt: [{ type: "text", text: "question" }],
    });
    updates.length = 0;
    await connection.loadSession({
      sessionId: "hs-1",
      cwd: ".",
      mcpServers: [],
    });
    const kinds = updates.map(
      (u) => (u.update as { sessionUpdate: string }).sessionUpdate,
    );
    expect(kinds).toEqual(["user_message_chunk", "agent_message_chunk"]);
  });
});
