import { createMemoryTtlStore } from "../../core/ttl-store.js";
import crypto from "node:crypto";
import { describe, it, expect, vi } from "vitest";
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
    listByOwnerOldestFirst: async (ownerId) =>
      [...rows.values()].filter((c) => c.ownerId === ownerId),
    get: async (id, ownerId) => {
      const c = rows.get(id);
      return c && c.ownerId === ownerId ? c : null;
    },
    getById: async (id) => rows.get(id) ?? null,
    listDue: async () => [],
    updateAuth: async (id, auth) => {
      const c = rows.get(id);
      if (c) rows.set(id, { ...c, auth });
    },
    updateContributions: async () => {},
    mergeInputs: async (id, inputs) => {
      const c = rows.get(id);
      if (c) rows.set(id, { ...c, inputs: { ...c.inputs, ...inputs } });
    },
    delete: async (id) => {
      rows.delete(id);
    },
    grant: async () => {},
    revoke: async () => {},
    setPreferred: async () => {},
    listAgentGrants: async () => [],
    listConnectionsForAgent: async () => [],
    listAgentsForConnection: async () => [],
    revokeAllForAgent: async () => {},
    listDistinctGrantAgentIds: async () => [],
    updateName: async () => {},
    listOwnersOfTemplate: async () => [],
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
    putFields: async (ref, fields) => {
      stored.set(ref.path, { ...(stored.get(ref.path) ?? {}), ...fields });
    },
    get: async (ref) => stored.get(ref.path) ?? null,
    getField: async (ref) => stored.get(ref.path)?.[ref.field] ?? null,
    delete: async (ref) => {
      deleted.push(ref.path);
      stored.delete(ref.path);
    },
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
    harnesses: { default: "claude-code", harnesses: [] },
    isOwnedAgent: async () => true,
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
    s3CredentialProbe: {
      probe: async () => {
        throw new Error("Unexpected dependency: s3CredentialProbe");
      },
    },
    providerBalance: {
      lookup: async () => {
        throw new Error("Unexpected dependency: providerBalance");
      },
    },
    credentialProbe: { probe: async () => ({ status: "passed" }) },
    providerKeyProbe: { probe: async () => ({ ok: true }) },
    oauthCallbackUrl: "https://cb.example/oauth/callback",
    brandName: "Test",
    connectionLock: <T>(key: string, fn: () => Promise<T>): Promise<T> => {
      lockKeys.push(key);
      return fn();
    },
    resolveKbShare: async () => null,
  });
  return {
    svc,
    repo,
    rows,
    stored,
    deleted,
    tokenCalls,
    tokenBodies,
    lockKeys,
  };
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

    expect(tokenCalls.filter((url) => url.includes("/access_tokens"))).toEqual([
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
    await expect(svc.createFromTemplate(createInput())).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringMatching(
        /^GitHub rejected the app's credentials\. .* GitHub said: "Bad credentials"\.$/,
      ),
    });
    expect(rows.size).toBe(0);
    expect(stored.size).toBe(0);
  });

  it("tells the user which input GitHub rejected", async () => {
    const respond = (message: string, status: number) => () =>
      new Response(JSON.stringify({ message, status: String(status) }), {
        status,
        headers: { "content-type": "application/json" },
      });
    const cases: [string, number, RegExp][] = [
      ["Integration not found", 404, /^The App ID is wrong/],
      ["Not Found", 404, /^The Installation ID is wrong/],
      [
        "A JSON web token could not be decoded",
        401,
        /^The private key does not belong to the app with App ID 123456/,
      ],
    ];
    for (const [message, status, expected] of cases) {
      const { svc, rows, stored } = makeService(respond(message, status));
      await expect(svc.createFromTemplate(createInput())).rejects.toMatchObject(
        { code: "BAD_REQUEST", message: expect.stringMatching(expected) },
      );
      expect(rows.size).toBe(0);
      expect(stored.size).toBe(0);
    }
  });

  it("rejects an Installation ID that is not a number before reaching GitHub", async () => {
    const { svc, tokenCalls } = makeService();
    await expect(
      svc.createFromTemplate(
        createInput({
          installationId: "https://github.com/settings/installations/987654",
        }),
      ),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringMatching(/^The Installation ID must be a number/),
    });
    expect(tokenCalls).toHaveLength(0);
  });

  it("fails before persisting when the private key is invalid", async () => {
    const { svc, rows, stored } = makeService();
    await expect(
      svc.createFromTemplate(createInput({ privateKey: "not-a-key" })),
    ).rejects.toThrow(
      /^The private key is not valid: it must be a PEM-encoded/,
    );
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
    await svc.update(id, { value: rotatedPem.replaceAll("\n", "\\n") });

    expect(stored.get(SECRET_PATH)!.private_key).toBe(rotatedPem.trim());
    const auth = rows.get(id)!.auth;
    if (auth.kind !== "github-app") throw new Error("kind");
    expect(auth.refreshFailedAt).toBeUndefined();
    expect((await svc.getConnection(id))?.status).toBe("active");
  });

  it("stores the new private key even when a re-mint went first", async () => {
    const { svc, repo, stored } = makeService();
    const id = await svc.createFromTemplate(createInput());
    const readRow = repo.getById.bind(repo);
    repo.getById = async (connectionId) => {
      const fresh = await readRow(connectionId);
      if (!fresh || fresh.auth.kind !== "github-app") return fresh;
      return {
        ...fresh,
        auth: { ...fresh.auth, expiresAt: (fresh.auth.expiresAt ?? 0) + 60 },
      };
    };

    const { privateKey: rotatedPem } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs1", format: "pem" },
    });
    await svc.update(id, { value: rotatedPem });

    expect(stored.get(SECRET_PATH)!.private_key).toBe(rotatedPem.trim());
  });

  it("leaves the connection untouched when the new key is unusable", async () => {
    const { svc, rows, stored } = makeService();
    const id = await svc.createFromTemplate(createInput());
    const authBefore = rows.get(id)!.auth;

    await expect(svc.update(id, { value: "not-a-key" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: /PEM-encoded/,
    });

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
    vi.stubGlobal("fetch", async () =>
      Response.json({ login: "octo", id: 1, name: null, email: null }),
    );
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

describe("github-app credential check", () => {
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { "content-type": "application/json" },
    });

  function github(
    overrides: { mint?: () => Response; installation?: () => Response } = {},
  ) {
    return (url: string) => {
      if (url.includes("/access_tokens")) {
        return (
          overrides.mint?.() ??
          json({ token: "ghs_1", expires_at: "2027-01-15T13:00:00Z" }, 201)
        );
      }
      if (url.endsWith("/app/installations/987654")) {
        return (
          overrides.installation?.() ??
          json({ app_slug: "dam-bot", account: { login: "dam-agents" } })
        );
      }
      if (url.includes("/installation/repositories")) {
        return json({
          total_count: 2,
          repositories: [
            { id: 12, name: "docs" },
            { id: 34, name: "web" },
          ],
        });
      }
      return new Response(null, { status: 204 });
    };
  }

  // TEST_SCENARIO: a GitHub App connection that mints a token is saved with a passed check that names the bot, the account the app is installed on and the repositories the token reaches, so the CLI and the page can tell the user who the connection acts as.
  it("names the bot, the installation's account and the repositories on save", async () => {
    const { svc } = makeService(github());
    const id = await svc.createFromTemplate(createInput());

    const check = (await svc.getConnection(id))?.check;
    expect(check).toMatchObject({
      status: "passed",
      account: "dam-bot[bot]",
      installedOn: "dam-agents",
      repositories: ["docs", "web"],
    });
    expect(check).not.toHaveProperty("repositoriesTruncated");
    expect(Date.parse(check!.at)).not.toBeNaN();
  });

  // TEST_SCENARIO: the token the check minted for itself is revoked, and the one the save minted stays the connection's own, so a check on demand leaves no extra live token behind.
  it("checks a stored connection again and revokes the token it minted", async () => {
    let mints = 0;
    const { svc, stored, tokenCalls } = makeService(
      github({
        mint: () =>
          json(
            { token: `ghs_${++mints}`, expires_at: "2027-01-15T13:00:00Z" },
            201,
          ),
      }),
    );
    const id = await svc.createFromTemplate(createInput());

    const check = await svc.checkCredential(id);

    expect(check).toMatchObject({ status: "passed", account: "dam-bot[bot]" });
    expect(mints).toBe(2);
    expect(tokenCalls.at(-1)).toBe("https://api.github.com/installation/token");
    expect(stored.get(SECRET_PATH)!.access_token).toBe("ghs_1");
    expect((await svc.getConnection(id))?.check?.status).toBe("passed");
  });

  // TEST_SCENARIO: a key revoked or an installation removed after the save is found on demand: the check fails with the input GitHub rejected and the listing keeps that result, so the user learns before an agent's gh call is refused.
  it("fails a stored connection GitHub no longer accepts, naming the input", async () => {
    let refuse = false;
    const { svc } = makeService(
      github({
        mint: () =>
          refuse
            ? json({ message: "Not Found" }, 404)
            : json({ token: "ghs_1", expires_at: "2027-01-15T13:00:00Z" }, 201),
      }),
    );
    const id = await svc.createFromTemplate(createInput());
    refuse = true;

    const check = await svc.checkCredential(id);

    expect(check?.status).toBe("failed");
    expect(check?.reason).toMatch(/^The Installation ID is wrong/);
    expect((await svc.getConnection(id))?.check?.status).toBe("failed");
  });

  // TEST_SCENARIO: a suspended installation answers 403, which fails the check with advice about the installation.
  it("fails a suspended installation", async () => {
    let refuse = false;
    const { svc } = makeService(
      github({
        mint: () =>
          refuse
            ? json({ message: "This installation has been suspended" }, 403)
            : json({ token: "ghs_1" }, 201),
      }),
    );
    const id = await svc.createFromTemplate(createInput());
    refuse = true;

    const check = await svc.checkCredential(id);

    expect(check?.status).toBe("failed");
    expect(check?.reason).toMatch(/not suspended/);
  });

  // TEST_SCENARIO: a GitHub outage says nothing about the app's credentials, so the check is unchecked rather than failed.
  it("leaves the check unchecked when GitHub has an outage", async () => {
    let outage = false;
    const { svc } = makeService(
      github({
        mint: () =>
          outage
            ? new Response("oops", { status: 502 })
            : json({ token: "ghs_1" }, 201),
      }),
    );
    const id = await svc.createFromTemplate(createInput());
    outage = true;

    const check = await svc.checkCredential(id);

    expect(check?.status).toBe("unchecked");
    expect(check?.reason).toMatch(/HTTP 502/);
  });

  // TEST_SCENARIO: the bot and the repositories are details: when GitHub will not say them, the check still passes on the minted token, without the details.
  it("passes without details when the installation cannot be read", async () => {
    const { svc } = makeService(
      github({ installation: () => json({ message: "Not Found" }, 404) }),
    );
    const id = await svc.createFromTemplate(createInput());

    const check = (await svc.getConnection(id))?.check;
    expect(check?.status).toBe("passed");
    expect(check).not.toHaveProperty("account");
    expect(check?.repositories).toEqual(["docs", "web"]);
  });

  // TEST_SCENARIO: a key rotation records a fresh check, so the result reads as the new key's.
  it("records a fresh check when the private key is rotated", async () => {
    const { svc, rows } = makeService(github());
    const id = await svc.createFromTemplate(createInput());
    const row = rows.get(id)!;
    rows.set(id, {
      ...row,
      inputs: {
        ...row.inputs,
        credentialCheck: {
          status: "failed",
          reason: "old",
          at: "2026-01-01T00:00:00Z",
        },
      },
    });

    await svc.update(id, { value: PRIVATE_KEY_PEM });

    expect((await svc.getConnection(id))?.check).toMatchObject({
      status: "passed",
      account: "dam-bot[bot]",
    });
  });

  // TEST_SCENARIO: a narrowed scope is checked with the token minted for it, so the check lists only the repositories the narrowed token reaches.
  it("records the check of the new scope", async () => {
    let scoped = false;
    const respond = github();
    const { svc } = makeService((url) =>
      scoped && url.includes("/installation/repositories")
        ? json({ total_count: 1, repositories: [{ id: 12, name: "docs" }] })
        : respond(url),
    );
    const id = await svc.createFromTemplate(createInput());
    scoped = true;

    await svc.updateGitHubAppScope({ id, repositories: "docs" });

    expect((await svc.getConnection(id))?.check?.repositories).toEqual([
      "docs",
    ]);
  });

  // TEST_SCENARIO: an installation with more repositories than one page lists the first page and says the list is truncated, rather than claim it is complete.
  it("flags a repository list longer than one page", async () => {
    const respond = github();
    const { svc } = makeService((url) =>
      url.includes("/installation/repositories")
        ? json({ total_count: 250, repositories: [{ id: 12, name: "docs" }] })
        : respond(url),
    );
    const id = await svc.createFromTemplate(createInput());

    expect((await svc.getConnection(id))?.check).toMatchObject({
      repositories: ["docs"],
      repositoriesTruncated: true,
    });
  });
});
