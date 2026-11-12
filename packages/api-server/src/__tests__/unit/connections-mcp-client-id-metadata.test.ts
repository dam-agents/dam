import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { Connection, SecretRef } from "api-server-api";
import { connectionAuthConfigSchema } from "api-server-api";
import { createMemoryTtlStore } from "../../core/ttl-store.js";
import {
  createOAuthEngine,
  type OAuthEngine,
} from "../../modules/connections/infrastructure/oauth-engine.js";
import type { ConnectionsRepository } from "../../modules/connections/infrastructure/connections-repository.js";
import {
  oauthProviderFor,
  oauthProviderForSignIn,
  refreshOAuthAccessToken,
} from "../../modules/connections/services/oauth-token.js";
import { createOAuthFlowService } from "../../modules/connections/services/oauth-flow.js";
import { buildConnection } from "../../modules/connections/domain/build-connection.js";
import { buildCatalog } from "../../modules/connections/domain/catalog.js";
import { createConnectionTemplateRegistry } from "../../modules/connections/domain/connection-template.js";
import { createOAuthRoutes } from "../../modules/connections/oauth-routes.js";
import { createConnectionsService } from "../../modules/connections/services/connections-service.js";
import type { OAuthCallbackDeps } from "../../modules/connections/oauth-routes.js";
import type { SecretStore } from "../../modules/secret-store/index.js";
import { keyedMutex, unused } from "../helpers/connections-service.js";

/**
 * TEST_OVERVIEW: a Custom MCP server (OAuth) connection gets its client the
 * way the MCP authorization spec orders it: a client ID the user entered, else
 * the platform's Client ID Metadata Document URL when the authorization server
 * accepts one, else Dynamic Client Registration. The document is served at the
 * URL used as the client_id, without sign-in, and names the OAuth callback as
 * its only redirect URI.
 */

const AS = "https://auth.example.com";
const MCP_URL = "https://mcp.example.com/mcp";
const UI = "https://platform.example.com";
const CALLBACK = `${UI}/api/oauth/callback`;
const METADATA_URL = `${UI}/api/oauth/client-metadata.json`;

interface AsMetadata {
  registration?: boolean;
  cimd?: boolean;
  scopes?: string[];
}

function mcpServer(as: AsMetadata): { calls: string[] } {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (
        url ===
        "https://mcp.example.com/.well-known/oauth-protected-resource/mcp"
      )
        return Response.json({
          authorization_servers: [AS],
          ...(as.scopes ? { scopes_supported: as.scopes } : {}),
        });
      if (url === `${AS}/.well-known/oauth-authorization-server`)
        return Response.json({
          authorization_endpoint: `${AS}/authorize`,
          token_endpoint: `${AS}/token`,
          ...(as.registration
            ? { registration_endpoint: `${AS}/register` }
            : {}),
          ...(as.cimd ? { client_id_metadata_document_supported: true } : {}),
        });
      if (url === `${AS}/register` && init?.method === "POST")
        return Response.json({ client_id: "dcr-client" });
      return new Response("not found", { status: 404 });
    },
  );
  return { calls };
}

function mintRef(purpose: string): SecretRef {
  return { storeId: "k8s", path: `secret-${purpose}`, field: "" };
}

function mcpOAuthTemplate() {
  const t = buildCatalog().find((t) => t.id === "custom-mcp-oauth");
  if (!t) throw new Error("custom-mcp-oauth template missing from catalog");
  return t;
}

