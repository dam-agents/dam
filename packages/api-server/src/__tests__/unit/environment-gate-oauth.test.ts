// TEST_OVERVIEW: A person's own OAuth client, such as an MCP client, at an Environment address. A request with no credential gets a 401 that names the address's resource metadata, which the gate serves itself, before the app, naming the platform's identity provider and the scopes to ask. A bearer token from that provider, signed with its key and naming exactly this address as its only audience, is admitted under the same lists a browser session is, read at every request: the owner by `sub`, anyone else by a verified email; a person off the lists gets a 403. A token for another address, another audience, an expired or forged one, or one without a verified email outside the owner, never reaches the app, and the token itself never reaches the app either. A sleeping Environment is woken and a token-carrying request waits for it instead of failing. A browser keeps its sign-in redirect.
import http from "node:http";
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWK,
} from "jose";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createMemoryTtlStore } from "../../core/ttl-store.js";
import type { EnvironmentRecord } from "../../modules/environments/domain/environment.js";
import {
  checkBearer,
  resourceOf,
  wwwAuthenticate,
} from "../../modules/environments/gate/bearer.js";
import { createEnvironmentGate } from "../../modules/environments/gate/environment-gate.js";
import { createEnvironmentSignIn } from "../../modules/environments/services/environment-signin.js";

const DOMAIN = "env.test";
const ISSUER = "http://keycloak.test/realms/platform";
const OWNER = "owner-sub";
const ADDRESS = "mcp-pr-1-abcdef";
const RESOURCE = `http://${ADDRESS}.${DOMAIN}`;

let privateKey: CryptoKey;
let otherKey: CryptoKey;
let jwks: { keys: JWK[] };

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  otherKey = (await generateKeyPair("RS256")).privateKey;
  jwks = {
    keys: [{ ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256" }],
  };
});

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

async function token(
  claims: Record<string, unknown> = {},
  opts: { key?: CryptoKey; exp?: number | string } = {},
) {
  return new SignJWT({
    sub: OWNER,
    email: "owner@example.com",
    email_verified: true,
    aud: RESOURCE,
    ...claims,
  })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? "5m")
    .sign(opts.key ?? privateKey);
}

interface Answer {
  status: number;
  header: (name: string) => string | null;
  text: string;
  json: () => Record<string, unknown>;
}

async function listen(server: http.Server): Promise<number> {
  closers.push(() => new Promise((r) => server.close(() => r())));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return (server.address() as AddressInfo).port;
}

