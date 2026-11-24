import crypto from "node:crypto";
import { describe, it, expect, vi } from "vitest";
import type { Db } from "db";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import {
  connectionAuthConfigSchema,
  type Connection,
  type ConnectionAuthConfig,
} from "api-server-api";
import { remintGitHubAppOne } from "../../modules/connections/services/oauth-refresh.js";
import { gitHubAppMintLockKey } from "../../modules/connections/services/github-app.js";
import { createGitHubAppEngine } from "../../modules/connections/infrastructure/github-app-engine.js";
import { sdsFileKeyForHost } from "../../modules/connections/domain/connection-sds.js";
import type { SecretStore } from "../../modules/secret-store/index.js";

const securityLog = vi.hoisted(() => vi.fn());
vi.mock("../../core/security-log.js", () => ({ securityLog }));

const NOW_MS = 1_800_000_000_000;

const { privateKey: PRIVATE_KEY_PEM } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
});

const AUTH: Extract<ConnectionAuthConfig, { kind: "github-app" }> = {
  kind: "github-app",
  appId: "123456",
  installationId: "987654",
  privateKeyRef: { storeId: "test", path: "secret-p", field: "private_key" },
  accessTokenRef: { storeId: "test", path: "secret-p", field: "access_token" },
  apiBaseUrl: "https://api.github.com",
  expiresAt: Math.floor(NOW_MS / 1000) + 60,
  connectedAt: Math.floor(NOW_MS / 1000) - 3600,
  host: "github.com",
};

const CONN: Connection = {
  id: "conn-1",
  ownerId: "owner-sub",
  templateId: "github-app",
  name: "my-app",
  inputs: {},
  auth: AUTH,
  contributions: [
    {
      kind: "egress-inject",
      host: "api.github.com",
      headerName: "Authorization",
      valueFormat: "Bearer {value}",
    },
  ],
};

