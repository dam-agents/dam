// TEST_OVERVIEW: For about a second after an agent's machine turns Ready, the mesh may not route to it yet, and the api-server's HTTP tRPC proxy cannot connect. The proxy tries the request again within about 2 seconds, but only when the agent cannot have run it twice: any request whose connection was refused, and a query (GET) whose connection was reset before an answer. A mutation whose connection was reset may have reached the agent, so it gets 502 at once. Once the agent has started an answer, nothing is retried.
import { afterEach, describe, expect, it } from "vitest";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Hono } from "hono";
import type { ApiVariables } from "../../apps/api-server/deps.js";
import { createAgentTrpcProxy } from "../../apps/api-server/agent-proxies/trpc-proxy.js";

const closers: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

async function listen(
  handle: (
    req: IncomingMessage,
    body: string,
    res: import("node:http").ServerResponse,
  ) => void,
  port = 0,
): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (d: Buffer) => (body += d.toString()));
    req.on("end", () => handle(req, body, res));
  });
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
  closers.push(() => {
    server.closeAllConnections();
    return new Promise<void>((r) => server.close(() => r()));
  });
  return { server, port: (server.address() as AddressInfo).port };
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((r) => server.close(() => r()));
  return port;
}

function proxyApp(port: number) {
  const app = new Hono<{ Variables: ApiVariables }>();
  app.use("*", async (c, next) => {
    c.set("user", {
      sub: "owner",
      preferredUsername: "owner",
      scopes: ["agents:operate"],
      agentIds: "*",
    });
    await next();
  });
  app.all(
    "/api/agents/:id/trpc/*",
    createAgentTrpcProxy({
      namespace: "ns",
      verifyOwner: async () => true,
      ensureReady: async () => undefined,
      upstreamBase: () => `http://127.0.0.1:${port}`,
    }),
  );
  return app;
}

const writeBody = JSON.stringify({ path: "x", content: "y" });
const write = (app: Hono<{ Variables: ApiVariables }>) =>
  app.request("/api/agents/a1/trpc/files.write", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(writeBody)),
    },
    body: writeBody,
  });

describe("agent tRPC proxy connect retry", () => {
  // TEST_SCENARIO: the agent's port refuses connections for 300 ms, as while the mesh catches up with a pod that just turned Ready. A mutation never reached the agent, so the proxy sends it again, with the same body, and returns the agent's answer.
  it("retries a refused mutation and replays its body", async () => {
    const port = await freePort();
    const app = proxyApp(port);
    const bodies: string[] = [];
    setTimeout(
      () =>
        void listen((_req, body, res) => {
          bodies.push(body);
          res.writeHead(200, { "content-type": "application/json" });
          res.end('{"result":{"data":"ok"}}');
        }, port),
      300,
    );
    const res = await write(app);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"result":{"data":"ok"}}');
    expect(bodies).toEqual([writeBody]);
  });

  // TEST_SCENARIO: the agent accepts the connection and closes it before it answers, twice. A query is retried and gets the third answer.
  it("retries a query whose connection was reset before an answer", async () => {
    let calls = 0;
    const { port } = await listen((req, _body, res) => {
      if (++calls <= 2) return req.socket.destroy();
      res.writeHead(200).end("answered");
    });
    const res = await proxyApp(port).request(
      "/api/agents/a1/trpc/sessions.list",
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("answered");
    expect(calls).toBe(3);
  });

  // TEST_SCENARIO: the agent accepts a mutation's connection and closes it before it answers. The agent may have run it, so the proxy does not send it again and answers 502.
  it("does not retry a mutation whose connection was reset", async () => {
    let calls = 0;
    const { port } = await listen((req) => {
      calls++;
      req.socket.destroy();
    });
    const res = await write(proxyApp(port));
    expect(res.status).toBe(502);
    expect(calls).toBe(1);
  });

  // TEST_SCENARIO: the agent sends its status and headers and then drops the connection. The answer has started, so the proxy passes it on as it is and never sends the request again.
  it("never retries once the answer has started", async () => {
    let calls = 0;
    const { port } = await listen((req, _body, res) => {
      calls++;
      res.writeHead(200, { "content-length": "100" });
      res.write("partial");
      setTimeout(() => req.socket.destroy(), 20);
    });
    const res = await proxyApp(port).request(
      "/api/agents/a1/trpc/sessions.list",
    );
    expect(res.status).toBe(200);
    await expect(res.text()).rejects.toThrow();
    expect(calls).toBe(1);
  });

  // TEST_SCENARIO: the agent never listens. The proxy gives up within its budget of about 2 seconds and answers 502.
  it("answers 502 once the retry budget is spent", async () => {
    const started = Date.now();
    const res = await proxyApp(await freePort()).request(
      "/api/agents/a1/trpc/sessions.list",
    );
    expect(res.status).toBe(502);
    expect(Date.now() - started).toBeGreaterThan(1_000);
    expect(Date.now() - started).toBeLessThan(2_500);
  });
});
