import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOidcDiscovery } from "../modules/auth/infrastructure/oidc-discovery.js";

const ORIGINAL_FETCH = globalThis.fetch;

function stubFetch(handler: (url: string) => Promise<Response>) {
  globalThis.fetch = vi.fn(async (input: string | URL | Request) =>
    handler(typeof input === "string" ? input : input.toString()),
  ) as typeof globalThis.fetch;
}

// A standards-shaped discovery document with the extra noise real
// Keycloak emits — we want to confirm the probe ignores everything we
// don't care about.
function fullDiscoveryBody(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    issuer: "http://idp.example/realms/platform",
    authorization_endpoint: "http://idp.example/realms/platform/protocol/openid-connect/auth",
    token_endpoint: "http://idp.example/realms/platform/protocol/openid-connect/token",
    revocation_endpoint: "http://idp.example/realms/platform/protocol/openid-connect/revoke",
    device_authorization_endpoint: "http://idp.example/realms/platform/protocol/openid-connect/auth/device",
    userinfo_endpoint: "http://idp.example/realms/platform/protocol/openid-connect/userinfo",
    response_types_supported: ["code", "token"],
    grant_types_supported: ["authorization_code", "urn:ietf:params:oauth:grant-type:device_code"],
    scopes_supported: ["openid", "profile", "email", "offline_access"],
    ...overrides,
  });
}

describe("HttpOidcDiscovery", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    vi.restoreAllMocks();
  });

  it("joins issuer + /.well-known/openid-configuration (no trailing slash duplication)", async () => {
    let receivedUrl = "";
    stubFetch(async (url) => {
      receivedUrl = url;
      return new Response(fullDiscoveryBody(), { status: 200 });
    });

    const probe = createOidcDiscovery();
    await probe.discover("http://idp.example/realms/platform/");
    expect(receivedUrl).toBe(
      "http://idp.example/realms/platform/.well-known/openid-configuration",
    );

    await probe.discover("http://idp.example/realms/platform");
    expect(receivedUrl).toBe(
      "http://idp.example/realms/platform/.well-known/openid-configuration",
    );
  });

  it("extracts only the three fields the CLI consumes", async () => {
    stubFetch(async () => new Response(fullDiscoveryBody(), { status: 200 }));

    const r = await createOidcDiscovery().discover(
      "http://idp.example/realms/platform",
    );
    expect(r).toEqual({
      ok: true,
      value: {
        deviceAuthorizationEndpoint:
          "http://idp.example/realms/platform/protocol/openid-connect/auth/device",
        tokenEndpoint:
          "http://idp.example/realms/platform/protocol/openid-connect/token",
        revocationEndpoint:
          "http://idp.example/realms/platform/protocol/openid-connect/revoke",
      },
    });
  });

  it("missing device_authorization_endpoint → Err(missing-device-endpoint)", async () => {
    stubFetch(async () =>
      new Response(
        fullDiscoveryBody({ device_authorization_endpoint: undefined }),
        { status: 200 },
      ),
    );

    const r = await createOidcDiscovery().discover(
      "http://idp.example/realms/platform",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("oidc-discovery");
      expect(r.error.code).toBe("missing-device-endpoint");
    }
  });

  it("missing token_endpoint → Err(malformed-response)", async () => {
    stubFetch(async () =>
      new Response(
        fullDiscoveryBody({ token_endpoint: undefined }),
        { status: 200 },
      ),
    );

    const r = await createOidcDiscovery().discover(
      "http://idp.example/realms/platform",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("malformed-response");
      expect(r.error.message).toContain("token_endpoint");
    }
  });

  it("malformed JSON → Err(malformed-response)", async () => {
    stubFetch(async () => new Response("not json", { status: 200 }));

    const r = await createOidcDiscovery().discover(
      "http://idp.example/realms/platform",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("malformed-response");
  });

  it("500 → Err(non-ok-status) carrying the status code", async () => {
    stubFetch(async () => new Response("nope", { status: 500 }));

    const r = await createOidcDiscovery().discover(
      "http://idp.example/realms/platform",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("non-ok-status");
      expect(r.error.message).toContain("500");
    }
  });

  it("network failure → Err(network)", async () => {
    stubFetch(async () => {
      throw new TypeError("fetch failed");
    });

    const r = await createOidcDiscovery().discover(
      "http://idp.example/realms/platform",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("network");
      expect(r.error.message).toContain("fetch failed");
    }
  });
});
