import { z } from "zod";
import type { TrpcClient } from "../../shared/trpc/trpc-client.js";
import { AuthRequiredAtTransportError } from "../../shared/trpc/trpc-client.js";
import { err, ok, type Result } from "../../../result.js";
import type {
  AuthRequiredError,
  TransportError,
} from "../../instance/domain/errors.js";

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

const TemplateSchema: z.ZodType<Template> = z.object({
  id: z.string(),
  name: z.string(),
  image: z.string(),
  description: z.string().optional(),
});

const TemplateListSchema = z.array(TemplateSchema);

export interface TemplateService {
  list(): Promise<Result<readonly Template[], TransportError | AuthRequiredError>>;
}

export interface TemplateServiceDeps {
  trpc: TrpcClient;
}

export function createTemplateService(deps: TemplateServiceDeps): TemplateService {
  return {
    async list() {
      try {
        const value = await deps.trpc.templates.list.query();
        // Validate the wire shape at the boundary. The contract type
        // already guarantees it at compile time, but a server schema
        // drift would otherwise propagate as a confusing TypeError
        // later in the render path.
        const parsed = TemplateListSchema.safeParse(value);
        if (!parsed.success) {
          return err({
            kind: "transport",
            reason: `unexpected templates response: ${parsed.error.message}`,
          });
        }
        return ok(parsed.data);
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
