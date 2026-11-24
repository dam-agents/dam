// TEST_OVERVIEW: The official MCP SDK client, as an IDE or CLI runs it, against an MCP server behind the real Environment gate. The gate's 401 and resource metadata are all the client needs to find the authorization server, register itself, sign the person in with PKCE for that one address and call a tool; an expired token refreshes with no browser; a token for one Environment opens no other; a person removed from the lists is refused at their next call; a sleeping Environment wakes and the call answers. The authorization server here stands in for the platform's Keycloak with its keycloak-environments extension: it issues a token whose only audience is the requested address, without the trailing slash the SDK sends.
import crypto from "node:crypto";
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
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  UnauthorizedError,
  type OAuthClientProvider,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  OAuthClientInformationMixed,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMemoryTtlStore } from "../../core/ttl-store.js";
import type { EnvironmentRecord } from "../../modules/environments/domain/environment.js";
import { createEnvironmentGate } from "../../modules/environments/gate/environment-gate.js";
import { createEnvironmentSignIn } from "../../modules/environments/services/environment-signin.js";

const DOMAIN = "env.test";
const OWNER = "owner-sub";
const CALLBACK = "http://127.0.0.1:33418/callback";

let keys: { privateKey: CryptoKey; jwks: { keys: JWK[] } };

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  keys = {
    privateKey: pair.privateKey,
    jwks: {
      keys: [{ ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256" }],
    },
  };
});

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

