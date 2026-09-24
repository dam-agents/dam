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
    label: z.string().min(1).max(120).optional(),
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

export const invocationViewSchema = z.object({
  status: z.enum(["running", "done", "failed"]),
  result: z.unknown(),
  errorReason: z.string().optional(),
});

export const INVOCATIONS_TREE_MAX_IDS = 200;

export const invocationsTreeInputSchema = z.object({
  driverAgentId: z.string().min(1),
  ids: z.array(z.string().min(1)).min(1).max(INVOCATIONS_TREE_MAX_IDS),
});
