import { createMemoryTtlStore } from "../../core/ttl-store.js";
import crypto from "node:crypto";
import { describe, it, expect } from "vitest";
import type { Connection, ConnectionAuthConfig } from "api-server-api";
import { createConnectionsService } from "../../modules/connections/services/connections-service.js";
import { createConnectionTemplateRegistry } from "../../modules/connections/domain/connection-template.js";
import { buildCatalog } from "../../modules/connections/domain/catalog.js";
import { createOAuthEngine } from "../../modules/connections/infrastructure/oauth-engine.js";
import { createGitHubAppEngine } from "../../modules/connections/infrastructure/github-app-engine.js";
import { sdsFileKeyForHost } from "../../modules/connections/domain/connection-sds.js";
import { gitHubAppMintLockKey } from "../../modules/connections/services/github-app.js";
import type { ConnectionsRepository } from "../../modules/connections/infrastructure/connections-repository.js";
import type { SecretStore } from "../../modules/secret-store/index.js";
import type { OAuthFlowService } from "../../modules/connections/services/oauth-flow.js";

const NOW_MS = 1_800_000_000_000;
const OWNER = "owner-sub";

const { privateKey: PRIVATE_KEY_PEM } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
});

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
  respond: (url: string) => Response = () =>
    new Response(
      JSON.stringify({ token: "ghs_1", expires_at: "2027-01-15T13:00:00Z" }),
      { status: 201, headers: { "content-type": "application/json" } },
    ),
) {
  const { repo, rows } = makeRepoFake();
  const { store, stored, deleted } = makeSecretStoreFake();
  const tokenCalls: string[] = [];
  const tokenBodies: (string | undefined)[] = [];
  const githubAppEngine = createGitHubAppEngine({
    now: () => NOW_MS,
    fetchImpl: (async (url: RequestInfo | URL, init?: RequestInit) => {
      tokenCalls.push(String(url));
      if (String(url).includes("/access_tokens")) {
        tokenBodies.push(
          typeof init?.body === "string" ? init.body : undefined,
        );
      }
      return respond(String(url));
    }) as typeof fetch,
  });
  const lockKeys: string[] = [];
  const oauthFlow: OAuthFlowService = {
    startOAuth: async () => {
      throw new Error("startOAuth must not be called for github-app");
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
    oauthEngine: createOAuthEngine({
      pendingStore: createMemoryTtlStore(600_000),
      now: () => NOW_MS,
    }),
    githubAppEngine,
    oauthCallbackUrl: "https://cb.example/oauth/callback",
    brandName: "Test",
    connectionLock: <T>(key: string, fn: () => Promise<T>): Promise<T> => {
      lockKeys.push(key);
      return fn();
    },
  });
  return { svc, rows, stored, deleted, tokenCalls, tokenBodies, lockKeys };
}

function createInput(overrides: Record<string, string> = {}) {
  return {
    templateId: "github-app",
    name: "my-app",
    authKind: "github-app" as const,
    appId: "123456",
    installationId: "987654",
    privateKey: PRIVATE_KEY_PEM,
    ...overrides,
  };
}

const SECRET_PATH = "secret-connection:github-app";

