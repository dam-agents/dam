import { describe, it, expect, vi } from "vitest";
import {
  AuthRequiredAtTransportError,
  createTrpcClient,
} from "../modules/shared/trpc/trpc-client.js";
import { ok, err } from "../result.js";
import type { TokenProvider } from "../modules/auth/index.js";

const HOST = "http://api-server.localhost:4444";

function mockFetch(captured: Request[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input as RequestInfo, init);
    captured.push(req);
    const body = JSON.stringify([{ result: { data: [] } }]);
    return new Response(body, {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

function fakeTokenProvider(
  fn: () => ReturnType<TokenProvider["getValidAccessToken"]>,
): TokenProvider {
  return { getValidAccessToken: vi.fn(fn) };
}

describe("shared trpc-client adapter", () => {
  it("attaches the bearer header from tokenProvider on each request", async () => {
    const captured: Request[] = [];
    const fetchSpy = vi.fn(mockFetch(captured));
    const tp = fakeTokenProvider(async () => ok("AT-1"));
    const trpc = createTrpcClient({
      host: HOST,
      tokenProvider: tp,
      fetch: fetchSpy,
    });

    await trpc.instances.list.query();

    expect(tp.getValidAccessToken).toHaveBeenCalledOnce();
    expect(captured).toHaveLength(1);
    expect(captured[0]!.headers.get("authorization")).toBe("Bearer AT-1");
  });

  it("aborts before the wire when tokenProvider returns not-logged-in — no HTTP request fires", async () => {
    const captured: Request[] = [];
    const fetchSpy = vi.fn(mockFetch(captured));
    const tp = fakeTokenProvider(async () =>
      err({ kind: "not-logged-in" as const, host: HOST }),
    );
    const trpc = createTrpcClient({
      host: HOST,
      tokenProvider: tp,
      fetch: fetchSpy,
    });

    let caught: unknown;
    try {
      await trpc.instances.list.query();
    } catch (e) {
      caught = e;
    }

    const cause = (caught as { cause?: unknown }).cause;
    expect(cause).toBeInstanceOf(AuthRequiredAtTransportError);
    expect((cause as AuthRequiredAtTransportError).message).toBe(
      `not logged in to ${HOST}`,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
