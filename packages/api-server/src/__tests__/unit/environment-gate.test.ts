// TEST_OVERVIEW: The api-server's front for Environment addresses, end to end over real HTTP: the owner signs in once on the sign-in host, the address trades a one-time code for its own session, and requests and WebSockets are relayed to the Environment runtime's forward for the declared port. A visitor who is not signed in is sent to sign in; a session or code made for one address opens nothing on another; another person is refused; the platform's own session cookie and `Authorization` never reach the app, the app cannot set that cookie, and every response is uncacheable. Any other host passes on untouched.
import http from "node:http";
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { ok } from "../../core/result.js";
import { createMemoryTtlStore } from "../../core/ttl-store.js";
import {
  domainOf,
  parseAddress,
  relayHeaders,
} from "../../modules/environments/domain/gate.js";
import type { EnvironmentRecord } from "../../modules/environments/domain/environment.js";
import { createEnvironmentGate } from "../../modules/environments/gate/environment-gate.js";
import { createEnvironmentSignIn } from "../../modules/environments/services/environment-signin.js";

const DOMAIN = "env.test";
const OWNER = "owner-sub";
const closers: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

function record(host: string, port: number, owner = OWNER): EnvironmentRecord {
  return {
    agentId: `agent-${host}`,
    owningAgentId: "agent-owning",
    owner,
    name: host,
    host,
    endpoints: [{ name: "app", port }],
    access: null,
    expiresAt: new Date(Date.now() + 86_400_000),
    createdAt: new Date(),
  };
}

async function listen(server: http.Server): Promise<number> {
  closers.push(() => new Promise((r) => server.close(() => r())));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return (server.address() as AddressInfo).port;
}

