import { describe, it, expect, afterEach } from "vitest";
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

// TEST_OVERVIEW: The browser panel's stream page opens a socket beside itself, /api/public/browser-stream/<agent>/api/websockets, which the api-server relays to the agent's display stream. It reaches only an agent the caller owns, only one that requires named connections, keeps the agent awake while open like any panel, and its traffic never counts as activity.

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

describe("who reaches an agent's browser stream", () => {
  const owned = "agent-mine";
  const users: Record<string, { sub: string; agentIds: string[] | "*" }> = {
    alice: { sub: "alice", agentIds: "*" },
    "alice-key-for-other": { sub: "alice", agentIds: ["agent-other"] },
  };

  async function harness() {
    const relayed: string[] = [];
    const admission = createRelayAdmission({
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
      verifyOwner: async (agentId, user) =>
        user.sub === "alice" && agentId === owned,
      isTermsAccepted: async () => true,
      surfaceAttribution: { uiClientId: "platform-ui", cliClientId: "cli" },
    });
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
    } as unknown as Pick<AgentsRepository, "ensureReady">;
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
      relay.handleUpgrade(req, socket, head, "agent-1"),
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
});
