import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHttpVersionProbe } from "../modules/cli/infrastructure/version-probe.js";

const ORIGINAL_FETCH = globalThis.fetch;

describe("HttpVersionProbe", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = ORIGINAL_FETCH;
    vi.restoreAllMocks();
  });

  function stubFetch(handler: (url: string) => Promise<Response>) {
    globalThis.fetch = vi.fn(async (input: string | URL | Request) =>
      handler(typeof input === "string" ? input : input.toString()),
    ) as typeof globalThis.fetch;
  }

  it("joins server URL + /api/version (no trailing slash duplication)", async () => {
    let receivedUrl = "";
    stubFetch(async (url) => {
      receivedUrl = url;
      return new Response(
        JSON.stringify({ serverVersion: "1.2.3", minClientVersion: "0.0.0" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const probe = createHttpVersionProbe();
    await probe.probe("http://api.example/");
    expect(receivedUrl).toBe("http://api.example/api/version");

    await probe.probe("http://api.example");
    expect(receivedUrl).toBe("http://api.example/api/version");
  });

  it("returns Ok with the parsed body on 200", async () => {
    stubFetch(
      async () =>
        new Response(
          JSON.stringify({ serverVersion: "1.2.3", minClientVersion: "0.5.0" }),
          { status: 200 },
        ),
    );

    const r = await createHttpVersionProbe().probe("http://api.example");
    expect(r).toEqual({
      ok: true,
      value: { serverVersion: "1.2.3", minClientVersion: "0.5.0" },
    });
  });

  it("non-2xx → Err(probe-error, non-ok-status)", async () => {
    stubFetch(async () => new Response("nope", { status: 503 }));

    const r = await createHttpVersionProbe().probe("http://api.example");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("non-ok-status");
      expect(r.error.message).toContain("503");
    }
  });

  it("network error → Err(probe-error, network)", async () => {
    stubFetch(async () => {
      throw new TypeError("fetch failed");
    });

    const r = await createHttpVersionProbe().probe("http://api.example");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("network");
      expect(r.error.message).toContain("fetch failed");
    }
  });

  it("malformed JSON body → Err(probe-error, malformed-response)", async () => {
    stubFetch(
      async () =>
        new Response("not json", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );

    const r = await createHttpVersionProbe().probe("http://api.example");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("malformed-response");
    }
  });

  it("missing fields → Err(probe-error, malformed-response)", async () => {
    stubFetch(
      async () => new Response(JSON.stringify({ foo: "bar" }), { status: 200 }),
    );

    const r = await createHttpVersionProbe().probe("http://api.example");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("malformed-response");
      // Zod surfaces the missing required field by name; the floor is
      // optional and must not appear in the error.
      expect(r.error.message).toContain("serverVersion");
      expect(r.error.message).not.toContain("minClientVersion");
    }
  });

  it("absent minClientVersion → Ok with undefined floor", async () => {
    stubFetch(
      async () =>
        new Response(JSON.stringify({ serverVersion: "1.2.3" }), {
          status: 200,
        }),
    );

    const r = await createHttpVersionProbe().probe("http://api.example");
    expect(r).toEqual({
      ok: true,
      value: { serverVersion: "1.2.3" },
    });
  });

  it("aborts with timeout error when fetch never resolves", async () => {
    vi.useRealTimers();
    stubFetch(
      (_url) =>
        new Promise<Response>((_, reject) => {
          // Forward the AbortSignal abort to a rejection — that's what the
          // real `fetch` does on abort.
          // The signal is bound at call-time; we read it from the third arg.
        }) as Promise<Response>,
    );

    // We intercept again with the proper signal-aware handler:
    globalThis.fetch = vi.fn(
      async (_input, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const e = new Error("aborted");
            e.name = "AbortError";
            reject(e);
          });
        }),
    ) as typeof globalThis.fetch;

    const r = await createHttpVersionProbe({ timeoutMs: 30 }).probe(
      "http://api.example",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("timeout");
  });
});
