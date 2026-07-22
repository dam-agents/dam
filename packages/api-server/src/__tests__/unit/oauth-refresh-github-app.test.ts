import crypto from "node:crypto";
import { describe, it, expect } from "vitest";
import type { Db } from "db";
import {
  connectionAuthConfigSchema,
  type Connection,
  type ConnectionAuthConfig,
} from "api-server-api";
import { remintGitHubAppOne } from "../../modules/connections/services/oauth-refresh.js";
import { createGitHubAppEngine } from "../../modules/connections/infrastructure/github-app-engine.js";
import { sdsFileKeyForHost } from "../../modules/connections/domain/connection-sds.js";
import type { SecretStore } from "../../modules/secret-store/index.js";

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

function makeDeps(opts: { privateKey: string | null }) {
  const putCalls: { path: string; fields: Record<string, string> }[] = [];
  const secretStore = {
    getField: async () => opts.privateKey,
    putFields: async (
      ref: { path: string },
      fields: Record<string, string>,
    ) => {
      putCalls.push({ path: ref.path, fields });
    },
  } as unknown as SecretStore;

  const dbUpdates: { auth: ConnectionAuthConfig }[] = [];
  const db = {
    update: () => ({
      set: (row: { auth: ConnectionAuthConfig }) => {
        dbUpdates.push(row);
        return { where: async () => {} };
      },
    }),
  } as unknown as Db;

  const tokenCalls: string[] = [];
  const githubAppEngine = createGitHubAppEngine({
    now: () => NOW_MS,
    fetchImpl: (async (url: RequestInfo | URL) => {
      tokenCalls.push(String(url));
      return new Response(
        JSON.stringify({
          token: "ghs_next",
          expires_at: "2027-01-15T13:00:00Z",
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch,
  });

  return { githubAppEngine, secretStore, db, putCalls, dbUpdates, tokenCalls };
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
    // A re-mint never rewrites the private key.
    expect(deps.putCalls[0].fields.private_key).toBeUndefined();

    expect(deps.dbUpdates).toHaveLength(1);
    const updated = deps.dbUpdates[0].auth;
    if (updated.kind !== "github-app") throw new Error("wrong kind");
    expect(updated.expiresAt).toBe(
      Math.floor(Date.parse("2027-01-15T13:00:00Z") / 1000),
    );
  });

  it("throws (leaving state untouched) when the private key is gone", async () => {
    const deps = makeDeps({ privateKey: null });
    await expect(remintGitHubAppOne(CONN, AUTH, deps)).rejects.toThrow(
      /private key missing/,
    );
    expect(deps.putCalls).toHaveLength(0);
    expect(deps.dbUpdates).toHaveLength(0);
  });

  // Guards dueConnections' parseRow: an auth shape the schema rejects is
  // silently dropped from the loop, so the round-trip must stay green.
  it("github-app auth round-trips through the wire schema", () => {
    const parsed = connectionAuthConfigSchema.safeParse(AUTH);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toEqual(AUTH);
  });
});
