// TEST_OVERVIEW: The api-server's front for Environment addresses, end to end over real HTTP: a visitor without a session is sent to the share host's front door, which signs them in with the share session (passing a signed-in visitor straight through), decides access and hands the address a one-time code bound to the visitor's browser, which the address trades for its own session, and requests and WebSockets are relayed to the Environment runtime's forward for the declared port. A visitor who is not signed in is sent to sign in; the owner and people on the owner's list (narrowed per Environment by its agent) are admitted, by verified email; a session or code made for one address opens nothing on another, and a code opens nothing in another browser; the address's session ends with the share session it came from, and signing out ends both; a request another site's page makes in the visitor's name is refused; anyone else is refused, with a page that says whom to ask; the platform's own cookies and `Authorization` never reach the app, the app cannot set those cookies, and every response is uncacheable. Any other host passes on untouched.
import http from "node:http";
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { getCookie } from "hono/cookie";
import { createMemoryTtlStore } from "../../core/ttl-store.js";
import {
  domainOf,
  parseAddress,
  relayHeaders,
  requestAllowed,
  safeNext,
} from "../../modules/environments/domain/gate.js";
import type { EnvironmentRecord } from "../../modules/environments/domain/environment.js";
import { createEnvironmentGate } from "../../modules/environments/gate/environment-gate.js";
import { createEnvironmentFrontDoor } from "../../modules/environments/gate/front-door.js";
import { createEnvironmentSignIn } from "../../modules/environments/services/environment-signin.js";

const DOMAIN = "env.test";
const SHARE = "share.test";
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

async function world(
  opts: {
    signedInAs?: string;
    email?: string | null;
    ownerList?: string[];
    environmentList?: string[] | null;
  } = {},
) {
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
        "shared=1; Domain=env.test; Path=/",
      ]);
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.end(
        received > 0 ? `from the app, ${received} bytes` : "from the app",
      );
    });
  });
  // UNIT_BOUNDARY_DESCRIPTION: an app that crashes during an upgrade to /crash: it closes the connection before it answers.
  runtime.prependListener("upgrade", (req, socket) => {
    if (req.url?.endsWith("/crash")) socket.destroy();
  });
  const wss = new WebSocketServer({ server: runtime });
  wss.on("headers", (headers) =>
    headers.push("Set-Cookie: platform-env=forged", "Set-Cookie: ws=1"),
  );
  wss.on("connection", (ws, req) => {
    seen.push({ path: req.url ?? "", headers: req.headers });
    ws.on("message", (d) => ws.send(`echo:${d}`));
  });
  const runtimePort = await listen(runtime);

  const records = [record("pr-1-abcdef", 4444), record("pr-2-abcdef", 4444)];
  records[0]!.access = opts.environmentList ?? null;
  const woken: string[] = [];
  // UNIT_BOUNDARY_DESCRIPTION: the share host's sessions, faked: the ones still alive, by id.
  const shareSessions = new Set(["share-1"]);
  const signIn = createEnvironmentSignIn({
    handoffs: createMemoryTtlStore(60_000),
    sessions: createMemoryTtlStore(3_600_000),
    share: {
      alive: async (id) => shareSessions.has(id),
      end: async (id) => void shareSessions.delete(id),
    },
    addressUrl: (a) => `http://${a}.${DOMAIN}`,
    now: () => Date.now(),
  });
  const repo = {
    getByHost: async (host: string) =>
      records.find((r) => r.host === host) ?? null,
  };
  const owners = { list: opts.ownerList ?? [] };
  const ownerList = async () => owners.list;
  // UNIT_BOUNDARY_DESCRIPTION: the share host's sign-in, faked: a `share` cookie names a share session, alive or not, and its login path is where the share host would send a visitor without one through the identity provider.
  const shareLogins: string[] = [];
  const visitor = {
    sub: opts.signedInAs ?? OWNER,
    email: opts.email === undefined ? "owner@example.com" : opts.email,
  };
  const shareSignIn = {
    alive: async (id: string) => shareSessions.has(id),
    end: async (id: string) => void shareSessions.delete(id),
    logoutUrl: (next: string) =>
      `http://idp.test/logout?next=${encodeURIComponent(next)}`,
  };
  const share = new Hono();
  share.route(
    "/e",
    createEnvironmentFrontDoor({
      domain: DOMAIN,
      addressUrl: (a) => `http://${a}.${DOMAIN}`,
      repo,
      ownerList,
      signIn,
      share: {
        ...shareSignIn,
        visitor: async (c) => {
          const id = getCookie(c, "share");
          return id && shareSessions.has(id)
            ? { ...visitor, shareSession: id }
            : null;
        },
        loginPath: (next) => {
          shareLogins.push(next);
          return `/auth/login?next=${encodeURIComponent(next)}`;
        },
        logoutPath: "/auth/logout",
      },
      brandName: "Test",
    }),
  );
  const gate = createEnvironmentGate({
    domain: DOMAIN,
    scheme: "http",
    frontDoorUrl: (address, next, binding) =>
      `http://${SHARE}/e/${address}?next=${encodeURIComponent(next)}&b=${binding}`,
    signOutUrl: (address) => shareSignIn.logoutUrl(`/e/${address}`),
    repo,
    ownerList,
    signIn,
    ensureReady: async (id) => void woken.push(id),
    stampActivity: async () => {},
    upstream: () => ({ host: "127.0.0.1", port: runtimePort }),
    brandName: "Test",
  });
  const app = new Hono();
  app.use("*", gate.middleware);
  app.all("*", (c) =>
    c.req.header("host") === SHARE
      ? share.fetch(c.req.raw)
      : c.text("the platform"),
  );
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

  // UNIT_BOUNDARY_DESCRIPTION: the front door as a browser walks it, signed in on the share host: the address gives the browser its sign-in secret and sends the visitor there, and the share host either answers itself (a refusal) or hands the address a code. The answer carries the secret's cookie, as the browser keeps it.
  async function frontDoor(address: string, path = "/page?x=1") {
    const start = await request(`${address}.${DOMAIN}`, path, {
      accept: "text/html",
    });
    expect(start.status).toBe(302);
    const door = new URL(start.location!);
    expect(door.host).toBe(SHARE);
    const secret = start.cookies[0]!.split(";")[0]!;
    expect(secret).toMatch(/^platform-env-signin=/);
    return {
      ...(await request(SHARE, `${door.pathname}${door.search}`, {
        cookie: "share=share-1",
      })),
      secret,
    };
  }

  // UNIT_BOUNDARY_DESCRIPTION: the whole sign-in of a visitor the front door lets in: the code it hands the address, traded in the same browser for the address's own session cookie.
  async function signInTo(address: string): Promise<string> {
    const handed = await frontDoor(address);
    expect(handed.status).toBe(302);
    const handoff = new URL(handed.location!);
    expect(handoff.host).toBe(`${address}.${DOMAIN}`);
    const session = await request(
      handoff.host,
      `${handoff.pathname}${handoff.search}`,
      { cookie: handed.secret },
    );
    expect(session.status).toBe(302);
    expect(session.location).toBe("/page?x=1");
    return session.cookies[0]!.split(";")[0]!;
  }

  return {
    request,
    abortedUpload,
    frontDoor,
    signInTo,
    shareLogins,
    shareSessions,
    records,
    owners,
    seen,
    woken,
    port,
    runtimePort,
  };
}

