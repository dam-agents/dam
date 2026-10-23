// TEST_OVERVIEW: The SSH relay differs from the other wake-gated relays in two ways: an SSH session is the user's own, so it takes the session presence hold as soon as the client connects, and the client's own traffic stamps the agent's activity once it is forwarded. Frames the client sends while the agent wakes are held, then forwarded in order.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";

import { createSshRelay } from "../../apps/api-server/agent-proxies/ssh-relay.js";
import type { AgentsRepository } from "../../modules/agents/infrastructure/agents-repository.js";
import { LAST_ACTIVITY_KEY } from "../../modules/agents/infrastructure/labels.js";
import type { SessionPresence } from "../../apps/api-server/agent-proxies/session-presence.js";

const closers: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

async function until(check: () => boolean, ms = 2_000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function harness() {
  const http = createServer();
  const wss = new WebSocketServer({ server: http });
  const received: string[] = [];
  wss.on("connection", (ws) =>
    ws.on("message", (d) => received.push(d.toString())),
  );
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
  const upstreamBase = `ws://127.0.0.1:${(http.address() as { port: number }).port}`;
  closers.push(() => {
    http.closeAllConnections();
    return new Promise<void>((r) => wss.close(() => http.close(() => r())));
  });

  let woken!: () => void;
  const wake = new Promise<void>((r) => (woken = r));
  const ensureReady = vi.fn(() => wake);
  const patchAnnotation = vi.fn(
    async (_id: string, _key: string, _value: string) => {},
  );
  const repo = {
    ensureReady,
    peekCached: () => undefined,
    patchAnnotation,
  } as unknown as AgentsRepository;

  let held = 0;
  const presence = {
    acquire: () => {
      held++;
      return () => {
        held--;
      };
    },
  } as unknown as SessionPresence;

  const relay = createSshRelay("ns", repo, presence, () => upstreamBase);
  const server = createServer();
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
  await new Promise<void>((r) => ws.once("open", () => r()));

  return {
    relay,
    ws,
    received,
    ensureReady,
    patchAnnotation,
    held: () => held,
    woken,
  };
}

describe("ssh relay", () => {
  it("holds presence from the client's connect, buffers, then forwards and stamps", async () => {
    const h = await harness();
    expect(h.held()).toBe(1);
    expect(h.ensureReady).toHaveBeenCalledWith("agent-a");

    h.ws.send("first");
    await new Promise((r) => setTimeout(r, 100));
    expect(h.received).toEqual([]);

    h.woken();
    await until(() => h.received.includes("first"));

    h.ws.send("second");
    await until(() => h.received.includes("second"));
    await until(() => h.patchAnnotation.mock.calls.length > 0);
    expect(h.patchAnnotation.mock.calls[0]![1]).toBe(LAST_ACTIVITY_KEY);

    h.ws.close();
    await until(() => h.held() === 0);
  });

  it("closes the client with 1001 on shutdown and releases presence", async () => {
    const h = await harness();
    const closed = new Promise<number>((r) => h.ws.once("close", (c) => r(c)));
    h.woken();
    h.ws.send("hello");
    await until(() => h.received.includes("hello"));
    h.relay.close();
    expect(await closed).toBe(1001);
    await until(() => h.held() === 0);
  });
});
