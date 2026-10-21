// TEST_OVERVIEW: a client that starts a session through the ACP relay without naming a model, such as `dam run`, gets the agent's saved default Session Pair filled into its `session/new`, as the web chat sends it. A frame that names a model, an agent with no saved default and every other frame reach the runtime as the client sent them, and in the order it sent them.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import type { SessionPair } from "api-server-api";
import type { AgentsRepository } from "../../modules/agents/infrastructure/agents-repository.js";
import type { ApprovalsRelayService } from "../../modules/approvals/compose.js";
import type { SessionPresence } from "../../apps/api-server/agent-proxies/session-presence.js";
import type { FirePair } from "../../modules/harness-config/index.js";
import { NoDefaultModelError } from "../../modules/harness-config/domain/no-default-model.js";

const runtime = vi.hoisted(() => ({ port: 0 }));

vi.mock("../../modules/agents/infrastructure/k8s.js", async (original) => ({
  ...(await original<object>()),
  podBaseUrl: () => `127.0.0.1:${String(runtime.port)}`,
}));

const { createAcpRelay } =
  await import("../../apps/api-server/agent-proxies/acp-relay.js");
const { fillSavedDefault } =
  await import("../../apps/api-server/agent-proxies/saved-default.js");

const saved: SessionPair = {
  harness: "claude-code",
  provider: "conn-1",
  model: "anthropic/claude-opus-5-5",
};

const repo = {
  resolveIdentity: async (agentId: string) => ({ owner: "u", agentId }),
  ensureReady: async () => {},
  peekCached: () => null,
  patchAnnotation: async () => {},
} as unknown as AgentsRepository;

const approvals = {
  subscribeFrameInjects: () => () => {},
} as unknown as ApprovalsRelayService;

const presence = { acquire: () => () => {} } as unknown as SessionPresence;

const closers: (() => void)[] = [];

afterEach(() => {
  for (const close of closers.splice(0)) close();
});

async function listen(server: Server): Promise<number> {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  closers.push(() => server.close());
  return (server.address() as { port: number }).port;
}

async function world(firePair: FirePair) {
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

  const relay = createAcpRelay("ns", repo, approvals, presence, firePair);
  const front = createServer();
  front.on("upgrade", (req, socket, head) => {
    relay.handleUpgrade(req, socket, head, "agent-1", {
      sub: "u",
      surface: "cli",
      attached: () => {},
    });
  });
  const port = await listen(front);
  const client = new WebSocket(`ws://127.0.0.1:${String(port)}/`);
  closers.push(() => client.terminate());
  await new Promise<void>((res, rej) => {
    client.once("open", res);
    client.once("error", rej);
  });
  return {
    send: (frame: object) => client.send(JSON.stringify(frame)),
    received: async (count: number) => {
      await vi.waitFor(() => expect(received).toHaveLength(count));
      return received;
    },
  };
}

const cliNewSession = {
  jsonrpc: "2.0",
  id: 2,
  method: "session/new",
  params: {
    cwd: ".",
    mcpServers: [],
    _meta: { platform: { mode: "chat", type: "cli_run" } },
  },
};

