import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { keepAlive } from "../../apps/api-server/agent-proxies/heartbeat.js";

const PING_INTERVAL_MS = 30_000;

let server: Server;
let port: number;
let serverSide: WebSocket;
const sockets: WebSocket[] = [];

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const wss = new WebSocketServer({ noServer: true });
  server = createServer();
  server.on("upgrade", (req, socket, head) =>
    wss.handleUpgrade(req, socket, head, (ws) => {
      serverSide = ws;
      keepAlive(ws);
    }),
  );
  await new Promise<void>((r) => server.listen(0, r));
  port = (server.address() as { port: number }).port;
});

afterEach(async () => {
  vi.useRealTimers();
  for (const ws of sockets.splice(0)) ws.terminate();
  await new Promise((r) => server.close(() => r(null)));
});

async function connect(autoPong = true) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/`, { autoPong });
  sockets.push(ws);
  await new Promise<void>((res, rej) => {
    ws.once("open", res);
    ws.once("error", rej);
  });
  return ws;
}

const next = (ws: WebSocket, event: "ping" | "pong" | "close") =>
  new Promise<void>((r) => ws.once(event, () => r()));

describe("keepAlive", () => {
  // TEST_SCENARIO: a session that sits quiet sends no frames, so without a ping a network that cuts idle connections drops it. A client that answers each ping stays connected however long it is quiet.
  it("pings a quiet client every 30 seconds and keeps it open while it answers", async () => {
    const ws = await connect();

    for (let i = 0; i < 3; i++) {
      const pong = next(serverSide, "pong");
      vi.advanceTimersByTime(PING_INTERVAL_MS);
      await pong;
    }

    expect(ws.readyState).toBe(WebSocket.OPEN);
  });

  // TEST_SCENARIO: a client whose network went away cannot send a close frame. It is terminated once it leaves a ping unanswered, so its session presence is released.
  it("terminates a client that leaves a ping unanswered", async () => {
    const ws = await connect(false);
    const closed = new Promise<number>((r) =>
      ws.once("close", (code) => r(code)),
    );

    const ping = next(ws, "ping");
    vi.advanceTimersByTime(PING_INTERVAL_MS);
    await ping;
    vi.advanceTimersByTime(PING_INTERVAL_MS);

    expect(await closed).toBe(1006);
  });

  it("stops pinging once the client has closed", async () => {
    const ws = await connect();
    const serverClosed = next(serverSide, "close");
    ws.close();
    await serverClosed;

    expect(vi.getTimerCount()).toBe(0);
  });
});
