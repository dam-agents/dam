// TEST_OVERVIEW: The Environment gate while an Environment is asleep, waking or its app not ready yet. A page load wakes a sleeping Environment and gets the "Starting…" loading page at once, with status 503, `Retry-After` and no caching; the page asks the gate's status under `/.platform/`, which says starting until the endpoint is ready and refreshes the Environment's activity as any request does. Every other request, a script's call or a WebSocket, gets a plain 503 with `Retry-After` while the machine wakes, never HTML or a 200; once the machine runs, every request but a page load goes to the app as it is, so the gate never stands in for a script or an API answer of an app that is up. An endpoint is ready once its readiness path answers 2xx or 3xx, or without one once anything but a proxy's 502, 503 or 504 answers on its port, as a bridge or an ingress answers in front of an app still starting; an app's own 500 still counts as an answer. A wake that fails ends on "did not start", with one button that tries again. A page load to an endpoint without a readiness path goes to the app with no probe first, and its own answer decides.
import http from "node:http";
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import type { EnvironmentRecord } from "../../modules/environments/domain/environment.js";
import type { EnvironmentSession } from "../../modules/environments/domain/gate.js";
import { createEnvironmentGate } from "../../modules/environments/gate/environment-gate.js";

const DOMAIN = "env.test";
const HOST = `app-pr-1-abcdef.${DOMAIN}`;
const COOKIE = "platform-env=s1";
const PAGE = {
  accept: "text/html",
  "sec-fetch-mode": "navigate",
  cookie: COOKIE,
};
const UNREACHABLE = "x-platform-environment-unreachable";
const closers: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

