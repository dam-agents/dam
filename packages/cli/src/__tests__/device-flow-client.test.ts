import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDeviceFlowClient,
  DEVICE_FLOW_SCOPE,
} from "../modules/auth/infrastructure/device-flow-client.js";

const ORIGINAL_FETCH = globalThis.fetch;
const ENDPOINT =
  "http://keycloak.example/realms/platform/protocol/openid-connect/auth/device";

describe("HttpDeviceFlowClient", () => {
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

  it("happy path: POSTs client_id + the spec scopes and returns parsed payload", async () => {
    let receivedBody = "";
    let receivedContentType = "";
    stubFetch(async (_url, init) => {
      receivedBody = String(init?.body);
      receivedContentType = (init?.headers as Record<string, string> | undefined)?.["Content-Type"]
        ?? "";
      return new Response(
        JSON.stringify({
          device_code: "DC",
          user_code: "UC",
          verification_uri: "http://idp/device",
          verification_uri_complete: "http://idp/device?user_code=UC",
          expires_in: 600,
          interval: 5,
        }),
        { status: 200 },
      );
    });

    const r = await createDeviceFlowClient().authorize({
      deviceAuthorizationEndpoint: ENDPOINT,
      clientId: "platform-cli",
    });

    expect(r).toEqual({
      ok: true,
      value: {
        deviceCode: "DC",
        userCode: "UC",
        verificationUri: "http://idp/device",
        verificationUriComplete: "http://idp/device?user_code=UC",
        expiresIn: 600,
        interval: 5,
      },
    });

    expect(receivedContentType).toBe("application/x-www-form-urlencoded");
    const params = new URLSearchParams(receivedBody);
    expect(params.get("client_id")).toBe("platform-cli");
    expect(params.get("scope")).toBe(DEVICE_FLOW_SCOPE);
  });

  it("malformed body → Err(malformed-response)", async () => {
    stubFetch(async () =>
      new Response(JSON.stringify({ device_code: "x" }), { status: 200 }),
    );

    const r = await createDeviceFlowClient().authorize({
      deviceAuthorizationEndpoint: ENDPOINT,
      clientId: "platform-cli",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("malformed-response");
  });

  it("network error → Err(network)", async () => {
    stubFetch(async () => {
      throw new TypeError("fetch failed");
    });

    const r = await createDeviceFlowClient().authorize({
      deviceAuthorizationEndpoint: ENDPOINT,
      clientId: "platform-cli",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("network");
  });

  it("non-2xx → Err(non-ok-status) carrying the status", async () => {
    stubFetch(async () => new Response("denied", { status: 401 }));

    const r = await createDeviceFlowClient().authorize({
      deviceAuthorizationEndpoint: ENDPOINT,
      clientId: "platform-cli",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("non-ok-status");
      expect(r.error.message).toContain("401");
    }
  });
});
