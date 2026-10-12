// TEST_OVERVIEW: An admitted tRPC WebSocket lives only as long as its credential. The door nudges the client to reconnect shortly before the credential expires and closes the socket at expiry. A connection admitted with less than the nudge lead left must not be nudged at once: the client would reconnect with the same token and be nudged again, in a tight loop until the token expires.
import { createServer, type Server } from "node:http";
import type { ApiContext } from "api-server-api";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import { createTrpcWsEndpoint } from "../../apps/api-server/trpc/ws.js";

const servers: Server[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.terminate();
  for (const s of servers.splice(0))
    await new Promise((r) => s.close(() => r(null)));
});

async function admit(expiresInMs: number) {
  const endpoint = createTrpcWsEndpoint({
    authenticate: async () => ({
      ok: true,
      principal: {
        user: { sub: "u1", preferredUsername: "u1", scopes: [], agentIds: [] },
        azp: "ui",
        roles: [],
        expiresAt: new Date(Date.now() + expiresInMs),
      },
    }),
    surfaceAttribution: { uiClientId: "ui", cliClientId: "cli" },
    composeApiContext: () => ({}) as ApiContext,
  });
  const server = createServer();
  servers.push(server);
  server.on("upgrade", (req, socket, head) =>
    endpoint.handleUpgrade(req, socket, head),
  );
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;

  const ws = new WebSocket(`ws://127.0.0.1:${port}/?connectionParams=1`);
  sockets.push(ws);
  const messages: { method?: string }[] = [];
  ws.on("message", (raw) => {
    const text = raw.toString();
    if (text !== "PING" && text !== "PONG") messages.push(JSON.parse(text));
  });
  const closed = new Promise<number>((r) =>
    ws.once("close", (code) => r(code)),
  );
  await new Promise<void>((res, rej) => {
    ws.once("open", res);
    ws.once("error", rej);
  });
  ws.send(JSON.stringify({ method: "connectionParams", data: { token: "t" } }));
  return { messages, closed };
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const nudges = (messages: { method?: string }[]) =>
  messages.filter((m) => m.method === "reconnect").length;

describe("tRPC WebSocket door, credential expiry", () => {
  // TEST_SCENARIO: The token has half a second left when the client connects, as it does when a background tab reconnects with a token its renew timer never refreshed. The door must not nudge; it closes the socket with 4401 when the token expires.
  it("does not nudge a connection admitted inside the nudge lead", async () => {
    const { messages, closed } = await admit(500);
    expect(await closed).toBe(4401);
    expect(nudges(messages)).toBe(0);
  });

  // TEST_SCENARIO: The token outlives the nudge lead by a fifth of a second. The door nudges the client once that margin has passed, before the token expires.
  it("nudges a connection once its credential nears expiry", async () => {
    const { messages } = await admit(30_200);
    await pause(50);
    expect(nudges(messages)).toBe(0);
    await pause(400);
    expect(nudges(messages)).toBe(1);
  });
});
