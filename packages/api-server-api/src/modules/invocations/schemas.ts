import { z } from "zod";
import { agentSetupSeedSchema, agentSetupShape } from "../agents/setup.js";
import { templateHarnessSchema } from "../templates/schemas.js";
import { agentConfigOptionsSchema } from "../harness-config/schemas.js";

export const DEFAULT_INVOCATION_TTL_MS = 60 * 60 * 1000;
export const MIN_INVOCATION_TTL_MS = 60 * 1000;
export const MAX_INVOCATION_TTL_MS = 6 * 60 * 60 * 1000;

export const invocationHarnessConfigSchema = z
  .object({
    model: z.string().min(1).optional(),
    mode: z.string().min(1).optional(),
    configOptions: agentConfigOptionsSchema
      .refine((o) => Object.keys(o).length > 0, {
        message: "configOptions must name at least one option",
      })
      .optional(),
  })
  .refine(
    (c) =>
      c.model !== undefined ||
      c.mode !== undefined ||
      c.configOptions !== undefined,
    { message: "harnessConfig needs a model, a mode or configOptions" },
  );

const spawnTargetShape = {
  harness: templateHarnessSchema.optional(),
  image: z.string().min(1).optional(),
  connections: z.array(z.string().min(1)).optional(),
  label: z.string().min(1).max(100).optional(),
  ttlMs: z
    .number()
    .int()
    .min(MIN_INVOCATION_TTL_MS)
    .max(MAX_INVOCATION_TTL_MS)
    .optional(),
  ...agentSetupShape,
  seed: agentSetupSeedSchema.optional(),
};

interface SpawnTargetFields {
  harness?: unknown;
  image?: unknown;
}

function refineSpawnTarget<S extends z.ZodType<SpawnTargetFields>>(
  schema: S,
): S {
  return schema.refine(
    (d) => d.harness !== undefined || d.image !== undefined,
    { message: "pass a harness, or an image" },
  );
}

export const spawnInvocationRequestSchema = refineSpawnTarget(
  z.object({
    ...spawnTargetShape,
    prompt: z.string().min(1),
    schema: z.unknown(),
    harnessConfig: invocationHarnessConfigSchema.optional(),
  }),
);

export const MAX_INVOCATION_SCRIPT_CHARS = 64 * 1024;

export const spawnScriptInvocationRequestSchema = refineSpawnTarget(
  z.object({
    ...spawnTargetShape,
    script: z.string().trim().min(1).max(MAX_INVOCATION_SCRIPT_CHARS),
  }),
);

export const spawnInvocationResponseSchema = z.object({
  id: z.string().min(1),
});

export const INVOCATION_OUTPUT_STREAMS = ["stdout", "stderr"] as const;

export const invocationOutputStreamSchema = z.enum(INVOCATION_OUTPUT_STREAMS);

export const invocationOutputBlobSchema = z.object({
  sizeBytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

export const invocationOutputSchema = z.object({
  stdout: invocationOutputBlobSchema.optional(),
  stderr: invocationOutputBlobSchema.optional(),
});

export const invocationViewSchema = z.object({
  status: z.enum(["running", "done", "failed"]),
  result: z.unknown(),
  errorReason: z.string().optional(),
  exitCode: z.number().int().optional(),
  output: invocationOutputSchema.optional(),
});

export const invocationOutputLinkSchema = invocationOutputBlobSchema.extend({
  url: z.string().min(1),
});

export const INVOCATIONS_TREE_MAX_IDS = 200;

export const invocationsTreeInputSchema = z.object({
  driverAgentId: z.string().min(1),
  ids: z.array(z.string().min(1)).min(1).max(INVOCATIONS_TREE_MAX_IDS),
});

export const invocationsRunningInputSchema = z.object({
  driverAgentId: z.string().min(1),
  sessionId: z.string().min(1).nullable().optional(),
});

export const invocationTranscriptInputSchema = z.object({
  driverAgentId: z.string().min(1),
  id: z.string().min(1),
});

export const invocationStopInputSchema = invocationTranscriptInputSchema;
