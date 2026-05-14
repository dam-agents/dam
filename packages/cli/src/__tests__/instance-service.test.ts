import { describe, it, expect, vi } from "vitest";
import { createInstanceService } from "../modules/instance/services/instance-service.js";
import {
  AuthRequiredAtTransportError,
  type TrpcClient,
} from "../modules/shared/trpc/trpc-client.js";

/** Build a stub trpc client that supplies `query` / `mutate` methods
 *  for the routes the service consumes. */
function makeTrpc(opts: {
  list?: () => unknown;
  get?: (input: { id: string }) => unknown;
  instancesDelete?: (input: { id: string }) => unknown;
  agentsDelete?: (input: { id: string }) => unknown;
}): TrpcClient {
  return {
    instances: {
      list: { query: vi.fn(async () => opts.list?.() ?? []) },
      get: { query: vi.fn(async (input: { id: string }) => opts.get?.(input) ?? null) },
      delete: {
        mutate: vi.fn(async (input: { id: string }) => opts.instancesDelete?.(input)),
      },
    },
    agents: {
      delete: {
        mutate: vi.fn(async (input: { id: string }) => opts.agentsDelete?.(input)),
      },
    },
  } as unknown as TrpcClient;
}

/** Construct a value that quacks like a `TRPCClientError` for the
 *  service's `hasCode` detection. */
function trpcError(code: string, message: string): Error & { data: { code: string } } {
  const e = new Error(message) as Error & { data: { code: string } };
  e.data = { code };
  return e;
}

describe("instance-service", () => {
  // The integration tests cover the OK paths end-to-end through a real
  // `appRouter`. The unit tests focus on the two non-trivial pieces of
  // the classifier: auth-required propagation across the trpc-client's
  // `cause` chain, and the deliberate `NOT_FOUND → ok(null)` mapping
  // that the resolver depends on.

  it("walks the cause chain to map the auth-required sentinel to AuthRequiredError", async () => {
    // The trpc-client wraps thrown header errors into a TRPCClientError
    // with the sentinel as `cause`. The service has to unwrap it,
    // otherwise auth failures surface as generic transport errors and
    // the user gets a "cannot reach server" message instead of "run
    // dam auth login". This was a real bug caught by the integration
    // tests during issue 3.
    const wrapped = new Error("trpc client error");
    (wrapped as Error & { cause: unknown }).cause = new AuthRequiredAtTransportError(
      "not logged in to host X",
    );
    const svc = createInstanceService({
      trpc: makeTrpc({
        list: () => {
          throw wrapped;
        },
      }),
    });

    const result = await svc.list();

    expect(result).toEqual({
      ok: false,
      error: { kind: "auth-required", reason: "not logged in to host X" },
    });
  });

  it("deleteInstance routes through instances.delete and maps NOT_FOUND to a typed not-found error", async () => {
    // Used by `dam instance delete` for orphan instances (templateId
    // === null) where the cascade via `agents.delete` would silently
    // no-op and leave the Instance ConfigMap behind.
    const svc = createInstanceService({
      trpc: makeTrpc({
        instancesDelete: () => {
          throw trpcError("NOT_FOUND", "no such instance");
        },
      }),
    });

    const result = await svc.deleteInstance("inst-gone");

    expect(result).toEqual({
      ok: false,
      error: { kind: "not-found", ref: "inst-gone", via: "id" },
    });
  });

  it("maps tRPC NOT_FOUND on get() to Result.ok(null) so the resolver decides reporting", async () => {
    // The resolver's ID branch relies on this: a 404 from the server is
    // a normal "no instance with this ID" signal, not an error. If this
    // mapping breaks, the resolver loses the ability to distinguish
    // not-found from a real transport failure.
    const svc = createInstanceService({
      trpc: makeTrpc({
        get: () => {
          throw trpcError("NOT_FOUND", "no such instance");
        },
      }),
    });

    const result = await svc.get("inst-missing");

    expect(result).toEqual({ ok: true, value: null });
  });
});
