import { z } from "zod";

// The driver-facing Invocation spawn contract. This is a REST rail (not tRPC),
// so it lives here as a plain Zod schema that both sides share: the api-server
// validates requests against it, and the driver SDK does a type-only import of
// the inferred types so a change to the request shape breaks the SDK build.

/** Default liveness deadline for one Invocation, in ms. A short TTL fails a
 *  wedged/misconfigured target fast; a longer one lets a heavy target run past
 *  the default hour. Bounds one result, not the agent's own lifetime. */
export const DEFAULT_INVOCATION_TTL_MS = 60 * 60 * 1000;
/** Lower bound — a target needs at least this long to boot and run a turn. */
export const MIN_INVOCATION_TTL_MS = 60 * 1000;
/** Upper bound — the hard ceiling on how long one target may occupy compute. */
export const MAX_INVOCATION_TTL_MS = 6 * 60 * 60 * 1000;

export const spawnInvocationRequestSchema = z
  .object({
    image: z.string().min(1).optional(),
    templateId: z.string().min(1).optional(),
    connections: z.array(z.string().min(1)).optional(),
    prompt: z.string().min(1),
    // The result JSON Schema — arbitrary JSON, validated structurally by ajv
    // when the target reports (a malformed schema is rejected at spawn).
    schema: z.unknown(),
    // Optional liveness deadline for this target, in ms. Bounded server-side; a
    // shorter value fails a wedged/misconfigured target fast, a longer one lets
    // a heavy target run past the default hour.
    ttlMs: z
      .number()
      .int()
      .min(MIN_INVOCATION_TTL_MS)
      .max(MAX_INVOCATION_TTL_MS)
      .optional(),
    // Optional resource limits. A heavy Make (clone + install + build)
    // OOM-kills at the template's small default memory, so let the driver raise
    // it. Same grammar and floors as the agent size knob.
    memory: z
      .string()
      .regex(/^\d+(Mi|Gi)$/, "memory must look like '512Mi' or '4Gi'")
      .optional(),
    cpu: z
      .string()
      .regex(/^\d+(\.\d+)?m?$/, "cpu must look like '2', '0.5' or '500m'")
      .optional(),
  })
  .refine((d) => d.image !== undefined || d.templateId !== undefined, {
    message: "either image or templateId is required",
  });

/** POST /invocations reply — the id the driver polls. */
export const spawnInvocationResponseSchema = z.object({
  id: z.string().min(1),
});

/** GET /invocations/:id reply — status plus the schema-validated result once
 *  the target reports (undefined while still running or on failure). */
export const invocationViewSchema = z.object({
  status: z.enum(["running", "done", "failed"]),
  result: z.unknown(),
});
