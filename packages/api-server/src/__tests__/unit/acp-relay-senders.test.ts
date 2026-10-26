// TEST_OVERVIEW: the ACP relay names the person signed in on the chat socket as the Sender of every prompt, queue edit and rewrite, and as the answerer of every permission answer, replacing whatever the client claimed. Only the relay knows who is signed in, so the runtime trusts these stamps alone. Other frames reach the runtime as the client sent them. The runtime reads a binary frame as text, so the relay reads it the same way: a binary frame is stamped like a text frame, and an editor's mark-seen in one never reaches the runtime.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import type { AgentsRepository } from "../../modules/agents/infrastructure/agents-repository.js";
import type { ApprovalsRelayService } from "../../modules/approvals/compose.js";
import type { SessionPresence } from "../../apps/api-server/agent-proxies/session-presence.js";
import type { RelayActor } from "../../apps/api-server/agent-proxies/upgrade.js";

const runtime = vi.hoisted(() => ({ port: 0 }));

vi.mock("../../modules/agents/infrastructure/k8s.js", async (original) => ({
  ...(await original<object>()),
  agentServiceAddress: () => `127.0.0.1:${String(runtime.port)}`,
}));

const { createAcpRelay } =
  await import("../../apps/api-server/agent-proxies/acp-relay.js");

const repo = {
  resolveIdentity: async (agentId: string) => ({ owner: "owner-sub", agentId }),
  ensureReady: async () => {},
  peekCached: () => null,
  patchAnnotation: async () => {},
} as unknown as AgentsRepository;

const approvals = {
  subscribeFrameInjects: () => () => {},
  resolveAcpNativeFromInSession: async () => {},
} as unknown as ApprovalsRelayService;

const presence = { acquire: () => () => {} } as unknown as SessionPresence;

const editor: Pick<RelayActor, "sub" | "email" | "editor"> = {
  sub: "editor-sub",
  email: "Editor@Example.com",
  editor: {
    email: "editor@example.com",
    ownerSub: "owner-sub",
    permissions: ["sessions"],
  },
};

const closers: (() => void)[] = [];

afterEach(() => {
  for (const close of closers.splice(0)) close();
});

async function listen(server: Server): Promise<number> {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  closers.push(() => server.close());
  return (server.address() as { port: number }).port;
}

async function world(person: Pick<RelayActor, "sub" | "email" | "editor">) {
  const upstream = createServer();
  const received: Record<string, unknown>[] = [];
  const upstreamWss = new WebSocketServer({ server: upstream });
  upstreamWss.on("connection", (ws) => {
    ws.on("message", (data) => {
      received.push(JSON.parse(String(data)) as Record<string, unknown>);
    });
  });
  closers.push(() => upstreamWss.close());
  runtime.port = await listen(upstream);

  const relay = createAcpRelay(
    "ns",
    repo,
    approvals,
    presence,
    async () => null,
  );
  const front = createServer();
  front.on("upgrade", (req, socket, head) => {
    relay.handleUpgrade(req, socket, head, "agent-1", {
      ...person,
      surface: "ui",
      attached: () => {},
      opened: () => {},
    });
  });
  const port = await listen(front);
  const client = new WebSocket(`ws://127.0.0.1:${String(port)}/`);
  closers.push(() => client.terminate());
  const replies: Record<string, unknown>[] = [];
  client.on("message", (data) => {
    replies.push(JSON.parse(String(data)) as Record<string, unknown>);
  });
  await new Promise<void>((res, rej) => {
    client.once("open", res);
    client.once("error", rej);
  });
  return {
    send: (frame: object) => client.send(JSON.stringify(frame)),
    sendBinary: (frame: object) =>
      client.send(Buffer.from(JSON.stringify(frame)), { binary: true }),
    replies: async (count: number) => {
      await vi.waitFor(() => expect(replies).toHaveLength(count));
      return replies;
    },
    received: async (count: number) => {
      await vi.waitFor(() => expect(received).toHaveLength(count));
      return received;
    },
  };
}