async function listening(server: http.Server): Promise<number> {
  closers.push(
    () =>
      new Promise((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  );
  if (!server.listening)
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return (server.address() as AddressInfo).port;
}

// UNIT_BOUNDARY_DESCRIPTION: an MCP server with one tool, as an agent runs one in an Environment; it sees requests as the runtime's forward hands them on.
async function mcpApp(): Promise<{ port: number; seen: string[] }> {
  const seen: string[] = [];
  const server = http.createServer((req, res) => {
    seen.push(String(req.headers.authorization ?? ""));
    req.url = (req.url ?? "").replace(/^\/api\/environment\/forward\/\d+/, "");
    let body = "";
    req.on("data", (d: Buffer) => (body += d));
    req.on("end", () => {
      void (async () => {
        const mcp = new McpServer({ name: "team-tools", version: "1" });
        mcp.tool("echo", { text: z.string() }, ({ text }) => ({
          content: [{ type: "text", text: `echo: ${text}` }],
        }));
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
        });
        await mcp.connect(transport);
        await transport.handleRequest(
          req,
          res,
          body ? (JSON.parse(body) as unknown) : undefined,
        );
      })();
    });
  });
  return { port: await listening(server), seen };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The platform's Keycloak as an MCP client meets
 * it, with the keycloak-environments extension: RFC 8414 metadata, anonymous
 * registration, an authorization that the person allows and that names one
 * address as its resource, and a token endpoint for the code (with PKCE) and
 * refreshes. The token's only audience is the address without a trailing
 * slash, and a refresh keeps it.
 */
async function authorizationServer(people: Record<string, string>) {
  const app = new Hono();
  const codes = new Map<
    string,
    { person: string; resource: string; challenge: string }
  >();
  const refreshes = new Map<string, { person: string; resource: string }>();
  const asked: { resource: string; scope: string; consented: boolean }[] = [];
  let issuer = "";
  let next = "";
  const token = (person: string, resource: string) =>
    new SignJWT({
      email: people[person],
      email_verified: true,
      scope: "environments offline_access",
    })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(issuer)
      .setSubject(person === "owner" ? OWNER : person)
      .setAudience(resource)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(keys.privateKey);
  app.get("/.well-known/oauth-authorization-server", (c) =>
    c.json({
      issuer,
      authorization_endpoint: `${issuer}/auth`,
      token_endpoint: `${issuer}/token`,
      registration_endpoint: `${issuer}/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["environments", "offline_access"],
    }),
  );
  app.post("/register", async (c) => {
    const body: { redirect_uris: string[] } = await c.req.json();
    return c.json(
      {
        ...body,
        client_id: crypto.randomUUID(),
        token_endpoint_auth_method: "none",
      },
      201,
    );
  });
  app.get("/auth", (c) => {
    const q = c.req.query();
    const resource = (q.resource ?? "").replace(/\/$/, "");
    asked.push({
      resource: q.resource ?? "",
      scope: q.scope ?? "",
      consented: true,
    });
    const code = crypto.randomUUID();
    codes.set(code, {
      person: next,
      resource,
      challenge: q.code_challenge ?? "",
    });
    return c.redirect(`${q.redirect_uri}?code=${code}&state=${q.state ?? ""}`);
  });
  app.post("/token", async (c) => {
    const form = new URLSearchParams(await c.req.text());
    if (form.get("grant_type") === "authorization_code") {
      const grant = codes.get(form.get("code") ?? "");
      const verifier = form.get("code_verifier") ?? "";
      const challenge = crypto
        .createHash("sha256")
        .update(verifier)
        .digest("base64url");
      if (!grant || grant.challenge !== challenge)
        return c.json({ error: "invalid_grant" }, 400);
      const refresh = crypto.randomUUID();
      refreshes.set(refresh, grant);
      return c.json({
        access_token: await token(grant.person, grant.resource),
        token_type: "Bearer",
        expires_in: 300,
        refresh_token: refresh,
        scope: "environments offline_access",
      });
    }
    const held = refreshes.get(form.get("refresh_token") ?? "");
    if (!held) return c.json({ error: "invalid_grant" }, 400);
    return c.json({
      access_token: await token(held.person, held.resource),
      token_type: "Bearer",
      expires_in: 300,
      refresh_token: form.get("refresh_token"),
    });
  });
  const server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" });
  await new Promise((r) => server.once("listening", r));
  const port = await listening(server as unknown as http.Server);
  issuer = `http://127.0.0.1:${port}`;
  return {
    issuer,
    asked,
    signInAs: (person: string) => (next = person),
  };
}

async function world() {
  const app = await mcpApp();
  const as = await authorizationServer({
    owner: "owner@example.com",
    ana: "ana@example.com",
  });
  const lists = { members: ["ana@example.com"] };
  const sleep = { asleep: false };
  const record = (host: string): EnvironmentRecord => ({
    agentId: `agent-${host}`,
    owningAgentId: "agent-owning",
    owner: OWNER,
    name: host,
    host,
    endpoints: [{ name: "mcp", port: 4444 }],
    expiresAt: null,
    createdAt: new Date(),
  });
  const records = [record("pr-1-abcdef"), record("pr-2-abcdef")];
  const hono = new Hono();
  const server = serve({ fetch: hono.fetch, port: 0, hostname: "127.0.0.1" });
  await new Promise((r) => server.once("listening", r));
  const gatePort = await listening(server as unknown as http.Server);
  const gate = createEnvironmentGate({
    domain: DOMAIN,
    scheme: "http",
    port: gatePort,
    oauth: { issuer: as.issuer, keys: createLocalJWKSet(keys.jwks) },
    frontDoorUrl: () => "http://share.test/e",
    signOutUrl: () => "http://share.test/out",
    repo: { getByHost: async (h) => records.find((r) => r.host === h) ?? null },
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
      signedIn: createMemoryTtlStore(60_000),
      completions: createMemoryTtlStore(60_000),
      share: { alive: async () => true, end: async () => {} },
      addressUrl: (a) => `http://${a}.${DOMAIN}:${gatePort}`,
      now: () => Date.now(),
    }),
    platform: { issuers: [as.issuer], isApiKey: () => false },
    ensureReady: async (_id, { onWaking }) => {
      if (!sleep.asleep) return;
      onWaking();
      await new Promise((r) => setTimeout(r, 800));
      sleep.asleep = false;
    },
    stampActivity: async () => {},
    upstream: () => ({ host: "127.0.0.1", port: app.port }),
    brandName: "Test",
    wakeWaitMs: 5_000,
  });
  hono.use("*", gate.middleware);
  return { gatePort, as, lists, sleep, appSeen: app.seen };
}

// UNIT_BOUNDARY_DESCRIPTION: the SDK's fetch with the Environment address kept in the Host header, which Node's fetch would replace; every other request, the authorization server's included, is a normal fetch.
function viaGate(gatePort: number): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    if (!url.hostname.endsWith(`.${DOMAIN}`)) return fetch(input, init);
    const headers: Record<string, string> = { host: url.host };
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    headers.host = url.host;
    return new Promise<Response>((resolve, reject) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port: gatePort,
          path: url.pathname + url.search,
          method: init?.method ?? "GET",
          headers,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (d: Buffer) => chunks.push(d));
          res.on("end", () => {
            const out = new Headers();
            for (const [k, v] of Object.entries(res.headers))
              if (v !== undefined)
                out.set(k, Array.isArray(v) ? v.join(", ") : v);
            resolve(
              new Response(
                res.statusCode === 204 || res.statusCode === 202
                  ? null
                  : Buffer.concat(chunks),
                { status: res.statusCode!, headers: out },
              ),
            );
          });
        },
      );
      req.on("error", reject);
      if (init?.body) req.write(String(init.body));
      req.end();
    });
  }) as typeof fetch;
}