function makeDeps(opts: {
  privateKey: string | null;
  reReadAuth?: ConnectionAuthConfig;
  tokenStatus?: number;
  keyAfterMint?: string | null;
  writeMatches?: boolean;
}) {
  const reReadAuth = opts.reReadAuth ?? AUTH;
  const putCalls: { path: string; fields: Record<string, string> }[] = [];
  let keyReads = 0;
  const secretStore = {
    getField: async () =>
      keyReads++ > 0 && opts.keyAfterMint !== undefined
        ? opts.keyAfterMint
        : opts.privateKey,
    putFields: async (
      ref: { path: string },
      fields: Record<string, string>,
    ) => {
      putCalls.push({ path: ref.path, fields });
    },
  } as unknown as SecretStore;

  const dbUpdates: { auth: unknown; where?: SQL }[] = [];
  const db = {
    update: () => ({
      set: (row: { auth: unknown }) => {
        const update: { auth: unknown; where?: SQL } = { ...row };
        dbUpdates.push(update);
        return {
          where: (where: SQL) => {
            update.where = where;
            return Object.assign(Promise.resolve([]), {
              returning: async () =>
                opts.writeMatches === false ? [] : [{ id: "matched" }],
            });
          },
        };
      },
    }),
    select: () => ({
      from: () => ({
        where: async () => [
          {
            id: CONN.id,
            owner: CONN.ownerId,
            templateId: CONN.templateId,
            name: CONN.name,
            inputs: CONN.inputs,
            auth: reReadAuth,
            contributions: CONN.contributions,
          },
        ],
      }),
    }),
  } as unknown as Db;

  const tokenCalls: string[] = [];
  const tokenBodies: (string | undefined)[] = [];
  const githubAppEngine = createGitHubAppEngine({
    now: () => NOW_MS,
    fetchImpl: (async (url: RequestInfo | URL, init?: RequestInit) => {
      tokenCalls.push(String(url));
      tokenBodies.push(typeof init?.body === "string" ? init.body : undefined);
      if (opts.tokenStatus)
        return new Response(JSON.stringify({ message: "refused" }), {
          status: opts.tokenStatus,
          headers: { "content-type": "application/json" },
        });
      return new Response(
        JSON.stringify({
          token: "ghs_next",
          expires_at: "2027-01-15T13:00:00Z",
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch,
  });

  const lockKeys: string[] = [];
  return {
    githubAppEngine,
    secretStore,
    db,
    connectionLock: <T>(key: string, fn: () => Promise<T>): Promise<T> => {
      lockKeys.push(key);
      return fn();
    },
    putCalls,
    dbUpdates,
    tokenCalls,
    tokenBodies,
    lockKeys,
  };
}

describe("github-app re-mint", () => {
  it("signs with the stored key, hits the installation endpoint, and hot-swaps token + SDS", async () => {
    const deps = makeDeps({ privateKey: PRIVATE_KEY_PEM });
    await remintGitHubAppOne(CONN, AUTH, deps);

    expect(deps.tokenCalls).toEqual([
      "https://api.github.com/app/installations/987654/access_tokens",
    ]);

    expect(deps.putCalls).toHaveLength(1);
    expect(deps.putCalls[0].path).toBe("secret-p");
    expect(deps.putCalls[0].fields.access_token).toBe("ghs_next");
    expect(
      deps.putCalls[0].fields[sdsFileKeyForHost("api.github.com")],
    ).toContain("Bearer ghs_next");
    expect(deps.putCalls[0].fields.private_key).toBeUndefined();

    expect(deps.dbUpdates).toHaveLength(1);
    expect(deps.dbUpdates[0].auth).toMatchObject({
      kind: "github-app",
      expiresAt: Math.floor(Date.parse("2027-01-15T13:00:00Z") / 1000),
    });
    expect(deps.dbUpdates[0].auth).not.toHaveProperty("refreshFailedAt");
    expect(deps.dbUpdates[0].auth).not.toHaveProperty("refreshBackoff");
  });

  it("throws (leaving state untouched) when the private key is gone", async () => {
    const deps = makeDeps({ privateKey: null });
    await expect(remintGitHubAppOne(CONN, AUTH, deps)).rejects.toThrow(
      /private key missing/,
    );
    expect(deps.putCalls).toHaveLength(0);
    expect(deps.dbUpdates).toHaveLength(0);
  });

  it("github-app auth round-trips through the wire schema", () => {
    const parsed = connectionAuthConfigSchema.safeParse(AUTH);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toEqual(AUTH);
  });

  it("sends no body for a connection with no scope stored", async () => {
    const deps = makeDeps({ privateKey: PRIVATE_KEY_PEM });
    await remintGitHubAppOne(CONN, AUTH, deps);
    expect(deps.tokenBodies).toEqual([undefined]);
  });
});

describe("github-app re-mint with a stored scope", () => {
  const SCOPED_AUTH: Extract<ConnectionAuthConfig, { kind: "github-app" }> = {
    ...AUTH,
    repositories: ["docs"],
    permissions: { contents: "read", metadata: "read" },
  };
  const SCOPED_CONN: Connection = { ...CONN, auth: SCOPED_AUTH };

  it("re-mints asking for the same subset", async () => {
    const deps = makeDeps({
      privateKey: PRIVATE_KEY_PEM,
      reReadAuth: SCOPED_AUTH,
    });
    await remintGitHubAppOne(SCOPED_CONN, SCOPED_AUTH, deps);

    expect(deps.tokenBodies).toHaveLength(1);
    expect(JSON.parse(deps.tokenBodies[0]!)).toEqual({
      repositories: ["docs"],
      permissions: { contents: "read", metadata: "read" },
    });
  });

  it("never names the scope in the row it writes back", async () => {
    const deps = makeDeps({ privateKey: PRIVATE_KEY_PEM });
    await remintGitHubAppOne(SCOPED_CONN, SCOPED_AUTH, deps);

    const write = deps.dbUpdates[0].auth as ConnectionAuthConfig;
    expect(write).toHaveProperty("expiresAt");
    expect(write).not.toHaveProperty("repositories");
    expect(write).not.toHaveProperty("permissions");
  });

  it("scoped auth round-trips through the wire schema", () => {
    const parsed = connectionAuthConfigSchema.safeParse(SCOPED_AUTH);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toEqual(SCOPED_AUTH);
  });
});

describe("github-app re-mint with picked repository ids", () => {
  const ID_AUTH: Extract<ConnectionAuthConfig, { kind: "github-app" }> = {
    ...AUTH,
    repositoryIds: [12, 34],
    permissions: { contents: "read" },
  };
  const ID_CONN: Connection = { ...CONN, auth: ID_AUTH };

  it("re-mints asking for the same repository ids", async () => {
    const deps = makeDeps({ privateKey: PRIVATE_KEY_PEM, reReadAuth: ID_AUTH });
    await remintGitHubAppOne(ID_CONN, ID_AUTH, deps);
    expect(JSON.parse(deps.tokenBodies[0]!)).toEqual({
      repository_ids: [12, 34],
      permissions: { contents: "read" },
    });
  });

  it("never names the ids in the row it writes back", async () => {
    const deps = makeDeps({ privateKey: PRIVATE_KEY_PEM });
    await remintGitHubAppOne(ID_CONN, ID_AUTH, deps);
    expect(deps.dbUpdates[0].auth).not.toHaveProperty("repositoryIds");
  });

  it("mints against the scope as it stands inside the lock, not the one the tick carried in", async () => {
    const EDITED: ConnectionAuthConfig = {
      ...ID_AUTH,
      repositoryIds: [99],
      permissions: { contents: "read" },
    };
    const deps = makeDeps({
      privateKey: PRIVATE_KEY_PEM,
      reReadAuth: EDITED,
    });

    await remintGitHubAppOne(ID_CONN, ID_AUTH, deps);

    expect(deps.tokenBodies).toHaveLength(1);
    expect(JSON.parse(deps.tokenBodies[0]!)).toEqual({
      repository_ids: [99],
      permissions: { contents: "read" },
    });
  });

  it("runs under the connection's mint lock", async () => {
    const deps = makeDeps({ privateKey: PRIVATE_KEY_PEM });
    await remintGitHubAppOne(ID_CONN, ID_AUTH, deps);
    expect(deps.lockKeys).toEqual([gitHubAppMintLockKey(ID_CONN.id)]);
  });

  it("id-scoped auth round-trips through the wire schema", () => {
    const parsed = connectionAuthConfigSchema.safeParse(ID_AUTH);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toEqual(ID_AUTH);
  });
});

describe("github-app re-mint refused on the installation's key", () => {
  const PARENT_ID = "installation-1";
  const CHILD: Connection = { ...CONN, parentId: PARENT_ID };

  // TEST_SCENARIO: GitHub answers 401 to a connection made from an installation: the key is dead, so the installation itself is marked, under its own mint lock, and then says its key needs replacing.
  it("marks the installation when GitHub refuses its key", async () => {
    securityLog.mockClear();
    const deps = makeDeps({ privateKey: PRIVATE_KEY_PEM, tokenStatus: 401 });
    await expect(remintGitHubAppOne(CHILD, AUTH, deps)).rejects.toThrow(/401/);
    expect(deps.lockKeys).toEqual([
      gitHubAppMintLockKey(CHILD.id),
      gitHubAppMintLockKey(PARENT_ID),
    ]);
    expect(deps.dbUpdates).toHaveLength(1);
    expect(deps.dbUpdates[0]).toHaveProperty("updatedAt");
    expect(securityLog).toHaveBeenCalledWith(
      "warn",
      "connection.installation_key_refused",
      expect.objectContaining({ target: PARENT_ID, decision: "expired" }),
    );
  });

  // TEST_SCENARIO: the mark targets the installation's own row, only while it is a GitHub App installation that is not marked yet.
  it("writes the mark to the installation's row only, once", async () => {
    const deps = makeDeps({ privateKey: PRIVATE_KEY_PEM, tokenStatus: 401 });
    await expect(remintGitHubAppOne(CHILD, AUTH, deps)).rejects.toThrow(/401/);
    const where = new PgDialect().sqlToQuery(deps.dbUpdates[0]!.where!);
    expect(where.sql).toContain(`"connections"."id" = $1`);
    expect(where.params[0]).toBe(PARENT_ID);
    expect(where.sql).toContain(`->> 'kind' = 'github-app'`);
    expect(where.sql).toContain(`-> 'refreshFailedAt') IS NULL`);
  });

  // TEST_SCENARIO: an installation already marked matches no row, so the event is not logged again.
  it("logs nothing when the installation is already marked", async () => {
    securityLog.mockClear();
    const deps = makeDeps({
      privateKey: PRIVATE_KEY_PEM,
      tokenStatus: 401,
      writeMatches: false,
    });
    await expect(remintGitHubAppOne(CHILD, AUTH, deps)).rejects.toThrow(/401/);
    expect(deps.dbUpdates).toHaveLength(1);
    expect(securityLog).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: a key replaced while the mint was out is not the key GitHub refused, so the installation is not marked.
  it("leaves the installation alone when its key was replaced meanwhile", async () => {
    const deps = makeDeps({
      privateKey: PRIVATE_KEY_PEM,
      tokenStatus: 401,
      keyAfterMint: "a newer key",
    });
    await expect(remintGitHubAppOne(CHILD, AUTH, deps)).rejects.toThrow(/401/);
    expect(deps.lockKeys).toContain(gitHubAppMintLockKey(PARENT_ID));
    expect(deps.dbUpdates).toHaveLength(0);
  });

  // TEST_SCENARIO: a refused scope (422) or a removed installation (404) is not a dead key; a new key would not fix it, so only the connection fails.
  it.each([422, 404])(
    "leaves the installation alone on a %i",
    async (tokenStatus) => {
      const scoped: Extract<ConnectionAuthConfig, { kind: "github-app" }> = {
        ...AUTH,
        repositories: ["docs"],
      };
      const deps = makeDeps({
        privateKey: PRIVATE_KEY_PEM,
        reReadAuth: scoped,
        tokenStatus,
      });
      await expect(
        remintGitHubAppOne({ ...CHILD, auth: scoped }, scoped, deps),
      ).rejects.toThrow(String(tokenStatus));
      expect(deps.lockKeys).toEqual([gitHubAppMintLockKey(CHILD.id)]);
      expect(deps.dbUpdates).toHaveLength(0);
    },
  );

  // TEST_SCENARIO: a connection with no parent has no installation to mark; its own failure marker stays the refresh loop's.
  it("marks nothing else for a connection with no parent", async () => {
    const deps = makeDeps({ privateKey: PRIVATE_KEY_PEM, tokenStatus: 401 });
    await expect(remintGitHubAppOne(CONN, AUTH, deps)).rejects.toThrow(/401/);
    expect(deps.lockKeys).toEqual([gitHubAppMintLockKey(CONN.id)]);
    expect(deps.dbUpdates).toHaveLength(0);
  });
});