describe("ACP relay: who sent a prompt and who answered", () => {
  // TEST_SCENARIO: an editor's browser claims the owner sent its prompt; the runtime must get the editor, by the verified email their standing was matched on, or the chat would name the wrong person.
  it("replaces a claimed Sender with the person signed in", async () => {
    const relay = await world(editor);
    relay.send({
      jsonrpc: "2.0",
      id: 3,
      method: "session/prompt",
      params: {
        sessionId: "s1",
        prompt: [{ type: "text", text: "hi" }],
        _meta: {
          platform: {
            promptId: "p1",
            sender: { sub: "owner-sub", email: "owner@example.com" },
          },
        },
      },
    });
    const [frame] = await relay.received(1);
    expect(frame?.params).toMatchObject({
      _meta: {
        platform: {
          promptId: "p1",
          sender: { sub: "editor-sub", email: "editor@example.com" },
        },
      },
    });
  });

  // TEST_SCENARIO: the owner allows a tool call from the chat; the answer must name them so the verdict line says who allowed it after a reload. The owner signed in with an API key has no email, so only the sub is stamped.
  it("stamps who answered a permission request", async () => {
    const relay = await world({ sub: "owner-sub", email: null, editor: null });
    relay.send({
      jsonrpc: "2.0",
      id: 7,
      result: { outcome: { outcome: "selected", optionId: "allow" } },
    });
    const [frame] = await relay.received(1);
    expect(frame?.result).toEqual({
      outcome: { outcome: "selected", optionId: "allow" },
      _meta: { platform: { answeredBy: { sub: "owner-sub" } } },
    });
  });

  // TEST_SCENARIO: a frame that makes nobody a Sender, such as a cancel, must reach the runtime exactly as sent.
  it("passes other frames on unchanged", async () => {
    const relay = await world(editor);
    const cancel = {
      jsonrpc: "2.0",
      method: "session/cancel",
      params: { sessionId: "s1" },
    };
    relay.send(cancel);
    const [frame] = await relay.received(1);
    expect(frame).toEqual(cancel);
  });
});

describe("ACP relay: binary frames", () => {
  // TEST_SCENARIO: an editor sends their prompt as a binary frame and claims the owner sent it. The runtime parses it like a text frame, so the relay must stamp the editor here too, or the owner would see "You" on the editor's message.
  it("stamps the Sender of a binary prompt", async () => {
    const relay = await world(editor);
    relay.sendBinary({
      jsonrpc: "2.0",
      id: 3,
      method: "session/prompt",
      params: {
        sessionId: "s1",
        prompt: [{ type: "text", text: "hi" }],
        _meta: {
          platform: {
            promptId: "p1",
            sender: { sub: "owner-sub", email: "owner@example.com" },
          },
        },
      },
    });
    const [frame] = await relay.received(1);
    expect(frame?.params).toMatchObject({
      _meta: {
        platform: {
          sender: { sub: "editor-sub", email: "editor@example.com" },
        },
      },
    });
  });

  // TEST_SCENARIO: an editor answers a permission request in a binary frame and claims the owner answered. The verdict line must name the editor.
  it("stamps who answered in a binary permission answer", async () => {
    const relay = await world(editor);
    relay.sendBinary({
      jsonrpc: "2.0",
      id: 7,
      result: {
        outcome: { outcome: "selected", optionId: "allow" },
        _meta: { platform: { answeredBy: { sub: "owner-sub" } } },
      },
    });
    const [frame] = await relay.received(1);
    expect(frame?.result).toMatchObject({
      _meta: {
        platform: {
          answeredBy: { sub: "editor-sub", email: "editor@example.com" },
        },
      },
    });
  });

  // TEST_SCENARIO: read state stays the owner's. An editor's mark-seen in a binary frame must get the relay's own answer and never reach the runtime, the same as in a text frame.
  it("answers an editor's binary mark-seen itself", async () => {
    const relay = await world(editor);
    relay.sendBinary({
      jsonrpc: "2.0",
      id: 9,
      method: "platform/markSeen",
      params: { sessionId: "s1" },
    });
    relay.send({
      jsonrpc: "2.0",
      method: "session/cancel",
      params: { sessionId: "s1" },
    });
    expect(await relay.replies(1)).toEqual([
      { jsonrpc: "2.0", id: 9, result: {} },
    ]);
    const received = await relay.received(1);
    expect(received.map((frame) => frame.method)).toEqual(["session/cancel"]);
  });
});
