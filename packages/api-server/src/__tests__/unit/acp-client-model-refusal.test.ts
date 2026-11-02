// TEST_OVERVIEW: a prompt the model refuses ends its turn with ACP's `refusal` stop reason, not with an error, so the platform's ACP client turns that stop reason into an AcpModelRefusedError naming the session; a turn that ends any other way still answers with the agent's text.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";

const runtime = vi.hoisted(() => ({ port: 0 }));

vi.mock("../../modules/agents/infrastructure/k8s.js", async (original) => ({
  ...(await original<object>()),
  agentServiceAddress: () => `127.0.0.1:${String(runtime.port)}`,
}));

const { AcpModelRefusedError, createAcpClient } =
  await import("../../core/acp-client.js");

const closers: (() => void)[] = [];

afterEach(() => {
  for (const close of closers.splice(0)) close();
});

async function fakeAgent(stopReason: string) {
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
      if (frame.method === "session/new") answer(frame.id, { sessionId: "s1" });
      if (frame.method === "session/prompt") {
        ws.send(
          JSON.stringify({
            jsonrpc: "2.0",
            method: "session/update",
            params: {
              sessionId: "s1",
              update: {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: "partial" },
              },
            },
          }),
        );
        answer(frame.id, { stopReason });
      }
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

describe("a refused prompt", () => {
  // TEST_SCENARIO: the harness ends the turn with stop reason `refusal`; a channel must learn the model refused, or it reads the turn as answered and the thread stays silent.
  it("throws AcpModelRefusedError naming the session", async () => {
    const acp = await fakeAgent("refusal");
    const sent = acp.sendPrompt("hi", { platformMeta: { harness: "x" } });
    await expect(sent).rejects.toBeInstanceOf(AcpModelRefusedError);
    await expect(sent).rejects.toMatchObject({ sessionId: "s1" });
  });

  // TEST_SCENARIO: a turn that ends normally keeps answering with the text the agent streamed.
  it("answers with the agent's text on any other stop reason", async () => {
    const acp = await fakeAgent("end_turn");
    await expect(
      acp.sendPrompt("hi", { platformMeta: { harness: "x" } }),
    ).resolves.toBe("partial");
  });
});
