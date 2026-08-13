import { describe, it, expect, vi } from "vitest";
import { createAgentService } from "../modules/agent/services/agent-service.js";
import {
  AuthRequiredAtTransportError,
  type TrpcClient,
} from "../modules/shared/trpc/trpc-client.js";

function makeTrpc(opts: {
  list?: () => unknown;
  get?: (input: { id: string }) => unknown;
  agentsDelete?: (input: { id: string }) => unknown;
  agentsRestart?: (input: { id: string }) => unknown;
}): TrpcClient {
  return {
    agents: {
      list: { query: vi.fn(async () => opts.list?.() ?? []) },
      get: {
        query: vi.fn(
          async (input: { id: string }) => opts.get?.(input) ?? null,
        ),
      },
      delete: {
        mutate: vi.fn(async (input: { id: string }) =>
          opts.agentsDelete?.(input),
        ),
      },
      restart: {
        mutate: vi.fn(async (input: { id: string }) =>
          opts.agentsRestart?.(input),
        ),
      },
    },
  } as unknown as TrpcClient;
}

function trpcError(
  code: string,
  message: string,
): Error & { data: { code: string } } {
  const e = new Error(message) as Error & { data: { code: string } };
  e.data = { code };
  return e;
}

describe("agent-service", () => {
  it("walks the cause chain to map the auth-required sentinel to AuthRequiredError", async () => {
    const wrapped = new Error("trpc client error");
    (wrapped as Error & { cause: unknown }).cause =
      new AuthRequiredAtTransportError("not logged in to host X");
    const svc = createAgentService({
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

  it("deleteAgent routes through agents.delete and maps NOT_FOUND to a typed not-found error", async () => {
    const svc = createAgentService({
      trpc: makeTrpc({
        agentsDelete: () => {
          throw trpcError("NOT_FOUND", "no such agent");
        },
      }),
    });

    const result = await svc.deleteAgent("agent-gone");

    expect(result).toEqual({
      ok: false,
      error: { kind: "not-found", ref: "agent-gone", via: "id" },
    });
  });

  it("maps tRPC NOT_FOUND on get() to Result.ok(null) so the resolver decides reporting", async () => {
    const svc = createAgentService({
      trpc: makeTrpc({
        get: () => {
          throw trpcError("NOT_FOUND", "no such agent");
        },
      }),
    });

    const result = await svc.get("agent-missing");

    expect(result).toEqual({ ok: true, value: null });
  });
});
