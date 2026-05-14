import { describe, it, expect, vi } from "vitest";
import {
  AuthRequiredAtTransportError,
  createTrpcClient,
} from "../modules/shared/trpc/trpc-client.js";
import { err, ok, type Result } from "../result.js";
import type { AuthRequiredError } from "../modules/instance/domain/errors.js";

const HOST = "http://api-server.localhost:4444";

/** Minimal mock fetch implementing the subset of behaviour the trpc-batch
 *  link consumes: a `Response` that surfaces JSON for a list-shaped query.
 *  The fake never inspects the URL or input — it's a pass-through that
 *  echoes back an empty `instances.list` payload. */
function mockFetch(captured: Request[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input as RequestInfo, init);
    captured.push(req);
    // Shape mirrors what the api-server returns for `instances.list`
    // batched calls: a single-element JSON array (one query in the batch).
    const body = JSON.stringify([{ result: { data: [] } }]);
    return new Response(body, {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

describe("shared trpc-client adapter", () => {
  it("attaches the bearer header from getToken() on each request", async () => {
    const captured: Request[] = [];
    const fetchSpy = vi.fn(mockFetch(captured));
    const getToken = vi.fn<() => Promise<Result<string, AuthRequiredError>>>(
      async () => ok("AT-1"),
    );
    const trpc = createTrpcClientWithFetch(getToken, fetchSpy);

    await trpc.instances.list.query();

    expect(getToken).toHaveBeenCalledOnce();
    expect(captured).toHaveLength(1);
    expect(captured[0]!.headers.get("authorization")).toBe("Bearer AT-1");
  });

  it("aborts before the wire when getToken() returns auth-required — no HTTP request fires", async () => {
    const captured: Request[] = [];
    const fetchSpy = vi.fn(mockFetch(captured));
    const getToken = vi.fn<() => Promise<Result<string, AuthRequiredError>>>(
      async () => err({ kind: "auth-required" as const, reason: "not logged in" }),
    );
    const trpc = createTrpcClientWithFetch(getToken, fetchSpy);

    let caught: unknown;
    try {
      await trpc.instances.list.query();
    } catch (e) {
      caught = e;
    }

    // The TRPCClientError that bubbles out wraps our sentinel as its
    // `cause` — the service layer recognises it via instanceof.
    const cause = (caught as { cause?: unknown }).cause;
    expect(cause).toBeInstanceOf(AuthRequiredAtTransportError);
    expect((cause as AuthRequiredAtTransportError).message).toBe("not logged in");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

function createTrpcClientWithFetch(
  getToken: () => Promise<Result<string, AuthRequiredError>>,
  fetchFn: typeof fetch,
) {
  return createTrpcClient({ host: HOST, getToken, fetch: fetchFn });
}
