// TEST_OVERVIEW: a frame on an agent's ACP websocket that is not JSON closes that connection alone, as invalid payload (1007), and the turn on it fails; the parse error never escapes the socket listener, where it would take the whole api-server process down.
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

async function fakeAgent(onClose: (code: number) => void) {
  const server = createServer();
  const wss = new WebSocketServer({ server });
  wss.on("connection", (ws) => {
    ws.on("close", onClose);
    const answer = (id: unknown, result: object) =>
      ws.send(JSON.stringify({ jsonrpc: "2.0", id, result }));
    ws.on("message", (data) => {
      const frame = JSON.parse(String(data)) as {
        id?: unknown;
        method?: string;
      };
      if (frame.method === "initialize")
        answer(frame.id, { protocolVersion: 1, agentCapabilities: {} });
      if (frame.method === "session/new") answer(frame.id, { sessionId: "s1" });
      if (frame.method === "session/prompt")
        ws.send(
          '{"jsonrpc":"2.0","method":"session/update","params":{"update":{"title":"Ba',
        );
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

describe("a truncated ACP frame", () => {
  // TEST_SCENARIO: the agent sends a frame cut off mid-string while a prompt is running; the client closes that connection with 1007 and the prompt fails, and nothing is thrown out of the listener.
  it("closes the connection with 1007 and fails the turn", async () => {
    const uncaught = vi.fn();
    process.on("uncaughtException", uncaught);
    closers.push(() => process.off("uncaughtException", uncaught));
    let closed!: (code: number) => void;
    const closeCode = new Promise<number>((r) => (closed = r));
    const acp = await fakeAgent(closed);

    const sent = acp.sendPrompt("hi", { platformMeta: { harness: "x" } });

    await expect(closeCode).resolves.toBe(1007);
    await expect(sent).rejects.toThrow();
    expect(uncaught).not.toHaveBeenCalled();
  });
});
