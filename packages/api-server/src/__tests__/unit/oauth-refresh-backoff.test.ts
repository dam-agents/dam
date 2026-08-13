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
  transient: () => new Response("upstream unavailable", { status: 503 }),
  "revoked-grant": () => new Response("error=invalid_grant", { status: 400 }),
  "revoked-grant-200": () =>
    new Response("error=bad_refresh_token&error_description=expired", {
      status: 200,
    }),
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
  markerWriteMatches?: boolean;
}) {
  const auth = opts?.auth ?? AUTH;
  let clock = 0;
  let mode: Mode = "transient";
  let fetchCount = 0;
  let rows: RawRow[] = [rowFor("conn-1", auth)];
  let due = true;
  const written: ConnectionAuthConfig[] = [];

  const fetchImpl = (async () => {
    fetchCount++;
    return MODE_RESPONSES[mode]();
  }) as typeof fetch;

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
          if (kind !== "backoff") {
            written.push((rows[0]?.auth ?? patch.auth) as ConnectionAuthConfig);
          }
          return Promise.resolve({ rowCount: rows.length });
        },
      }),
    }),
  } as unknown as Db;

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
    forkReplica: makeReplicaLoop,
    setClock: (t: number) => (clock = t),
    setMode: (m: Mode) => (mode = m),
    setRows: (ids: string[]) => (rows = ids.map((id) => rowFor(id, auth))),
    setDue: (v: boolean) => (due = v),
    fetchCount: () => fetchCount,
    written: () => written,
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

    expect(await h.loop.tickOnce()).toEqual({
      refreshed: 0,
      failed: 0,
      skipped: 1,
    });
    expect(h.fetchCount()).toBe(1);

    h.setClock(59_999);
    expect((await h.loop.tickOnce()).skipped).toBe(1);
    expect(h.fetchCount()).toBe(1);

    h.setClock(60_000);
    expect(await h.loop.tickOnce()).toEqual({
      refreshed: 0,
      failed: 1,
      skipped: 0,
    });
    expect(h.fetchCount()).toBe(2);

    h.setClock(120_000);
    expect((await h.loop.tickOnce()).skipped).toBe(1);
    expect(h.fetchCount()).toBe(2);

    expect(h.written()).toEqual([]);
  });

  it("resets the failure counter (not just the timer) after a success", async () => {
    const h = makeLoop({ baseMs: 60_000 });

    h.setClock(0);
    await h.loop.tickOnce();

    h.setClock(60_000);
    h.setMode("ok");
    expect((await h.loop.tickOnce()).refreshed).toBe(1);

    h.setClock(60_001);
    h.setMode("transient");
    expect((await h.loop.tickOnce()).failed).toBe(1);
    const afterSecondFailure = h.fetchCount();

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

    expect((await h.loop.tickOnce()).skipped).toBe(1);
    expect(h.fetchCount()).toBe(1);
  });

  it("holds the backoff across replicas by persisting it on the connection", async () => {
    const h = makeLoop({ baseMs: 60_000 });

    h.setClock(0);
    expect((await h.loop.tickOnce()).failed).toBe(1);

    const other = h.forkReplica();
    h.setClock(30_000);
    expect((await other.tickOnce()).skipped).toBe(1);
    expect(h.fetchCount()).toBe(1);

    h.setClock(70_000);
    expect((await other.tickOnce()).failed).toBe(1);
    expect(h.fetchCount()).toBe(2);
  });

  it("keeps the backoff across a trip out of the due set, and a success clears it", async () => {
    const h = makeLoop({ baseMs: 100_000 });

    h.setClock(0);
    await h.loop.tickOnce();
    expect(h.fetchCount()).toBe(1);

    h.setDue(false);
    expect((await h.loop.tickOnce()).skipped).toBe(0);
    h.setDue(true);

    h.setClock(50_000);
    expect((await h.loop.tickOnce()).skipped).toBe(1);
    expect(h.fetchCount()).toBe(1);

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

      expect(await h.loop.tickOnce()).toEqual({
        refreshed: 0,
        failed: 0,
        skipped: 0,
      });
      expect(h.fetchCount()).toBe(1);
    },
  );

  it("marks a rejected client secret only when the connection owns it", async () => {
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
