// TEST_OVERVIEW: the platform's ACP client lists an agent's sessions with the platform metadata the runtime keeps on each, and the channels find a thread's session by the `threadTs` in it; a field the runtime sends as null must not drop that metadata, or every message in a thread starts a new session.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";

const runtime = vi.hoisted(() => ({ port: 0 }));

vi.mock("../../modules/agents/infrastructure/k8s.js", async (original) => ({
  ...(await original<object>()),
  agentServiceAddress: () => `127.0.0.1:${String(runtime.port)}`,
}));

const { createAcpClient } = await import("../../core/acp-client.js");

const closers: (() => void)[] = [];

afterEach(() => {
  for (const close of closers.splice(0)) close();
});

async function fakeAgent(sessions: object[]) {
  const server = createServer();
  const wss = new WebSocketServer({ server });
  wss.on("connection", (ws) => {
    const answer = (id: unknown, result: object) =>
      ws.send(JSON.stringify({ jsonrpc: "2.0", id, result }));
    ws.on("message", (data) => {
      const frame = JSON.parse(String(data)) as {
        id?: unknown;
        method?: string;
      };
      if (frame.method === "initialize")
        answer(frame.id, { protocolVersion: 1, agentCapabilities: {} });
      if (frame.method === "session/list") answer(frame.id, { sessions });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  closers.push(() => {
    wss.close();
    server.close();
  });
  runtime.port = (server.address() as { port: number }).port;
  return createAcpClient({
    namespace: "ns",
    instanceName: "agent-1",
    stallProbeMs: 60_000,
  });
}

describe("listing sessions", () => {
  // TEST_SCENARIO: the runtime lists a Slack session nobody renamed with `customTitle: null`, as it has since the rename dialog stopped prefilling automatic titles; the session still carries its thread key.
  it("keeps the thread key of a session with no custom title", async () => {
    const acp = await fakeAgent([
      {
        sessionId: "s1",
        title: "who owns you?",
        _meta: {
          platform: {
            mode: "chat",
            type: "channel_slack",
            createdAt: "2026-10-30T12:00:00.000Z",
            running: false,
            threadTs: "C1:1793293203.730589",
            customTitle: null,
            autoTitle: "who owns you?",
          },
        },
      },
    ]);

    const [session] = await acp.listSessions();

    expect(session?.platform).toMatchObject({
      type: "channel_slack",
      threadTs: "C1:1793293203.730589",
    });
    expect(session?.platform?.customTitle).toBeUndefined();
  });

  // TEST_SCENARIO: a session the person renamed keeps its custom title in the listed metadata.
  it("keeps a custom title the person set", async () => {
    const acp = await fakeAgent([
      {
        sessionId: "s1",
        _meta: {
          platform: { threadTs: "C1:1.2", customTitle: "Release notes" },
        },
      },
    ]);

    const [session] = await acp.listSessions();

    expect(session?.platform).toMatchObject({
      threadTs: "C1:1.2",
      customTitle: "Release notes",
    });
  });
});