// UNIT_BOUNDARY_DESCRIPTION: a person's MCP client as an IDE keeps it: its registration and tokens in memory, and a "browser" that follows the authorization URL to the callback.
class PersonClient implements OAuthClientProvider {
  info: OAuthClientInformationMixed | undefined;
  saved: OAuthTokens | undefined;
  verifier = "";
  code = "";
  browserOpened = 0;
  get redirectUrl() {
    return CALLBACK;
  }
  get clientMetadata() {
    return {
      client_name: "IDE",
      redirect_uris: [CALLBACK],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "environments offline_access",
    };
  }
  clientInformation() {
    return this.info;
  }
  saveClientInformation(info: OAuthClientInformationMixed) {
    this.info = info;
  }
  tokens() {
    return this.saved;
  }
  saveTokens(tokens: OAuthTokens) {
    this.saved = tokens;
  }
  saveCodeVerifier(verifier: string) {
    this.verifier = verifier;
  }
  codeVerifier() {
    return this.verifier;
  }
  async redirectToAuthorization(url: URL) {
    this.browserOpened += 1;
    const answer = await fetch(url, { redirect: "manual" });
    this.code = new URL(answer.headers.get("location")!).searchParams.get(
      "code",
    )!;
  }
}

async function connect(gatePort: number, host: string, person: PersonClient) {
  const url = new URL(`http://${host}.${DOMAIN}:${gatePort}/mcp`);
  const opts = { authProvider: person, fetch: viaGate(gatePort) };
  const first = new Client({ name: "ide", version: "1" });
  try {
    await first.connect(new StreamableHTTPClientTransport(url, opts));
    return first;
  } catch (e) {
    if (!(e instanceof UnauthorizedError)) throw e;
  }
  await new StreamableHTTPClientTransport(url, opts).finishAuth(person.code);
  const mcp = new Client({ name: "ide", version: "1" });
  await mcp.connect(new StreamableHTTPClientTransport(url, opts));
  return mcp;
}

function text(result: Awaited<ReturnType<Client["callTool"]>>): string {
  return (result.content as { text: string }[])[0]!.text;
}

describe("the MCP SDK client at an Environment address", () => {
  // TEST_SCENARIO: AC-4, AC-5, AC-6 — the owner adds the address to their client and signs in once: the client finds the authorization server from the gate's 401, registers itself, asks for this one address with an offline session, and lists and calls the tools; the token never reaches the server. When the access token is no longer good, the client refreshes it with no browser and keeps working.
  it("signs the owner in once and stays connected", async () => {
    const { gatePort, as, appSeen } = await world();
    const owner = new PersonClient();
    as.signInAs("owner");

    const mcp = await connect(gatePort, "mcp-pr-1-abcdef", owner);
    expect(owner.browserOpened).toBe(1);
    expect(as.asked[0]!.resource).toMatch(
      new RegExp(`^http://mcp-pr-1-abcdef\\.env\\.test:${gatePort}/?$`),
    );
    expect(as.asked[0]!.scope).toContain("environments");
    expect(as.asked[0]!.scope).toContain("offline_access");
    expect((await mcp.listTools()).tools.map((t) => t.name)).toEqual(["echo"]);
    expect(
      text(await mcp.callTool({ name: "echo", arguments: { text: "hi" } })),
    ).toBe("echo: hi");
    expect(appSeen.every((a) => a === "")).toBe(true);

    owner.saved = { ...owner.saved!, access_token: "no.longer.good" };
    const later = await connect(gatePort, "mcp-pr-1-abcdef", owner);
    expect(
      text(
        await later.callTool({ name: "echo", arguments: { text: "next day" } }),
      ),
    ).toBe("echo: next day");
    expect(owner.browserOpened).toBe(1);
  });

  // TEST_SCENARIO: #6318 — the token one Environment's server could collect from the client opens no other Environment: the gate refuses it with invalid_token.
  it("keeps a token to the Environment it was signed in for", async () => {
    const { gatePort, as } = await world();
    const owner = new PersonClient();
    as.signInAs("owner");
    await connect(gatePort, "mcp-pr-1-abcdef", owner);

    const elsewhere = await viaGate(gatePort)(
      `http://mcp-pr-2-abcdef.${DOMAIN}:${gatePort}/mcp`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${owner.saved!.access_token}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      },
    );
    expect(elsewhere.status).toBe(401);
    expect(elsewhere.headers.get("www-authenticate")).toContain(
      'error="invalid_token"',
    );
  });

  // TEST_SCENARIO: AC-7, AC-8, AC-9 — a person on the Environment's list connects; while the Environment sleeps, their call wakes it and answers; once the owner removes them, their next call is refused.
  it("follows the lists and wakes a sleeping Environment", async () => {
    const { gatePort, as, lists, sleep } = await world();
    const ana = new PersonClient();
    as.signInAs("ana");
    const mcp = await connect(gatePort, "mcp-pr-1-abcdef", ana);
    expect((await mcp.listTools()).tools).toHaveLength(1);

    sleep.asleep = true;
    const started = Date.now();
    expect(
      text(await mcp.callTool({ name: "echo", arguments: { text: "awake" } })),
    ).toBe("echo: awake");
    expect(Date.now() - started).toBeGreaterThanOrEqual(500);

    lists.members = [];
    await expect(mcp.listTools()).rejects.toThrow(/insufficient_scope/);
  });
});