async function world(
  opts: { members?: string[]; sleeping?: boolean; wakeAfterMs?: number } = {},
) {
  const seen: http.IncomingHttpHeaders[] = [];
  const runtime = http.createServer((req, res) => {
    if (req.method !== "HEAD") seen.push(req.headers);
    res.end("tools from the app");
  });
  const runtimePort = await listen(runtime);
  const record: EnvironmentRecord = {
    agentId: "agent-env",
    owningAgentId: "agent-owning",
    owner: OWNER,
    name: "pr-1",
    host: "pr-1-abcdef",
    endpoints: [{ name: "mcp", port: 4444 }],
    expiresAt: null,
    createdAt: new Date(),
  };
  const lists = { members: opts.members ?? [] };
  let asleep = opts.sleeping ?? false;
  const woken: string[] = [];
  const gate = createEnvironmentGate({
    domain: DOMAIN,
    scheme: "http",
    oauth: { issuer: ISSUER, keys: createLocalJWKSet(jwks) },
    frontDoorUrl: (address, next) =>
      `http://share.test/e/${address}?next=${encodeURIComponent(next)}`,
    signOutUrl: () => "http://share.test/out",
    repo: { getByHost: async (h) => (h === record.host ? record : null) },
    agentMembers: async () => [],
    environmentMembers: async () => lists.members,
    editorsOf: async () => [],
    memberAgents: async () => [],
    agentOfKey: async () => null,
    recordAgentVisit: async () => {},
    signIn: createEnvironmentSignIn({
      handoffs: createMemoryTtlStore(60_000),
      sessions: createMemoryTtlStore(60_000),
      chains: createMemoryTtlStore(60_000),
      share: { alive: async () => true, end: async () => {} },
      addressUrl: (a) => `http://${a}.${DOMAIN}`,
      now: () => Date.now(),
    }),
    platform: { issuers: [ISSUER], isApiKey: (t) => t.startsWith("pk_") },
    ensureReady: async (id, { onWaking }) => {
      woken.push(id);
      if (!asleep) return;
      onWaking();
      await new Promise((r) => setTimeout(r, opts.wakeAfterMs ?? 50));
      asleep = false;
    },
    stampActivity: async () => {},
    upstream: () => ({ host: "127.0.0.1", port: runtimePort }),
    brandName: "Test",
    wakeWaitMs: 2_000,
  });
  const app = new Hono();
  app.use("*", gate.middleware);
  app.all("*", (c) => c.text("not an address", 404));
  const server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" });
  closers.push(() => new Promise((r) => server.close(() => r())));
  await new Promise((r) => server.once("listening", r));
  const port = (server.address() as AddressInfo).port;
  // UNIT_BOUNDARY_DESCRIPTION: a request to the address as a client sends it, with the address in its Host header, which fetch would replace.
  const call = (path: string, headers: Record<string, string> = {}) =>
    new Promise<Answer>((resolve, reject) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          path,
          headers: { ...headers, host: `${ADDRESS}.${DOMAIN}` },
        },
        (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (d: string) => (body += d));
          res.on("end", () =>
            resolve({
              status: res.statusCode!,
              header: (name) => {
                const v = res.headers[name];
                return Array.isArray(v) ? v.join(", ") : (v ?? null);
              },
              text: body,
              json: () => JSON.parse(body) as Record<string, unknown>,
            }),
          );
        },
      );
      req.on("error", reject);
      req.end();
    });
  return { call, seen, lists, woken };
}

