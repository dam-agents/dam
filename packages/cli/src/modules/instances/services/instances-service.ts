import type { Instance } from "api-server-api";
import { err, ok, type Result } from "../../../result.js";
import type { AuthRequiredError, TransportError } from "../domain/errors.js";
import {
  AuthRequiredAtTransportError,
  type InstancesTrpcClient,
} from "../infrastructure/trpc-client.js";

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

export interface InstancesService {
  list(): Promise<Result<readonly Instance[], TransportError | AuthRequiredError>>;
  get(id: string): Promise<Result<Instance | null, TransportError | AuthRequiredError>>;
}

export interface InstancesServiceDeps {
  trpc: InstancesTrpcClient;
}

export function createInstancesService(deps: InstancesServiceDeps): InstancesService {
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
