import { z } from "zod";

export const DEFAULT_INVOCATION_TTL_MS = 60 * 60 * 1000;
export const MIN_INVOCATION_TTL_MS = 60 * 1000;
export const MAX_INVOCATION_TTL_MS = 6 * 60 * 60 * 1000;

export const spawnInvocationRequestSchema = z
  .object({
    image: z.string().min(1).optional(),
    templateId: z.string().min(1).optional(),
    connections: z.array(z.string().min(1)).optional(),
    prompt: z.string().min(1),
    schema: z.unknown(),
    ttlMs: z
      .number()
      .int()
      .min(MIN_INVOCATION_TTL_MS)
      .max(MAX_INVOCATION_TTL_MS)
      .optional(),
    memory: z
      .string()
      .regex(/^\d+(Mi|Gi)$/, "memory must look like '512Mi' or '4Gi'")
      .optional(),
    cpu: z
      .string()
      .regex(/^\d+(\.\d+)?m?$/, "cpu must look like '2', '0.5' or '500m'")
      .optional(),
    experimentSpanId: z.string().min(1).max(300).optional(),
  })
  .refine((d) => d.image !== undefined || d.templateId !== undefined, {
    message: "either image or templateId is required",
  });

export const spawnInvocationResponseSchema = z.object({
  id: z.string().min(1),
});

/** GET /invocations/:id reply — status plus the schema-validated result once
 *  the target reports (undefined while still running or on failure). A failed
 *  row carries the platform's reason (deadline exceeded, target pod restarted,
 *  stopped) so the driver can say WHY instead of a bare "failed" — the one
 *  line of diagnosis the platform holds and the driver cannot reconstruct. */
export const invocationViewSchema = z.object({
  status: z.enum(["running", "done", "failed"]),
  result: z.unknown(),
  errorReason: z.string().optional(),
});
