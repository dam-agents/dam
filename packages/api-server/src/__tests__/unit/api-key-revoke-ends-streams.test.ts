// TEST_OVERVIEW: An API key is checked when a stream opens. Revoking or expiring the key must also end the streams it already opened, on every long-lived door: the HTTP tRPC door (SSE), the tRPC WebSocket door and the agent relays.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import type { ApiContext, LiveEvent } from "api-server-api";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket, WebSocketServer } from "ws";

import type { Authenticate } from "../../apps/api-server/admission/auth.js";
import { createAuthMiddleware } from "../../apps/api-server/admission/auth-middleware.js";
import {
  createRelayAdmission,
  relayRoute,
} from "../../apps/api-server/agent-proxies/upgrade.js";
import { createTrpcHttpHandler } from "../../apps/api-server/trpc/http.js";
import { createTrpcWsEndpoint } from "../../apps/api-server/trpc/ws.js";
import type { ApiVariables } from "../../apps/api-server/deps.js";
import { createLiveEventsService } from "../../modules/live-events/services/live-events-service.js";

const servers: Server[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  vi.useRealTimers();
  for (const ws of sockets.splice(0)) ws.terminate();
  for (const s of servers.splice(0)) {
    s.closeAllConnections();
    await new Promise((r) => s.close(r));
  }
});

const attribution = { uiClientId: "ui", cliClientId: "cli" };

function apiKey() {
  const key = { revoked: false };
  const authenticate: Authenticate = async () =>
    key.revoked
      ? { ok: false, kind: "unauthorized" }
      : {
          ok: true,
          principal: {
            user: {
              sub: "owner-1",
              preferredUsername: "owner-1",
              scopes: ["agents:read", "agents:operate"],
              agentIds: "*",
              keyId: "key-1",
            },
            azp: "",
            roles: [],
          },
        };
  return { key, authenticate };
}

function liveEventsWithListeners() {
  const listeners = new Set<(event: LiveEvent) => void>();
  const liveEvents = createLiveEventsService({
    bus: {
      publish: () => {},
      subscribe: (_sub, listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  });
  return { listeners, liveEvents };
}

async function listen(server: Server): Promise<number> {
  servers.push(server);
  if (!server.listening)
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return (server.address() as AddressInfo).port;
}

function openSocket(url: string): Promise<WebSocket> {
  const ws = new WebSocket(url);
  sockets.push(ws);
  return new Promise((res, rej) => {
    ws.once("open", () => res(ws));
    ws.once("error", rej);
  });
}

const closeOf = (ws: WebSocket) =>
  new Promise<number>((r) => ws.once("close", (code) => r(code)));

describe("API key revocation and open streams", () => {
  // TEST_SCENARIO: A CLI holds the owner live-events stream open over HTTP with an API key, and the owner revokes that key. The stream must end on the next key re-check, and the subscription must leave the bus.
  it("ends an open events.owner SSE stream once its key is revoked", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { key, authenticate } = apiKey();
    const { listeners, liveEvents } = liveEventsWithListeners();
    const app = new Hono<{ Variables: ApiVariables }>();
    app.use("/api/*", createAuthMiddleware(authenticate, attribution));
    app.all(
      "/api/trpc/*",
      createTrpcHttpHandler({
        composeApiContext: (user) => ({ user, liveEvents }) as ApiContext,
      }),
    );
    const port = await listen(
      serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }) as Server,
    );

    const res = await fetch(`http://127.0.0.1:${port}/api/trpc/events.owner`, {
      headers: { authorization: "Bearer pk_test" },
    });
    expect(res.headers.get("content-type")).toMatch(/^text\/event-stream/);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    while (!text.includes('"sync"')) {
      text += decoder.decode((await reader.read()).value);
    }
    expect(listeners.size).toBe(1);

    key.revoked = true;
    await vi.advanceTimersByTimeAsync(10_000);

    const ended = await Promise.race([
      (async () => {
        for (;;) {
          const chunk = await reader.read().catch(() => ({ done: true }));
          if (chunk.done) return true;
        }
      })(),
      new Promise((r) => setTimeout(() => r(false), 2_000)),
    ]);
    expect(ended).toBe(true);
    await vi.waitFor(() => expect(listeners.size).toBe(0));
  });

  // TEST_SCENARIO: An integration holds the tRPC WebSocket open with an API key, and the key is revoked. The door must close the socket with the credential close code on the next key re-check, not wait for the periodic reconnect.
  it("closes a tRPC WebSocket once its key is revoked", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { key, authenticate } = apiKey();
    const { liveEvents } = liveEventsWithListeners();
    const endpoint = createTrpcWsEndpoint({
      authenticate,
      surfaceAttribution: attribution,
      composeApiContext: (user) =>
        ({
          user,
          liveEvents,
          terms: { isAccepted: async () => true },
        }) as unknown as ApiContext,
    });
    const server = createServer();
    server.on("upgrade", (req, socket, head) =>
      endpoint.handleUpgrade(req, socket, head),
    );
    const port = await listen(server);

    const ws = await openSocket(`ws://127.0.0.1:${port}/?connectionParams=1`);
    const closed = closeOf(ws);
    const firstEvent = new Promise<string>((r) =>
      ws.once("message", (raw) => r(raw.toString())),
    );
    ws.send(
      JSON.stringify({ method: "connectionParams", data: { token: "pk_x" } }),
    );
    ws.send(
      JSON.stringify({
        id: 1,
        method: "subscription",
        params: { path: "events.owner", input: null },
      }),
    );
    expect(await firstEvent).toContain('"started"');

    key.revoked = true;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await closed).toBe(4401);
  });

  // TEST_SCENARIO: A terminal or ACP relay is admitted once on upgrade with an API key, and the key is revoked. The relay socket must be cut on the next key re-check.
  it("cuts an agent relay socket once its key is revoked", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { key, authenticate } = apiKey();
    const wss = new WebSocketServer({ noServer: true });
    const route = relayRoute(
      createRelayAdmission({
        authenticate,
        verifyOwner: async () => true,
        isTermsAccepted: async () => true,
        surfaceAttribution: attribution,
      }),
      {
        handleUpgrade: (req, socket, head) =>
          wss.handleUpgrade(req, socket, head, () => {}),
      },
      "terminal",
    );
    const server = createServer();
    server.on("upgrade", (req, socket, head) => {
      const url = new URL(req.url!, "http://x");
      void route(req, socket, head, url, { id: "agent-1" });
    });
    const port = await listen(server);

    const ws = await openSocket(
      `ws://127.0.0.1:${port}/api/agents/agent-1/terminal?token=pk_x&passive=1`,
    );
    const closed = closeOf(ws);

    key.revoked = true;
    await vi.advanceTimersByTimeAsync(10_000);
    await closed;
  });
});
