import { z } from "zod";
import { agentSetupSeedSchema, agentSetupShape } from "../agents/setup.js";
import { templateHarnessSchema } from "../templates/schemas.js";

export const DEFAULT_INVOCATION_TTL_MS = 60 * 60 * 1000;
export const MIN_INVOCATION_TTL_MS = 60 * 1000;
export const MAX_INVOCATION_TTL_MS = 6 * 60 * 60 * 1000;

export const spawnInvocationRequestSchema = z
  .object({
    harness: templateHarnessSchema.optional(),
    image: z.string().min(1).optional(),
    connections: z.array(z.string().min(1)).optional(),
    prompt: z.string().min(1),
    schema: z.unknown(),
    label: z.string().min(1).max(100).optional(),
    ttlMs: z
      .number()
      .int()
      .min(MIN_INVOCATION_TTL_MS)
      .max(MAX_INVOCATION_TTL_MS)
      .optional(),
    ...agentSetupShape,
    seed: agentSetupSeedSchema.optional(),
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
  .refine((d) => d.harness !== undefined || d.image !== undefined, {
    message: "pass a harness, or an image",
  })
  .refine(
    (d) =>
      d.resources === undefined ||
      (d.cpu === undefined && d.memory === undefined),
    { message: "pass cpu and memory inside resources, not beside it" },
  );

export const spawnInvocationResponseSchema = z.object({
  id: z.string().min(1),
});

export const invocationViewSchema = z.object({
  status: z.enum(["running", "done", "failed"]),
  result: z.unknown(),
  errorReason: z.string().optional(),
});
