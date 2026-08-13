import { createMemoryTtlStore } from "../../core/ttl-store.js";
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

// The kinds that can carry a refresh-failure marker (header/none never do).
type MarkableAuth = Extract<
  ConnectionAuthConfig,
  { kind: "oauth" | "client-credentials" | "github-app" }
>;

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

type Mode =
  | "transient"
  | "revoked-grant"
  | "revoked-grant-200"
  | "invalid-client"
  | "ok";

const MODE_RESPONSES: Record<Mode, () => Response> = {
  // Retryable: the endpoint failed to answer rather than rejecting anything.
  transient: () => new Response("upstream unavailable", { status: 503 }),
  // What Google returns for a revoked refresh token, form-encoded.
  "revoked-grant": () => new Response("error=invalid_grant", { status: 400 }),
  // GitHub's shape: the rejection rides a 200 form body, so the code — not the
  // status — has to classify it.
  "revoked-grant-200": () =>
    new Response("error=bad_refresh_token&error_description=expired", {
      status: 200,
    }),
  // Client credential rejected: permanent only if the connection owns it.
  "invalid-client": () =>
    new Response(JSON.stringify({ error: "invalid_client" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    }),
  ok: () =>
    new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
};

function makeLoop(opts?: {
  baseMs?: number;
  maxMs?: number;
  auth?: ConnectionAuthConfig;
  /** Simulate a credential fix racing the tick: the guarded marker write
   *  matches no rows. */
  markerWriteMatches?: boolean;
}) {
  const auth = opts?.auth ?? AUTH;
  let clock = 0;
  let mode: Mode = "transient";
  let fetchCount = 0;
  let rows: RawRow[] = [rowFor("conn-1", auth)];
  // Whether the rows currently read as due, without discarding them — models
  // a connection whose expiry moved out and later back in, keeping whatever
  // the loop persisted on it.
  let due = true;
  const written: ConnectionAuthConfig[] = [];

  const fetchImpl = (async () => {
    fetchCount++;
    return MODE_RESPONSES[mode]();
  }) as typeof fetch;

  // Two writes arrive as SQL fragments (server-side jsonb merges, so a
  // concurrent fix isn't clobbered): the permanent-failure marker, and the
  // transient backoff. Tell them apart by the path they set, and stand in for
  // Postgres applying each. Success paths write plain auth objects and pass
  // through.
  // Read the literal SQL text out of the chunks. Deliberately not
  // JSON.stringify: a chunk may be a drizzle Column, which is circular.
  const chunkText = (next: unknown): string =>
    ((next as { queryChunks: unknown[] }).queryChunks ?? [])
      .flatMap((c) =>
        typeof c === "string"
          ? [c]
          : Array.isArray((c as { value?: unknown }).value)
            ? ((c as { value: unknown[] }).value.filter(
                (v) => typeof v === "string",
              ) as string[])
            : [],
      )
      .join("");

  const fragmentPath = (next: unknown): "marker" | "backoff" | null => {
    if (!next || typeof next !== "object" || !("queryChunks" in next))
      return null;
    const text = chunkText(next);
    if (text.includes("refreshBackoff")) return "backoff";
    if (text.includes("refreshFailedAt")) return "marker";
    return null;
  };

  // The backoff value rides the fragment as a JSON-encoded param; pull it back
  // out so the next tick sees what the loop actually persisted.
  const backoffFromFragment = (next: unknown) => {
    const json = ((next as { queryChunks: unknown[] }).queryChunks ?? []).find(
      (c): c is string => typeof c === "string" && c.includes("nextAttempt"),
    );
    return json
      ? (JSON.parse(json) as { failures: number; nextAttempt: number })
      : undefined;
  };

  const applyAuthWrite = (
    current: MarkableAuth,
    next: unknown,
  ): ConnectionAuthConfig => {
    switch (fragmentPath(next)) {
      case "marker":
        return { ...current, refreshFailedAt: Math.floor(clock / 1000) };
      case "backoff":
        return { ...current, refreshBackoff: backoffFromFragment(next) };
      default:
        return next as ConnectionAuthConfig;
    }
  };

  // Only the marker clause is reproduced here — "a marked connection is parked"
  // is what these tests assert. Writes land back on the rows for the next tick.
  const db = {
    select: () => ({
      from: () => ({
        where: () =>
          Promise.resolve(
            due
              ? rows.filter((r) => !("refreshFailedAt" in (r.auth as object)))
              : [],
          ),
      }),
    }),
    update: () => ({
      set: (patch: { auth: unknown }) => ({
        where: () => {
          const kind = fragmentPath(patch.auth);
          if (kind === "marker" && opts?.markerWriteMatches === false) {
            return Promise.resolve({ rowCount: 0 });
          }
          for (const r of rows) {
            r.auth = applyAuthWrite(r.auth as MarkableAuth, patch.auth);
          }
          // Backoff is bookkeeping, not a credential write — keep it out of
          // the persisted-auth log these tests assert on.
          if (kind !== "backoff") {
            written.push((rows[0]?.auth ?? patch.auth) as ConnectionAuthConfig);
          }
          return Promise.resolve({ rowCount: rows.length });
        },
      }),
    }),
  } as unknown as Db;

  // Every call builds a fresh loop over the same `rows` and clock — a second
  // api-server replica, sharing Postgres but nothing in memory.
  const makeReplicaLoop = () =>
    createOAuthRefreshLoop({
      db,
      engine: createOAuthEngine({
        pendingStore: createMemoryTtlStore(600_000),
        now: () => clock,
        fetchImpl,
      }),
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

  const loop = makeReplicaLoop();

  return {
    loop,
    /** A second replica's loop over the same rows: shares Postgres, shares no
     *  in-process state. */
    forkReplica: makeReplicaLoop,
    setClock: (t: number) => (clock = t),
    setMode: (m: Mode) => (mode = m),
    setRows: (ids: string[]) => (rows = ids.map((id) => rowFor(id, auth))),
    /** Take the rows out of / back into the due set, preserving their auth. */
    setDue: (v: boolean) => (due = v),
    fetchCount: () => fetchCount,
    /** Auth objects the loop persisted, oldest first. */
    written: () => written,
    /** Stands in for credential maintenance clearing the marker. */
    clearMarker: () => {
      for (const r of rows) {
        const { refreshFailedAt: _dropped, ...rest } =
          r.auth as ConnectionAuthConfig & { refreshFailedAt?: number };
        r.auth = rest;
      }
    },
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

    // A transient failure never marks: the backoff above governs the retry.
    expect(h.written()).toEqual([]);
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
    h.setMode("transient");
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

  it("holds the backoff across replicas by persisting it on the connection", async () => {
    const h = makeLoop({ baseMs: 60_000 });

    h.setClock(0);
    expect((await h.loop.tickOnce()).failed).toBe(1);

    // The sweep runs as a periodic job on whichever replica draws the tick, so
    // the next one is a different process with an empty heap. A second loop
    // over the same rows stands in for that: it must still honour the window,
    // which it can only do if the backoff was written to the connection.
    const other = h.forkReplica();
    h.setClock(30_000);
    expect((await other.tickOnce()).skipped).toBe(1);
    expect(h.fetchCount()).toBe(1);

    // ...and still retry once the window has elapsed.
    h.setClock(70_000);
    expect((await other.tickOnce()).failed).toBe(1);
    expect(h.fetchCount()).toBe(2);
  });

  it("keeps the backoff across a trip out of the due set, and a success clears it", async () => {
    const h = makeLoop({ baseMs: 100_000 });

    h.setClock(0);
    await h.loop.tickOnce(); // fail → nextAttempt = 100_000
    expect(h.fetchCount()).toBe(1);

    // Leaves the due set and comes back — same row, so the backoff comes back
    // with it. The in-memory version pruned here and handed the connection a
    // free retry; persisted, a still-failing connection stays held.
    h.setDue(false);
    expect((await h.loop.tickOnce()).skipped).toBe(0);
    h.setDue(true);

    h.setClock(50_000);
    expect((await h.loop.tickOnce()).skipped).toBe(1);
    expect(h.fetchCount()).toBe(1);

    // A success is what clears it — every credential write strips the record,
    // so the connection is never held on a stale one after it is fixed.
    h.setClock(150_000);
    h.setMode("ok");
    expect((await h.loop.tickOnce()).refreshed).toBe(1);
    h.setMode("transient");
    h.setClock(150_001);
    expect((await h.loop.tickOnce()).failed).toBe(1);
  });
});

describe("oauth refresh permanent failures", () => {
  it.each(["revoked-grant", "revoked-grant-200"] as const)(
    "marks a revoked grant (%s) and parks it out of the due set",
    async (mode) => {
      const h = makeLoop();
      h.setMode(mode);
      h.setClock(5_000);

      expect(await h.loop.tickOnce()).toEqual({
        refreshed: 0,
        failed: 1,
        skipped: 0,
      });
      expect(h.written().at(-1)).toMatchObject({ refreshFailedAt: 5 });

      // Parked, not backed off — gone from the due set, so not even skipped.
      expect(await h.loop.tickOnce()).toEqual({
        refreshed: 0,
        failed: 0,
        skipped: 0,
      });
      expect(h.fetchCount()).toBe(1);
    },
  );

  it("marks a rejected client secret only when the connection owns it", async () => {
    // No clientSecretRef: the operator owns the secret, a redeploy fixes it.
    const operatorBaked = makeLoop();
    operatorBaked.setMode("invalid-client");
    expect((await operatorBaked.loop.tickOnce()).failed).toBe(1);
    expect(operatorBaked.written()).toEqual([]);

    const ownSecret = makeLoop({
      auth: {
        ...AUTH,
        clientSecretRef: {
          storeId: "test",
          path: "secret-p",
          field: "client_secret",
        },
      },
    });
    ownSecret.setMode("invalid-client");
    ownSecret.setClock(9_000);
    expect((await ownSecret.loop.tickOnce()).failed).toBe(1);
    expect(ownSecret.written().at(-1)).toMatchObject({ refreshFailedAt: 9 });
  });

  it("falls back to the backoff when the guarded marker write matches no rows", async () => {
    const h = makeLoop({ markerWriteMatches: false });
    h.setMode("revoked-grant");
    h.setClock(0);
    expect((await h.loop.tickOnce()).failed).toBe(1);
    expect(h.written()).toEqual([]);

    // Not parked: still due, held by the backoff window instead of retried hot.
    expect((await h.loop.tickOnce()).skipped).toBe(1);
    expect(h.fetchCount()).toBe(1);
  });

  it("re-admits a connection once the marker is cleared", async () => {
    const h = makeLoop();
    h.setMode("revoked-grant");
    await h.loop.tickOnce();
    expect((await h.loop.tickOnce()).failed).toBe(0);

    h.clearMarker();
    h.setMode("ok");
    expect((await h.loop.tickOnce()).refreshed).toBe(1);
    expect(h.written().at(-1)).not.toHaveProperty("refreshFailedAt");
  });
});
