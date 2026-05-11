import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAuthConfigProbe } from "../modules/auth/infrastructure/auth-config-probe.js";

const ORIGINAL_FETCH = globalThis.fetch;

function stubFetch(handler: (url: string) => Promise<Response>) {
  globalThis.fetch = vi.fn(async (input: string | URL | Request) =>
    handler(typeof input === "string" ? input : input.toString()),
  ) as typeof globalThis.fetch;
}

describe("HttpAuthConfigProbe", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    vi.restoreAllMocks();
  });

  it("joins server URL + /api/auth/config (no trailing slash duplication)", async () => {
    let receivedUrl = "";
    stubFetch(async (url) => {
      receivedUrl = url;
      return new Response(
        JSON.stringify({
          issuer: "http://idp.example/realms/platform",
          clientId: "platform-ui",
          cliClientId: "platform-cli",
        }),
        { status: 200 },
      );
    });

    const probe = createAuthConfigProbe();
    await probe.probe("http://api.example/");
    expect(receivedUrl).toBe("http://api.example/api/auth/config");

    await probe.probe("http://api.example");
    expect(receivedUrl).toBe("http://api.example/api/auth/config");
  });

  it("returns Ok with the parsed body on 200", async () => {
    stubFetch(async () =>
      new Response(
        JSON.stringify({
          issuer: "http://idp.example/realms/platform",
          clientId: "platform-ui",
          cliClientId: "platform-cli",
        }),
        { status: 200 },
      ),
    );

    const r = await createAuthConfigProbe().probe("http://api.example");
    expect(r).toEqual({
      ok: true,
      value: {
        issuer: "http://idp.example/realms/platform",
        clientId: "platform-ui",
        cliClientId: "platform-cli",
      },
    });
  });

  it("missing cliClientId → Err(missing-cli-client-id)", async () => {
    stubFetch(async () =>
      new Response(
        JSON.stringify({
          issuer: "http://idp.example/realms/platform",
          clientId: "platform-ui",
        }),
        { status: 200 },
      ),
    );

    const r = await createAuthConfigProbe().probe("http://api.example");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("auth-config-probe");
      expect(r.error.code).toBe("missing-cli-client-id");
    }
  });

  it("malformed JSON → Err(malformed-response)", async () => {
    stubFetch(async () => new Response("not json", { status: 200 }));

    const r = await createAuthConfigProbe().probe("http://api.example");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("malformed-response");
  });

  it("missing required field → Err(malformed-response)", async () => {
    stubFetch(async () =>
      new Response(JSON.stringify({ clientId: "x" }), { status: 200 }),
    );

    const r = await createAuthConfigProbe().probe("http://api.example");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("malformed-response");
      expect(r.error.message).toContain("issuer");
    }
  });

  it("500 → Err(non-ok-status) carrying the status code", async () => {
    stubFetch(async () => new Response("nope", { status: 500 }));

    const r = await createAuthConfigProbe().probe("http://api.example");
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

    const r = await createAuthConfigProbe().probe("http://api.example");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("network");
      expect(r.error.message).toContain("fetch failed");
    }
  });

  it("times out as network error when fetch never resolves", async () => {
    globalThis.fetch = vi.fn(
      async (_input, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const e = new Error("aborted");
            e.name = "TimeoutError";
            reject(e);
          });
        }),
    ) as typeof globalThis.fetch;

    const r = await createAuthConfigProbe({ timeoutMs: 30 }).probe(
      "http://api.example",
    );
    expect(r.ok).toBe(false);
    // Timeout is folded into `network` per the error taxonomy in
    // packages/cli/src/modules/auth/domain/errors.ts.
    if (!r.ok) expect(r.error.code).toBe("network");
  });
});