describe("github-app connection create", () => {
  it("mints once and persists private key, token, SDS, and auth markers", async () => {
    const { svc, rows, stored, tokenCalls } = makeService();
    const id = await svc.createFromTemplate(createInput());

    expect(tokenCalls).toEqual([
      "https://api.github.com/app/installations/987654/access_tokens",
    ]);

    const fields = stored.get(SECRET_PATH)!;
    expect(fields.private_key).toBe(PRIVATE_KEY_PEM.trim());
    expect(fields.access_token).toBe("ghs_1");
    expect(fields[sdsFileKeyForHost("api.github.com")]).toContain(
      "Bearer ghs_1",
    );
    expect(fields[sdsFileKeyForHost("github.com")]).toContain(
      `Basic ${Buffer.from("x-access-token:ghs_1", "utf8").toString("base64")}`,
    );

    const conn = rows.get(id)!;
    expect(conn.auth.kind).toBe("github-app");
    if (conn.auth.kind !== "github-app") return;
    expect(conn.auth.expiresAt).toBe(
      Math.floor(Date.parse("2027-01-15T13:00:00Z") / 1000),
    );
    expect(conn.auth.connectedAt).toBeGreaterThan(0);
    expect(JSON.stringify(conn.inputs)).not.toContain("PRIVATE KEY");

    const view = await svc.getConnection(id);
    expect(view?.status).toBe("active");
    expect(view?.authKind).toBe("github-app");
  });

  it("persists nothing when the installation-token request fails", async () => {
    const { svc, rows, stored } = makeService(
      () => new Response("Bad credentials", { status: 401 }),
    );
    await expect(svc.createFromTemplate(createInput())).rejects.toThrow(/401/);
    expect(rows.size).toBe(0);
    expect(stored.size).toBe(0);
  });

  it("fails before persisting when the private key is invalid", async () => {
    const { svc, rows, stored } = makeService();
    await expect(
      svc.createFromTemplate(createInput({ privateKey: "not-a-key" })),
    ).rejects.toThrow(/PEM-encoded/);
    expect(rows.size).toBe(0);
    expect(stored.size).toBe(0);
  });

  it("falls back to a one-hour horizon when GitHub returns no expiry", async () => {
    const { svc, rows } = makeService(
      () =>
        new Response(JSON.stringify({ token: "ghs_1" }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
    );
    const before = Math.floor(Date.now() / 1000);
    const id = await svc.createFromTemplate(createInput());
    const after = Math.floor(Date.now() / 1000);
    const auth = rows.get(id)!.auth;
    if (auth.kind !== "github-app") throw new Error("wrong kind");
    expect(auth.expiresAt).toBe(Math.floor(NOW_MS / 1000) + 3600);
    expect(after).toBeGreaterThanOrEqual(before);
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
      ...(conn.auth as Extract<ConnectionAuthConfig, { kind: "github-app" }>),
      expiresAt: Math.floor(Date.now() / 1000) - 60,
    };
    rows.set(id, { ...conn, auth });
    const view = await svc.getConnection(id);
    expect(view?.status).toBe("expired");
  });

  it("exposes the injected GitHub hosts on the view", async () => {
    const { svc } = makeService();
    const id = await svc.createFromTemplate(createInput());
    const view = await svc.getConnection(id);
    expect(view?.host).toBe("github.com");
    expect(view?.hosts).toEqual([
      "api.github.com",
      "github.com",
      "raw.githubusercontent.com",
    ]);
  });

  it("rotates the private key, normalizing a flattened PEM paste", async () => {
    const { svc, rows, stored } = makeService();
    const id = await svc.createFromTemplate(createInput());
    const created = rows.get(id)!;
    if (created.auth.kind !== "github-app") throw new Error("kind");
    rows.set(id, {
      ...created,
      auth: { ...created.auth, refreshFailedAt: 1700000000 },
    });

    const { privateKey: rotatedPem } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs1", format: "pem" },
    });
    await svc.update(id, rotatedPem.replaceAll("\n", "\\n"));

    expect(stored.get(SECRET_PATH)!.private_key).toBe(rotatedPem.trim());
    const auth = rows.get(id)!.auth;
    if (auth.kind !== "github-app") throw new Error("kind");
    expect(auth.refreshFailedAt).toBeUndefined();
    expect((await svc.getConnection(id))?.status).toBe("active");
  });

  it("leaves the connection untouched when the new key is unusable", async () => {
    const { svc, rows, stored } = makeService();
    const id = await svc.createFromTemplate(createInput());
    const authBefore = rows.get(id)!.auth;

    await expect(svc.update(id, "not-a-key")).rejects.toThrow(/PEM-encoded/);

    expect(stored.get(SECRET_PATH)!.private_key).toBe(PRIVATE_KEY_PEM.trim());
    expect(rows.get(id)!.auth).toEqual(authBefore);
  });
});

