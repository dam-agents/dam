import { describe, it, expect } from "vitest";
import {
  connectionAuthConfigSchema,
  type Connection,
  type ConnectionAuthConfig,
} from "api-server-api";
import { createMemoryTtlStore } from "../../core/ttl-store.js";
import { createConnectionsService } from "../../modules/connections/services/connections-service.js";
import { createConnectionTemplateRegistry } from "../../modules/connections/domain/connection-template.js";
import { buildCatalog } from "../../modules/connections/domain/catalog.js";
import {
  createOAuthEngine,
  type OAuthEngine,
} from "../../modules/connections/infrastructure/oauth-engine.js";
import { createGitHubAppEngine } from "../../modules/connections/infrastructure/github-app-engine.js";
import { sdsFileKeyForHost } from "../../modules/connections/domain/connection-sds.js";
import { parseGitHubUserTokenScope } from "../../modules/connections/domain/github-user-token-scope.js";
import { refreshOAuthAccessToken } from "../../modules/connections/services/oauth-token.js";
import type { ConnectionsRepository } from "../../modules/connections/infrastructure/connections-repository.js";
import type { SecretStore } from "../../modules/secret-store/index.js";
import type { OAuthFlowService } from "../../modules/connections/services/oauth-flow.js";

/**
 * TEST_OVERVIEW: a GitHub sign-in connection made through a GitHub App holds
 * a user token (ghu_). It may be narrowed to one account, some repositories
 * and some permissions. The platform keeps the full user token at rest and
 * injects only a scoped token that GitHub derives from it, at every renewal,
 * at re-consent and when the scope is edited.
 */

const NOW_MS = 1_800_000_000_000;
const NOW_SEC = Math.floor(NOW_MS / 1000);
const OWNER = "owner-sub";
const SECRET_PATH = "secret-conn";
const API_HOST_SDS = sdsFileKeyForHost("api.github.com");

type OAuthAuth = Extract<ConnectionAuthConfig, { kind: "oauth" }>;

const AUTH: OAuthAuth = {
  kind: "oauth",
  clientId: "Iv1.client",
  refreshTokenRef: {
    storeId: "test",
    path: SECRET_PATH,
    field: "refresh_token",
  },
  accessTokenRef: { storeId: "test", path: SECRET_PATH, field: "access_token" },
  scopes: [],
  tokenUrl: "https://github.com/login/oauth/access_token",
  authorizationUrl: "https://github.com/login/oauth/authorize",
  expiresAt: NOW_SEC + 60,
  connectedAt: NOW_SEC - 3600,
  tokenEndpointAcceptJson: true,
};

const SCOPE = {
  targetId: 42,
  repositoryIds: [7] as [number],
  permissions: { contents: "read" },
};

function connection(auth: OAuthAuth, templateId = "github"): Connection {
  return {
    id: "conn-1",
    ownerId: OWNER,
    templateId,
    name: "my-github",
    inputs: {},
    auth,
    contributions: [
      {
        kind: "egress-inject",
        host: "api.github.com",
        headerName: "Authorization",
        valueFormat: "Bearer {value}",
      },
    ],
  };
}

interface RecordedCall {
  url: string;
  method: string | undefined;
  headers: Record<string, string>;
  body: string | undefined;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function scopedTokenResponse(token = "ghu_scoped"): Response {
  return jsonResponse({
    token,
    expires_at: new Date((NOW_SEC + 1800) * 1000).toISOString(),
    installation: { account: { login: "acme" } },
  });
}

function makeEngine(respond: (call: RecordedCall) => Response) {
  const calls: RecordedCall[] = [];
  const engine = createGitHubAppEngine({
    now: () => NOW_MS,
    fetchImpl: (async (url: RequestInfo | URL, init?: RequestInit) => {
      const call: RecordedCall = {
        url: String(url),
        method: init?.method,
        headers: (init?.headers as Record<string, string>) ?? {},
        body: typeof init?.body === "string" ? init.body : undefined,
      };
      calls.push(call);
      return respond(call);
    }) as typeof fetch,
  });
  return { engine, calls };
}

function makeSecretStoreFake(initial: Record<string, string>) {
  const stored = new Map<string, Record<string, string>>([
    [SECRET_PATH, { ...initial }],
  ]);
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
      stored.delete(ref.path);
    },
    list: async () => [],
  };
  return { store, secret: () => stored.get(SECRET_PATH) ?? {} };
}

