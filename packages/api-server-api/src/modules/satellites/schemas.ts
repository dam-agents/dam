import { z } from "zod";

export const DEFAULT_MAX_CONCURRENT = 16;
export const INLINE_OUTPUT_LIMIT = 4096;

export const satelliteNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(
    /^[a-z0-9][a-z0-9.@-]*$/,
    "a satellite name is lowercase letters, digits, dashes, dots and @ — like gpu-box or jan@lab-01",
  );

export const RESERVED_TOOL_NAMES = ["wait", "get", "cancel"] as const;

export const satelliteToolNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(
    /^[a-zA-Z0-9_-]+$/,
    "a tool name is letters, digits, underscores and dashes",
  )
  .refine(
    (name) => !RESERVED_TOOL_NAMES.includes(name as never),
    `a tool may not be named ${RESERVED_TOOL_NAMES.join(", ")} — the platform registers those beside your tools`,
  );

/**
 * UNIT_BOUNDARY_DESCRIPTION: One tool as a Satellite advertises it, which is an
 * MCP `tools/list` entry trimmed to what the platform re-exposes. `inputSchema`
 * travels as opaque JSON Schema: the platform never reads inside it, because
 * only the machine knows what its own arguments mean.
 */
export const satelliteToolSchema = z.object({
  name: satelliteToolNameSchema,
  title: z.string().max(120).optional(),
  description: z.string().max(4096).optional(),
  inputSchema: z.record(z.string(), z.unknown()),
  maxConcurrent: z.number().int().positive().max(1024).optional(),
});

export const satelliteManifestSchema = z.object({
  name: satelliteNameSchema,
  description: z.string().max(280).optional(),
  maxConcurrent: z
    .number()
    .int()
    .positive()
    .max(1024)
    .default(DEFAULT_MAX_CONCURRENT),
  tools: z.array(satelliteToolSchema).min(1).max(256),
});

export const jobStatusSchema = z.enum([
  "queued",
  "running",
  "done",
  "interrupted",
  "cancelled",
]);

export const satelliteConnectInputSchema = z.object({
  manifest: satelliteManifestSchema,
  host: z.string().max(253).optional(),
});

export const claimInputSchema = z.object({
  satellite: satelliteNameSchema,
  capacity: z.number().int().min(0).max(1024),
  waitMs: z.number().int().min(0).max(60_000).optional(),
});

export const heartbeatInputSchema = z.object({
  satellite: satelliteNameSchema,
  running: z.array(z.number().int().positive()).max(1024),
});

export const MAX_JOB_OUTPUT_BYTES = 1024 * 1024;
export const MAX_TOOL_ARGS_BYTES = 64 * 1024;

export const toolArgsSchema = z
  .record(z.string(), z.unknown())
  .refine(
    (args) => JSON.stringify(args).length <= MAX_TOOL_ARGS_BYTES,
    `tool arguments must be under ${MAX_TOOL_ARGS_BYTES} bytes`,
  );

export const reportInputSchema = z.object({
  satellite: satelliteNameSchema,
  sequence: z.number().int().positive(),
  outcome: z.discriminatedUnion("status", [
    z.object({
      status: z.literal("done"),
      isError: z.boolean().default(false),
      exitCode: z.number().int().nullable().default(null),
      output: z.string().max(MAX_JOB_OUTPUT_BYTES),
      truncated: z.boolean().default(false),
    }),
    z.object({
      status: z.literal("cancelled"),
      output: z.string().max(MAX_JOB_OUTPUT_BYTES).default(""),
      truncated: z.boolean().default(false),
    }),
    z.object({
      status: z.literal("interrupted"),
      reason: z.string().max(280),
      output: z.string().max(MAX_JOB_OUTPUT_BYTES).default(""),
      truncated: z.boolean().default(false),
    }),
  ]),
});

export const jobRefSchema = z.object({
  satellite: satelliteNameSchema,
  job: z.number().int().positive(),
});

export const satelliteGrantInputSchema = z.object({
  satellite: satelliteNameSchema,
  agentId: z.string().min(1),
});

export function formatJobRef(satellite: string, sequence: number): string {
  return `${satellite}#${sequence}`;
}