describe("ACP relay: the saved default on a new session", () => {
  // TEST_SCENARIO: `dam run` sends `session/new` with no harness or model; the runtime must receive the agent's saved default, or it refuses the session as having no model.
  it("fills the saved default into a session/new that names no model", async () => {
    const firePair = vi.fn<FirePair>(async () => saved);
    const relay = await world(firePair);
    relay.send(cliNewSession);
    const [frame] = await relay.received(1);
    expect(frame?.params).toEqual({
      cwd: ".",
      mcpServers: [],
      _meta: {
        platform: {
          mode: "chat",
          type: "cli_run",
          harness: "claude-code",
          provider: "conn-1",
          model: "anthropic/claude-opus-5-5",
        },
      },
    });
    expect(firePair).toHaveBeenCalledWith("agent-1", {});
  });

  // TEST_SCENARIO: frames sent while the saved default is looked up must not overtake the `session/new` before them, or a prompt would reach the runtime before its session exists.
  it("keeps the client's frame order while it looks the default up", async () => {
    let answer!: (pair: SessionPair) => void;
    const relay = await world(
      () => new Promise<SessionPair>((r) => (answer = r)),
    );
    relay.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    relay.send(cliNewSession);
    relay.send({ jsonrpc: "2.0", method: "session/cancel", params: {} });
    await vi.waitFor(() => expect(answer).toBeDefined());
    answer(saved);
    const frames = await relay.received(3);
    expect(frames.map((f) => f.method)).toEqual([
      "initialize",
      "session/new",
      "session/cancel",
    ]);
  });

  // TEST_SCENARIO: an agent with no saved default model gets the frame as sent, so the runtime's own no-model refusal names the Providers page.
  it("passes the frame on when the agent has no default model", async () => {
    const relay = await world(async () => {
      throw new NoDefaultModelError();
    });
    relay.send(cliNewSession);
    const [frame] = await relay.received(1);
    expect(frame).toEqual(cliNewSession);
  });

  // TEST_SCENARIO: a failing lookup must not swallow the session/new; it goes on as sent.
  it("passes the frame on when the lookup fails", async () => {
    const relay = await world(async () => {
      throw new Error("db down");
    });
    relay.send(cliNewSession);
    const [frame] = await relay.received(1);
    expect(frame).toEqual(cliNewSession);
  });
});

describe("fillSavedDefault", () => {
  const firePair = vi.fn<FirePair>(async () => saved);

  // TEST_SCENARIO: a session/new that already names a model is the client's choice, and no lookup runs.
  it("leaves a session/new that names a model alone", () => {
    const frame = {
      ...cliNewSession,
      params: { _meta: { platform: { model: "openai/gpt-5" } } },
    };
    expect(fillSavedDefault(frame, "agent-1", firePair)).toBeNull();
    expect(firePair).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: only session/new is filled; a prompt or a load keeps the session's own model.
  it("leaves every other frame alone", () => {
    for (const method of ["session/prompt", "session/load", "initialize"])
      expect(
        fillSavedDefault({ jsonrpc: "2.0", id: 1, method }, "a", firePair),
      ).toBeNull();
    expect(firePair).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: a client that names a harness gets the saved default for that harness, with the client's own settings kept over the saved ones.
  it("looks up the default for the harness the client names", async () => {
    const pick = vi.fn<FirePair>(async () => ({
      harness: "codex",
      provider: "conn-2",
      model: "openai/gpt-5",
      settings: { mode: "auto" },
    }));
    const frame = {
      jsonrpc: "2.0",
      id: 3,
      method: "session/new",
      params: {
        _meta: { platform: { harness: "codex", settings: { mode: "plan" } } },
      },
    };
    await expect(fillSavedDefault(frame, "agent-1", pick)).resolves.toEqual({
      ...frame,
      params: {
        _meta: {
          platform: {
            harness: "codex",
            provider: "conn-2",
            model: "openai/gpt-5",
            settings: { mode: "plan" },
          },
        },
      },
    });
    expect(pick).toHaveBeenCalledWith("agent-1", { harness: "codex" });
  });

  // TEST_SCENARIO: a runtime that does not route Session Pairs, or a saved default with no model, leaves nothing to fill.
  it("fills nothing when the resolved pair has no model", async () => {
    const none = vi.fn<FirePair>(async () => undefined);
    await expect(
      fillSavedDefault(cliNewSession, "agent-1", none),
    ).resolves.toBeNull();
    const noModel = vi.fn<FirePair>(async () => ({ ...saved, model: null }));
    await expect(
      fillSavedDefault(cliNewSession, "agent-1", noModel),
    ).resolves.toBeNull();
  });
});