async function world(opts: { signedInAs?: string } = {}) {
  const seen: { path: string; headers: http.IncomingHttpHeaders }[] = [];
  const runtime = http.createServer((req, res) => {
    seen.push({ path: req.url ?? "", headers: req.headers });
    let received = 0;
    req.on("data", (d: Buffer) => (received += d.length));
    req.on("error", () => {});
    req.on("end", () => {
      res.setHeader("Set-Cookie", [
        "app=1; Path=/",
        "platform-env=forged; Path=/",
        "platform-env =padded; Path=/",
      ]);
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.end(
        received > 0 ? `from the app, ${received} bytes` : "from the app",
      );
    });
  });
  const wss = new WebSocketServer({ server: runtime });
  wss.on("connection", (ws, req) => {
    seen.push({ path: req.url ?? "", headers: req.headers });
    ws.on("message", (d) => ws.send(`echo:${d}`));
  });
  const runtimePort = await listen(runtime);

  const records = [record("pr-1-abcdef", 4444), record("pr-2-abcdef", 4444)];
  const woken: string[] = [];
  const signIn = createEnvironmentSignIn({
    provider: {
      authorizeUrl: ({ state, nonce }) =>
        `https://idp.test/auth?state=${state}&nonce=${nonce}`,
      redeemCode: async ({ code }) =>
        ok({
          sub: opts.signedInAs ?? OWNER,
          email: "owner@example.com",
          emailVerified: true,
          nonce: code,
        }),
      endSessionUrl: ({ postLogoutRedirectUri }) =>
        `https://idp.test/logout?to=${postLogoutRedirectUri}`,
    },
    pending: createMemoryTtlStore(300_000),
    handoffs: createMemoryTtlStore(60_000),
    sessions: createMemoryTtlStore(3_600_000),
    addressUrl: (a) => `http://${a}.${DOMAIN}`,
    signInUrl: `http://signin.${DOMAIN}`,
    now: () => Date.now(),
  });
  const gate = createEnvironmentGate({
    domain: DOMAIN,
    scheme: "http",
    addressUrl: (a) => `http://${a}.${DOMAIN}`,
    repo: {
      getByHost: async (host) => records.find((r) => r.host === host) ?? null,
    },
    signIn,
    ensureReady: async (id) => void woken.push(id),
    stampActivity: async () => {},
    upstream: () => ({ host: "127.0.0.1", port: runtimePort }),
    brandName: "Test",
  });
  const app = new Hono();
  app.use("*", gate.middleware);
  app.get("*", (c) => c.text("the platform"));
  const server = serve({ fetch: app.fetch, port: 0 }) as http.Server;
  server.on("upgrade", (req, socket, head) => {
    if (!gate.handleUpgrade(req, socket, head)) socket.destroy();
  });
  await new Promise<void>((r) =>
    server.listening ? r() : server.once("listening", () => r()),
  );
  closers.push(() => new Promise((r) => server.close(() => r())));
  const port = (server.address() as AddressInfo).port;

  // UNIT_BOUNDARY_DESCRIPTION: a request to an Environment address. fetch sets Host from the URL whatever it is given, so the test speaks HTTP itself.
  function request(
    host: string,
    path: string,
    headers: Record<string, string> = {},
    body?: { method: string; data: string },
  ) {
    return new Promise<{
      status: number;
      location: string | null;
      cookies: string[];
      cacheControl: string | null;
      nosniff: string | null;
      body: string;
    }>((resolve, reject) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          path,
          method: body?.method ?? "GET",
          headers: { ...headers, host },
        },
        (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (d: string) => (body += d));
          res.on("end", () =>
            resolve({
              status: res.statusCode!,
              location: res.headers.location ?? null,
              cookies: res.headers["set-cookie"] ?? [],
              cacheControl: res.headers["cache-control"] ?? null,
              nosniff:
                (res.headers["x-content-type-options"] as string) ?? null,
              body,
            }),
          );
        },
      );
      req.on("error", reject);
      req.end(body?.data);
    });
  }

  // UNIT_BOUNDARY_DESCRIPTION: a visitor that starts an upload and drops the connection before the body ends.
  function abortedUpload(host: string, path: string, cookie: string) {
    return new Promise<void>((resolve) => {
      const req = http.request({
        host: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers: { host, cookie, "content-length": "100000" },
      });
      req.on("error", () => resolve());
      req.write("x".repeat(1000), () => {
        setTimeout(() => {
          req.destroy();
          resolve();
        }, 50);
      });
    });
  }

  // UNIT_BOUNDARY_DESCRIPTION: the whole sign-in, as a browser walks it: the address sends the visitor to the sign-in host, the identity provider comes back to its callback, and the callback hands the address a code for a session of its own.
  async function signInTo(address: string): Promise<string> {
    const start = await request(`${address}.${DOMAIN}`, "/page?x=1", {
      accept: "text/html",
    });
    expect(start.status).toBe(302);
    const login = new URL(start.location!);
    expect(login.host).toBe(`signin.${DOMAIN}`);
    const idp = await request(
      `signin.${DOMAIN}`,
      `${login.pathname}${login.search}`,
    );
    const auth = new URL(idp.location!);
    const back = await request(
      `signin.${DOMAIN}`,
      `/.platform/callback?state=${auth.searchParams.get("state")}&code=${auth.searchParams.get("nonce")}`,
    );
    const handoff = new URL(back.location!);
    expect(handoff.host).toBe(`${address}.${DOMAIN}`);
    const session = await request(
      handoff.host,
      `${handoff.pathname}${handoff.search}`,
    );
    expect(session.status).toBe(302);
    expect(session.location).toBe("/page?x=1");
    return session.cookies[0]!.split(";")[0]!;
  }

  return { request, abortedUpload, signInTo, seen, woken, port, runtimePort };
}

