/**
 * TEST_OVERVIEW: When the Slack Socket Mode connection drops, the gateway
 * reconnects it itself. A reconnect that Slack refuses, such as
 * `apps.connections.open` answering `invalid_auth`, is logged and tried again
 * with a growing delay. It never becomes an unhandled rejection, which would
 * end the api-server process. Once Slack accepts the app token again, the
 * socket is back without a restart. These tests run the real Bolt App and
 * Socket Mode client against a local WebSocket server, with Slack's Web API
 * answered by a stubbed fetch.
 */
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocketServer } from "ws";
import { createBoltSlackGateway } from "../../modules/channels/infrastructure/bolt-slack-gateway.js";
import type { SlackGatewayHandlers } from "../../modules/channels/infrastructure/slack-gateway.js";

type OpenAnswer = "url" | "invalid_auth";

let server: WebSocketServer;
let socketUrl: string;
let connections: number;
let openAnswers: OpenAnswer[];
let openCalls: number;
let unhandled: unknown[];
let logged: string[];
const onUnhandled = (reason: unknown) => unhandled.push(reason);

function slackAnswer(body: object): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function nextConnection(): Promise<void> {
  return new Promise((resolve) => server.once("connection", () => resolve()));
}

function createGateway() {
  return createBoltSlackGateway({
    resolveBotToken: async () => "xoxb-test",
    importHelmToken: async () => {},
    renewTokens: async () => {},
    forgetBotToken: () => {},
    helmBotToken: null,
    appToken: "xapp-test",
    commandName: "/platform",
    onCredentialRejected: async () => {},
  });
}

function dropEverySocket() {
  for (const client of server.clients) client.terminate();
}

async function dropAndAwaitReconnectTimer() {
  dropEverySocket();
  await vi.waitFor(
    () =>
      expect(logged).toContain(
        "[slack] Socket Mode disconnected, reconnecting\n",
      ),
    { interval: 5 },
  );
}

async function advanceUntil(done: () => boolean): Promise<number> {
  let elapsedMs = 0;
  while (!done()) {
    if (elapsedMs >= 120_000) throw new Error("condition never held");
    await vi.advanceTimersByTimeAsync(100);
    elapsedMs += 100;
    await new Promise((resolve) => setImmediate(resolve));
  }
  return elapsedMs;
}

beforeEach(async () => {
  connections = 0;
  openCalls = 0;
  openAnswers = [];
  unhandled = [];
  logged = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    logged.push(String(chunk));
    return true;
  });
  process.on("unhandledRejection", onUnhandled);
  server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  socketUrl = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
  server.on("connection", (ws) => {
    connections += 1;
    ws.send(JSON.stringify({ type: "hello" }));
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      openCalls += 1;
      const answer = openAnswers.shift() ?? "url";
      return answer === "url"
        ? slackAnswer({ ok: true, url: socketUrl })
        : slackAnswer({ ok: false, error: answer });
    }),
  );
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  process.off("unhandledRejection", onUnhandled);
  dropEverySocket();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("Slack Socket Mode reconnect", () => {
  /**
   * TEST_SCENARIO: The socket drops, and Slack refuses the app token on the
   * reconnect. This is the crash seen in production: the Socket Mode client's
   * own reconnect left the refusal unhandled. Now the refusal is handled, and
   * a later reconnect opens the socket again.
   */
  it("leaves no unhandled rejection when a reconnect is refused", async () => {
    const gateway = createGateway();
    await gateway.start({} as SlackGatewayHandlers);

    openAnswers = ["invalid_auth"];
    dropEverySocket();
    await advanceUntil(() => openCalls === 2 || unhandled.length > 0);
    await new Promise((resolve) => setImmediate(resolve));
    expect(unhandled).toEqual([]);

    await advanceUntil(() => connections === 2 || unhandled.length > 0);
    expect(unhandled).toEqual([]);
    expect(connections).toBe(2);
    await gateway.stop();
  });

  /**
   * TEST_SCENARIO: Slack refuses the app token twice on reconnect, as in a
   * short Slack auth outage. The first reconnect runs 1 s after the drop, each
   * refusal is retried after a longer delay, 5 s and then 15 s, and the third
   * reconnect opens the socket.
   */
  it("retries a reconnect refused with invalid_auth until Slack accepts it", async () => {
    const gateway = createGateway();
    expect(await gateway.start({} as SlackGatewayHandlers)).toBe(true);
    expect(connections).toBe(1);

    openAnswers = ["invalid_auth", "invalid_auth"];
    await dropAndAwaitReconnectTimer();

    expect(await advanceUntil(() => openCalls === 2)).toBe(1_000);
    expect(await advanceUntil(() => openCalls === 3)).toBe(5_000);
    expect(connections).toBe(1);

    const reconnected = nextConnection();
    expect(await advanceUntil(() => openCalls === 4)).toBe(15_000);
    await reconnected;

    expect(openCalls).toBe(4);
    expect(connections).toBe(2);
    expect(unhandled).toEqual([]);
    await gateway.stop();
  });

  /**
   * TEST_SCENARIO: The gateway stops while a refused reconnect waits for its
   * next try. Nothing is tried after the stop, so a stopped gateway never
   * opens a socket again.
   */
  it("stops retrying once the gateway stops", async () => {
    const gateway = createGateway();
    await gateway.start({} as SlackGatewayHandlers);

    openAnswers = ["invalid_auth"];
    await dropAndAwaitReconnectTimer();
    await advanceUntil(() => openCalls === 2);

    await gateway.stop();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(openCalls).toBe(2);
    expect(connections).toBe(1);
    expect(unhandled).toEqual([]);
  });
});
