// TEST_OVERVIEW: An Environment's runtime relays HTTP and WebSocket from its forward path to a port on its own loopback, and only to a port the api-server names as one of the Environment's endpoints: an undeclared port, the runtime's own ports and the browser display are refused, and the declared-ports header never reaches the app.
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import {
  createEnvironmentForward,
  DECLARED_PORTS_HEADER,
  FORWARD_PREFIX,
} from "../../modules/environment-forward.js";

const MODEL_ROUTER_PORT = 24180;
const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((s) => new Promise((r) => s.close(() => r(null)))),
  );
});

async function listen(server: http.Server): Promise<number> {
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return (server.address() as AddressInfo).port;
}

async function world(ownPort = 1) {
  const app = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        path: req.url,
        host: req.headers.host,
        ports: req.headers[DECLARED_PORTS_HEADER] ?? null,
      }),
    );
  });
  const wss = new WebSocketServer({ server: app });
  wss.on("connection", (ws) => ws.on("message", (d) => ws.send(`echo:${d}`)));
  const appPort = await listen(app);

  const forward = createEnvironmentForward({ ownPorts: [ownPort] });
  const runtime = http.createServer((req, res) => {
    if (!forward.handleRequest(req, res)) res.writeHead(404).end();
  });
  runtime.on("upgrade", (req, socket, head) => {
    if (!forward.handleUpgrade(req, socket, head)) socket.destroy();
  });
  const runtimePort = await listen(runtime);
  return { appPort, runtimePort };
}

async function get(port: number, path: string, declared: string) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    headers: { [DECLARED_PORTS_HEADER]: declared },
  });
  return { status: res.status, body: await res.text() };
}

describe("the Environment forward", () => {
  // TEST_SCENARIO: a request for a declared port reaches that port on loopback with its path and query, as if the app were served at the root; the declared-ports header is the runtime's, so the app never sees it.
  it("relays a request to a declared port on loopback", async () => {
    const { appPort, runtimePort } = await world();

    const res = await get(
      runtimePort,
      `${FORWARD_PREFIX}${appPort}/a/b?c=1`,
      `80,${appPort}`,
    );

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      path: "/a/b?c=1",
      host: `127.0.0.1:${appPort}`,
      ports: null,
    });
  });

  // TEST_SCENARIO: a port the Environment did not declare, the runtime's own port, the browser display and a path that is no port are all refused before anything is dialled.
  it("refuses an undeclared port and the runtime's own ports", async () => {
    const { appPort, runtimePort } = await world(MODEL_ROUTER_PORT);

    expect(
      (await get(runtimePort, `${FORWARD_PREFIX}${appPort}/`, "81")).status,
    ).toBe(403);
    expect(
      (
        await get(
          runtimePort,
          `${FORWARD_PREFIX}${MODEL_ROUTER_PORT}/`,
          String(MODEL_ROUTER_PORT),
        )
      ).body,
    ).toMatch(/runtime's own/);
    expect(
      (await get(runtimePort, `${FORWARD_PREFIX}5999/`, "5999")).status,
    ).toBe(403);
    expect((await get(runtimePort, `${FORWARD_PREFIX}x/`, "80")).status).toBe(
      403,
    );
  });

  // TEST_SCENARIO: a declared port nothing listens on answers 502, not a hang.
  it("answers 502 when nothing listens on a declared port", async () => {
    const { runtimePort } = await world();
    const closed = await listen(http.createServer());
    await new Promise((r) => servers.pop()!.close(() => r(null)));

    const res = await get(
      runtimePort,
      `${FORWARD_PREFIX}${closed}/`,
      String(closed),
    );
    expect(res.status).toBe(502);
  });

  // TEST_SCENARIO: a WebSocket to a declared port is relayed both ways, so an app's live updates work at its address.
  it("relays a WebSocket to a declared port", async () => {
    const { appPort, runtimePort } = await world();

    const ws = new WebSocket(
      `ws://127.0.0.1:${runtimePort}${FORWARD_PREFIX}${appPort}/live`,
      { headers: { [DECLARED_PORTS_HEADER]: String(appPort) } },
    );
    const reply = await new Promise<string>((resolve, reject) => {
      ws.on("open", () => ws.send("hi"));
      ws.on("message", (d) => resolve(String(d)));
      ws.on("error", reject);
    });
    ws.close();
    expect(reply).toBe("echo:hi");
  });
});
