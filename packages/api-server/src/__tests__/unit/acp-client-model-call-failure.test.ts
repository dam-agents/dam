// TEST_OVERVIEW: a prompt whose model call failed comes back from the harness as an error, in a shape each harness picks: Claude Code answers a rejected key or access with ACP's bare `Authentication required` and leaves the provider's words only in the turn's last message, and names any other failed call beside an `errorKind`; Pi and Codex name it in `data.details`. The platform's ACP client turns every one of them into an AcpModelCallFailedError carrying the provider's words, and leaves any other error as it was.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";

const runtime = vi.hoisted(() => ({ port: 0 }));

vi.mock("../../modules/agents/infrastructure/k8s.js", async (original) => ({
  ...(await original<object>()),
  agentServiceAddress: () => `127.0.0.1:${String(runtime.port)}`,
}));

const { AcpModelCallFailedError, createAcpClient } =
  await import("../../core/acp-client.js");

const closers: (() => void)[] = [];

afterEach(() => {
  for (const close of closers.splice(0)) close();
});

type Chunk = { text: string; messageId?: string };

async function fakeAgent(
  chunks: Chunk[],
  error: { code: number; message: string; data?: unknown },
) {
  const server = createServer();
  const wss = new WebSocketServer({ server });
  wss.on("connection", (ws) => {
    const send = (frame: object) =>
      ws.send(JSON.stringify({ jsonrpc: "2.0", ...frame }));
    ws.on("message", (data) => {
      const frame = JSON.parse(String(data)) as {
        id?: unknown;
        method?: string;
      };
      if (frame.method === "initialize")
        send({
          id: frame.id,
          result: { protocolVersion: 1, agentCapabilities: {} },
        });
      if (frame.method === "session/new")
        send({ id: frame.id, result: { sessionId: "s1" } });
      if (frame.method === "session/prompt") {
        for (const chunk of chunks)
          send({
            method: "session/update",
            params: {
              sessionId: "s1",
              update: {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: chunk.text },
                ...(chunk.messageId !== undefined && {
                  messageId: chunk.messageId,
                }),
              },
            },
          });
        send({ id: frame.id, error });
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

const send = (acp: Awaited<ReturnType<typeof fakeAgent>>) =>
  acp.sendPrompt("hi", { platformMeta: { harness: "x" } });

const AUTH_REQUIRED = { code: -32000, message: "Authentication required" };

describe("a prompt whose model call failed", () => {
  // TEST_SCENARIO: the frames Claude Code's adapter 0.94 and 0.96 send when the provider answers 403 with no body, after the agent already ran a tool and wrote its output: the error names the session, says the call was rejected, and carries the provider's words from the last message alone.
  it("reads a rejected Claude Code call's words from its last message", async () => {
    const acp = await fakeAgent(
      [
        { text: "```console\nhi\n```", messageId: "m1" },
        {
          text: "Failed to authenticate. API Error: 403 status code (no body)",
          messageId: "m2",
        },
      ],
      AUTH_REQUIRED,
    );
    const sent = send(acp);
    await expect(sent).rejects.toBeInstanceOf(AcpModelCallFailedError);
    await expect(sent).rejects.toMatchObject({
      sessionId: "s1",
      failure: "rejected",
      providerText:
        "Failed to authenticate. API Error: 403 status code (no body)",
    });
  });

  // TEST_SCENARIO: the agent-runtime puts its key hint before a provider's `authentication_error`; the provider's words come without it.
  it("leaves the runtime's key hint out of the provider's words", async () => {
    const { AUTH_ERROR_HINT } = await import("api-server-api");
    const acp = await fakeAgent(
      [
        {
          text: `${AUTH_ERROR_HINT}\n\nError: Failed to authenticate. API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}`,
          messageId: "m1",
        },
      ],
      AUTH_REQUIRED,
    );
    await expect(send(acp)).rejects.toMatchObject({
      failure: "rejected",
      providerText: expect.stringMatching(/^Failed to authenticate\. API Error: 401/),
    });
  });

  // TEST_SCENARIO: the turn's last message is the agent's own prose, not an API error; the failure is still reported, but nothing the agent wrote is passed off as the provider's words.
  it("relays no words when the last message is the agent's own", async () => {
    const acp = await fakeAgent(
      [{ text: "I'll check whether the API key works.", messageId: "m1" }],
      AUTH_REQUIRED,
    );
    await expect(send(acp)).rejects.toMatchObject({
      failure: "rejected",
      providerText: null,
    });
  });

  // TEST_SCENARIO: Claude Code names any other failed call after the internal error's prefix, tagged with the provider's error kind; a rejected model counts as rejected, a server error as failed.
  it("reads Claude Code's internal error tagged with an error kind", async () => {
    const failed = await fakeAgent([], {
      code: -32603,
      message: "Internal error: API Error: 400 model not allowed",
      data: { errorKind: "model_not_found" },
    });
    await expect(send(failed)).rejects.toMatchObject({
      failure: "rejected",
      providerText: "API Error: 400 model not allowed",
    });
    const server = await fakeAgent([], {
      code: -32603,
      message: "Internal error: API Error: Connection refused (ECONNREFUSED)",
      data: { errorKind: "server_error" },
    });
    await expect(send(server)).rejects.toMatchObject({
      failure: "failed",
      providerText: "API Error: Connection refused (ECONNREFUSED)",
    });
  });

  // TEST_SCENARIO: Pi and Codex name a failed call in `data.details`, after `Model request failed:`.
  it("reads Pi's and Codex's failed request from its details", async () => {
    const acp = await fakeAgent([], {
      code: -32603,
      message: "Internal error",
      data: { details: "Model request failed: 403 Forbidden" },
    });
    await expect(send(acp)).rejects.toMatchObject({
      failure: "failed",
      providerText: "403 Forbidden",
    });
  });

  // TEST_SCENARIO: an error that is not a failed model call — the runtime's own refusal, a harness that crashed — stays the error it was.
  it("leaves any other error as it was", async () => {
    const acp = await fakeAgent([], {
      code: -32000,
      message: "the harness is not running",
    });
    const sent = send(acp);
    await expect(sent).rejects.not.toBeInstanceOf(AcpModelCallFailedError);
    await expect(sent).rejects.toMatchObject({
      message: "the harness is not running",
    });
  });
});