function makeRepoFake(initial: Connection) {
  const rows = new Map<string, Connection>([[initial.id, initial]]);
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
    mergeInputs: async () => {},
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

const templates = createConnectionTemplateRegistry(
  buildCatalog({ github: { clientId: "Iv1.client", clientSecret: "shh" } }),
);

function refreshingEngine(): OAuthEngine {
  return {
    refresh: async () => ({
      accessToken: "ghu_user2",
      refreshToken: "ghr_2",
      expiresAt: NOW_SEC + 28800,
    }),
  } as unknown as OAuthEngine;
}

function makeService(
  initial: Connection,
  respond: (call: RecordedCall) => Response,
) {
  const { repo, rows } = makeRepoFake(initial);
  const { store, secret } = makeSecretStoreFake({
    access_token: "ghu_user",
    refresh_token: "ghr_1",
    [API_HOST_SDS]: "previous-injection",
  });
  const { engine, calls } = makeEngine(respond);
  const oauthFlow: OAuthFlowService = {
    startOAuth: async () => {
      throw new Error("startOAuth must not be called");
    },
    completeOAuth: async () => {
      throw new Error("completeOAuth must not be called");
    },
  };
  const svc = createConnectionsService({
    ownerId: OWNER,
    templates,
    repo,
    secretStore: store,
    fanOut: { apply: async () => {} },
    oauthFlow,
    oauthEngine: createOAuthEngine({
      pendingStore: createMemoryTtlStore(600_000),
      now: () => NOW_MS,
    }),
    githubAppEngine: engine,
    oauthCallbackUrl: "https://cb.example/oauth/callback",
    brandName: "Test",
    connectionLock: <T>(_key: string, fn: () => Promise<T>): Promise<T> => fn(),
    resolveKbShare: async () => null,
  });
  return { svc, rows, secret, calls };
}

describe("GitHub user token scoping — engine", () => {
  it("asks GitHub for a scoped token with the app's client credentials", async () => {
    const { engine, calls } = makeEngine(() => scopedTokenResponse());
    const out = await engine.scopeUserToken({
      id: "connection:conn-1:github",
      apiBaseUrl: "https://api.github.com/",
      clientId: "Iv1.client",
      clientSecret: "shh",
      accessToken: "ghu_user",
      targetId: 42,
      repositoryIds: [7, 8],
      permissions: { contents: "read" },
    });

    expect(out).toEqual({
      accessToken: "ghu_scoped",
      expiresAt: NOW_SEC + 1800,
      accountLogin: "acme",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      "https://api.github.com/applications/Iv1.client/token/scoped",
    );
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.headers.Authorization).toBe(
      `Basic ${Buffer.from("Iv1.client:shh").toString("base64")}`,
    );
    expect(JSON.parse(calls[0]!.body!)).toEqual({
      access_token: "ghu_user",
      target_id: 42,
      repository_ids: [7, 8],
      permissions: { contents: "read" },
    });
  });

  it("classifies a scope GitHub cannot cover as a rejected grant", async () => {
    const { engine } = makeEngine(() =>
      jsonResponse({ message: "Validation Failed" }, 422),
    );
    const err = await engine
      .scopeUserToken({
        id: "connection:conn-1:github",
        apiBaseUrl: "https://api.github.com",
        clientId: "Iv1.client",
        clientSecret: "shh",
        accessToken: "ghu_user",
        targetId: 42,
      })
      .catch((e: unknown) => e);
    expect(err).toMatchObject({
      name: "OAuthTokenEndpointError",
      status: 422,
      oauthError: "invalid_grant",
    });
  });

  it("lists the installations a sign-in reaches, each with its repositories", async () => {
    const { engine, calls } = makeEngine((call) => {
      if (call.url.includes("/user/installations?")) {
        return jsonResponse({
          installations: [
            {
              id: 100,
              target_id: 42,
              account: { id: 42, login: "acme" },
              permissions: { contents: "write", metadata: "read" },
              repository_selection: "selected",
            },
            {
              id: 200,
              target_id: 43,
              account: { id: 43, login: "me" },
              permissions: { issues: "read" },
              repository_selection: "all",
            },
          ],
        });
      }
      if (call.url.includes("/user/installations/100/repositories")) {
        return jsonResponse({ repositories: [{ id: 7, name: "docs" }] });
      }
      return jsonResponse({ message: "Not Found" }, 404);
    });

    const out = await engine.readUserInstallations({
      id: "connection:conn-1:github",
      apiBaseUrl: "https://api.github.com",
      accessToken: "ghu_user",
    });

    expect(calls[0]!.headers.Authorization).toBe("Bearer ghu_user");
    expect(out.installations).toEqual([
      {
        installationId: 100,
        targetId: 42,
        accountLogin: "acme",
        permissions: { contents: "write", metadata: "read" },
        repositorySelection: "selected",
        repositories: [{ id: 7, name: "docs" }],
      },
      {
        installationId: 200,
        targetId: 43,
        accountLogin: "me",
        permissions: { issues: "read" },
        repositorySelection: "all",
        repositories: [],
        repositoriesUnavailable: '404 {"message":"Not Found"}',
      },
    ]);
  });
});

describe("GitHub user token scoping — renewal", () => {
  it("keeps the user token at rest and injects only the scoped token", async () => {
    const { store, secret } = makeSecretStoreFake({
      access_token: "ghu_user",
      refresh_token: "ghr_1",
    });
    const { engine, calls } = makeEngine(() => scopedTokenResponse());
    const auth = { ...AUTH, githubUserTokenScope: SCOPE };

    const out = await refreshOAuthAccessToken({
      conn: connection(auth),
      auth,
      engine: refreshingEngine(),
      githubAppEngine: engine,
      templates,
      secretStore: store,
    });

    expect(out.expiresAt).toBe(NOW_SEC + 1800);
    expect(JSON.parse(calls[0]!.body!).access_token).toBe("ghu_user2");
    expect(secret().access_token).toBe("ghu_user2");
    expect(secret().refresh_token).toBe("ghr_2");
    expect(secret()[API_HOST_SDS]).toContain("Bearer ghu_scoped");
    expect(secret()[API_HOST_SDS]).not.toContain("ghu_user2");
  });

  /**
   * TEST_SCENARIO: GitHub rotates the refresh token on every refresh. When
   * scoping fails after a refresh, the new refresh token must already be
   * stored, or the connection can never renew again. The injection must not
   * fall back to the unscoped token.
   */
  it("stores the rotated refresh token even when scoping is rejected", async () => {
    const { store, secret } = makeSecretStoreFake({
      access_token: "ghu_user",
      refresh_token: "ghr_1",
      [API_HOST_SDS]: "previous-injection",
    });
    const { engine } = makeEngine(() =>
      jsonResponse({ message: "Validation Failed" }, 422),
    );
    const auth = { ...AUTH, githubUserTokenScope: SCOPE };

    await expect(
      refreshOAuthAccessToken({
        conn: connection(auth),
        auth,
        engine: refreshingEngine(),
        githubAppEngine: engine,
        templates,
        secretStore: store,
      }),
    ).rejects.toMatchObject({ oauthError: "invalid_grant" });

    expect(secret().refresh_token).toBe("ghr_2");
    expect(secret().access_token).toBe("ghu_user2");
    expect(secret()[API_HOST_SDS]).toBe("previous-injection");
  });

  it("leaves an unscoped connection's renewal unchanged", async () => {
    const { store, secret } = makeSecretStoreFake({
      access_token: "ghu_user",
      refresh_token: "ghr_1",
    });
    const { engine, calls } = makeEngine(() => scopedTokenResponse());

    const out = await refreshOAuthAccessToken({
      conn: connection(AUTH),
      auth: AUTH,
      engine: refreshingEngine(),
      githubAppEngine: engine,
      templates,
      secretStore: store,
    });

    expect(calls).toHaveLength(0);
    expect(out.expiresAt).toBe(NOW_SEC + 28800);
    expect(secret()[API_HOST_SDS]).toContain("Bearer ghu_user2");
  });

  it("round-trips a stored scope through the wire schema", () => {
    const auth = { ...AUTH, githubUserTokenScope: SCOPE };
    expect(connectionAuthConfigSchema.parse(auth)).toEqual(auth);
  });
});

describe("GitHub user token scoping — editing", () => {
  it("proves the scope with GitHub before storing it", async () => {
    const { svc, rows, secret, calls } = makeService(connection(AUTH), () =>
      scopedTokenResponse(),
    );

    await svc.updateGitHubUserTokenScope({
      id: "conn-1",
      targetId: 42,
      repositoryIds: "7",
      permissions: "contents:read",
    });

    expect(JSON.parse(calls[0]!.body!)).toEqual({
      access_token: "ghu_user",
      target_id: 42,
      repository_ids: [7],
      permissions: { contents: "read" },
    });
    const auth = rows.get("conn-1")!.auth as OAuthAuth;
    expect(auth.githubUserTokenScope).toEqual({
      ...SCOPE,
      targetLogin: "acme",
    });
    expect(auth.expiresAt).toBe(NOW_SEC + 1800);
    expect(secret()[API_HOST_SDS]).toContain("Bearer ghu_scoped");
    expect(secret().access_token).toBe("ghu_user");
  });

  it("stores nothing when GitHub refuses the scope", async () => {
    const { svc, rows, secret } = makeService(connection(AUTH), () =>
      jsonResponse({ message: "Validation Failed" }, 422),
    );

    await expect(
      svc.updateGitHubUserTokenScope({ id: "conn-1", targetId: 42 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect((rows.get("conn-1")!.auth as OAuthAuth).githubUserTokenScope).toBe(
      undefined,
    );
    expect(secret()[API_HOST_SDS]).toBe("previous-injection");
  });

  it("clearing the scope injects the full user token again", async () => {
    const { svc, rows, secret, calls } = makeService(
      connection({ ...AUTH, githubUserTokenScope: SCOPE }),
      () => scopedTokenResponse(),
    );

    await svc.updateGitHubUserTokenScope({ id: "conn-1" });

    expect(calls).toHaveLength(0);
    expect(
      (rows.get("conn-1")!.auth as OAuthAuth).githubUserTokenScope,
    ).toBeUndefined();
    expect(secret()[API_HOST_SDS]).toContain("Bearer ghu_user");
  });

  it("offers the edit only on GitHub sign-in connections", async () => {
    const github = makeService(
      connection({ ...AUTH, githubUserTokenScope: SCOPE }),
      () => scopedTokenResponse(),
    );
    const other = makeService(connection(AUTH, "linear"), () =>
      scopedTokenResponse(),
    );

    expect((await github.svc.getConnection("conn-1"))?.githubUserToken).toEqual(
      { scope: SCOPE },
    );
    expect(
      (await other.svc.getConnection("conn-1"))?.githubUserToken,
    ).toBeUndefined();
    await expect(
      other.svc.updateGitHubUserTokenScope({ id: "conn-1", targetId: 42 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("GitHub user token scoping — parsing", () => {
  it("needs an account before repositories or permissions", () => {
    expect(() =>
      parseGitHubUserTokenScope({ permissions: "contents:read" }),
    ).toThrow(/account/);
    expect(parseGitHubUserTokenScope({})).toBeUndefined();
    expect(
      parseGitHubUserTokenScope({ targetId: 42, repositoryIds: " " }),
    ).toEqual({ targetId: 42 });
  });
});
