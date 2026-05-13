import type { TrpcClient } from "../../shared/trpc/trpc-client.js";
import { AuthRequiredAtTransportError } from "../../shared/trpc/trpc-client.js";
import { err, ok, type Result } from "../../../result.js";
import type {
  AuthRequiredError,
  TransportError,
} from "../../instances/domain/errors.js";

/**
 * Port over the api-server's `templates.list` route.
 *
 * Shape matches the api-server's `toView()` ([packages/api-server-api/src/modules/templates/router.ts]
 * lines 6–13): `id`, `name`, `image`, optional `description`. Keeping
 * the CLI-side type local avoids re-exporting api-server-api domain
 * types from the CLI's `index.ts` seam.
 */
export interface Template {
  id: string;
  name: string;
  image: string;
  description?: string;
}

export interface TemplatesService {
  list(): Promise<Result<readonly Template[], TransportError | AuthRequiredError>>;
}

export interface TemplatesServiceDeps {
  trpc: TrpcClient;
}

export function createTemplatesService(deps: TemplatesServiceDeps): TemplatesService {
  return {
    async list() {
      try {
        const value = await deps.trpc.templates.list.query();
        return ok(value as readonly Template[]);
      } catch (e) {
        const sentinel = findAuthSentinel(e);
        if (sentinel) return err({ kind: "auth-required", reason: sentinel.message });
        return err({ kind: "transport", reason: errorReason(e) });
      }
    },
  };
}

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

function errorReason(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return "unknown transport failure";
}
