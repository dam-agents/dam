import type { Instance } from "api-server-api";
import { err, ok, type Result } from "../../../result.js";
import type {
  AuthRequiredError,
  NotFoundError,
  TransportError,
} from "../domain/errors.js";
import {
  AuthRequiredAtTransportError,
  type TrpcClient,
} from "../../shared/trpc/trpc-client.js";

/**
 * Thin port over the api-server's `instances.{list,get}` tRPC routes.
 * Translates the adapter's exceptional surface into typed `Result`s so
 * the resolver and command layers never see thrown errors.
 *
 * Mapping:
 *   - `AuthRequiredAtTransportError` (carried as the trpc-client error's
 *     `cause`) → `AuthRequiredError`. The request never reached the wire.
 *   - tRPC `NOT_FOUND` on `get` → `Result.ok(null)`. Matches the
 *     api-server's `instances.get` semantics where a missing instance
 *     is a normal, non-error response; the resolver decides how to
 *     report this to the user.
 *   - Any other thrown error → `TransportError` carrying a message.
 *
 * The service has no business rules of its own; centralising it gives
 * the resolver and the two commands a single seam.
 */

export interface InstanceService {
  list(): Promise<Result<readonly Instance[], TransportError | AuthRequiredError>>;
  get(id: string): Promise<Result<Instance | null, TransportError | AuthRequiredError>>;
  /** Cascade-delete an Agent. The K8s OwnerReferences clean up the
   *  derived Instance ConfigMap and its PVCs. Mirrors the web UI's
   *  "delete agent" flow. The CLI uses this for normal Instance
   *  deletes — the Agent exists, the cascade does the rest. */
  deleteAgent(agentId: string): Promise<Result<void, TransportError | AuthRequiredError | NotFoundError>>;
  /** Direct Instance ConfigMap delete, no cascade. Used by
   *  `dam instance delete` only when the Instance is orphaned (its
   *  backing Agent is gone, so `agents.delete` would silently no-op
   *  and leave the Instance ConfigMap behind). */
  deleteInstance(id: string): Promise<Result<void, TransportError | AuthRequiredError | NotFoundError>>;
  /** Restart an Instance (deletes pod-0; PVCs survive). */
  restart(id: string): Promise<Result<void, TransportError | AuthRequiredError | NotFoundError>>;
}

export interface InstanceServiceDeps {
  trpc: TrpcClient;
}

export function createInstanceService(deps: InstanceServiceDeps): InstanceService {
  function classify(
    e: unknown,
  ): Result<never, TransportError | AuthRequiredError> {
    const sentinel = findAuthSentinel(e);
    if (sentinel) {
      return err({ kind: "auth-required", reason: sentinel.message });
    }
    return err({ kind: "transport", reason: errorReason(e) });
  }

  /** Walk the `cause` chain — the trpc-client wraps thrown header
   *  errors into a TRPCClientError, exposing the original via `cause`. */
  function findAuthSentinel(e: unknown): AuthRequiredAtTransportError | null {
    let cursor: unknown = e;
    let depth = 0;
    while (cursor && depth < 8) {
      if (cursor instanceof AuthRequiredAtTransportError) return cursor;
      cursor = (cursor as { cause?: unknown }).cause;
      depth++;
    }
    return null;
  }

  return {
    async list() {
      try {
        const value = await deps.trpc.instances.list.query();
        return ok(value as readonly Instance[]);
      } catch (e) {
        return classify(e);
      }
    },

    async get(id) {
      try {
        const value = await deps.trpc.instances.get.query({ id });
        return ok(value as Instance);
      } catch (e) {
        if (hasTrpcCode(e, "NOT_FOUND")) return ok(null);
        return classify(e);
      }
    },

    async deleteAgent(agentId) {
      try {
        await deps.trpc.agents.delete.mutate({ id: agentId });
        return ok(undefined);
      } catch (e) {
        if (hasTrpcCode(e, "NOT_FOUND")) {
          return err({ kind: "not-found", ref: agentId, via: "id" });
        }
        return classify(e);
      }
    },

    async deleteInstance(id) {
      try {
        await deps.trpc.instances.delete.mutate({ id });
        return ok(undefined);
      } catch (e) {
        if (hasTrpcCode(e, "NOT_FOUND")) {
          return err({ kind: "not-found", ref: id, via: "id" });
        }
        return classify(e);
      }
    },

    async restart(id) {
      try {
        await deps.trpc.instances.restart.mutate({ id });
        return ok(undefined);
      } catch (e) {
        if (hasTrpcCode(e, "NOT_FOUND")) {
          return err({ kind: "not-found", ref: id, via: "id" });
        }
        return classify(e);
      }
    },
  };
}

function hasTrpcCode(e: unknown, code: string): boolean {
  return (
    typeof e === "object"
    && e !== null
    && (e as { data?: { code?: string } }).data?.code === code
  );
}

function errorReason(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return "unknown transport failure";
}
