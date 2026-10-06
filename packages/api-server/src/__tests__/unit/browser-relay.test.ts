import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import {
  browserUpstreamPath,
  createBrowserRelay,
  requiresConnectionAddress,
} from "../../apps/api-server/agent-proxies/browser-relay.js";
import {
  relayRoute,
  type RelayAdmission,
} from "../../apps/api-server/agent-proxies/upgrade.js";
import type { AgentsRepository } from "../../modules/agents/infrastructure/agents-repository.js";
import type { SessionPresence } from "../../apps/api-server/agent-proxies/session-presence.js";

// TEST_OVERVIEW: The browser relay carries the chat's browser panel to the agent's `/api/browser` stream: frames from the agent, input from the user. It is open only on agents whose gateway injects credentials into addressed requests alone, it keeps the agent awake like an open chat, and only the user's input — never a frame — counts as activity.

const closers: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

async function listen(server: Server) {
  await new Promise<void>((r) => server.listen(0, r));
  closers.push(() => new Promise<void>((r) => server.close(() => r())));
  return (server.address() as { port: number }).port;
}

async function fakeAgent() {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise<void>((r) => wss.once("listening", () => r()));
  closers.push(() => new Promise<void>((r) => wss.close(() => r())));
  const paths: string[] = [];
  const received: string[] = [];
  const sockets: WebSocket[] = [];
  wss.on("connection", (ws, req) => {
    sockets.push(ws);
    paths.push(req.url ?? "");
    ws.on("message", (d) => received.push(d.toString()));
  });
  return {
    base: `ws://127.0.0.1:${(wss.address() as { port: number }).port}`,
    paths,
    received,
    sockets,
  };
}

async function open(url: string) {
  const ws = new WebSocket(url);
  closers.push(() => ws.terminate());
  const messages: string[] = [];
  ws.on("message", (d) => messages.push(d.toString()));
  await new Promise<void>((res, rej) => {
    ws.once("open", () => res());
    ws.once("error", rej);
  });
  return { ws, messages };
}

async function until(check: () => boolean, ms = 2_000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("browserUpstreamPath", () => {
  // TEST_SCENARIO: The panel's address reaches the agent, but the user's access token, which rides in the same query, never does, nor does anything else the query carries.
  it("forwards the address, and drops the token and anything else", () => {
    const path = browserUpstreamPath(
      new URL(
        "http://x/api/agents/a/browser?token=secret&url=http%3A%2F%2F127.0.0.1%3A4444%2F&maxFps=10&pacing=ack&codec=h264&passive=1",
      ),
    );
    expect(path).toBe("/api/browser?url=http%3A%2F%2F127.0.0.1%3A4444%2F");
    expect(browserUpstreamPath(new URL("http://x/?token=t"))).toBe(
      "/api/browser",
    );
  });
});

describe("requiresConnectionAddress", () => {
  // TEST_SCENARIO: Only an agent whose spec sets requireConnectionAddress qualifies: without it, the gateway would put the agent's credentials into whatever the user browses.
  it("reads the agent's addressing setting", async () => {
    const repo = (spec: object | null) =>
      ({
        get: async () => (spec ? { spec } : null),
      }) as unknown as Pick<AgentsRepository, "get">;
    expect(
      await requiresConnectionAddress(
        repo({ requireConnectionAddress: true }),
        "a",
      ),
    ).toBe(true);
    expect(await requiresConnectionAddress(repo({}), "a")).toBe(false);
    expect(await requiresConnectionAddress(repo(null), "a")).toBe(false);
  });
});

describe("browser relay", () => {
  // TEST_SCENARIO: An owner who passes admission is still refused the browser of an agent without addressed injection, with 403 and before any relay work starts.
  it("refuses an agent that does not require connection addresses", async () => {
    const admitted: RelayAdmission = async () => ({
      ok: true,
      user: { sub: "u" } as never,
      surface: "web",
    });
    let relayed = false;
    const route = relayRoute(
      admitted,
      {
        handleUpgrade: () => {
          relayed = true;
        },
      },
      "browser",
      async () => false,
    );
    const server = createServer();
    server.on("upgrade", (req, socket, head) => {
      void route(req, socket, head, new URL(req.url!, "http://x"), {
        id: "a",
      });
    });
    const port = await listen(server);

    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/agents/a/browser`);
    ws.on("error", () => {});
    const status = await new Promise<number | undefined>((r) =>
      ws.once("unexpected-response", (_req, res) => r(res.statusCode)),
    );
    expect(status).toBe(403);
    expect(relayed).toBe(false);
  });

  // TEST_SCENARIO: A panel attaches. It holds the agent awake for as long as it is open, its address reaches the agent, frames reach the panel and input reaches the agent; input stamps last-activity, frames do not.
  it("pipes frames and input, holding presence and stamping only on input", async () => {
    const agent = await fakeAgent();
    const stamps: string[] = [];
    let held = 0;
    const repo = {
      ensureReady: async () => {},
      patchAnnotation: async (id: string) => {
        stamps.push(id);
      },
    } as unknown as AgentsRepository;
    const presence = {
      acquire: () => {
        held++;
        return () => {
          held--;
        };
      },
    } as unknown as SessionPresence;
    const relay = createBrowserRelay("ns", repo, presence, () => agent.base);
    const server = createServer();
    server.on("upgrade", (req, socket, head) =>
      relay.handleUpgrade(req, socket, head, "agent-1"),
    );
    const port = await listen(server);

    const { ws, messages } = await open(
      `ws://127.0.0.1:${port}/?token=t&url=http%3A%2F%2F127.0.0.1%3A3000%2F`,
    );
    await until(() => agent.sockets.length === 1);
    expect(held).toBe(1);
    expect(agent.paths[0]).toBe(
      "/api/browser?url=http%3A%2F%2F127.0.0.1%3A3000%2F",
    );

    agent.sockets[0]!.send(JSON.stringify({ type: "frame", seq: 1 }));
    await until(() => messages.length === 1);
    expect(stamps).toEqual([]);

    ws.send(JSON.stringify({ type: "input_keyboard", key: "a" }));
    await until(() => agent.received.length === 1);
    expect(stamps).toEqual(["agent-1"]);

    ws.close();
    await until(() => held === 0);
    relay.close();
  });
});
