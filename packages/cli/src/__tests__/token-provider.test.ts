import { describe, expect, it } from "vitest";
import { ok, type Result } from "../result.js";
import { createTokenProvider } from "../modules/auth/services/token-provider.js";
import type {
  AuthStore,
  HostUrl,
} from "../modules/auth/infrastructure/auth-store.js";
import type { HostAuth } from "../modules/auth/domain/host-auth.js";
import type { AuthEnvReader } from "../modules/auth/infrastructure/auth-env-reader.js";
import type { TokenEndpointClient } from "../modules/auth/infrastructure/token-endpoint-client.js";
import type { TokenEndpointResponse } from "../modules/auth/domain/tokens.js";
import type { HostMetadataResolver } from "../modules/auth/services/token-provider.js";
import type { TokenTransportError } from "../modules/auth/domain/errors.js";

const HOST: HostUrl = "http://dam.localhost:4444";
const NOW = new Date("2026-01-01T00:00:00.000Z");

function makeAuth(expiresAtIso: string): HostAuth {
  return {
    issuer: "http://idp/realms/platform",
    username: "petr",
    sub: "s",
    cliClientId: "platform-cli",
    accessToken: "AT-old",
    refreshToken: "RT-old",
    expiresAt: new Date(expiresAtIso),
  };
}

/** In-memory Auth Store. Mirrors the production port shape exactly. */
function makeStore(seed: Array<[HostUrl, HostAuth]> = []): AuthStore & {
  state: Map<HostUrl, HostAuth>;
  writes: number;
  removes: number;
} {
  const state = new Map<HostUrl, HostAuth>(seed);
  let writes = 0;
  let removes = 0;
  return {
    get state() { return state; },
    get writes() { return writes; },
    get removes() { return removes; },
    async read() {
      return ok(state as ReadonlyMap<HostUrl, HostAuth>);
    },
    async write(host, value) {
      writes++;
      state.set(host, value);
      return ok(undefined);
    },
    async remove(host) {
      removes++;
      state.delete(host);
      return ok(undefined);
    },
  };
}

function envReader(token: string | undefined): AuthEnvReader {
  return { damToken: () => token };
}

function metadataResolver(): HostMetadataResolver {
  return {
    async resolve() {
      return ok({ tokenEndpoint: "http://idp/token" });
    },
  };
}

/** Token endpoint client whose refresh() returns a scripted response. */
function refreshClient(
  result: Result<TokenEndpointResponse, TokenTransportError>,
  spy?: { calls: number },
): TokenEndpointClient {
  return {
    async exchangeDeviceCode() {
      throw new Error("not used in token-provider tests");
    },
    async refresh() {
      if (spy) spy.calls++;
      return result;
    },
  };
}

describe("TokenProvider — claim 5: DAM_TOKEN precedence", () => {
  it("DAM_TOKEN set + Auth Store entry present → returns env value, no refresh, no write", async () => {
    const spy = { calls: 0 };
    const store = makeStore([[HOST, makeAuth("2026-01-01T00:00:30Z")]]);
    const tp = createTokenProvider({
      authStore: store,
      authEnvReader: envReader("env-token-value"),
      tokenEndpointClient: refreshClient(
        ok({ kind: "success", access_token: "x", refresh_token: "y", expires_in: 1, token_type: "Bearer" }),
        spy,
      ),
      hostMetadata: metadataResolver(),
      now: () => NOW,
    });

    const r = await tp.getValidAccessToken(HOST);
    expect(r).toEqual({ ok: true, value: "env-token-value" });
    expect(spy.calls).toBe(0);
    expect(store.writes).toBe(0);
    expect(store.removes).toBe(0);
  });

  it("DAM_TOKEN empty string treated as unset (falls through to Auth Store)", async () => {
    const store = makeStore([[HOST, makeAuth("2027-01-01T00:00:00Z")]]);
    const tp = createTokenProvider({
      authStore: store,
      // The production reader maps "" → undefined; injecting undefined
      // here mirrors that contract.
      authEnvReader: envReader(undefined),
      tokenEndpointClient: refreshClient(
        ok({ kind: "error", error: "should_not_be_called" }),
      ),
      hostMetadata: metadataResolver(),
      now: () => NOW,
    });

    const r = await tp.getValidAccessToken(HOST);
    expect(r).toEqual({ ok: true, value: "AT-old" });
  });
});

