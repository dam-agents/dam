import { describe, it, expect } from "vitest";
import type { Db } from "db";
import type { ConnectionAuthConfig } from "api-server-api";
import {
  backoffDelayMs,
  createOAuthRefreshLoop,
} from "../../modules/connections/services/oauth-refresh.js";
import { createOAuthEngine } from "../../modules/connections/infrastructure/oauth-engine.js";
import { createGitHubAppEngine } from "../../modules/connections/infrastructure/github-app-engine.js";
import type { ConnectionTemplateRegistry } from "../../modules/connections/domain/connection-template.js";
import type { SecretStore } from "../../modules/secret-store/index.js";

const AUTH: Extract<ConnectionAuthConfig, { kind: "oauth" }> = {
  kind: "oauth",
  clientId: "cid",
  refreshTokenRef: {
    storeId: "test",
    path: "secret-p",
    field: "refresh_token",
  },
  accessTokenRef: { storeId: "test", path: "secret-p", field: "access_token" },
  scopes: ["read"],
  tokenUrl: "https://auth.example.com/token",
  authorizationUrl: "https://auth.example.com/authorize",
  expiresAt: 1000,
  connectedAt: 900,
};

const CC_AUTH: Extract<ConnectionAuthConfig, { kind: "client-credentials" }> = {
  kind: "client-credentials",
  clientId: "cid",
  clientSecretRef: {
    storeId: "test",
    path: "secret-p",
    field: "client_secret",
  },
  accessTokenRef: { storeId: "test", path: "secret-p", field: "access_token" },
  issuerUrl: "https://auth.example.com/realms/main",
  tokenUrl: "https://auth.example.com/token",
  scopes: ["read"],
  expiresAt: 1000,
  connectedAt: 900,
};

interface RawRow {
  id: string;
  owner: string;
  templateId: string;
  name: string;
  inputs: unknown;
  auth: unknown;
  contributions: unknown;
}

const rowFor = (id: string, auth: ConnectionAuthConfig = AUTH): RawRow => ({
  id,
  owner: "owner-sub",
  templateId: "custom-oauth",
  name: id,
  inputs: {},
  auth,
  contributions: [],
});

