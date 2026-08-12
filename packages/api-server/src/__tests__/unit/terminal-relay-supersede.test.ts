import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { WebSocket } from "ws";
import { createTerminalRelay } from "../../apps/api-server/agent-proxies/terminal-relay.js";
import type { AgentsRepository } from "../../modules/agents/infrastructure/agents-repository.js";
import type { SessionPresence } from "../../apps/api-server/agent-proxies/session-presence.js";
import type { RedisBus, BusListener } from "../../core/redis-bus.js";

/** In-process stand-in for Redis pub/sub, shared by both "replicas". */
function fakeBus(): RedisBus {
  const listeners = new Map<string, Set<BusListener>>();
  return {
    async publish(channel, payload) {
      for (const fn of listeners.get(channel) ?? []) fn(payload);
    },
    subscribe(channel, listener) {
      let set = listeners.get(channel);
      if (!set) listeners.set(channel, (set = new Set()));
      set.add(listener);
      return () => set!.delete(listener);
    },
    async close() {},
  };
}

// Never resolves: the upstream agent pod is out of scope here. The client is
// registered as active before the dial, which is the behaviour under test.
const repo = {
  ensureReady: () => new Promise<void>(() => {}),
  patchAnnotation: async () => {},
} as unknown as AgentsRepository;

const presence = { acquire: () => () => {} } as unknown as SessionPresence;

const servers: Server[] = [];
const sockets: WebSocket[] = [];

/** A relay behind a real HTTP server — one api-server replica. */
async function replica(bus?: RedisBus) {
  const relay = createTerminalRelay("ns", repo, presence, bus);
  const server = createServer();
  servers.push(server);
  server.on("upgrade", (req, socket, head) => {
    const agentId = new URL(req.url!, "http://x").searchParams.get("agentId")!;
    relay.handleUpgrade(req, socket, head, agentId);
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;
  return {
    relay,
    attach: async (agentId: string, sessionId?: string) => {
      const qs = sessionId ? `&sessionId=${sessionId}` : "";
      const ws = new WebSocket(
        `ws://127.0.0.1:${port}/?agentId=${agentId}${qs}`,
      );
      sockets.push(ws);
      await new Promise<void>((res, rej) => {
        ws.once("open", res);
        ws.once("error", rej);
      });
      return ws;
    },
  };
}

/** Resolves to the close code, or null if the socket is still open. */
function closedWithin(ws: WebSocket, ms: number): Promise<number | null> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) return resolve(1000);
    const timer = setTimeout(() => resolve(null), ms);
    ws.once("close", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.terminate();
  for (const s of servers.splice(0))
    await new Promise((r) => s.close(() => r(null)));
});

describe("terminal relay supersede", () => {
  it("evicts a client attached to another replica", async () => {
    const bus = fakeBus();
    const a = await replica(bus);
    const b = await replica(bus);

    const first = await a.attach("agent-1", "s1");
    // Nothing pins a browser to the replica its earlier tab used, so the
    // second attach commonly lands elsewhere. One PTY admits one client — if
    // this doesn't evict, both tabs interleave input into the same terminal.
    await b.attach("agent-1", "s1");

    expect(await closedWithin(first, 1000)).toBe(1000);
  });

  it("does not evict a different agent's session with the same id", async () => {
    const bus = fakeBus();
    const a = await replica(bus);

    // Both default to sessionId "default". Keyed on the session id alone,
    // agent-2 would knock agent-1's terminal offline.
    const one = await a.attach("agent-1");
    const two = await a.attach("agent-2");

    expect(await closedWithin(one, 300)).toBeNull();
    expect(await closedWithin(two, 300)).toBeNull();
  });

  it("still evicts a second attach for the same agent and session", async () => {
    const a = await replica(fakeBus());

    const first = await a.attach("agent-1", "s1");
    await a.attach("agent-1", "s1");

    expect(await closedWithin(first, 1000)).toBe(1000);
  });
});