describe("an OAuth client at an Environment address", () => {
  // TEST_SCENARIO: #6318 — an MCP client calls the address with no credential; it gets a 401 whose WWW-Authenticate names the resource metadata and the scopes, and the metadata names the address itself as the resource and the platform's identity provider as its authorization server.
  it("is pointed at the resource metadata, which the gate serves", async () => {
    const { call, seen } = await world();

    const refused = await call("/mcp", { accept: "application/json" });
    expect(refused.status).toBe(401);
    expect(refused.header("www-authenticate")).toBe(
      `Bearer resource_metadata="${RESOURCE}/.well-known/oauth-protected-resource", scope="environments offline_access"`,
    );

    for (const path of [
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/mcp",
    ]) {
      const metadata = await call(path);
      expect(metadata.status).toBe(200);
      expect(metadata.json()).toEqual({
        resource: RESOURCE,
        authorization_servers: [ISSUER],
        scopes_supported: ["environments", "offline_access"],
        bearer_methods_supported: ["header"],
        resource_name: "Test Environment",
      });
    }
    expect(seen).toHaveLength(0);
  });

  // TEST_SCENARIO: AC-4 — the owner's client, with a token for this address, reaches the app, and the app never sees the token.
  it("lets the owner's token in, and keeps the token from the app", async () => {
    const { call, seen } = await world();

    const answer = await call("/mcp", {
      authorization: `Bearer ${await token()}`,
    });
    expect(answer.status).toBe(200);
    expect(answer.text).toBe("tools from the app");
    expect(seen[0]!.authorization).toBeUndefined();
  });

  // TEST_SCENARIO: AC-7, AC-8 — a person on the Environment's list gets in by verified email; once the owner removes them the next call is refused with a 403 that names them, and a person never on the list is refused the same way.
  it("follows the share lists at every request", async () => {
    const { call, lists } = await world({ members: ["ana@example.com"] });
    const ana = await token({ sub: "ana", email: "ana@example.com" });

    expect(
      (await call("/mcp", { authorization: `Bearer ${ana}` })).status,
    ).toBe(200);
    lists.members = [];
    const removed = await call("/mcp", { authorization: `Bearer ${ana}` });
    expect(removed.status).toBe(403);
    expect(removed.json().error_description).toContain("ana@example.com");

    const eve = await token({ sub: "eve", email: "eve@example.com" });
    expect(
      (await call("/mcp", { authorization: `Bearer ${eve}` })).status,
    ).toBe(403);
  });

  // TEST_SCENARIO: #6318 — a token one MCP server collected for another Environment, a token for the platform's API, one with a second audience, an expired one, one signed by another key and one whose email is not verified are each refused, with a 401 that says the token is invalid, or a 403 for the unverified email; none reaches the app.
  it("refuses every token not made for this address", async () => {
    const { call, seen } = await world({ members: ["ana@example.com"] });
    const invalid = [
      await token({ aud: "http://mcp-pr-2-abcdef.env.test" }),
      await token({ aud: "platform-api" }),
      await token({ aud: [RESOURCE, "platform-api"] }),
      await token({}, { exp: Math.floor(Date.now() / 1000) - 60 }),
      await token({}, { key: otherKey }),
    ];
    for (const t of invalid) {
      const answer = await call("/mcp", { authorization: `Bearer ${t}` });
      expect(answer.status).toBe(401);
      expect(answer.header("www-authenticate")).toContain(
        'error="invalid_token"',
      );
    }
    const unverified = await token({
      sub: "ana",
      email: "ana@example.com",
      email_verified: false,
    });
    expect(
      (await call("/mcp", { authorization: `Bearer ${unverified}` })).status,
    ).toBe(403);
    expect(seen).toHaveLength(0);
  });

  // TEST_SCENARIO: AC-9 — the owner's client calls a sleeping Environment; the gate wakes it and holds the call until the machine runs, so the call answers instead of failing with a 503.
  it("waits for a sleeping Environment to wake", async () => {
    const { call, woken } = await world({ sleeping: true, wakeAfterMs: 600 });

    const answer = await call("/mcp", {
      authorization: `Bearer ${await token()}`,
    });
    expect(woken).toContain("agent-env");
    expect(answer.status).toBe(200);
    expect(answer.text).toBe("tools from the app");
  });

  // TEST_SCENARIO: AC-10 — a browser with no session is still sent to the platform's sign-in; the bearer path changes nothing for it.
  it("leaves a browser's sign-in as it was", async () => {
    const { call } = await world();

    const answer = await call("/", {
      accept: "text/html",
      "sec-fetch-mode": "navigate",
    });
    expect(answer.status).toBe(302);
    expect(answer.header("location")).toContain("http://share.test/e/");
  });
});

describe("the bearer check", () => {
  // TEST_SCENARIO: a header that is no platform bearer token is not the gate's to judge: no header, another scheme, or a token of another issuer.
  it("leaves other credentials alone", async () => {
    const keys = createLocalJWKSet(jwks);
    const opts = { resource: RESOURCE, issuers: [ISSUER], keys };
    expect(await checkBearer(undefined, opts)).toEqual({ kind: "none" });
    expect(await checkBearer("Basic dXNlcjpwYXNz", opts)).toEqual({
      kind: "none",
    });
    const foreign = await new SignJWT({ sub: "x", aud: RESOURCE })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer("https://app.example/issuer")
      .setExpirationTime("5m")
      .sign(privateKey);
    expect(await checkBearer(`Bearer ${foreign}`, opts)).toEqual({
      kind: "none",
    });
  });

  // TEST_SCENARIO: an address's resource is the exact string a client compares: no trailing slash, the port only when the install's URL has one; the 401 header names it with the metadata path.
  it("names the address as a client compares it", () => {
    expect(
      resourceOf("mcp-x", {
        scheme: "https",
        domain: "env.example.com",
        port: null,
      }),
    ).toBe("https://mcp-x.env.example.com");
    expect(
      resourceOf("mcp-x", {
        scheme: "http",
        domain: "env.localhost",
        port: 4444,
      }),
    ).toBe("http://mcp-x.env.localhost:4444");
    expect(wwwAuthenticate("https://a.b", "invalid_token")).toBe(
      'Bearer error="invalid_token", resource_metadata="https://a.b/.well-known/oauth-protected-resource", scope="environments offline_access"',
    );
  });
});
