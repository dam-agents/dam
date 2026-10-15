import { describe, it, expect, afterEach, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import {
  createBrowserStreamRelay,
  requiresConnectionAddress,
} from "../../apps/api-server/agent-proxies/browser-stream-relay.js";
import {
  createRelayAdmission,
  createUpgradeHandler,
  relayRoute,
  type RelayAdmission,
} from "../../apps/api-server/agent-proxies/upgrade.js";
import type { AgentsRepository } from "../../modules/agents/infrastructure/agents-repository.js";
import type { SessionPresence } from "../../apps/api-server/agent-proxies/session-presence.js";

const securityLog = vi.hoisted(() => vi.fn());
vi.mock("../../core/security-log.js", () => ({ securityLog }));

// TEST_OVERVIEW: The browser panel's stream page opens a socket beside itself, /api/public/browser-stream/<agent>/api/websockets, which the api-server relays to the agent's display stream. It reaches only an agent the caller owns, only one that requires named connections, keeps the agent awake while open like any panel, and its traffic never counts as activity. It opens the agent's end once the agent is ready, or, on a wake from hibernation, once the agent answers its health check while its gateway is ready.

const STREAM_ROUTE = "/api/public/browser-stream/:id/api/websockets";
const UPSTREAM_PATH = "/api/browser/display";

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
  const state = { healthy: false };
  const http = createServer((req, res) => {
    res.writeHead(req.url === "/healthz" && state.healthy ? 200 : 503);
    res.end();
  });
  const wss = new WebSocketServer({ server: http });
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
  closers.push(() => {
    http.closeAllConnections();
    return new Promise<void>((r) => wss.close(() => http.close(() => r())));
  });
  const paths: string[] = [];
  const received: string[] = [];
  const sockets: WebSocket[] = [];
  wss.on("connection", (ws, req) => {
    sockets.push(ws);
    paths.push(req.url ?? "");
    ws.on("message", (d) => received.push(d.toString()));
  });
  return {
    base: `ws://127.0.0.1:${(http.address() as { port: number }).port}`,
    paths,
    received,
    sockets,
    state,
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

function statusOf(port: number, path: string) {
  return new Promise<number | undefined>((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
    ws.on("error", () => resolve(undefined));
    ws.once("unexpected-response", (_req, res) => resolve(res.statusCode));
  });
}

async function until(check: () => boolean, ms = 2_000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}

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

const owned = "agent-mine";
const users: Record<string, { sub: string; agentIds: string[] | "*" }> = {
  alice: { sub: "alice", agentIds: "*" },
  "alice-key-for-other": { sub: "alice", agentIds: ["agent-other"] },
};

function aliceAdmission() {
  return createRelayAdmission({
    authenticate: async (token) => {
      const u = token ? users[token] : undefined;
      if (!u) return { ok: false, kind: "unauthorized" };
      return {
        ok: true,
        principal: {
          user: {
            sub: u.sub,
            preferredUsername: u.sub,
            scopes: ["agents:operate"],
            agentIds: u.agentIds,
          },
          azp: "platform-ui",
          roles: [],
        },
      } as never;
    },
    verifyOwner: async (agentId, sub) => sub === "alice" && agentId === owned,
    isTermsAccepted: async () => true,
    surfaceAttribution: { uiClientId: "platform-ui", cliClientId: "cli" },
  });
}

describe("who reaches an agent's browser stream", () => {
  async function harness() {
    const relayed: string[] = [];
    const admission = aliceAdmission();
    const handler = createUpgradeHandler({
      [STREAM_ROUTE]: relayRoute(
        admission,
        {
          handleUpgrade: (_req, socket, _head, agentId) => {
            relayed.push(agentId);
            socket.end("HTTP/1.1 418 Relayed\r\n\r\n");
          },
        },
        "browser",
        async () => true,
      ),
    });
    const server = createServer();
    server.on(
      "upgrade",
      (req, socket, head) => void handler(req, socket, head),
    );
    const port = await listen(server);
    return { relayed, status: (path: string) => statusOf(port, path) };
  }

  const stream = (agent: string, token?: string) =>
    `/api/public/browser-stream/${agent}/api/websockets${token ? `?token=${token}` : ""}`;

  // TEST_SCENARIO: a signed-in user who owns one agent tries to open another agent's stream by putting that agent's id in the path. Admission checks ownership of exactly the agent the path names, and that one id is what the relay dials, so the request is refused (404, which does not reveal whether the agent exists) before anything is relayed. A path that smuggles another id behind an encoded separator is refused the same way, and the user's own agent still opens.
  it("relays only to an agent the caller owns", async () => {
    const { relayed, status } = await harness();
    expect(await status(stream("agent-other", "alice"))).toBe(404);
    expect(
      await status(
        stream(encodeURIComponent("agent-mine/../agent-other"), "alice"),
      ),
    ).toBe(404);
    expect(relayed).toEqual([]);

    expect(await status(stream(owned, "alice"))).toBe(418);
    expect(relayed).toEqual([owned]);
  });

  // TEST_SCENARIO: no token, a token the platform does not accept, or an API key bound to a different agent than the one the path names: none reaches the relay.
  it("refuses a missing or foreign token and a key bound to another agent", async () => {
    const { relayed, status } = await harness();
    expect(await status(stream(owned))).toBe(401);
    expect(await status(stream(owned, "nobody"))).toBe(401);
    expect(await status(stream(owned, "alice-key-for-other"))).toBe(403);
    expect(relayed).toEqual([]);
  });
});

describe("browser stream relay", () => {
  // TEST_SCENARIO: An owner who passes admission is still refused the stream of an agent without addressed injection, with 403 and before any relay work starts.
  it("refuses an agent that does not require connection addresses", async () => {
    const admitted: RelayAdmission = async () => ({
      ok: true,
      user: { sub: "u" } as never,
      surface: "web",
      attached: () => {},
      watchKey: () => () => {},
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
    expect(
      await statusOf(port, "/api/public/browser-stream/a/api/websockets"),
    ).toBe(403);
    expect(relayed).toBe(false);
  });

  // TEST_SCENARIO: The stream socket is relayed to the path it was created with — the agent's display stream — in both directions, untouched and without the caller's query, where the user's token rides. It holds the agent awake while open, and none of its traffic, which acknowledges frames many times a second, stamps last activity.
  it("relays the stream to its upstream path, holding presence and stamping nothing", async () => {
    const agent = await fakeAgent();
    let held = 0;
    let ensured = 0;
    const repo = {
      ensureReady: async () => {
        ensured++;
      },
      peekCached: () => null,
    } as unknown as Pick<AgentsRepository, "ensureReady" | "peekCached">;
    const presence = {
      acquire: () => {
        held++;
        return () => {
          held--;
        };
      },
    } as unknown as SessionPresence;
    const relay = createBrowserStreamRelay(
      "ns",
      repo,
      presence,
      UPSTREAM_PATH,
      () => agent.base,
    );
    closers.push(() => relay.close());
    const server = createServer();
    server.on("upgrade", (req, socket, head) =>
      relay.handleUpgrade(req, socket, head, "agent-1", {
        sub: "u",
        surface: "web",
        attached: () => {},
      }),
    );
    const port = await listen(server);

    const { ws, messages } = await open(
      `ws://127.0.0.1:${port}/api/public/browser-stream/agent-1/api/websockets?token=secret`,
    );
    await until(() => agent.sockets.length === 1);
    expect(ensured).toBe(1);
    expect(held).toBe(1);
    expect(agent.paths).toEqual([UPSTREAM_PATH]);

    for (let i = 0; i < 5; i++) ws.send(`ACK ${i}`);
    await until(() => agent.received.length === 5);
    agent.sockets[0]!.send("frame");
    await until(() => messages.includes("frame"));

    ws.close();
    await until(() => held === 0);
  });

  // TEST_SCENARIO: Selkies' web client reconnects by itself whenever its socket closes, as it does when the user puts the agent to sleep. Its reconnect must not wake the agent: the hold only waits out a wake asked for elsewhere, and the presence hold, which alone would wake the agent, is taken only once the agent's end is open.
  it("never wakes the agent, and holds presence only once the stream opens", async () => {
    const agent = await fakeAgent();
    const asked: unknown[] = [];
    let wake!: () => void;
    const repo = {
      ensureReady: (_id: string, opts: unknown) => {
        asked.push(opts);
        return new Promise<void>((r) => (wake = r));
      },
      peekCached: () => null,
    } as unknown as Pick<AgentsRepository, "ensureReady" | "peekCached">;
    let held = 0;
    const presence = {
      acquire: () => {
        held++;
        return () => {
          held--;
        };
      },
    } as unknown as SessionPresence;
    const relay = createBrowserStreamRelay(
      "ns",
      repo,
      presence,
      UPSTREAM_PATH,
      () => agent.base,
    );
    closers.push(() => relay.close());
    const server = createServer();
    server.on("upgrade", (req, socket, head) =>
      relay.handleUpgrade(req, socket, head, "agent-1", {
        sub: "u",
        surface: "web",
        attached: () => {},
      }),
    );
    const port = await listen(server);

    const { ws } = await open(
      `ws://127.0.0.1:${port}/api/public/browser-stream/agent-1/api/websockets`,
    );
    await until(() => asked.length === 1);
    expect(asked).toEqual([{ waitOnly: true }]);
    await new Promise((r) => setTimeout(r, 50));
    expect(held).toBe(0);

    wake();
    await until(() => held === 1);
    ws.close();
    await until(() => held === 0);
  });

  // TEST_SCENARIO: The relay.attach security log marks the moment the agent's end opens, not the moment the browser connects, so on a wake it reads the wake's real length. Nothing is logged while the agent wakes; once its stream opens, one attach is logged with the time since the browser connected.
  it("logs the attach once the agent's end opens", async () => {
    const agent = await fakeAgent();
    let wake!: () => void;
    const repo = {
      ensureReady: () => new Promise<void>((r) => (wake = r)),
      peekCached: () => null,
    } as unknown as Pick<AgentsRepository, "ensureReady" | "peekCached">;
    const presence = {
      acquire: () => () => {},
    } as unknown as SessionPresence;
    const relay = createBrowserStreamRelay(
      "ns",
      repo,
      presence,
      UPSTREAM_PATH,
      () => agent.base,
    );
    closers.push(() => relay.close());
    const handler = createUpgradeHandler({
      [STREAM_ROUTE]: relayRoute(
        aliceAdmission(),
        relay,
        "browser",
        async () => true,
      ),
    });
    const server = createServer();
    server.on(
      "upgrade",
      (req, socket, head) => void handler(req, socket, head),
    );
    const port = await listen(server);
    const attaches = () =>
      securityLog.mock.calls.filter(([, event]) => event === "relay.attach");
    securityLog.mockClear();

    await open(
      `ws://127.0.0.1:${port}/api/public/browser-stream/${owned}/api/websockets?token=alice`,
    );
    await until(() => wake !== undefined);
    await new Promise((r) => setTimeout(r, 50));
    expect(attaches()).toEqual([]);

    wake();
    await until(() => attaches().length === 1);
    expect(agent.sockets).toHaveLength(1);
    expect(attaches()[0]![2]).toMatchObject({
      actor: "alice",
      agentId: owned,
      result: "success",
      detail: { relay: "browser", sinceConnectMs: expect.any(Number) },
    });
  });

  // TEST_SCENARIO: Ready reaches the api-server only after a full controller reconcile, about half a second after the guest answers. On a wake from hibernation, the stream opens its upstream as soon as the agent answers its health check while its gateway is ready, without waiting for Ready.
  it("opens the stream on a wake from hibernation once the agent answers its health check with its gateway ready", async () => {
    const agent = await fakeAgent();
    const repo = {
      ensureReady: () => new Promise<void>(() => {}),
      peekCached: () => ({ hibernated: true, gatewayPodReady: true }),
    } as unknown as Pick<AgentsRepository, "ensureReady" | "peekCached">;
    const relay = createBrowserStreamRelay(
      "ns",
      repo,
      { acquire: () => () => {} } as unknown as SessionPresence,
      UPSTREAM_PATH,
      () => agent.base,
    );
    closers.push(() => relay.close());
    const server = createServer();
    server.on("upgrade", (req, socket, head) =>
      relay.handleUpgrade(req, socket, head, "agent-1", {
        sub: "u",
        surface: "web",
        attached: () => {},
      }),
    );
    const port = await listen(server);

    const { ws } = await open(
      `ws://127.0.0.1:${port}/api/public/browser-stream/agent-1/api/websockets`,
    );
    ws.send("first");
    await new Promise((r) => setTimeout(r, 250));
    expect(agent.sockets).toHaveLength(0);
    agent.state.healthy = true;
    await until(() => agent.received.includes("first"));
  });
});