function build(callbackUrl = CALLBACK, clientId?: string, mcpUrl = MCP_URL) {
  return buildConnection(
    mcpOAuthTemplate(),
    {
      templateId: "custom-mcp-oauth",
      authKind: "oauth",
      name: "mcp",
      url: mcpUrl,
      ...(clientId ? { clientId } : {}),
    },
    mintRef,
    callbackUrl,
    "Test",
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("custom MCP OAuth client", () => {
  // TEST_SCENARIO: failed discovery, changed authorization servers, and changed resource identifiers stop sign-in before a pending OAuth flow; degraded root metadata keeps the stored audience and requested scopes.
  it.each([
    "unavailable",
    "changed-server",
    "changed-resource",
    "degraded-root",
  ])("handles %s metadata before authorization", async (failure) => {
    mcpServer({ cimd: true, scopes: ["mcp:read"] });
    const built = await build();
    const origin = "https://mcp.example.com";
    const auth = connectionAuthConfigSchema.parse({
      ...built.auth,
      ...(failure === "changed-resource" ? { resource: origin } : {}),
      ...(failure === "degraded-root"
        ? {
            resource: origin,
            authorizationUrl: `${origin}/authorize`,
            tokenUrl: `${origin}/token`,
          }
        : {}),
    });
    const conn: Connection = {
      id: "conn-gate",
      ownerId: "owner",
      templateId: "custom-mcp-oauth",
      name: "mcp",
      inputs: { url: MCP_URL },
      auth,
      contributions: built.contributions,
    };
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = String(input);
      if (
        (failure === "changed-server" || failure === "changed-resource") &&
        url.includes("oauth-protected-resource")
      )
        return Response.json({
          resource: MCP_URL,
          authorization_servers: [AS],
          scopes_supported: ["mcp:read"],
        });
      if (
        (failure === "changed-server" || failure === "changed-resource") &&
        url === `${AS}/.well-known/oauth-authorization-server`
      )
        return Response.json({
          authorization_endpoint: `${AS}/authorize`,
          token_endpoint:
            failure === "changed-server"
              ? `${AS}/different-token`
              : `${AS}/token`,
        });
      if (
        failure === "degraded-root" &&
        url === `${origin}/.well-known/oauth-authorization-server`
      )
        return Response.json({
          authorization_endpoint: `${origin}/authorize`,
          token_endpoint: `${origin}/token`,
        });
      return new Response("unavailable", { status: 503 });
    });
    const engine = createOAuthEngine({
      pendingStore: createMemoryTtlStore(600_000),
    });
    const start = vi.spyOn(engine, "start");
    const flow = createOAuthFlowService({
      engine,
      ownerId: "owner",
      callbackUrl: CALLBACK,
      templates: createConnectionTemplateRegistry(buildCatalog()),
      secretStore: unused(),
      repo: unused<ConnectionsRepository>({ get: async () => conn }),
      connectionLock: keyedMutex(),
      githubAppEngine: unused(),
      runtimeMutator: unused(),
    });
    if (failure === "degraded-root") {
      const started = new URL((await flow.startOAuth(conn.id)).authUrl);
      expect(started.searchParams.get("resource")).toBe(origin);
      expect(started.searchParams.get("scope")).toBe("mcp:read");
      expect(start).toHaveBeenCalledOnce();
      return;
    }
    await expect(flow.startOAuth(conn.id)).rejects.toThrow(
      failure === "changed-server"
        ? /authorization server changed/
        : failure === "changed-resource"
          ? /resource metadata changed/
          : /metadata.*try signing in again/,
    );
    expect(start).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: an authorization server can grant extra scopes. A completed legacy sign-in preserves those grants separately from the requested MCP scopes, and a metadata outage after authorization cannot change or break the pending exchange.
  it.each(["protected-resource", "authorization-server"])(
    "keeps a legacy connection's configuration through %s discovery, callback and refresh",
    async (source) => {
      mcpServer({ cimd: true, scopes: ["mcp:read"] });
      const built = await build();
      let conn: Connection = {
        id: "conn-old",
        ownerId: "owner",
        templateId: "custom-mcp-oauth",
        name: "old",
        inputs: { url: MCP_URL },
        contributions: built.contributions,
        auth: connectionAuthConfigSchema.parse({
          ...built.auth,
          resource: undefined,
          requestedScopes: undefined,
          scopes: ["openid", "service_account"],
        }),
      };
      const templates = createConnectionTemplateRegistry(buildCatalog());
      const secretStore = unused<SecretStore>({
        putFields: async () => {},
        getField: async () => "refresh",
      });
      const requests: URLSearchParams[] = [];
      const engine = createOAuthEngine({
        pendingStore: createMemoryTtlStore(600_000),
        fetchImpl: (async (_url: RequestInfo | URL, init?: RequestInit) => {
          requests.push(new URLSearchParams(String(init?.body)));
          return Response.json({
            access_token: "access",
            refresh_token: "refresh",
            scope: "openid service_account",
          });
        }) as typeof fetch,
      });
      const flow = createOAuthFlowService({
        engine,
        templates,
        secretStore,
        ownerId: "owner",
        callbackUrl: CALLBACK,
        connectionLock: keyedMutex(),
        githubAppEngine: unused(),
        runtimeMutator: unused(),
        repo: unused<ConnectionsRepository>({
          get: async () => conn,
          updateAuth: async (_id, auth) => {
            conn = { ...conn, auth };
          },
        }),
      });
      const resource = source === "protected-resource" ? MCP_URL : null;
      if (source === "authorization-server")
        vi.stubGlobal("fetch", async (input: RequestInfo | URL) =>
          String(input) ===
          "https://mcp.example.com/.well-known/oauth-authorization-server"
            ? Response.json({
                authorization_endpoint: `${AS}/authorize`,
                token_endpoint: `${AS}/token`,
              })
            : new Response("unavailable", { status: 503 }),
        );
      const started = new URL((await flow.startOAuth(conn.id)).authUrl);
      expect(started.searchParams.get("scope")).toBe(
        resource ? "mcp:read" : null,
      );
      expect(started.searchParams.get("resource")).toBe(resource);
      vi.stubGlobal(
        "fetch",
        vi.fn().mockRejectedValue(new Error("MCP unavailable")),
      );
      await flow.completeOAuth(started.searchParams.get("state")!, "code");
      expect(conn.auth).toMatchObject({
        scopes: ["openid", "service_account"],
      });
      if (resource)
        expect(conn.auth).toMatchObject({
          resource,
          requestedScopes: ["mcp:read"],
        });
      else {
        if (conn.auth.kind !== "oauth") throw new Error("expected OAuth auth");
        expect(conn.auth.resource).toBeUndefined();
        expect(conn.auth.requestedScopes).toBeUndefined();
      }
      if (conn.auth.kind !== "oauth") throw new Error("expected OAuth auth");
      const provider = await oauthProviderFor({
        conn,
        auth: conn.auth,
        templates,
        secretStore,
      });
      expect(provider.scopes).toEqual(
        resource ? ["mcp:read"] : ["openid", "service_account"],
      );
      await refreshOAuthAccessToken({
        conn,
        auth: conn.auth,
        templates,
        secretStore,
        engine,
        githubAppEngine: unused(),
        children: unused(),
      });
      expect(requests.map((body) => body.get("resource"))).toEqual([
        resource,
        resource,
      ]);
      expect(fetch).not.toHaveBeenCalled();
      mcpServer({ cimd: true, scopes: ["mcp:read"] });
      const next = new URL((await flow.startOAuth(conn.id)).authUrl);
      expect(next.searchParams.get("scope")).toBe("mcp:read");
      expect(next.searchParams.get("resource")).toBe(MCP_URL);
    },
  );

  // TEST_SCENARIO: refreshing an existing unbound connection needs its token endpoint, not a new metadata request to the MCP server.
  it("refreshes a legacy connection while MCP metadata is unavailable", async () => {
    mcpServer({ cimd: true });
    const built = await build();
    const auth = connectionAuthConfigSchema.parse({
      ...built.auth,
      resource: undefined,
      requestedScopes: undefined,
    });
    if (auth.kind !== "oauth") throw new Error("expected OAuth auth");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("MCP unavailable")),
    );
    const result = await refreshOAuthAccessToken({
      conn: {
        id: "conn-old",
        ownerId: "owner",
        templateId: "custom-mcp-oauth",
        name: "old",
        inputs: { url: MCP_URL },
        auth,
        contributions: built.contributions,
      },
      auth,
      templates: createConnectionTemplateRegistry(buildCatalog()),
      secretStore: unused<SecretStore>({
        getField: async () => "refresh",
        putFields: async () => {},
      }),
      engine: unused<OAuthEngine>({
        refresh: async () => ({ accessToken: "next", expiresAt: 1234 }),
      }),
      githubAppEngine: unused(),
      children: unused(),
    });
    expect(result.expiresAt).toBe(1234);
    expect(fetch).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: a reconnect of a stored connection predating resource binding must replace its old realm-wide scopes with current resource metadata, even when its template carries unrelated scopes.
  it("rediscovers scopes and the resource for a legacy connection", async () => {
    mcpServer({ cimd: true, scopes: ["mcp:read"] });
    const built = await build();
    const auth = connectionAuthConfigSchema.parse({
      ...built.auth,
      resource: undefined,
      scopes: ["openid", "service_account"],
    });
    if (auth.kind !== "oauth") throw new Error("expected OAuth auth");
    const template = mcpOAuthTemplate();
    if (template.authKind !== "oauth")
      throw new Error("expected OAuth template");
    const provider = await oauthProviderForSignIn({
      conn: {
        id: "conn-old",
        ownerId: "owner",
        templateId: template.id,
        name: "old",
        inputs: { url: MCP_URL },
        auth,
        contributions: built.contributions,
      },
      auth,
      templates: createConnectionTemplateRegistry([
        { ...template, scopes: ["legacy-template-scope"] },
      ]),
      secretStore: unused<SecretStore>(),
    });
    expect(provider.scopes).toEqual(["mcp:read"]);
    expect(provider.resource).toBe(MCP_URL);
  });

  // TEST_SCENARIO: a resource server accepts only tokens issued for its own identifier. That identifier must survive stored auth parsing and appear on authorization, code exchange and refresh requests.
  it("binds the MCP connection's entire OAuth flow to its resource", async () => {
    mcpServer({ cimd: true });
    const mcpUrl = `${MCP_URL}?tenant=example#view`;
    const built = await build(CALLBACK, undefined, mcpUrl);
    const auth = connectionAuthConfigSchema.parse(built.auth);
    if (auth.kind !== "oauth") throw new Error("expected OAuth auth");
    const provider = await oauthProviderFor({
      conn: {
        id: "conn-mcp",
        ownerId: "owner",
        templateId: "custom-mcp-oauth",
        name: "mcp",
        inputs: { url: mcpUrl },
        auth,
        contributions: built.contributions,
      },
      auth,
      templates: createConnectionTemplateRegistry(buildCatalog()),
      secretStore: unused<SecretStore>(),
    });
    const tokenRequests: URLSearchParams[] = [];
    const engine = createOAuthEngine({
      pendingStore: createMemoryTtlStore(600_000),
      fetchImpl: (async (_url: RequestInfo | URL, init?: RequestInit) => {
        tokenRequests.push(new URLSearchParams(String(init?.body)));
        return Response.json({
          access_token: "access",
          refresh_token: "refresh",
        });
      }) as typeof fetch,
    });

    const started = await engine.start({
      provider,
      redirectUri: CALLBACK,
      ctx: {},
    });
    expect(new URL(started.authUrl).searchParams.get("resource")).toBe(MCP_URL);
    const pending = await engine.consume(started.state);
    if (!pending) throw new Error("expected pending OAuth flow");
    await engine.exchange(pending, "code");
    await engine.refresh({ provider, refreshToken: "refresh" });

    expect(tokenRequests.map((body) => body.get("resource"))).toEqual([
      MCP_URL,
      MCP_URL,
    ]);
  });

  // TEST_SCENARIO: the authorization server accepts a metadata document and has no registration endpoint. Before, this server could not be connected at all; now the document URL is the client ID.
  it("uses the metadata document URL when the server accepts one", async () => {
    mcpServer({ cimd: true });

    const built = await build();

    expect(built.auth).toMatchObject({
      kind: "oauth",
      clientId: METADATA_URL,
      authorizationUrl: `${AS}/authorize`,
      tokenUrl: `${AS}/token`,
    });
    expect(built.auth).not.toHaveProperty("clientSecretRef");
    expect(built.secrets.size).toBe(0);
  });

  // TEST_SCENARIO: a server that offers both is not registered with: the spec puts the metadata document before DCR, and each registration leaves one more client on the server.
  it("prefers the metadata document over registration", async () => {
    const { calls } = mcpServer({ cimd: true, registration: true });

    const built = await build();

    expect(built.auth).toMatchObject({ clientId: METADATA_URL });
    expect(calls.filter((c) => c.startsWith("POST"))).toEqual([]);
  });

  // TEST_SCENARIO: a server without metadata document support keeps the DCR path that works today.
  it("falls back to registration", async () => {
    const { calls } = mcpServer({ registration: true });

    const built = await build();

    expect(built.auth).toMatchObject({ clientId: "dcr-client" });
    expect(calls).toContain(`POST ${AS}/register`);
  });

  // TEST_SCENARIO: an authorization server only fetches an HTTPS client_id, so a deployment served over plain HTTP (a local cluster) registers instead of sending a client ID the server refuses.
  it("registers when the platform is not served over HTTPS", async () => {
    mcpServer({ cimd: true, registration: true });

    const built = await build("http://localhost:4444/api/oauth/callback");

    expect(built.auth).toMatchObject({ clientId: "dcr-client" });
  });

  // TEST_SCENARIO: a client ID the user entered wins over both, as a pre-registered client does in the spec.
  it("keeps a client ID the user entered", async () => {
    const { calls } = mcpServer({ cimd: true, registration: true });

    const built = await build(CALLBACK, "pre-registered");

    expect(built.auth).toMatchObject({ clientId: "pre-registered" });
    expect(calls.filter((c) => c.startsWith("POST"))).toEqual([]);
  });

  // TEST_SCENARIO: with neither option the build fails and tells the user what to enter instead.
  it("fails with neither registration nor a metadata document", async () => {
    mcpServer({});

    await expect(build()).rejects.toThrow(/enter a client ID/);
  });
});

describe("discoverMcp", () => {
  function service(callbackUrl = CALLBACK) {
    return createConnectionsService({
      damConnectionOffered: async () => true,
      harnesses: { default: "claude-code", harnesses: [] },
      ownerId: "owner",
      templates: createConnectionTemplateRegistry(buildCatalog()),
      repo: unused(),
      secretStore: unused<SecretStore>(),
      fanOut: unused(),
      oauthFlow: unused(),
      oauthEngine: unused(),
      githubAppEngine: unused(),
      s3CredentialProbe: unused(),
      providerBalance: unused(),
      credentialProbe: unused(),
      providerKeyProbe: unused(),
      providerModelCatalog: unused(),
      oauthCallbackUrl: callbackUrl,
      brandName: "Test",
      connectionLock: (_key, fn) => fn(),
      isOwnedAgent: async () => true,
      resolveKbShare: unused(),
    });
  }

  // TEST_SCENARIO: the create form and the CLI pick the OAuth template from this answer; a server that accepts only a metadata document is an OAuth server, not an auth-less one.
  it("reports OAuth for a server that accepts only a metadata document", async () => {
    mcpServer({ cimd: true });

    await expect(service().discoverMcp({ url: MCP_URL })).resolves.toEqual({
      auth: "oauth",
    });
  });

  // TEST_SCENARIO: on a deployment served over plain HTTP the create path cannot use a metadata document, so discovery must not offer OAuth that create then refuses.
  it("reports none for a metadata-document-only server on a plain-HTTP deployment", async () => {
    mcpServer({ cimd: true });

    await expect(
      service("http://localhost:4444/api/oauth/callback").discoverMcp({
        url: MCP_URL,
      }),
    ).resolves.toEqual({ auth: "none" });
  });

  // TEST_SCENARIO: a server with neither way to get a client stays reported as auth-less, as before.
  it("reports none when the server offers no way to get a client", async () => {
    mcpServer({});

    await expect(service().discoverMcp({ url: MCP_URL })).resolves.toEqual({
      auth: "none",
    });
  });
});

describe("client ID metadata document route", () => {
  // TEST_SCENARIO: the authorization server fetches the document at the client_id URL and checks that client_id equals that URL and that the redirect URI of the request is listed.
  it("serves the document at the URL used as the client ID", async () => {
    const app = new Hono().route(
      "/api/oauth",
      createOAuthRoutes(
        unused<OAuthCallbackDeps>({ uiBaseUrl: UI, brandName: "Test" }),
      ),
    );

    const res = await app.request(new URL(METADATA_URL).pathname);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      client_id: METADATA_URL,
      client_name: "Test Agent Platform",
      client_uri: UI,
      redirect_uris: [CALLBACK],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    });
  });
});
