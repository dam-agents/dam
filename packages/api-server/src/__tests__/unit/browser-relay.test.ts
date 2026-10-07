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

// TEST_OVERVIEW: The browser relay carries the chat's browser panel to the agent: its control socket to `/api/browser` — the page's state from the agent, the toolbar's requests from the user — and its stream page's socket to `/api/browser/display`. It is open only on agents whose gateway injects credentials into addressed requests alone, it keeps the agent awake like an open chat, and only the toolbar's requests count as activity, never the stream.

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
  // TEST_SCENARIO: The panel's control socket reaches the runtime's browser supervisor, but the user's access token, which rides in its query, never does, nor does anything else the query carries.
  it("sends the panel's socket to the browser supervisor, without its query", () => {
    expect(
      browserUpstreamPath(
        new URL(
          "http://x/api/agents/a/browser?token=secret&url=http%3A%2F%2Fa",
        ),
      ),
    ).toBe("/api/browser");
  });

  // TEST_SCENARIO: the stream client the panel frames opens its socket next to the page it was served from, /api/public/browser-stream/<agent>/api/websockets. That socket carries the stream server's own protocol, so it goes to the runtime's display relay, never to the browser's control socket; the user's token, which the client puts in the query, does not travel on.
  it("sends the stream client's socket to the display relay", () => {
    expect(
      browserUpstreamPath(
        new URL(
          "http://x/api/public/browser-stream/agent-1/api/websockets?token=secret&role=viewer",
        ),
      ),
    ).toBe("/api/browser/display");
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

  // TEST_SCENARIO: A panel's control socket attaches. It holds the agent awake for as long as it is open, the page's state reaches the panel and the toolbar's requests reach the agent; a request stamps last-activity, the page's state does not.
  it("relays the control socket, holding presence and stamping only on requests", async () => {
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

    const { ws, messages } = await open(`ws://127.0.0.1:${port}/?token=t`);
    await until(() => agent.sockets.length === 1);
    expect(held).toBe(1);
    expect(agent.paths[0]).toBe("/api/browser");

    agent.sockets[0]!.send(JSON.stringify({ type: "url", url: "http://a/" }));
    await until(() => messages.length === 1);
    expect(stamps).toEqual([]);

    ws.send(JSON.stringify({ type: "reload" }));
    await until(() => agent.received.length === 1);
    expect(stamps).toEqual(["agent-1"]);

    ws.close();
    await until(() => held === 0);
    relay.close();
  });

  // TEST_SCENARIO: The stream client's socket carries the picture and the stream protocol's own traffic — it acknowledges frames many times a second — so nothing on it stamps last-activity; otherwise a forgotten panel would keep the agent's idle clock fresh forever. It still holds the agent awake while open, as any panel connection does.
  it("relays the stream socket without stamping activity", async () => {
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

    const { ws } = await open(
      `ws://127.0.0.1:${port}/api/public/browser-stream/agent-1/api/websockets?token=t`,
    );
    await until(() => agent.sockets.length === 1);
    expect(held).toBe(1);
    expect(agent.paths[0]).toBe("/api/browser/display");

    for (let i = 0; i < 5; i++) ws.send(`ACK ${i}`);
    await until(() => agent.received.length === 5);
    expect(stamps).toEqual([]);

    ws.close();
    await until(() => held === 0);
    relay.close();
  });
});