// UNIT_BOUNDARY_DESCRIPTION: a gate in front of one Environment whose machine and app the test drives: `sleeping` makes the next wake wait until `wake()` or `failWake()`, `listening` says whether anything answers on the endpoint's port, `proxyWaiting` makes what answers there a proxy with nothing behind it yet, and `healthy` whether its readiness path answers 200.
async function world(opts: { ready?: string } = {}) {
  const app = {
    listening: false,
    healthy: false,
    proxyWaiting: null as null | 502 | 503 | 504,
  };
  const probes: string[] = [];
  const relayed: string[] = [];
  const runtime = http.createServer((req, res) => {
    const path = req.url!.replace(/^\/api\/environment\/forward\/4444/, "");
    if (!app.listening) {
      res.writeHead(502, { [UNREACHABLE]: "1" }).end("nothing answers");
      return;
    }
    if (path === "/healthz") {
      probes.push(`${req.method} ${path}`);
      res.writeHead(app.healthy ? 200 : 503).end();
      return;
    }
    if (req.method === "HEAD") probes.push(`HEAD ${path}`);
    else relayed.push(path);
    if (app.proxyWaiting !== null) {
      res.writeHead(app.proxyWaiting).end("no available server");
      return;
    }
    res.writeHead(path === "/broken" ? 500 : 200).end("from the app");
  });
  new WebSocketServer({ server: runtime });
  await new Promise<void>((r) => runtime.listen(0, "127.0.0.1", r));
  closers.push(() => new Promise((r) => runtime.close(() => r())));
  const runtimePort = (runtime.address() as AddressInfo).port;

  const record: EnvironmentRecord = {
    agentId: "agent-pr-1",
    owningAgentId: "agent-owning",
    owner: "owner-sub",
    name: "pr-1",
    host: "pr-1-abcdef",
    endpoints: [
      { name: "app", port: 4444, ...(opts.ready ? { ready: opts.ready } : {}) },
    ],
    expiresAt: new Date(Date.now() + 86_400_000),
    createdAt: new Date(),
  };
  const session: EnvironmentSession = {
    sub: "owner-sub",
    email: "owner@example.com",
    address: "app-pr-1-abcdef",
    shareSession: "share-1",
    createdAt: Date.now(),
  };
  const machine = {
    sleeping: false,
    wakes: 0,
    pending: null as null | { resolve: () => void; reject: (e: Error) => void },
  };
  const stamped: string[] = [];
  const gate = createEnvironmentGate({
    domain: DOMAIN,
    scheme: "http",
    frontDoorUrl: () => "http://share.test/e/x",
    signOutUrl: () => "http://share.test/out",
    repo: { getByHost: async (h) => (h === record.host ? record : null) },
    agentMembers: async () => [],
    environmentMembers: async () => [],
    editorsOf: async () => [],
    signIn: {
      redeemHandoff: async () => null,
      session: async (id) => (id === "s1" ? session : null),
      signOut: async () => {},
    },
    platform: { issuers: [], isApiKey: () => false },
    ensureReady: async (_id, { onWaking }) => {
      if (!machine.sleeping) return;
      machine.wakes += 1;
      onWaking();
      await new Promise<void>((resolve, reject) => {
        machine.pending = { resolve, reject };
      });
    },
    stampActivity: async (id) => void stamped.push(id),
    upstream: () => ({ host: "127.0.0.1", port: runtimePort }),
    brandName: "Test",
    readinessRetryMs: 0,
  });
  const hono = new Hono();
  hono.use("*", gate.middleware);
  const server = serve({ fetch: hono.fetch, port: 0 }) as http.Server;
  server.on("upgrade", (req, socket, head) => {
    if (!gate.handleUpgrade(req, socket, head)) socket.destroy();
  });
  await new Promise<void>((r) =>
    server.listening ? r() : server.once("listening", () => r()),
  );
  closers.push(() => new Promise((r) => server.close(() => r())));
  const port = (server.address() as AddressInfo).port;

  function request(path: string, headers: Record<string, string> = {}) {
    return new Promise<{
      status: number;
      headers: http.IncomingHttpHeaders;
      body: string;
    }>((resolve, reject) => {
      http
        .request(
          {
            host: "127.0.0.1",
            port,
            path,
            headers: { ...headers, host: HOST },
          },
          (res) => {
            let body = "";
            res.setEncoding("utf8");
            res.on("data", (d: string) => (body += d));
            res.on("end", () =>
              resolve({ status: res.statusCode!, headers: res.headers, body }),
            );
          },
        )
        .on("error", reject)
        .end();
    });
  }

  async function status() {
    const res = await request("/.platform/status", { cookie: COOKIE });
    return (JSON.parse(res.body) as { state: string }).state;
  }

  // UNIT_BOUNDARY_DESCRIPTION: the status a WebSocket upgrade gets, or "open" when it is relayed.
  function upgrade() {
    return new Promise<number | "open">((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/live`, {
        headers: { host: HOST, cookie: COOKIE },
      });
      ws.on("unexpected-response", (_req, res) => resolve(res.statusCode!));
      ws.on("open", () => {
        ws.close();
        resolve("open");
      });
      ws.on("error", () => {});
    });
  }

  return {
    app,
    machine,
    probes,
    relayed,
    stamped,
    request,
    status,
    upgrade,
    wake: () => {
      machine.sleeping = false;
      machine.pending!.resolve();
    },
    failWake: () => machine.pending!.reject(new Error("no capacity")),
  };
}

const settle = () => new Promise((r) => setTimeout(r, 20));

describe("the gate while an Environment starts", () => {
  // TEST_SCENARIO: a page load to a sleeping Environment starts its wake and gets the loading page at once, not a request that hangs until the machine runs; the page is a 503 with Retry-After and no caching, and carries the script that asks the gate's status.
  it("answers a page load to a sleeping Environment with the loading page at once", async () => {
    const w = await world();
    w.machine.sleeping = true;

    const res = await w.request("/", PAGE);

    expect(res.status).toBe(503);
    expect(res.headers["retry-after"]).toBe("5");
    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect(res.headers["content-type"]).toMatch(/^text\/html/);
    expect(res.body).toContain("Starting…");
    expect(res.body).toContain('"status":"/.platform/status"');
    expect(w.machine.wakes).toBe(1);
    expect(await w.status()).toBe("starting");
    expect(w.machine.wakes).toBe(1);
  });

  // TEST_SCENARIO: the visitor waits on the loading page while the machine wakes and then while the app starts; the status says starting until the app answers and then ready, so the page reloads into the app with no manual reload, and the page load after it reaches the app.
  it("says ready once the woken Environment's app answers", async () => {
    const w = await world();
    w.machine.sleeping = true;
    await w.request("/", PAGE);

    w.wake();
    await settle();
    expect(await w.status()).toBe("starting");

    w.app.listening = true;
    expect(await w.status()).toBe("ready");
    const res = await w.request("/", PAGE);
    expect(res.status).toBe(200);
    expect(res.body).toBe("from the app");
  });

  // TEST_SCENARIO: an endpoint with a readiness path shows the loading page while its port already answers, as an ingress does before the app behind it, and lets the visitor through only once the path answers 2xx; the probe asks that path, not the page.
  it("waits for an endpoint's readiness path, not just its port", async () => {
    const w = await world({ ready: "/healthz" });
    w.app.listening = true;

    expect((await w.request("/", PAGE)).status).toBe(503);
    expect(await w.status()).toBe("starting");
    expect(w.relayed).toEqual([]);

    w.app.healthy = true;
    expect(await w.status()).toBe("ready");
    expect((await w.request("/", PAGE)).status).toBe(200);
    expect(w.probes.every((p) => p === "GET /healthz")).toBe(true);
  });

  // TEST_SCENARIO: an endpoint with no readiness path, behind a proxy that answers 502, 503 or 504 while the app behind it starts, as a DAM install inside an Environment does, shows the loading page rather than the proxy's error, and lets the visitor through once the app answers.
  it("waits behind a proxy that has nothing to send to yet", async () => {
    const w = await world();
    w.app.listening = true;

    for (const status of [502, 503, 504] as const) {
      w.app.proxyWaiting = status;
      const res = await w.request("/", PAGE);
      expect(res.status).toBe(503);
      expect(res.body).toContain("Starting…");
      expect(await w.status()).toBe("starting");
    }

    w.app.proxyWaiting = null;
    expect(await w.status()).toBe("ready");
    const res = await w.request("/", PAGE);
    expect(res.status).toBe(200);
    expect(res.body).toBe("from the app");
  });

  // TEST_SCENARIO: an API call, a script request or a WebSocket while the machine wakes gets a plain 503 with Retry-After: never the HTML page, and never a 200 a health check would read as up; and once it runs, while nothing listens on the port, the same.
  it("answers anything but a page load with a plain 503", async () => {
    const w = await world();
    w.machine.sleeping = true;
    await w.request("/", PAGE);

    const api = await w.request("/api/items", {
      cookie: COOKIE,
      accept: "application/json",
    });
    expect(api.status).toBe(503);
    expect(api.headers["retry-after"]).toBe("5");
    expect(api.headers["content-type"]).toMatch(/^text\/plain/);
    expect(api.body).not.toContain("<");
    expect(await w.upgrade()).toBe(503);

    w.wake();
    await settle();
    const nothing = await w.request("/api/items", { cookie: COOKIE });
    expect(nothing.status).toBe(503);
    expect(nothing.headers["content-type"]).toMatch(/^text\/plain/);

    w.app.listening = true;
    expect(await w.upgrade()).toBe("open");
  });

  // TEST_SCENARIO: once the machine runs, every request but a page load goes to the app as it is, whatever the gate believes of the endpoint: a script or a stylesheet a page loads, an API call, even one that comes while a declared readiness path still fails or a proxy in front answers 503. The gate never answers for the app with its own 503 then, which a browser would refuse to run as a script.
  it("passes every request but a page load to a running app", async () => {
    const w = await world({ ready: "/healthz" });
    w.app.listening = true;

    const script = await w.request("/resources/login/app.js", {
      cookie: COOKIE,
      accept: "*/*",
      "sec-fetch-mode": "cors",
      "sec-fetch-dest": "script",
    });
    expect(script.status).toBe(200);
    expect(script.body).toBe("from the app");
    expect((await w.request("/", PAGE)).status).toBe(503);

    w.app.proxyWaiting = 503;
    const behindProxy = await w.request("/api/items", { cookie: COOKIE });
    expect(behindProxy.status).toBe(503);
    expect(behindProxy.body).toBe("no available server");
    expect(behindProxy.headers["retry-after"]).toBeUndefined();

    const htmlFetch = await w.request("/fragment", {
      cookie: COOKIE,
      accept: "text/html",
      "sec-fetch-mode": "cors",
    });
    expect(htmlFetch.body).toBe("no available server");
  });

  // TEST_SCENARIO: a wake that fails ends the wait: the status says failed, and a page load gets "did not start" with no script that keeps waiting and one "Try again" button, which starts a new wake at once rather than after the failure's hold, and returns the visitor to the page they asked for.
  it("ends on did not start when the wake fails, and tries again on request", async () => {
    const w = await world();
    w.machine.sleeping = true;
    await w.request("/", PAGE);

    w.failWake();
    await settle();

    expect(await w.status()).toBe("failed");
    const res = await w.request("/a?b=1", PAGE);
    expect(res.status).toBe(503);
    expect(res.body).toContain("Did not start");
    expect(res.body).not.toContain("<script>");
    const retry =
      /<a class="button primary" href="([^"]+)">Try again<\/a>/.exec(
        res.body,
      )?.[1];
    expect(retry).toBe("/.platform/start?next=%2Fa%3Fb%3D1");
    expect(w.machine.wakes).toBe(1);

    const again = await w.request(retry!, PAGE);
    expect(again.status).toBe(302);
    expect(again.headers.location).toBe("/a?b=1");
    expect(await w.status()).toBe("starting");
    expect(w.machine.wakes).toBe(2);
  });

  // TEST_SCENARIO: an app that answers with its own error is up, so it is relayed rather than hidden behind the loading page; page loads to an endpoint with no readiness path go to the app with no probe first, and a page load that finds nothing listening gets the loading page, whose status then probes.
  it("probes only for the loading page's status", async () => {
    const w = await world();
    w.app.listening = true;

    expect((await w.request("/broken", PAGE)).status).toBe(500);
    await w.request("/a", PAGE);
    await w.request("/b", PAGE);
    expect(w.probes).toEqual([]);

    w.app.listening = false;
    expect((await w.request("/c", PAGE)).status).toBe(503);
    expect(await w.status()).toBe("starting");
    w.app.listening = true;
    expect(await w.status()).toBe("ready");
    expect(w.probes).toEqual(["HEAD /"]);
  });

  // TEST_SCENARIO: a visitor who waits on the page keeps the Environment awake: asking the status refreshes its activity as any request does, at most once a minute; and the status, like every page of the gate, is for a signed-in visitor only.
  it("refreshes the activity from the status, for a signed-in visitor only", async () => {
    const w = await world();

    await w.status();
    await w.status();
    expect(w.stamped).toEqual(["agent-pr-1"]);

    const anonymous = await w.request("/.platform/status");
    expect(anonymous.status).toBe(401);
  });
});
