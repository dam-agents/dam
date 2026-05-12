import { describe, it, expect, vi } from "vitest";
import type { Instance } from "api-server-api";
import { createInstancesService } from "../modules/instances/services/instances-service.js";
import {
  AuthRequiredAtTransportError,
  type InstancesTrpcClient,
} from "../modules/instances/infrastructure/trpc-client.js";

function makeInstance(overrides: Partial<Instance> = {}): Instance {
  return {
    id: "inst-1",
    name: "demo",
    agentId: "agt-1",
    state: "running",
    channels: [],
    allowedUserEmails: [],
    ...overrides,
  };
}

/** Build a stub trpc client that supplies `query` methods for the two
 *  routes the service consumes. Each call is delegated to a vitest fn so
 *  per-test assertions / overrides are straightforward. */
function makeTrpc(opts: {
  list: () => unknown;
  get: (input: { id: string }) => unknown;
}): InstancesTrpcClient {
  return {
    instances: {
      list: { query: vi.fn(async () => opts.list()) },
      get: { query: vi.fn(async (input: { id: string }) => opts.get(input)) },
    },
  } as unknown as InstancesTrpcClient;
}

/** Construct a value that quacks like a `TRPCClientError` for the
 *  service's `isTrpcClientError`/`hasCode` detection. */
function trpcError(code: string, message: string): Error & { data: { code: string } } {
  const e = new Error(message) as Error & { data: { code: string } };
  e.data = { code };
  return e;
}

describe("instances-service", () => {
  describe("list()", () => {
    it("returns the instances on success", async () => {
      const inst = makeInstance();
      const svc = createInstancesService({
        trpc: makeTrpc({
          list: () => [inst],
          get: () => null,
        }),
      });

      const result = await svc.list();

      expect(result).toEqual({ ok: true, value: [inst] });
    });

    it("maps the smuggled auth-required sentinel to AuthRequiredError", async () => {
      const svc = createInstancesService({
        trpc: makeTrpc({
          list: () => {
            throw new AuthRequiredAtTransportError("not logged in to host X");
          },
          get: () => null,
        }),
      });

      const result = await svc.list();

      expect(result).toEqual({
        ok: false,
        error: { kind: "auth-required", reason: "not logged in to host X" },
      });
    });

    it("maps a server-side UNAUTHORIZED tRPC error to AuthRequiredError", async () => {
      const svc = createInstancesService({
        trpc: makeTrpc({
          list: () => {
            throw trpcError("UNAUTHORIZED", "bearer rejected");
          },
          get: () => null,
        }),
      });

      const result = await svc.list();

      expect(result).toEqual({
        ok: false,
        error: { kind: "auth-required", reason: "bearer rejected" },
      });
    });

    it("maps any other thrown error to TransportError", async () => {
      const svc = createInstancesService({
        trpc: makeTrpc({
          list: () => {
            throw new Error("ECONNREFUSED");
          },
          get: () => null,
        }),
      });

      const result = await svc.list();

      expect(result).toEqual({
        ok: false,
        error: { kind: "transport", reason: "ECONNREFUSED" },
      });
    });
  });

  describe("get(id)", () => {
    it("returns the instance on success", async () => {
      const inst = makeInstance({ id: "inst-42" });
      const svc = createInstancesService({
        trpc: makeTrpc({
          list: () => [],
          get: () => inst,
        }),
      });

      const result = await svc.get("inst-42");

      expect(result).toEqual({ ok: true, value: inst });
    });

    it("maps tRPC NOT_FOUND to Result.ok(null) so the resolver decides reporting", async () => {
      const svc = createInstancesService({
        trpc: makeTrpc({
          list: () => [],
          get: () => {
            throw trpcError("NOT_FOUND", "no such instance");
          },
        }),
      });

      const result = await svc.get("inst-missing");

      expect(result).toEqual({ ok: true, value: null });
    });

    it("propagates the auth-required sentinel", async () => {
      const svc = createInstancesService({
        trpc: makeTrpc({
          list: () => [],
          get: () => {
            throw new AuthRequiredAtTransportError("session expired");
          },
        }),
      });

      const result = await svc.get("inst-1");

      expect(result).toEqual({
        ok: false,
        error: { kind: "auth-required", reason: "session expired" },
      });
    });

    it("maps an opaque transport failure to TransportError", async () => {
      const svc = createInstancesService({
        trpc: makeTrpc({
          list: () => [],
          get: () => {
            throw new Error("fetch failed");
          },
        }),
      });

      const result = await svc.get("inst-1");

      expect(result).toEqual({
        ok: false,
        error: { kind: "transport", reason: "fetch failed" },
      });
    });
  });
});