describe("TokenProvider — claim 3: proactive refresh 60s buffer", () => {
  it("expiresAt 90s away → returns current access token, no refresh call", async () => {
    const spy = { calls: 0 };
    const store = makeStore([
      [HOST, makeAuth(new Date(NOW.getTime() + 90_000).toISOString())],
    ]);
    const tp = createTokenProvider({
      authStore: store,
      authEnvReader: envReader(undefined),
      tokenEndpointClient: refreshClient(
        ok({ kind: "success", access_token: "x", refresh_token: "y", expires_in: 1, token_type: "Bearer" }),
        spy,
      ),
      hostMetadata: metadataResolver(),
      now: () => NOW,
    });

    const r = await tp.getValidAccessToken(HOST);
    expect(r).toEqual({ ok: true, value: "AT-old" });
    expect(spy.calls).toBe(0);
    expect(store.writes).toBe(0);
  });

  it("expiresAt 30s away → triggers refresh, returns NEW access token, persists rotated tokens", async () => {
    const spy = { calls: 0 };
    const store = makeStore([
      [HOST, makeAuth(new Date(NOW.getTime() + 30_000).toISOString())],
    ]);
    const tp = createTokenProvider({
      authStore: store,
      authEnvReader: envReader(undefined),
      tokenEndpointClient: refreshClient(
        ok({
          kind: "success",
          access_token: "AT-new",
          refresh_token: "RT-new",
          expires_in: 3600,
          token_type: "Bearer",
        }),
        spy,
      ),
      hostMetadata: metadataResolver(),
      now: () => NOW,
    });

    const r = await tp.getValidAccessToken(HOST);
    expect(r).toEqual({ ok: true, value: "AT-new" });
    expect(spy.calls).toBe(1);
    expect(store.writes).toBe(1);
    expect(store.state.get(HOST)?.accessToken).toBe("AT-new");
    expect(store.state.get(HOST)?.refreshToken).toBe("RT-new");
    expect(store.state.get(HOST)?.expiresAt.toISOString()).toBe(
      new Date(NOW.getTime() + 3600 * 1000).toISOString(),
    );
  });

  it("boundary: expiresAt exactly 60s away → triggers refresh (off-by-one regression guard)", async () => {
    const spy = { calls: 0 };
    const store = makeStore([
      [HOST, makeAuth(new Date(NOW.getTime() + 60_000).toISOString())],
    ]);
    const tp = createTokenProvider({
      authStore: store,
      authEnvReader: envReader(undefined),
      tokenEndpointClient: refreshClient(
        ok({
          kind: "success",
          access_token: "AT-new",
          refresh_token: "RT-new",
          expires_in: 3600,
          token_type: "Bearer",
        }),
        spy,
      ),
      hostMetadata: metadataResolver(),
      now: () => NOW,
    });

    const r = await tp.getValidAccessToken(HOST);
    expect(r).toEqual({ ok: true, value: "AT-new" });
    expect(spy.calls).toBe(1);
  });
});

describe("TokenProvider — claim 4: invalid_grant clears creds; transient errors don't", () => {
  it("OAuth invalid_grant → removes host entry, returns session-expired", async () => {
    const store = makeStore([
      [HOST, makeAuth(new Date(NOW.getTime() + 30_000).toISOString())],
    ]);
    const tp = createTokenProvider({
      authStore: store,
      authEnvReader: envReader(undefined),
      tokenEndpointClient: refreshClient(
        ok({ kind: "error", error: "invalid_grant", error_description: "expired" }),
      ),
      hostMetadata: metadataResolver(),
      now: () => NOW,
    });

    const r = await tp.getValidAccessToken(HOST);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("session-expired");
      if (r.error.kind === "session-expired") expect(r.error.host).toBe(HOST);
    }
    expect(store.state.has(HOST)).toBe(false);
    expect(store.removes).toBe(1);
  });

  it("Transport error → preserves host entry, returns refresh-transient", async () => {
    const store = makeStore([
      [HOST, makeAuth(new Date(NOW.getTime() + 30_000).toISOString())],
    ]);
    const tp = createTokenProvider({
      authStore: store,
      authEnvReader: envReader(undefined),
      tokenEndpointClient: {
        async exchangeDeviceCode() { throw new Error("unused"); },
        async refresh() {
          return { ok: false, error: { kind: "token-transport", reason: "ECONNREFUSED" } };
        },
      },
      hostMetadata: metadataResolver(),
      now: () => NOW,
    });

    const r = await tp.getValidAccessToken(HOST);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("refresh-transient");
      if (r.error.kind === "refresh-transient") {
        expect(r.error.reason).toContain("ECONNREFUSED");
      }
    }
    expect(store.state.has(HOST)).toBe(true);
    expect(store.state.get(HOST)?.refreshToken).toBe("RT-old");
    expect(store.removes).toBe(0);
  });

  it("Other OAuth error (unauthorized_client) → preserves entry, returns refresh-failed", async () => {
    const store = makeStore([
      [HOST, makeAuth(new Date(NOW.getTime() + 30_000).toISOString())],
    ]);
    const tp = createTokenProvider({
      authStore: store,
      authEnvReader: envReader(undefined),
      tokenEndpointClient: refreshClient(
        ok({
          kind: "error",
          error: "unauthorized_client",
          error_description: "client got reconfigured",
        }),
      ),
      hostMetadata: metadataResolver(),
      now: () => NOW,
    });

    const r = await tp.getValidAccessToken(HOST);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("refresh-failed");
      if (r.error.kind === "refresh-failed") {
        expect(r.error.reason).toContain("unauthorized_client");
        expect(r.error.reason).toContain("client got reconfigured");
      }
    }
    expect(store.state.has(HOST)).toBe(true);
    expect(store.removes).toBe(0);
  });
});

describe("TokenProvider — not-logged-in path", () => {
  it("no env, no Auth Store entry for host → not-logged-in error", async () => {
    const store = makeStore();
    const tp = createTokenProvider({
      authStore: store,
      authEnvReader: envReader(undefined),
      tokenEndpointClient: refreshClient(
        ok({ kind: "error", error: "should_not_be_called" }),
      ),
      hostMetadata: metadataResolver(),
      now: () => NOW,
    });

    const r = await tp.getValidAccessToken(HOST);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("not-logged-in");
      if (r.error.kind === "not-logged-in") expect(r.error.host).toBe(HOST);
    }
  });
});
