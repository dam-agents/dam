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

    await trpc.agents.list.query();

    expect(tp.getValidAccessToken).toHaveBeenCalledOnce();
    expect(captured).toHaveLength(1);
    expect(captured[0]!.headers.get("authorization")).toBe("Bearer AT-1");
  });

  /**
   * TEST_SCENARIO: A satellite claim is a long poll: the server holds it open
   * until there is work or its wait runs out. A batch is answered only when
   * every call in it is, so a claim batched with anything holds that call for
   * the whole poll — a worker's fresh claim sat behind an open one for 25
   * seconds while a queued job waited. Claims go out one per request.
   */
  it("never batches a satellite claim, which holds its request open", async () => {
    const paths: string[] = [];
    const fetchSpy = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(new Request(input as RequestInfo, init).url);
      const path = url.pathname.replace(/^.*\/api\/trpc\//, "");
      paths.push(path);
      const body = url.searchParams.has("batch")
        ? path.split(",").map(() => ({ result: { data: null } }))
        : { result: { data: null } };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const trpc = createTrpcClient({
      host: HOST,
      tokenProvider: fakeTokenProvider(async () => ok("AT-1")),
      fetch: fetchSpy,
    });

    await Promise.all([
      trpc.satellites.claim.mutate({
        satellite: "box",
        capacity: 0,
        waitMs: 0,
      }),
      trpc.satellites.claim.mutate({
        satellite: "box",
        capacity: 1,
        waitMs: 0,
      }),
      trpc.satellites.heartbeat.mutate({ satellite: "box", running: [] }),
    ]);

    expect(paths.filter((p) => p === "satellites.claim")).toHaveLength(2);
    expect(
      paths.some((p) => p.includes(",") && p.includes("satellites.claim")),
    ).toBe(false);
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
      await trpc.agents.list.query();
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
