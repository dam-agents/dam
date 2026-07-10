import { describe, it, expect, vi } from "vitest";
import type { Connection, ConnectionAuthConfig } from "api-server-api";

vi.mock(
  "../../modules/connections/infrastructure/mcp-discovery.js",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    discoverIssuerMetadata: async () => ({
      tokenEndpoint: "https://auth.example.com/realms/main/token",
      grantTypesSupported: ["client_credentials"],
    }),
  }),
);
import { createConnectionsService } from "../../modules/connections/services/connections-service.js";
import { createConnectionTemplateRegistry } from "../../modules/connections/domain/connection-template.js";
import { buildCatalog } from "../../modules/connections/domain/catalog.js";
import { createOAuthEngine } from "../../modules/connections/infrastructure/oauth-engine.js";
import { sdsFileKeyForHost } from "../../modules/connections/domain/connection-sds.js";
import type { ConnectionsRepository } from "../../modules/connections/infrastructure/connections-repository.js";
import type { SecretStore } from "../../modules/secret-store/index.js";
import type { OAuthFlowService } from "../../modules/connections/services/oauth-flow.js";

const NOW_MS = 1_800_000_000_000;
const OWNER = "owner-sub";

function makeRepoFake() {
  const rows = new Map<string, Connection>();
  const repo: ConnectionsRepository = {
    insert: async (input) => {
      rows.set(input.id, { ...input });
    },
    listByOwner: async (ownerId) =>
      [...rows.values()].filter((c) => c.ownerId === ownerId),
    get: async (id, ownerId) => {
      const c = rows.get(id);
      return c && c.ownerId === ownerId ? c : null;
    },
    updateAuth: async (id, auth) => {
      const c = rows.get(id);
      if (c) rows.set(id, { ...c, auth });
    },
    updateContributions: async () => {},
    delete: async (id) => {
      rows.delete(id);
    },
    grant: async () => {},
    revoke: async () => {},
    listAgentGrants: async () => [],
    listConnectionsForAgent: async () => [],
    listAgentsForConnection: async () => [],
    revokeAllForAgent: async () => {},
    listDistinctGrantAgentIds: async () => [],
  };
  return { repo, rows };
}

function makeSecretStoreFake() {
  const stored = new Map<string, Record<string, string>>();
  const deleted: string[] = [];
  const store: SecretStore = {
    storeId: "test",
    mintRef: (meta) => ({
      storeId: "test",
      path: `secret-${meta.purpose}`,
      field: "",
    }),
    put: async (ref, fields) => {
      stored.set(ref.path, { ...fields });
    },
    putField: async () => {},
    putFields: async (ref, fields) => {
      stored.set(ref.path, { ...(stored.get(ref.path) ?? {}), ...fields });
    },
    get: async (ref) => stored.get(ref.path) ?? null,
    getField: async (ref) => stored.get(ref.path)?.[ref.field] ?? null,
    delete: async (ref) => {
      deleted.push(ref.path);
      stored.delete(ref.path);
    },
    list: async () => [],
  };
  return { store, stored, deleted };
}

