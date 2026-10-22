import { describe, expect, it } from "vitest";
import type { Connection, ConnectionAuthConfig } from "api-server-api";
import { mintUnderLock } from "../../modules/connections/services/credential-writer.js";
import type { SecretStore } from "../../modules/secret-store/index.js";
import type { ConnectionsRepository } from "../../modules/connections/infrastructure/connections-repository.js";

/**
 * TEST_OVERVIEW: every credential writer takes the Connection's lock and
 * re-reads the row inside it. When another writer already stored a newer
 * expiry, or the auth is no longer the kind the writer minted for, the writer
 * stands down and writes nothing, so the newer token survives.
 */

const AUTH: Extract<ConnectionAuthConfig, { kind: "client-credentials" }> = {
  kind: "client-credentials",
  clientId: "cid",
  clientSecretRef: {
    storeId: "test",
    path: "secret-p",
    field: "client_secret",
  },
  accessTokenRef: { storeId: "test", path: "secret-p", field: "access_token" },
  issuerUrl: "https://auth.example.com",
  tokenUrl: "https://auth.example.com/token",
  scopes: [],
  host: "api.example.com",
  expiresAt: 1_800_000_600,
};

const CONN: Connection = {
  id: "conn-1",
  ownerId: "owner-sub",
  templateId: "custom-client-credentials",
  name: "example",
  inputs: {},
  auth: AUTH,
  contributions: [],
};

function makeDeps(stored: Connection | null) {
  const authUpdates: ConnectionAuthConfig[] = [];
  let mints = 0;
  return {
    authUpdates,
    mints: () => mints,
    deps: {
      repo: {
        getById: async () => stored,
        updateAuth: async (_id: string, auth: ConnectionAuthConfig) => {
          authUpdates.push(auth);
        },
      } as unknown as ConnectionsRepository,
      secretStore: {} as SecretStore,
      connectionLock: async <T>(_key: string, fn: () => Promise<T>) => fn(),
      lockKey: "connection:refresh:conn-1",
    },
    mint: async () => {
      mints++;
      return { ...AUTH, expiresAt: 1_800_003_600 };
    },
  };
}

describe("a credential writer inside the Connection's lock", () => {
  it("stands down when another writer stored a newer expiry", async () => {
    const { deps, mint, mints, authUpdates } = makeDeps({
      ...CONN,
      auth: { ...AUTH, expiresAt: 1_800_003_000 },
    });

    await mintUnderLock(CONN, AUTH, deps, mint);

    expect(mints()).toBe(0);
    expect(authUpdates).toEqual([]);
  });

  it("stands down when the stored auth changed kind", async () => {
    const { deps, mint, mints, authUpdates } = makeDeps({
      ...CONN,
      auth: { kind: "none" },
    });

    await mintUnderLock(CONN, AUTH, deps, mint);

    expect(mints()).toBe(0);
    expect(authUpdates).toEqual([]);
  });

  it("writes the minted auth when the stored row still matches", async () => {
    const { deps, mint, mints, authUpdates } = makeDeps(CONN);

    await mintUnderLock(CONN, AUTH, deps, mint);

    expect(mints()).toBe(1);
    expect(authUpdates).toEqual([{ ...AUTH, expiresAt: 1_800_003_600 }]);
  });
});