describe("github-app scope editing", () => {
  const okToken = () =>
    new Response(
      JSON.stringify({ token: "ghs_2", expires_at: "2027-01-15T13:00:00Z" }),
      { status: 201, headers: { "content-type": "application/json" } },
    );

  it("re-mints against the new scope and stores it", async () => {
    const { svc, rows, stored, tokenBodies } = makeService(okToken);
    const id = await svc.createFromTemplate(createInput());

    await svc.updateGitHubAppScope({
      id,
      repositoryIds: "12 34",
      permissions: "contents:read",
    });

    expect(JSON.parse(tokenBodies.at(-1)!)).toEqual({
      repository_ids: [12, 34],
      permissions: { contents: "read" },
    });
    const auth = rows.get(id)!.auth;
    if (auth.kind !== "github-app") throw new Error("kind");
    expect(auth.repositoryIds).toEqual([12, 34]);
    expect(auth.permissions).toEqual({ contents: "read" });
    expect(stored.get(SECRET_PATH)!.access_token).toBe("ghs_2");
    expect(
      stored.get(SECRET_PATH)![sdsFileKeyForHost("api.github.com")],
    ).toContain("ghs_2");
  });

  it("keeps the credential and the connection's identity", async () => {
    const { svc, rows, stored } = makeService(okToken);
    const id = await svc.createFromTemplate(createInput());
    const before = rows.get(id)!;

    await svc.updateGitHubAppScope({ id, repositoryIds: "12" });

    const after = rows.get(id)!;
    expect(after.name).toBe(before.name);
    expect(after.contributions).toEqual(before.contributions);
    expect(stored.get(SECRET_PATH)!.private_key).toBe(PRIVATE_KEY_PEM.trim());
  });

  it("clears the scope back to the full installation", async () => {
    const { svc, rows, tokenBodies } = makeService(okToken);
    const id = await svc.createFromTemplate(
      createInput({ repositories: "docs", permissions: "contents:read" }),
    );

    await svc.updateGitHubAppScope({ id });

    expect(tokenBodies.at(-1)).toBeUndefined();
    const auth = rows.get(id)!.auth;
    if (auth.kind !== "github-app") throw new Error("kind");
    expect(auth).not.toHaveProperty("repositories");
    expect(auth).not.toHaveProperty("repositoryIds");
    expect(auth).not.toHaveProperty("permissions");
  });

  it("replaces a name-based scope rather than merging with it", async () => {
    const { svc, rows } = makeService(okToken);
    const id = await svc.createFromTemplate(
      createInput({ repositories: "docs" }),
    );

    await svc.updateGitHubAppScope({ id, repositoryIds: "12" });

    const auth = rows.get(id)!.auth;
    if (auth.kind !== "github-app") throw new Error("kind");
    expect(auth.repositoryIds).toEqual([12]);
    expect(auth).not.toHaveProperty("repositories");
  });

  it("leaves everything untouched when GitHub rejects the new scope", async () => {
    let mints = 0;
    const { svc, rows, stored } = makeService((url) => {
      if (!url.includes("/access_tokens")) return okToken();
      mints += 1;
      return mints === 1
        ? okToken()
        : new Response("no access to that repository", { status: 422 });
    });
    const id = await svc.createFromTemplate(createInput());
    const authBefore = rows.get(id)!.auth;
    const tokenBefore = stored.get(SECRET_PATH)!.access_token;

    await expect(
      svc.updateGitHubAppScope({ id, repositoryIds: "999" }),
    ).rejects.toThrow();

    expect(rows.get(id)!.auth).toEqual(authBefore);
    expect(stored.get(SECRET_PATH)!.access_token).toBe(tokenBefore);
  });

  it("clears a refresh-failure marker on a successful re-scope", async () => {
    const { svc, rows } = makeService(okToken);
    const id = await svc.createFromTemplate(createInput());
    const created = rows.get(id)!;
    if (created.auth.kind !== "github-app") throw new Error("kind");
    rows.set(id, {
      ...created,
      auth: { ...created.auth, refreshFailedAt: 1700000000 },
    });
    expect((await svc.getConnection(id))?.status).toBe("expired");

    await svc.updateGitHubAppScope({ id, repositoryIds: "12" });

    const auth = rows.get(id)!.auth;
    if (auth.kind !== "github-app") throw new Error("kind");
    expect(auth.refreshFailedAt).toBeUndefined();
    expect((await svc.getConnection(id))?.status).toBe("active");
  });

  it("runs the edit under the connection's mint lock", async () => {
    const { svc, lockKeys } = makeService(okToken);
    const id = await svc.createFromTemplate(createInput());
    lockKeys.length = 0;

    await svc.updateGitHubAppScope({ id, repositoryIds: "12" });

    expect(lockKeys).toEqual([gitHubAppMintLockKey(id)]);
  });

  it("rejects an id that is not a whole number before reaching GitHub", async () => {
    const { svc } = makeService(okToken);
    const id = await svc.createFromTemplate(createInput());
    await expect(
      svc.updateGitHubAppScope({ id, repositoryIds: "12abc" }),
    ).rejects.toThrow(/whole number/);
  });

  it("refuses a connection that is not a GitHub App installation", async () => {
    const { svc } = makeService(okToken);
    const id = await svc.createFromTemplate({
      templateId: "github-pat",
      name: "pat",
      authKind: "header" as const,
      value: "ghp_x",
    });
    await expect(svc.updateGitHubAppScope({ id })).rejects.toThrow(
      /not a GitHub App/,
    );
  });

  it("surfaces the stored scope on the connection view", async () => {
    const { svc } = makeService(okToken);
    const id = await svc.createFromTemplate(
      createInput({ repositories: "docs", permissions: "contents:read" }),
    );
    expect((await svc.getConnection(id))?.githubAppScope).toEqual({
      repositories: ["docs"],
      permissions: { contents: "read" },
    });
  });

  it("omits the scope from the view when nothing is narrowed", async () => {
    const { svc } = makeService(okToken);
    const id = await svc.createFromTemplate(createInput());
    expect((await svc.getConnection(id))?.githubAppScope).toBeUndefined();
  });

  it("probes the installation using the connection's stored key", async () => {
    const { svc, tokenCalls } = makeService((url) =>
      url.endsWith("/app/installations/987654")
        ? new Response(
            JSON.stringify({
              permissions: { contents: "write" },
              repository_selection: "selected",
              account: { login: "dam-agents" },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          )
        : url.includes("/installation/repositories")
          ? new Response(
              JSON.stringify({ repositories: [{ id: 12, name: "docs" }] }),
              { status: 200, headers: { "content-type": "application/json" } },
            )
          : okToken(),
    );
    const id = await svc.createFromTemplate(createInput());

    const probe = await svc.probeGitHubAppInstallationForConnection({
      connectionId: id,
    });

    expect(probe.permissions).toEqual({ contents: "write" });
    expect(probe.repositories).toEqual([{ id: 12, name: "docs" }]);
    expect(tokenCalls).toContain(
      "https://api.github.com/app/installations/987654",
    );
  });
});