function makeService(
  respond: (body: URLSearchParams) => Response = () =>
    new Response(JSON.stringify({ access_token: "tok-1", expires_in: 120 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
) {
  const { repo, rows } = makeRepoFake();
  const { store, stored, deleted } = makeSecretStoreFake();
  const tokenCalls: URLSearchParams[] = [];
  const engine = createOAuthEngine({
    now: () => NOW_MS,
    fetchImpl: (async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = new URLSearchParams(String(init?.body));
      tokenCalls.push(body);
      return respond(body);
    }) as typeof fetch,
  });
  const oauthFlow: OAuthFlowService = {
    startOAuth: async () => {
      throw new Error("startOAuth must not be called for client-credentials");
    },
    completeOAuth: async () => {
      throw new Error("completeOAuth must not be called");
    },
  };
  const svc = createConnectionsService({
    ownerId: OWNER,
    templates: createConnectionTemplateRegistry(buildCatalog()),
    repo,
    secretStore: store,
    fanOut: { apply: async () => {} },
    oauthFlow,
    oauthEngine: engine,
    oauthCallbackUrl: "https://cb.example/oauth/callback",
    brandName: "Test",
  });
  return { svc, rows, stored, deleted, tokenCalls };
}

function createInput(overrides: Record<string, string> = {}) {
  return {
    templateId: "custom-client-credentials",
    name: "my-api",
    authKind: "client-credentials" as const,
    host: "api.example.com",
    issuerUrl: "https://auth.example.com/realms/main",
    clientId: "cid",
    clientSecret: "csecret",
    ...overrides,
  };
}

const SECRET_PATH = "secret-connection:custom-client-credentials";

describe("client-credentials connection create", () => {
  it("mints once and persists secret, token, SDS, and auth markers", async () => {
    const { svc, rows, stored, tokenCalls } = makeService();
    const id = await svc.createFromTemplate(createInput());

    expect(tokenCalls).toHaveLength(1);
    expect(tokenCalls[0].get("grant_type")).toBe("client_credentials");

    const fields = stored.get(SECRET_PATH)!;
    expect(fields.client_secret).toBe("csecret");
    expect(fields.access_token).toBe("tok-1");
    expect(fields[sdsFileKeyForHost("api.example.com")]).toContain(
      "Bearer tok-1",
    );

    const conn = rows.get(id)!;
    expect(conn.auth.kind).toBe("client-credentials");
    if (conn.auth.kind !== "client-credentials") return;
    expect(conn.auth.expiresAt).toBe(Math.floor(NOW_MS / 1000) + 120);
    expect(conn.auth.connectedAt).toBeGreaterThan(0);
    expect(JSON.stringify(conn.inputs)).not.toContain("csecret");

    const view = await svc.getConnection(id);
    expect(view?.status).toBe("active");
    expect(view?.authKind).toBe("client-credentials");
  });

  it("persists nothing when the token endpoint rejects the credentials", async () => {
    const { svc, rows, stored } = makeService(
      () => new Response("unauthorized", { status: 401 }),
    );
    await expect(svc.createFromTemplate(createInput())).rejects.toThrow(/401/);
    expect(rows.size).toBe(0);
    expect(stored.size).toBe(0);
  });

  it("falls back to a one-hour horizon when the provider returns no expiry", async () => {
    const { svc, rows } = makeService(
      () =>
        new Response(JSON.stringify({ access_token: "tok-1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const before = Math.floor(Date.now() / 1000);
    const id = await svc.createFromTemplate(createInput());
    const after = Math.floor(Date.now() / 1000);
    const auth = rows.get(id)!.auth;
    if (auth.kind !== "client-credentials") throw new Error("wrong kind");
    // The fallback horizon is stamped from the wall clock, not the engine's.
    expect(auth.expiresAt).toBeGreaterThanOrEqual(before + 3600);
    expect(auth.expiresAt).toBeLessThanOrEqual(after + 3600);
  });

  it("delete removes the single shared secret exactly once", async () => {
    const { svc, deleted } = makeService();
    const id = await svc.createFromTemplate(createInput());
    await svc.deleteConnection(id);
    expect(deleted).toEqual([SECRET_PATH]);
  });

  it("reports expired once the token horizon has passed", async () => {
    const { svc, rows } = makeService();
    const id = await svc.createFromTemplate(createInput());
    const conn = rows.get(id)!;
    const auth: ConnectionAuthConfig = {
      ...(conn.auth as Extract<
        ConnectionAuthConfig,
        { kind: "client-credentials" }
      >),
      expiresAt: Math.floor(Date.now() / 1000) - 60,
    };
    rows.set(id, { ...conn, auth });
    const view = await svc.getConnection(id);
    expect(view?.status).toBe("expired");
  });

  it("exposes the injected host on the view", async () => {
    const { svc } = makeService();
    const id = await svc.createFromTemplate(createInput());
    const view = await svc.getConnection(id);
    expect(view?.host).toBe("api.example.com");
    expect(view?.hosts).toEqual(["api.example.com"]);
  });

  it("rejects a value update — rotation stays header-only", async () => {
    const { svc } = makeService();
    const id = await svc.createFromTemplate(createInput());
    await expect(svc.update(id, "new-secret")).rejects.toThrow(
      /header-credential/,
    );
  });
});
