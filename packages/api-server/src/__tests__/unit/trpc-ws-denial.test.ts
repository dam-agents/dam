// TEST_OVERVIEW: The tRPC WebSocket door authenticates on the connection's first frame. A refused bearer must reach the caller as a tRPC error on its own request, whatever the gap between that first frame and the request.
import { createServer, type Server } from "node:http";
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

async function refusingDoor(): Promise<number> {
  const endpoint = createTrpcWsEndpoint({
    authenticate: async () => ({ ok: false, kind: "unauthorized" }),
    surfaceAttribution: { uiClientId: "ui", cliClientId: "cli" },
    composeApiContext: () => {
      throw new Error("a refused connection composes no context");
    },
  });
  const server = createServer();
  servers.push(server);
  server.on("upgrade", (req, socket, head) =>
    endpoint.handleUpgrade(req, socket, head),
  );
  await new Promise<void>((r) => server.listen(0, r));
  return (server.address() as { port: number }).port;
}

async function connect(port: number) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/?connectionParams=1`);
  sockets.push(ws);
  const messages: { id: unknown; error?: { data?: { code?: string } } }[] = [];
  ws.on("message", (raw) => {
    const text = raw.toString();
    if (text !== "PING" && text !== "PONG") messages.push(JSON.parse(text));
  });
  const closed = new Promise<void>((r) => ws.once("close", () => r()));
  await new Promise<void>((res, rej) => {
    ws.once("open", res);
    ws.once("error", rej);
  });
  ws.send(
    JSON.stringify({ method: "connectionParams", data: { token: "bad" } }),
  );
  return { ws, messages, closed };
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("tRPC WebSocket door, refused bearer", () => {
  // TEST_SCENARIO: The first request arrives well after the connection params, as it can when a proxy splits the frames. The request still gets UNAUTHORIZED under its own id, and the connection closes after.
  it("answers a request that arrives after the refusal with the denial code", async () => {
    const { ws, messages, closed } = await connect(await refusingDoor());
    await pause(50);
    ws.send(
      JSON.stringify({
        id: 1,
        method: "query",
        params: { path: "terms.latestAcceptance", input: null },
      }),
    );
    await closed;
    const answer = messages.find((m) => m.id === 1);
    expect(answer?.error?.data?.code).toBe("UNAUTHORIZED");
  });

  // TEST_SCENARIO: A refused client that never sends a request is not held open; the door closes it within the grace period.
  it("closes a refused connection that sends no request", async () => {
    const { closed } = await connect(await refusingDoor());
    const outcome = await Promise.race([
      closed.then(() => "closed"),
      pause(2_000).then(() => "open"),
    ]);
    expect(outcome).toBe("closed");
  });
});