describe("the Environment gate", () => {
  // TEST_SCENARIO: the owner signs in once and the address relays to the runtime's forward for the declared port, waking the Environment first. The app gets its own cookies and the original host, never the platform's session cookie or Authorization; it cannot set the session cookie; and the answer is uncacheable whatever the app said.
  it("relays the owner's request to the declared port", async () => {
    const w = await world();
    const cookie = await w.signInTo("app-pr-1-abcdef");

    const res = await w.request(`app-pr-1-abcdef.${DOMAIN}`, "/a?b=1", {
      cookie: `${cookie}; app=1`,
      authorization: "Bearer platform-token",
    });

    expect(res.status).toBe(200);
    expect(res.body).toBe("from the app");
    expect(res.cacheControl).toBe("private, no-store");
    expect(res.cookies).toEqual(["app=1; Path=/"]);
    const relayed = w.seen.at(-1)!;
    expect(relayed.path).toBe("/api/environment/forward/4444/a?b=1");
    expect(relayed.headers.cookie).toBe("app=1");
    expect(relayed.headers.authorization).toBeUndefined();
    expect(relayed.headers["x-platform-environment-ports"]).toBe("4444");
    expect(relayed.headers["x-forwarded-host"]).toBe(
      `app-pr-1-abcdef.${DOMAIN}`,
    );
    expect(w.woken).toContain("agent-pr-1-abcdef");
  });

  // TEST_SCENARIO: a form post reaches the app with its body; a visitor who drops an upload part-way gets nothing relayed further, and the server keeps serving.
  it("relays a request body, and survives an aborted upload", async () => {
    const w = await world();
    const cookie = await w.signInTo("app-pr-1-abcdef");
    const host = `app-pr-1-abcdef.${DOMAIN}`;

    const posted = await w.request(
      host,
      "/form",
      { cookie, "content-type": "text/plain" },
      { method: "POST", data: "a=1&b=2" },
    );
    expect(posted.status).toBe(200);
    expect(posted.body).toBe("from the app, 7 bytes");

    await w.abortedUpload(host, "/upload", cookie);
    await new Promise((r) => setTimeout(r, 100));
    expect((await w.request(host, "/after", { cookie })).status).toBe(200);
  });

  // TEST_SCENARIO: the pages the gate answers with itself carry the platform's security headers, as its own pages do.
  it("sends the security headers on its own pages", async () => {
    const w = await world();

    const res = await w.request(`app-nothing-abcdef.${DOMAIN}`, "/");
    expect(res.status).toBe(404);
    expect(res.nosniff).toBe("nosniff");
    expect(res.cacheControl).toBe("private, no-store");
  });

  // TEST_SCENARIO: a session made for one Environment address opens nothing on another, even one of the same owner: the browser would never send it there, and a cookie carried across by hand is refused.
  it("refuses a session carried to another address", async () => {
    const w = await world();
    const cookie = await w.signInTo("app-pr-1-abcdef");

    const res = await w.request(`app-pr-2-abcdef.${DOMAIN}`, "/", {
      cookie,
    });
    expect(res.status).toBe(401);
    expect(w.seen).toHaveLength(0);
  });

  // TEST_SCENARIO: a person who is not the owner signs in and is refused, with a page that says whom to ask; nothing reaches the app.
  it("refuses a person who is not the owner", async () => {
    const w = await world({ signedInAs: "someone-else" });
    const cookie = await w.signInTo("app-pr-1-abcdef");

    const res = await w.request(`app-pr-1-abcdef.${DOMAIN}`, "/", { cookie });
    expect(res.status).toBe(403);
    expect(res.body).toContain("Ask them for access");
    expect(w.seen).toHaveLength(0);
  });

  // TEST_SCENARIO: the code the sign-in host hands an address works once and only on the address it was made for.
  it("accepts a hand-off code once, on its own address only", async () => {
    const w = await world();
    const start = await w.request(`app-pr-1-abcdef.${DOMAIN}`, "/", {
      accept: "text/html",
    });
    const login = new URL(start.location!);
    const idp = await w.request(
      `signin.${DOMAIN}`,
      `${login.pathname}${login.search}`,
    );
    const auth = new URL(idp.location!);
    const back = await w.request(
      `signin.${DOMAIN}`,
      `/.platform/callback?state=${auth.searchParams.get("state")}&code=${auth.searchParams.get("nonce")}`,
    );
    const handoff = new URL(back.location!);

    const elsewhere = await w.request(
      `app-pr-2-abcdef.${DOMAIN}`,
      `${handoff.pathname}${handoff.search}`,
    );
    expect(elsewhere.status).toBe(400);
    const again = await w.request(
      handoff.host,
      `${handoff.pathname}${handoff.search}`,
    );
    expect(again.status).toBe(400);
  });

  // TEST_SCENARIO: an address that names no Environment, or an endpoint it did not declare, answers 404; a request for another host passes to the rest of the api-server.
  it("answers 404 for an unknown address and passes other hosts on", async () => {
    const w = await world();

    expect((await w.request(`web-pr-1-abcdef.${DOMAIN}`, "/")).status).toBe(
      404,
    );
    expect((await w.request(`app-nope-123456.${DOMAIN}`, "/")).status).toBe(
      404,
    );
    expect((await w.request("platform.test", "/")).body).toBe("the platform");
  });

  // TEST_SCENARIO: a WebSocket to the owner's Environment is relayed to the declared port both ways, and one without a session is refused before it reaches the runtime.
  it("relays the owner's WebSocket and refuses one without a session", async () => {
    const w = await world();
    const cookie = await w.signInTo("app-pr-1-abcdef");

    const open = (headers: Record<string, string>) =>
      new WebSocket(`ws://127.0.0.1:${w.port}/live`, {
        headers: { host: `app-pr-1-abcdef.${DOMAIN}`, ...headers },
      });
    const ws = open({ cookie });
    const reply = await new Promise<string>((resolve, reject) => {
      ws.on("open", () => ws.send("hi"));
      ws.on("message", (d) => resolve(String(d)));
      ws.on("error", reject);
    });
    ws.close();
    expect(reply).toBe("echo:hi");
    expect(w.seen.at(-1)!.path).toBe("/api/environment/forward/4444/live");
    expect(w.seen.at(-1)!.headers.cookie).toBeUndefined();

    const refused = await new Promise<number>((resolve) => {
      const anon = open({});
      anon.on("unexpected-response", (_req, res) => resolve(res.statusCode!));
      anon.on("error", () => resolve(0));
    });
    expect(refused).toBe(401);
  });
});