describe("the Environment gate", () => {
  // TEST_SCENARIO: the owner signs in once and the address relays to the runtime's forward for the declared port, waking the Environment first. The app gets its own cookies and the original host, never the platform's session cookie or Authorization; it cannot set the session cookie, nor a cookie for the whole environments domain; and the answer is uncacheable whatever the app said.
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
    expect(res.cookies).toEqual(["app=1; Path=/", "shared=1; Path=/"]);
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

  // TEST_SCENARIO: a form post reaches the app with its body, a chunked one with `Expect: 100-continue` too; a visitor who drops an upload part-way gets nothing relayed further, and the server keeps serving.
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

    const chunked = await w.request(
      host,
      "/form",
      { cookie, "transfer-encoding": "chunked", expect: "100-continue" },
      { method: "POST", data: "streamed" },
    );
    expect(chunked.status).toBe(200);
    expect(chunked.body).toBe("from the app, 8 bytes");

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

  // TEST_SCENARIO: a person who is not the owner is refused at the front door, on the share host, with a page that names the account they are signed in with, says whom to ask and offers to switch account; no code reaches the address, and nothing reaches the app.
  it("refuses a person who is not the owner, on the share host", async () => {
    const w = await world({ signedInAs: "someone-else" });

    const res = await w.frontDoor("app-pr-1-abcdef");
    expect(res.status).toBe(403);
    expect(res.body).toContain("owner@example.com");
    expect(res.body).toContain("Ask the person who sent you the link");
    expect(res.body).toContain('action="/auth/logout"');
    expect(res.location).toBeNull();
    expect(w.seen).toHaveLength(0);
  });

  // TEST_SCENARIO: a visitor the share host has not signed in is sent through its sign-in, which returns to the front door for the same address, path and browser binding; one it has signed in passes straight on to the address with a code, with no page; a front door visit with no binding goes back to the address, which starts over.
  it("signs a visitor in through the share host, and passes a signed-in one straight on", async () => {
    const w = await world();
    const start = await w.request(`app-pr-1-abcdef.${DOMAIN}`, "/page?x=1", {
      accept: "text/html",
    });
    const door = new URL(start.location!);
    const anonymous = await w.request(SHARE, `${door.pathname}${door.search}`);
    expect(anonymous.status).toBe(302);
    expect(anonymous.location).toBe(
      `/auth/login?next=${encodeURIComponent(`${door.pathname}${door.search}`)}`,
    );
    expect(door.searchParams.get("next")).toBe("/page?x=1");
    expect(door.searchParams.get("b")).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const unbound = await w.request(SHARE, "/e/app-pr-1-abcdef?next=/page", {
      cookie: "share=share-1",
    });
    expect(unbound.location).toBe(`http://app-pr-1-abcdef.${DOMAIN}/page`);
    const offSite = await w.request(
      SHARE,
      `/e/app-pr-1-abcdef?next=${encodeURIComponent("/\t/evil.example")}`,
    );
    expect(offSite.location).toBe(`http://app-pr-1-abcdef.${DOMAIN}/`);

    const signedIn = await w.frontDoor("app-pr-1-abcdef");
    expect(signedIn.status).toBe(302);
    expect(new URL(signedIn.location!).pathname).toBe("/.platform/session");
  });

  // TEST_SCENARIO: the address checks the list on every request, not only at the front door: a person the owner takes off the list is refused on their next request with the session they already hold.
  it("refuses a session whose person left the list", async () => {
    const w = await world({
      signedInAs: "reviewer-sub",
      email: "reviewer@example.com",
      ownerList: ["reviewer@example.com"],
    });
    const cookie = await w.signInTo("app-pr-1-abcdef");
    expect(
      (await w.request(`app-pr-1-abcdef.${DOMAIN}`, "/", { cookie })).status,
    ).toBe(200);

    w.owners.list = [];
    const res = await w.request(`app-pr-1-abcdef.${DOMAIN}`, "/", { cookie });
    expect(res.status).toBe(403);
    expect(res.body).toContain("no longer on this Environment");
  });

  // TEST_SCENARIO: a person on the owner's list opens every Environment of that agent; when the agent narrowed one Environment's list, only the people left on it open that one, and an email the agent added that is not on the owner's list opens nothing.
  it("admits people on the owner's list, narrowed per Environment", async () => {
    const reviewer = await world({
      signedInAs: "reviewer-sub",
      email: "Reviewer@Example.com",
      ownerList: ["reviewer@example.com", "qa@example.com"],
    });
    const cookie = await reviewer.signInTo("app-pr-1-abcdef");
    expect(
      (await reviewer.request(`app-pr-1-abcdef.${DOMAIN}`, "/", { cookie }))
        .status,
    ).toBe(200);

    const narrowed = await world({
      signedInAs: "reviewer-sub",
      email: "reviewer@example.com",
      ownerList: ["reviewer@example.com", "qa@example.com"],
      environmentList: ["qa@example.com"],
    });
    expect((await narrowed.frontDoor("app-pr-1-abcdef")).status).toBe(403);

    const widened = await world({
      signedInAs: "outsider-sub",
      email: "outsider@example.com",
      ownerList: ["qa@example.com"],
      environmentList: ["outsider@example.com"],
    });
    expect((await widened.frontDoor("app-pr-1-abcdef")).status).toBe(403);
  });

  // TEST_SCENARIO: an account whose email the identity provider did not verify matches no list, and the page says why.
  it("refuses an account with no verified email", async () => {
    const w = await world({
      signedInAs: "unverified-sub",
      email: null,
      ownerList: ["someone@example.com"],
    });
    const res = await w.frontDoor("app-pr-1-abcdef");
    expect(res.status).toBe(403);
    expect(res.body).toContain("no verified email");
  });

  // TEST_SCENARIO: signing out of an address ends its session and the share session it came from, and goes on to the identity provider's sign-out, which comes back to the share host's sign-in for this address.
  it("signs out of an address, the share host and the identity provider", async () => {
    const w = await world();
    const cookie = await w.signInTo("app-pr-1-abcdef");

    const out = await w.request(
      `app-pr-1-abcdef.${DOMAIN}`,
      "/.platform/sign-out",
      { cookie },
    );
    expect(out.status).toBe(302);
    expect(out.location).toBe(
      `http://idp.test/logout?next=${encodeURIComponent("/e/app-pr-1-abcdef")}`,
    );
    expect(w.shareSessions.has("share-1")).toBe(false);
    expect(
      (await w.request(`app-pr-1-abcdef.${DOMAIN}`, "/", { cookie })).status,
    ).toBe(401);
  });

  // TEST_SCENARIO: an address's session lasts only while the share host's session it came from does: signing out on the share host, or that session expiring, ends it on the next request.
  it("ends an address's session with the share session", async () => {
    const w = await world();
    const cookie = await w.signInTo("app-pr-1-abcdef");
    expect(
      (await w.request(`app-pr-1-abcdef.${DOMAIN}`, "/", { cookie })).status,
    ).toBe(200);

    w.shareSessions.delete("share-1");
    expect(
      (await w.request(`app-pr-1-abcdef.${DOMAIN}`, "/", { cookie })).status,
    ).toBe(401);
  });

  // TEST_SCENARIO: the code the front door hands an address works once, only on the address it was made for, and only in the browser that asked for it: a code that leaks opens nothing in another browser.
  it("accepts a hand-off code once, on its own address and in its own browser only", async () => {
    const w = await world();
    const redeem = (host: string, handoff: URL, cookie?: string) =>
      w.request(
        host,
        `${handoff.pathname}${handoff.search}`,
        cookie ? { cookie } : {},
      );

    const first = await w.frontDoor("app-pr-1-abcdef");
    const handoff = new URL(first.location!);
    expect(
      (await redeem(`app-pr-2-abcdef.${DOMAIN}`, handoff, first.secret)).status,
    ).toBe(400);
    expect((await redeem(handoff.host, handoff, first.secret)).status).toBe(
      400,
    );

    const leaked = await w.frontDoor("app-pr-1-abcdef");
    const leakedUrl = new URL(leaked.location!);
    const other = await w.frontDoor("app-pr-1-abcdef");
    expect((await redeem(leakedUrl.host, leakedUrl)).status).toBe(400);
    const elsewhere = await redeem(leakedUrl.host, leakedUrl, other.secret);
    expect(elsewhere.status).toBe(400);
    expect(elsewhere.body).toContain("another browser");
    expect(elsewhere.cookies).toEqual([]);
  });

  // TEST_SCENARIO: a request another origin's page makes in the visitor's name — a script's call, a form post (an opaque-origin one too), a WebSocket from a page of another Environment — is refused before it reaches the app, though the browser sent the session cookie; a link from anywhere, the address's own calls (its form post under no-referrer too) and calls between endpoints of one Environment pass.
  it("refuses a request another origin makes in the visitor's name", async () => {
    const w = await world();
    w.records[0]!.endpoints.push({ name: "api", port: 5555 });
    const cookie = await w.signInTo("app-pr-1-abcdef");
    const host = `app-pr-1-abcdef.${DOMAIN}`;
    const evil = `http://app-pr-2-abcdef.${DOMAIN}`;

    expect(
      (await w.request(host, "/data", { cookie, origin: evil })).status,
    ).toBe(403);
    const posted = await w.request(
      host,
      "/form",
      { cookie, origin: evil },
      { method: "POST", data: "a=1" },
    );
    expect(posted.status).toBe(403);
    expect(posted.body).toContain("another site");
    expect(w.seen).toHaveLength(0);

    expect((await w.request(host, "/", { cookie })).status).toBe(200);
    const own = await w.request(
      host,
      "/form",
      { cookie, origin: `http://${host}` },
      { method: "POST", data: "a=1" },
    );
    expect(own.status).toBe(200);
    const noReferrer = await w.request(
      host,
      "/form",
      { cookie, origin: "null", "sec-fetch-site": "same-origin" },
      { method: "POST", data: "a=1" },
    );
    expect(noReferrer.status).toBe(200);
    const forgedNull = await w.request(
      host,
      "/form",
      { cookie, origin: "null", "sec-fetch-site": "same-site" },
      { method: "POST", data: "a=1" },
    );
    expect(forgedNull.status).toBe(403);
    const sibling = await w.request(host, "/data", {
      cookie,
      origin: `http://api-pr-1-abcdef.${DOMAIN}`,
    });
    expect(sibling.status).toBe(200);

    const ws = await new Promise<number>((resolve) => {
      const socket = new WebSocket(`ws://127.0.0.1:${w.port}/live`, {
        headers: { host, cookie, origin: evil },
      });
      socket.on("unexpected-response", (_req, res) => resolve(res.statusCode!));
      socket.on("open", () => resolve(101));
      socket.on("error", () => resolve(0));
    });
    expect(ws).toBe(403);
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

  // TEST_SCENARIO: a WebSocket to the owner's Environment is relayed to the declared port both ways, the app's handshake loses its Set-Cookie lines, an app that closes before it answers closes the visitor's socket, and one without a session is refused before it reaches the runtime.
  it("relays the owner's WebSocket and refuses one without a session", async () => {
    const w = await world();
    const cookie = await w.signInTo("app-pr-1-abcdef");

    const open = (headers: Record<string, string>) =>
      new WebSocket(`ws://127.0.0.1:${w.port}/live`, {
        headers: { host: `app-pr-1-abcdef.${DOMAIN}`, ...headers },
      });
    const ws = open({ cookie });
    let handshakeCookies: string[] | undefined;
    ws.on("upgrade", (res) => (handshakeCookies = res.headers["set-cookie"]));
    const reply = await new Promise<string>((resolve, reject) => {
      ws.on("open", () => ws.send("hi"));
      ws.on("message", (d) => resolve(String(d)));
      ws.on("error", reject);
    });
    ws.close();
    expect(reply).toBe("echo:hi");
    expect(handshakeCookies).toBeUndefined();
    expect(w.seen.at(-1)!.path).toBe("/api/environment/forward/4444/live");
    expect(w.seen.at(-1)!.headers.cookie).toBeUndefined();

    const refused = await new Promise<number>((resolve) => {
      const anon = open({});
      anon.on("unexpected-response", (_req, res) => resolve(res.statusCode!));
      anon.on("error", () => resolve(0));
    });
    expect(refused).toBe(401);

    const crashed = await new Promise<string>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${w.port}/crash`, {
        headers: { host: `app-pr-1-abcdef.${DOMAIN}`, cookie },
      });
      ws.on("open", () => resolve("open"));
      ws.on("error", () => resolve("closed"));
      ws.on("close", () => resolve("closed"));
      setTimeout(() => resolve("hanging"), 2000);
    });
    expect(crashed).toBe("closed");
  });
});

describe("Environment addresses", () => {
  // TEST_SCENARIO: a sign-in's return path stays on the address: a path of it passes, and a path a browser would read as another host — two slashes, a backslash, or a tab, newline or other control character it drops — becomes the root, as do the reserved paths and anything that is no path.
  it("keeps a return path on the address", () => {
    expect(safeNext("/page?x=1")).toBe("/page?x=1");
    for (const path of [
      "//evil.example",
      "/\\evil.example",
      "/\t/evil.example",
      "/\n/evil.example",
      "/\r/evil.example",
      "/\u000b/evil.example",
      "/\u0000/evil.example",
      "/\u007f/evil.example",
      "/.platform/session",
      "https://evil.example/",
      "page",
      undefined,
    ])
      expect(safeNext(path)).toBe("/");
  });

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

  // TEST_SCENARIO: the relay drops both spellings of the session cookie, a padded name too, and the sign-in secret's cookie, and keeps an app cookie whose name only starts the same way.
  it("drops only the platform's session cookies", () => {
    const out = relayHeaders(
      new Headers({
        cookie:
          "__Host-platform-env=s; platform-env =t; __Host-platform-env-signin=u; platform-envx=keep; a=1",
      }),
      { address: "x", publicHost: "h", scheme: "https" },
    );
    expect(out.get("cookie")).toBe("platform-envx=keep; a=1");
  });
});

describe("where a request to an address came from", () => {
  // TEST_SCENARIO: a request with no origin (a link, a typed address, a frame, an image) and one from an endpoint of the same Environment pass; the opaque origin a no-referrer page sends with its own form post passes only when the browser marks it same-origin; any other origin, and an opaque one from anywhere else or with no fetch metadata, is refused.
  it("serves no origin, the Environment's own endpoints, and its own opaque form posts only", () => {
    const own = new Set([
      "https://app-pr-1-abcdef.env.test",
      "https://api-pr-1-abcdef.env.test",
    ]);
    const from = (origin: string | undefined, site?: string) =>
      requestAllowed({ origin, site }, own);
    expect(from(undefined)).toBe(true);
    expect(from("https://api-pr-1-abcdef.env.test", "same-site")).toBe(true);
    expect(from("null", "same-origin")).toBe(true);
    expect(from("https://app-pr-2-abcdef.env.test", "same-site")).toBe(false);
    expect(from("https://share.test", "same-site")).toBe(false);
    expect(from("null", "same-site")).toBe(false);
    expect(from("null", "cross-site")).toBe(false);
    expect(from("null")).toBe(false);
  });
});
