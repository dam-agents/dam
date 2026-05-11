import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTokenEndpointClient } from "../modules/auth/infrastructure/token-endpoint-client.js";

const ORIGINAL_FETCH = globalThis.fetch;
const TOKEN_ENDPOINT =
  "http://keycloak.example/realms/platform/protocol/openid-connect/token";

describe("HttpTokenEndpointClient", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    vi.restoreAllMocks();
  });

  function stubFetch(
    handler: (url: string, init?: RequestInit) => Promise<Response>,
  ) {
    globalThis.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) =>
      handler(typeof input === "string" ? input : input.toString(), init),
    ) as typeof globalThis.fetch;
  }

  describe("exchangeDeviceCode", () => {
    it("200 success body parses as { kind: 'success', ... }", async () => {
      let body = "";
      stubFetch(async (_url, init) => {
        body = String(init?.body);
        return new Response(
          JSON.stringify({
            access_token: "AT",
            refresh_token: "RT",
            expires_in: 3600,
            token_type: "Bearer",
          }),
          { status: 200 },
        );
      });

      const r = await createTokenEndpointClient().exchangeDeviceCode({
        tokenEndpoint: TOKEN_ENDPOINT,
        clientId: "platform-cli",
        deviceCode: "DC",
      });

      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.value).toEqual({
          kind: "success",
          access_token: "AT",
          refresh_token: "RT",
          expires_in: 3600,
          token_type: "Bearer",
        });
      }

      // Public client: client_id in body, NO Authorization header.
      const params = new URLSearchParams(body);
      expect(params.get("grant_type")).toBe(
        "urn:ietf:params:oauth:grant-type:device_code",
      );
      expect(params.get("client_id")).toBe("platform-cli");
      expect(params.get("device_code")).toBe("DC");
    });

    it("400 with OAuth error body parses as { kind: 'error', ... }", async () => {
      stubFetch(async () =>
        new Response(
          JSON.stringify({
            error: "authorization_pending",
            error_description: "not yet",
          }),
          { status: 400 },
        ),
      );

      const r = await createTokenEndpointClient().exchangeDeviceCode({
        tokenEndpoint: TOKEN_ENDPOINT,
        clientId: "platform-cli",
        deviceCode: "DC",
      });

      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.value).toEqual({
          kind: "error",
          error: "authorization_pending",
          error_description: "not yet",
        });
      }
    });

    it("network error → Err(token-transport)", async () => {
      stubFetch(async () => {
        throw new TypeError("fetch failed");
      });

      const r = await createTokenEndpointClient().exchangeDeviceCode({
        tokenEndpoint: TOKEN_ENDPOINT,
        clientId: "platform-cli",
        deviceCode: "DC",
      });

      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.kind).toBe("token-transport");
        expect(r.error.reason).toContain("fetch failed");
      }
    });

    it("5xx → Err(token-transport) — no OAuth body to forward", async () => {
      stubFetch(async () => new Response("server boom", { status: 503 }));

      const r = await createTokenEndpointClient().exchangeDeviceCode({
        tokenEndpoint: TOKEN_ENDPOINT,
        clientId: "platform-cli",
        deviceCode: "DC",
      });

      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.kind).toBe("token-transport");
        expect(r.error.reason).toContain("503");
      }
    });

    it("unparseable body shape → Err(token-transport)", async () => {
      stubFetch(async () =>
        new Response(JSON.stringify({ something_weird: true }), { status: 200 }),
      );

      const r = await createTokenEndpointClient().exchangeDeviceCode({
        tokenEndpoint: TOKEN_ENDPOINT,
        clientId: "platform-cli",
        deviceCode: "DC",
      });

      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe("token-transport");
    });
  });

  describe("refresh", () => {
    it("sends grant_type=refresh_token with client_id + refresh_token in the body", async () => {
      let body = "";
      stubFetch(async (_url, init) => {
        body = String(init?.body);
        return new Response(
          JSON.stringify({
            access_token: "AT2",
            refresh_token: "RT2",
            expires_in: 3600,
            token_type: "Bearer",
          }),
          { status: 200 },
        );
      });

      const r = await createTokenEndpointClient().refresh({
        tokenEndpoint: TOKEN_ENDPOINT,
        clientId: "platform-cli",
        refreshToken: "RT-old",
      });

      expect(r.ok).toBe(true);
      const params = new URLSearchParams(body);
      expect(params.get("grant_type")).toBe("refresh_token");
      expect(params.get("client_id")).toBe("platform-cli");
      expect(params.get("refresh_token")).toBe("RT-old");
    });

    it("invalid_grant body parses as a normal OAuth-error response (forwarded, not a transport error)", async () => {
      stubFetch(async () =>
        new Response(
          JSON.stringify({
            error: "invalid_grant",
            error_description: "refresh token expired",
          }),
          { status: 400 },
        ),
      );

      const r = await createTokenEndpointClient().refresh({
        tokenEndpoint: TOKEN_ENDPOINT,
        clientId: "platform-cli",
        refreshToken: "RT-old",
      });

      // TokenProvider (issue 5) needs to see this body to clear the host's
      // creds and surface session-expired UX. A transport error would lose
      // that signal.
      expect(r.ok).toBe(true);
      if (r.ok && r.value.kind === "error") {
        expect(r.value.error).toBe("invalid_grant");
      }
    });
  });
});