function makeLoop(opts?: {
  baseMs?: number;
  maxMs?: number;
  auth?: ConnectionAuthConfig;
}) {
  const auth = opts?.auth ?? AUTH;
  let clock = 0;
  let mode: "fail" | "ok" = "fail";
  let fetchCount = 0;
  let rows: RawRow[] = [rowFor("conn-1", auth)];

  const fetchImpl = (async () => {
    fetchCount++;
    if (mode === "fail") {
      // What Google returns for a revoked refresh token.
      return new Response("error=invalid_grant", { status: 400 });
    }
    return new Response(
      JSON.stringify({ access_token: "tok", expires_in: 3600 }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  // dueConnections' SQL predicate is exercised against Postgres elsewhere; the
  // fake returns the current row set verbatim so these tests isolate the
  // loop's backoff bookkeeping.
  const db = {
    select: () => ({ from: () => ({ where: () => Promise.resolve(rows) }) }),
    update: () => ({
      set: () => ({ where: () => Promise.resolve(undefined) }),
    }),
  } as unknown as Db;

  const loop = createOAuthRefreshLoop({
    db,
    engine: createOAuthEngine({ now: () => clock, fetchImpl }),
    githubAppEngine: createGitHubAppEngine({ now: () => clock, fetchImpl }),
    templates: {
      get: () => undefined,
    } as unknown as ConnectionTemplateRegistry,
    secretStore: {
      getField: async () => "refresh-tok",
      putFields: async () => {},
    } as unknown as SecretStore,
    backoffBaseMs: opts?.baseMs ?? 60_000,
    backoffMaxMs: opts?.maxMs ?? 30 * 60_000,
    now: () => clock,
    log: () => {},
  });

  return {
    loop,
    setClock: (t: number) => (clock = t),
    setMode: (m: "fail" | "ok") => (mode = m),
    setRows: (ids: string[]) => (rows = ids.map((id) => rowFor(id, auth))),
    fetchCount: () => fetchCount,
  };
}

describe("backoffDelayMs", () => {
  it("doubles per consecutive failure and caps at max", () => {
    expect(backoffDelayMs(1, 1000, 100_000)).toBe(1000);
    expect(backoffDelayMs(2, 1000, 100_000)).toBe(2000);
    expect(backoffDelayMs(3, 1000, 100_000)).toBe(4000);
    expect(backoffDelayMs(100, 1000, 100_000)).toBe(100_000);
  });

  it("treats a zero/negative failure count as the base delay", () => {
    expect(backoffDelayMs(0, 1000, 100_000)).toBe(1000);
  });
});

describe("oauth refresh loop backoff", () => {
  it("backs off exponentially and skips a failing connection until due", async () => {
    const h = makeLoop({ baseMs: 60_000 });

    h.setClock(0);
    expect(await h.loop.tickOnce()).toEqual({
      refreshed: 0,
      failed: 1,
      skipped: 0,
    });
    expect(h.fetchCount()).toBe(1);

    // Same instant: inside the 60s backoff window → skipped, no network call.
    expect(await h.loop.tickOnce()).toEqual({
      refreshed: 0,
      failed: 0,
      skipped: 1,
    });
    expect(h.fetchCount()).toBe(1);

    // Just before the window elapses: still skipped.
    h.setClock(59_999);
    expect((await h.loop.tickOnce()).skipped).toBe(1);
    expect(h.fetchCount()).toBe(1);

    // Window elapsed: retry (still failing) → next window doubles to 120s.
    h.setClock(60_000);
    expect(await h.loop.tickOnce()).toEqual({
      refreshed: 0,
      failed: 1,
      skipped: 0,
    });
    expect(h.fetchCount()).toBe(2);

    // 60_000 + 120_000 = 180_000 is the next attempt; 120_000 is still early.
    h.setClock(120_000);
    expect((await h.loop.tickOnce()).skipped).toBe(1);
    expect(h.fetchCount()).toBe(2);
  });

  it("resets the failure counter (not just the timer) after a success", async () => {
    const h = makeLoop({ baseMs: 60_000 });

    // First failure → failures=1, nextAttempt = 0 + 60_000.
    h.setClock(0);
    await h.loop.tickOnce();

    // Succeeds once the window elapses → the entry must be fully cleared.
    h.setClock(60_000);
    h.setMode("ok");
    expect((await h.loop.tickOnce()).refreshed).toBe(1);

    // Fails again. If the counter reset this is failures=1 → a 60s window
    // (nextAttempt = 60_001 + 60_000 = 120_001). Had the entry survived the
    // success, it would be failures=2 → a 120s window (nextAttempt = 180_001).
    h.setClock(60_001);
    h.setMode("fail");
    expect((await h.loop.tickOnce()).failed).toBe(1);
    const afterSecondFailure = h.fetchCount();

    // At 150_000 the 60s window has elapsed but a doubled 120s window has not:
    // a retry here is only possible if the success reset the counter to base.
    // (If the entry had survived, this tick would be skipped instead.)
    h.setClock(150_000);
    expect((await h.loop.tickOnce()).failed).toBe(1);
    expect(h.fetchCount()).toBe(afterSecondFailure + 1);
  });

  it("applies the same backoff to a failing client-credentials remint", async () => {
    const h = makeLoop({ baseMs: 60_000, auth: CC_AUTH });

    h.setClock(0);
    expect(await h.loop.tickOnce()).toEqual({
      refreshed: 0,
      failed: 1,
      skipped: 0,
    });
    expect(h.fetchCount()).toBe(1);

    // Inside the backoff window → skipped, no second remint attempt.
    expect((await h.loop.tickOnce()).skipped).toBe(1);
    expect(h.fetchCount()).toBe(1);
  });

  it("prunes backoff state once a connection leaves the due set", async () => {
    const h = makeLoop({ baseMs: 100_000 });

    h.setClock(0);
    await h.loop.tickOnce(); // fail → nextAttempt = 100_000
    expect(h.fetchCount()).toBe(1);

    // Connection no longer due (refreshed elsewhere / deleted) → entry pruned.
    h.setRows([]);
    expect(await h.loop.tickOnce()).toEqual({
      refreshed: 0,
      failed: 0,
      skipped: 0,
    });

    // It reappears well before the old window: a stale entry would skip it,
    // but the pruned state means it is attempted immediately.
    h.setRows(["conn-1"]);
    h.setClock(50_000);
    expect((await h.loop.tickOnce()).failed).toBe(1);
    expect(h.fetchCount()).toBe(2);
  });
});
