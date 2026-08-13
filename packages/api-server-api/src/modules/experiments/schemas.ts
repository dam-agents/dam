import { z } from "zod";
import { agentSizeSchema } from "../agents/schemas.js";
import { egressPresetSchema } from "../egress-rules/schemas.js";

export const SCRIPT_CONTENT_MAX_BYTES = 256 * 1024;

export const DASHBOARD_CONTENT_MAX_BYTES = 512 * 1024;

export const CUSTOM_DATA_MAX_BYTES = 128 * 1024;

export const EXPERIMENT_FEED_MESSAGE_TYPE = "experiment-feed";

export const EXPERIMENT_FOLDER_PREFIX = "Experiments / ";

export function experimentFolderName(name: string): string {
  return `${EXPERIMENT_FOLDER_PREFIX}${name}`;
}

const stageIdSchema = z.string().trim().min(1).max(100);

const spanIdSchema = z.string().min(1).max(200);

const isoTimestampSchema = z.string().datetime({ offset: true });

export const skeletonSchema = z.object({
  stages: z
    .array(
      z.object({
        id: stageIdSchema,
        after: z.array(stageIdSchema).max(20).default([]),
      }),
    )
    .max(50)
    .default([]),
  loops: z
    .array(
      z.object({
        id: stageIdSchema,
        stages: z.array(stageIdSchema).min(1).max(50),
      }),
    )
    .max(10)
    .default([]),
});

export const planRegisterRequestSchema = z.object({
  name: z.string().trim().min(1).max(200),
  skeleton: skeletonSchema,
  script: z.object({
    path: z.string().min(1).max(1024),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    content: z.string().max(SCRIPT_CONTENT_MAX_BYTES),
  }),
  dashboard: z
    .object({ content: z.string().max(DASHBOARD_CONTENT_MAX_BYTES) })
    .optional(),
});

export const planRegisterResponseSchema = z.object({
  experimentId: z.string(),
});

const runStartEventSchema = z.object({
  type: z.literal("run-start"),
  scriptSha256: z.string().regex(/^[a-f0-9]{64}$/),
  scriptContent: z.string().max(SCRIPT_CONTENT_MAX_BYTES).optional(),
});

const stageDeclareEventSchema = z.object({
  type: z.literal("stage-declare"),
  stage: stageIdSchema,
});

const spanStartEventSchema = z.object({
  type: z.literal("span-start"),
  spanId: spanIdSchema,
  stage: stageIdSchema,
  iteration: z.number().int().nonnegative().optional(),
  parentSpanId: spanIdSchema.optional(),
  ts: isoTimestampSchema,
});

const spanEndEventSchema = z.object({
  type: z.literal("span-end"),
  spanId: spanIdSchema,
  status: z.enum(["ok", "error"]),
  score: z.number().finite().optional(),
  artifactIds: z.array(z.string().min(1)).max(20).optional(),
  attrs: z.record(z.string(), z.unknown()).optional(),
  ts: isoTimestampSchema,
});

const customDataEventSchema = z.object({
  type: z.literal("custom-data"),
  data: z.record(z.string(), z.unknown()),
  merge: z.boolean().optional(),
});

const heartbeatEventSchema = z.object({
  type: z.literal("heartbeat"),
});

export const traceEventSchema = z.discriminatedUnion("type", [
  runStartEventSchema,
  stageDeclareEventSchema,
  spanStartEventSchema,
  spanEndEventSchema,
  customDataEventSchema,
  heartbeatEventSchema,
]);

export const appendEventsRequestSchema = z.object({
  events: z.array(traceEventSchema).min(1).max(500),
});

export const appendEventsResponseSchema = z.object({
  accepted: z.number().int().nonnegative(),
});

export const finishRequestSchema = z.object({
  status: z.enum(["completed", "failed"]),
  error: z.string().max(2000).optional(),
});

export const experimentIdInputSchema = z.object({
  id: z.string().min(1),
});

export const EXPERIMENT_SKILL_NAME = "dam-experiment";

export const experimentSandboxCreateInputSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .refine((n) => !n.startsWith("agent-"), {
        message: "agent name cannot start with 'agent-' (reserved for IDs)",
      }),
    templateId: z.string().optional(),
    image: z.string().optional(),
    description: z.string().optional(),
    connectionIds: z.array(z.string()).optional(),
    egressPreset: egressPresetSchema.optional(),
    size: agentSizeSchema.optional(),
  })
  .refine((d) => d.templateId !== undefined || d.image !== undefined, {
    message: "Either templateId or image is required",
  });
