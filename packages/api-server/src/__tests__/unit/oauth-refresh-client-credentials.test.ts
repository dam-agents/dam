import { describe, it, expect } from "vitest";
import type { Db } from "db";
import {
  connectionAuthConfigSchema,
  type Connection,
  type ConnectionAuthConfig,
} from "api-server-api";
import { remintOne } from "../../modules/connections/services/oauth-refresh.js";
import { createOAuthEngine } from "../../modules/connections/infrastructure/oauth-engine.js";
import { sdsFileKeyForHost } from "../../modules/connections/domain/connection-sds.js";
import type { SecretStore } from "../../modules/secret-store/index.js";

const NOW_MS = 1_800_000_000_000;

const AUTH: Extract<ConnectionAuthConfig, { kind: "client-credentials" }> = {
  kind: "client-credentials",
  clientId: "cid",
  clientSecretRef: {
    storeId: "test",
    path: "secret-p",
    field: "client_secret",
  },
  accessTokenRef: { storeId: "test", path: "secret-p", field: "access_token" },
  issuerUrl: "https://auth.example.com/realms/main",
  tokenUrl: "https://auth.example.com/realms/main/token",
  scopes: ["read"],
  expiresAt: Math.floor(NOW_MS / 1000) + 60,
  connectedAt: Math.floor(NOW_MS / 1000) - 600,
  host: "api.example.com",
};

const CONN: Connection = {
  id: "conn-1",
  ownerId: "owner-sub",
  templateId: "custom-client-credentials",
  name: "my-api",
  inputs: {},
  auth: AUTH,
  contributions: [
    {
      kind: "egress-inject",
      host: "api.example.com",
      headerName: "Authorization",
      valueFormat: "Bearer {value}",
    },
  ],
};

function makeDeps(opts: { clientSecret: string | null }) {
  const putCalls: { path: string; fields: Record<string, string> }[] = [];
  const secretStore = {
    getField: async () => opts.clientSecret,
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

  const tokenCalls: URLSearchParams[] = [];
  const engine = createOAuthEngine({
    now: () => NOW_MS,
    fetchImpl: (async (_url: RequestInfo | URL, init?: RequestInit) => {
      tokenCalls.push(new URLSearchParams(String(init?.body)));
      return new Response(
        JSON.stringify({ access_token: "tok-2", expires_in: 300 }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch,
  });

  return { engine, secretStore, db, putCalls, dbUpdates, tokenCalls };
}

describe("client-credentials re-mint", () => {
  it("exchanges the stored client secret and hot-swaps token + SDS", async () => {
    const deps = makeDeps({ clientSecret: "csecret" });
    await remintOne(CONN, AUTH, deps);

    expect(deps.tokenCalls).toHaveLength(1);
    expect(Object.fromEntries(deps.tokenCalls[0])).toMatchObject({
      grant_type: "client_credentials",
      client_id: "cid",
      client_secret: "csecret",
      scope: "read",
    });

    expect(deps.putCalls).toHaveLength(1);
    expect(deps.putCalls[0].path).toBe("secret-p");
    expect(deps.putCalls[0].fields.access_token).toBe("tok-2");
    expect(
      deps.putCalls[0].fields[sdsFileKeyForHost("api.example.com")],
    ).toContain("Bearer tok-2");
    // The client secret is never rewritten by a re-mint.
    expect(deps.putCalls[0].fields.client_secret).toBeUndefined();

    expect(deps.dbUpdates).toHaveLength(1);
    const updated = deps.dbUpdates[0].auth;
    if (updated.kind !== "client-credentials") throw new Error("wrong kind");
    expect(updated.expiresAt).toBe(Math.floor(NOW_MS / 1000) + 300);
  });

  it("throws (leaving state untouched) when the client secret is gone", async () => {
    const deps = makeDeps({ clientSecret: null });
    await expect(remintOne(CONN, AUTH, deps)).rejects.toThrow(
      /client secret missing/,
    );
    expect(deps.putCalls).toHaveLength(0);
    expect(deps.dbUpdates).toHaveLength(0);
  });

  // Guards dueConnections' parseRow: an auth shape the schema rejects is
  // silently dropped from the loop, so the round-trip must stay green.
  it("client-credentials auth round-trips through the wire schema", () => {
    const parsed = connectionAuthConfigSchema.safeParse(AUTH);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toEqual(AUTH);
  });
});
