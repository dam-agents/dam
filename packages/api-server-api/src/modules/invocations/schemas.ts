import { z } from "zod";
import { agentSetupSeedSchema, agentSetupShape } from "../agents/setup.js";
import { templateHarnessSchema } from "../templates/schemas.js";
import { agentConfigOptionsSchema } from "../harness-config/schemas.js";
import { egressHostSchema } from "../egress-rules/schemas.js";

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

// UNIT_BOUNDARY_DESCRIPTION: which of the launching agent's connections a child holds: `parent`, all of them, kept in step with the parent's own for as long as the child lives, revokes included; `none`; or the ids named, each one of the parent's own, copied once at launch.
export const childConnectionsSchema = z.union([
  z.literal("parent"),
  z.literal("none"),
  z.array(z.string().min(1)),
]);
export type ChildConnections = z.infer<typeof childConnectionsSchema>;

export const childEgressRuleSchema = z.object({
  host: egressHostSchema,
  port: z.number().int().min(1).max(65535).optional(),
  method: z.string().min(1).optional(),
  pathPattern: z.string().min(1).optional(),
  verdict: z.enum(["allow", "deny"]),
});
export type ChildEgressRule = z.infer<typeof childEgressRuleSchema>;

// UNIT_BOUNDARY_DESCRIPTION: what replacing an open child's rules did with those the driver may not give itself: `waiting`, each rule that waits for the owner's approval with the id of its request; `blocked`, each allow rule not set because the owner blocked it on the child, which only the owner can lift.
export interface ChildEgressOutcome {
  waiting: { host: string; id: string }[];
  blocked: { host: string }[];
}

// UNIT_BOUNDARY_DESCRIPTION: whose egress rules decide a child's requests: `parent`, the root's, live; `open` (or `{ open: rules }`), rules of its own that the launching agent sets, with no prompt to the user and a host outside them denied; or `{ scoped: hosts }`, its own rules copied once from the parent's for those hosts (or all of them), widened only by the user's approval.
export const childEgressSchema = z.union([
  z.literal("parent"),
  z.literal("open"),
  z.object({ open: z.array(childEgressRuleSchema).max(200) }),
  z.object({
    scoped: z.union([z.literal("all"), z.array(z.string().min(1)).max(200)]),
  }),
]);
export type ChildEgress = z.infer<typeof childEgressSchema>;

const spawnTargetShape = {
  harness: templateHarnessSchema.optional(),
  image: z.string().min(1).optional(),
  connections: childConnectionsSchema.optional(),
  egress: childEgressSchema.optional(),
  keep: z.boolean().optional(),
  keepForMs: z.number().int().min(60_000).optional(),
  idleTimeoutMin: z.number().int().min(1).optional(),
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

export const MAX_STOP_REASON_CHARS = 500;

export const stopReasonSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_STOP_REASON_CHARS);

export const stopInvocationRequestSchema = z.object({
  reason: stopReasonSchema.optional(),
});

export const stopInvocationResponseSchema = z.object({
  stopped: z.boolean(),
});

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
  run: z.string().optional(),
  session: z.string().optional(),
  keepUntil: z.string().optional(),
  removed: z.literal(true).optional(),
  status: z.enum(["idle", "running", "done", "failed"]),
  result: z.unknown(),
  errorReason: z.string().optional(),
  exitCode: z.number().int().optional(),
  output: invocationOutputSchema.optional(),
  waiting: z.string().optional(),
});

export const invocationOutputLinkSchema = invocationOutputBlobSchema.extend({
  url: z.string().min(1),
});

export const INVOCATIONS_TREE_MAX_IDS = 200;

export const invocationsTreeInputSchema = z.object({
  driverAgentId: z.string().min(1),
  ids: z.array(z.string().min(1)).min(1).max(INVOCATIONS_TREE_MAX_IDS),
});

export const invocationsKeptInputSchema = z.object({
  driverAgentId: z.string().min(1),
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