describe("Environment addresses", () => {
  // TEST_SCENARIO: an address is the first label under the environments domain, split at its first hyphen into the endpoint and the Environment's host label; a deeper name, another domain, a label with no hyphen or one with characters a DNS label cannot hold is no address.
  it("parses an address from the Host header", () => {
    expect(parseAddress(`app-pr-42-abcdef.${DOMAIN}:443`, DOMAIN)).toEqual({
      address: "app-pr-42-abcdef",
      endpoint: "app",
      host: "pr-42-abcdef",
    });
    expect(parseAddress(`a.b-c.${DOMAIN}`, DOMAIN)).toBeNull();
    expect(parseAddress("app-pr.example.com", DOMAIN)).toBeNull();
    expect(parseAddress(`signin.${DOMAIN}`, DOMAIN)).toBeNull();
    expect(parseAddress(`app$&-pr-1.${DOMAIN}`, DOMAIN)).toBeNull();
    expect(domainOf("https://{host}.env.example.com")).toBe("env.example.com");
    expect(domainOf("http://{host}.env.localhost:4444")).toBe("env.localhost");
    expect(domainOf(null)).toBeNull();
  });

  // TEST_SCENARIO: the relay drops both spellings of the session cookie, a padded name too, and keeps an app cookie whose name only starts the same way.
  it("drops only the platform's session cookies", () => {
    const out = relayHeaders(
      new Headers({
        cookie:
          "__Host-platform-env=s; platform-env =t; platform-envx=keep; a=1",
      }),
      { address: "x", publicHost: "h", scheme: "https" },
    );
    expect(out.get("cookie")).toBe("platform-envx=keep; a=1");
  });
});
