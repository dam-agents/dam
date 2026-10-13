// TEST_OVERVIEW: The per-agent tRPC relay holds a browser's socket while the agent wakes, so the session list can be asked for at the click. It never wakes an agent itself: one that is hibernated with no wake asked for is refused as before. While it holds, it answers the client's keep-alive, and it forwards what the client sent once the agent is ready. A wake that fails closes the socket with the wake's cause.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";

import { createAgentTrpcRelay } from "../../apps/api-server/agent-proxies/agent-trpc-relay.js";
import { AgentStoppedError } from "../../modules/agents/domain/agent-stopped.js";
import { AgentWakeTimeoutError } from "../../modules/agents/domain/wake-failure.js";
import {
  type InfraAgent,
  parseInfraAgent,
} from "../../modules/agents/infrastructure/agent-mappers.js";
import { LAST_ACTIVITY_KEY } from "../../modules/agents/infrastructure/labels.js";

const closers: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

async function fakeAgent() {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise<void>((r) => wss.once("listening", () => r()));
  closers.push(() => new Promise<void>((r) => wss.close(() => r())));
  const received: string[] = [];
  wss.on("connection", (ws) =>
    ws.on("message", (d) => received.push(d.toString())),
  );
  return {
    base: `ws://127.0.0.1:${(wss.address() as { port: number }).port}`,
    received,
  };
}

function deferred() {
  let resolve!: () => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function harness(agent: Partial<InfraAgent> | null) {
  const upstream = await fakeAgent();
  const wake = deferred();
  const ensureReady = vi.fn(() => wake.promise);
  const repo = {
    get: vi.fn(async () => agent as InfraAgent | null),
    ensureReady,
    patchAnnotation: vi.fn(async () => {}),
  };
  const relay = createAgentTrpcRelay("ns", repo, () => upstream.base);
  const server: Server = createServer();
  server.on("upgrade", (req, socket, head) =>
    relay.handleUpgrade(req, socket, head, "agent-a", {
      sub: "u",
      surface: "web",
      attached: () => {},
    }),
  );
  await new Promise<void>((r) => server.listen(0, r));
  closers.push(() => new Promise<void>((r) => server.close(() => r())));
  const ws = new WebSocket(
    `ws://127.0.0.1:${(server.address() as { port: number }).port}/`,
  );
  closers.push(() => ws.terminate());
  const messages: string[] = [];
  ws.on("message", (d) => messages.push(d.toString()));
  const closed = new Promise<{ code: number; reason: string }>((r) =>
    ws.once("close", (code, reason) => r({ code, reason: reason.toString() })),
  );
  await new Promise<void>((r) => ws.once("open", () => r()));
  return { ws, messages, closed, upstream, wake, ensureReady };
}

async function until(check: () => boolean, ms = 2_000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("a wake asked for after hibernation", () => {
  const hibernatedAt = "2026-10-13T10:00:00Z";
  const parse = (lastActivity: string) =>
    parseInfraAgent({
      metadata: {
        name: "agent-a",
        annotations: { [LAST_ACTIVITY_KEY]: lastActivity },
      },
      spec: { name: "a" },
      status: {
        conditions: [
          {
            type: "Ready",
            status: "False",
            reason: "Hibernated",
            lastTransitionTime: hibernatedAt,
          },
        ],
      },
    } as Parameters<typeof parseInfraAgent>[0]);

  it("is read from activity newer than the hibernation", () => {
    expect(parse("2026-10-13T10:05:00Z").wakeRequested).toBe(true);
    expect(parse("2026-10-13T09:55:00Z").wakeRequested).toBeUndefined();
  });
});

describe("agent tRPC relay during a wake", () => {
  it("refuses a hibernated agent nobody asked to wake, and wakes nothing", async () => {
    const h = await harness({ hibernated: true });
    expect(await h.closed).toEqual({ code: 1011, reason: "agent not ready" });
    expect(h.ensureReady).not.toHaveBeenCalled();
  });

  it("holds while a wake is in flight, answers keep-alive, then forwards", async () => {
    const h = await harness({ hibernated: true, wakeRequested: true });
    h.ws.send('{"id":1,"method":"query","params":{"path":"sessions.list"}}');
    h.ws.send("PING");
    await until(() => h.messages.includes("PONG"));
    expect(h.upstream.received).toEqual([]);
    h.wake.resolve();
    await until(() => h.upstream.received.length === 1);
    expect(h.upstream.received[0]).toContain("sessions.list");
  });

  it("holds a starting agent the same way", async () => {
    const h = await harness({ hibernated: false, ready: false });
    h.ws.send("first");
    h.wake.resolve();
    await until(() => h.upstream.received.includes("first"));
  });

  it("closes with the wake's cause when the wake fails", async () => {
    const h = await harness({ hibernated: false });
    h.wake.reject(
      new AgentWakeTimeoutError({
        agentId: "agent-a",
        timeoutMs: 120_000,
        durationMs: 120_000,
        failure: { kind: "agent-pod-not-ready" },
      }),
    );
    const { code, reason } = await h.closed;
    expect(code).toBe(1011);
    expect(reason).toBe("agent not ready: agent-pod-not-ready");
  });

  it("refuses a stopped agent as before", async () => {
    const h = await harness({ hibernated: false });
    h.wake.reject(new AgentStoppedError("agent-a"));
    expect(await h.closed).toEqual({ code: 1011, reason: "agent not ready" });
  });
});
