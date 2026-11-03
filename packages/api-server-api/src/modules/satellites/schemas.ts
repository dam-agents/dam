import { z } from "zod";
import type { SatelliteImage } from "./types.js";

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
  resume: z.string().max(64).optional(),
});

export const claimInputSchema = z.object({
  satellite: satelliteNameSchema,
  capacity: z.number().int().min(0).max(1024),
  waitMs: z.number().int().min(0).max(60_000).optional(),
  incarnation: z.string().uuid().optional(),
});

export const heartbeatInputSchema = z.object({
  satellite: satelliteNameSchema,
  running: z.array(z.number().int().positive()).max(1024),
  incarnation: z.string().uuid().optional(),
});

/**
 * UNIT_BOUNDARY_DESCRIPTION: What a worker says when it stops serving. A CLI
 * that predates the registration fence sends the bare name, so both shapes are
 * accepted: the platform cannot tell which registration an old worker served,
 * and it says nothing rather than saying the wrong thing.
 */
export const drainInputSchema = z.union([
  satelliteNameSchema,
  z.object({
    satellite: satelliteNameSchema,
    incarnation: z.string().uuid().optional(),
  }),
]);

/**
 * UNIT_BOUNDARY_DESCRIPTION: What a worker that knows which registration it
 * serves says when it stops. It is a procedure of its own so an older server
 * answers that it does not exist — a refusal, not a call it reads and ignores —
 * and the identity is required, so a fence cannot be skipped silently.
 */
export const drainFencedInputSchema = z.object({
  satellite: satelliteNameSchema,
  incarnation: z.string().uuid(),
});

export const MAX_JOB_OUTPUT_BYTES = 1024 * 1024;
const MAX_TOOL_ARGS_BYTES = 64 * 1024;

/**
 * UNIT_BOUNDARY_DESCRIPTION: One image a Satellite's tool returned, forwarded
 * to the Agent as the MCP content block it was. The machine is untrusted, so
 * this is where an image is checked: `data` must be base64 and the media type
 * one a harness can show, which is what makes a character count a byte count
 * and keeps anything but a raster picture off the Agent's screen. The platform
 * never decodes `data`, and base64 is as far as it goes: it does not prove the
 * bytes are a picture, nor bound the width or height a harness will see.
 */
export const SATELLITE_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const;

const BASE64 =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/][AQgw]==|[A-Za-z0-9+/]{2}[AEIMQUYcgkosw048]=)?$/;

export function isBase64(data: string): boolean {
  return data.length > 0 && BASE64.test(data);
}

const satelliteImageDataSchema = z
  .string()
  .max(MAX_JOB_OUTPUT_BYTES)
  .refine(isBase64, "data must be base64");

const satelliteImageMimeSchema = z.enum(SATELLITE_IMAGE_MIME_TYPES);

export const satelliteImageSchema = z.object({
  type: z.literal("image"),
  data: satelliteImageDataSchema,
  mimeType: satelliteImageMimeSchema,
});

/**
 * UNIT_BOUNDARY_DESCRIPTION: One block an MCP server returned, as an image the
 * platform will accept, or null when it is one it will not: not base64, not a
 * media type a harness shows, or longer than a Job may carry. The worker asks
 * this of every block before it keeps one, so a block the platform would refuse
 * costs the Job its image rather than its whole report.
 */
export function satelliteImageOf(block: {
  data?: unknown;
  mimeType?: unknown;
}): SatelliteImage | null {
  const parsed = z
    .object({
      data: satelliteImageDataSchema,
      mimeType: satelliteImageMimeSchema,
    })
    .safeParse({ data: block.data, mimeType: block.mimeType });
  return parsed.success ? { type: "image", ...parsed.data } : null;
}

export const MAX_JOB_IMAGES = 8;

export const satelliteImagesSchema = z
  .array(satelliteImageSchema)
  .max(MAX_JOB_IMAGES)
  .refine(
    (images) => imageBytes(images) <= MAX_JOB_OUTPUT_BYTES,
    `images must fit in ${MAX_JOB_OUTPUT_BYTES} bytes between them`,
  );

function imageBytes(images: readonly { data: string }[]): number {
  return images.reduce((bytes, image) => bytes + image.data.length, 0);
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: What a finished Job's payload weighs as the JSON
 * the platform stores and hands back — the text escaped, the images as sent,
 * and the envelope around them. Escaping is what a raw byte count misses: a
 * character the JSON has to escape grows sixfold, so a payload counted before
 * it is written reaches an Agent several times the size it measured. A report
 * with no images keeps the character cap it has always had, since a worker of
 * an older version sends one and must not start being refused.
 */
export function storedPayloadBytes(payload: {
  output: string;
  images: readonly { data: string }[];
}): number {
  const stored = JSON.stringify({
    output: payload.output,
    images: payload.images,
  });
  return new TextEncoder().encode(stored).length + PAYLOAD_ENVELOPE_BYTES;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Room kept for what the ceiling does not count — the
 * rest of a Job's outcome, and the indentation a tool result adds around it — so
 * a payload at the ceiling still arrives at an Agent within it.
 */
export const PAYLOAD_ENVELOPE_BYTES = 4096;

export function escapedTextBytes(text: string): number {
  return new TextEncoder().encode(JSON.stringify(text)).length - 2;
}

function payloadFitsCeiling(outcome: {
  output: string;
  images: readonly { data: string }[];
}): boolean {
  if (outcome.images.length === 0) return true;
  return storedPayloadBytes(outcome) <= MAX_JOB_OUTPUT_BYTES;
}

export const toolArgsSchema = z
  .record(z.string(), z.unknown())
  .refine(
    (args) => JSON.stringify(args).length <= MAX_TOOL_ARGS_BYTES,
    `tool arguments must be under ${MAX_TOOL_ARGS_BYTES} bytes`,
  );

export const reportInputSchema = z.object({
  satellite: satelliteNameSchema,
  sequence: z.number().int().positive(),
  incarnation: z.string().uuid().optional(),
  outcome: z.discriminatedUnion("status", [
    z
      .object({
        status: z.literal("done"),
        isError: z.boolean().default(false),
        exitCode: z.number().int().nullable().default(null),
        output: z.string().max(MAX_JOB_OUTPUT_BYTES),
        truncated: z.boolean().default(false),
        images: satelliteImagesSchema.default([]),
      })
      .refine(
        payloadFitsCeiling,
        `the text and images of one job must fit in ${MAX_JOB_OUTPUT_BYTES} bytes between them, the result envelope aside`,
      ),
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

/**
 * UNIT_BOUNDARY_DESCRIPTION: A report from a worker that knows which
 * registration it serves, as a procedure of its own for the same reason as the
 * fenced drain: an older server refuses it instead of reading it and ignoring
 * the registration it names.
 */
export const reportFencedInputSchema = reportInputSchema.extend({
  incarnation: z.string().uuid(),
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
