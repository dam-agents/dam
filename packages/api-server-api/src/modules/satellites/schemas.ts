import { z } from "zod";

export const SATELLITE_SCOPE = "satellites:serve" as const;

export const DEFAULT_MAX_CONCURRENT = 16;
export const INLINE_OUTPUT_LIMIT = 4096;

export const satelliteNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(
    /^[a-z0-9][a-z0-9-]*$/,
    "a satellite name is lowercase letters, digits and dashes",
  );

export const satelliteCommandSchema = z.object({
  run: z.string().min(1).max(1024),
  about: z.string().max(280).optional(),
  approval: z.literal("always").optional(),
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
  commands: z.array(satelliteCommandSchema).min(1).max(256),
});

export const jobStatusSchema = z.enum([
  "pending-approval",
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

export const reportInputSchema = z.object({
  satellite: satelliteNameSchema,
  sequence: z.number().int().positive(),
  outcome: z.discriminatedUnion("status", [
    z.object({
      status: z.literal("done"),
      exitCode: z.number().int(),
      output: z.string(),
      truncated: z.boolean().default(false),
    }),
    z.object({ status: z.literal("cancelled") }),
    z.object({ status: z.literal("interrupted"), reason: z.string().max(280) }),
  ]),
});

export const startJobInputSchema = z.object({
  satellite: satelliteNameSchema,
  cmd: z.array(z.string()).min(1),
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
