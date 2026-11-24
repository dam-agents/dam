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
 *
 * A tool's `transfer` marker is sent only by a `dam satellite files` from before
 * the mount. Registration refuses it on sight, so the field outlives every tool
 * that declared it.
 */
export const satelliteToolSchema = z.object({
  name: satelliteToolNameSchema,
  title: z.string().max(120).optional(),
  description: z.string().max(4096).optional(),
  inputSchema: z.record(z.string(), z.unknown()),
  maxConcurrent: z.number().int().positive().max(1024).optional(),
  transfer: z.enum(["download", "upload"]).optional(),
});

/**
 * UNIT_BOUNDARY_DESCRIPTION: What a Satellite offers. A tools Satellite offers
 * tools and nothing else; a files Satellite offers one directory as a mount and
 * has no tools at all, so its tool list may be empty and its `files` block says
 * whether the worker was started writable. The pair is checked rather than each
 * field alone: a manifest that claims files without saying how they behave, or
 * carries a `files` block while offering tools, is one the platform cannot serve.
 */
export const satelliteKindSchema = z.enum(["tools", "files"]);

export const satelliteFilesSchema = z
  .object({ writable: z.boolean() })
  .strict();

export const satelliteManifestSchema = z
  .object({
    name: satelliteNameSchema,
    kind: satelliteKindSchema.optional(),
    description: z.string().max(280).optional(),
    maxConcurrent: z
      .number()
      .int()
      .positive()
      .max(1024)
      .default(DEFAULT_MAX_CONCURRENT),
    tools: z.array(satelliteToolSchema).max(256),
    files: satelliteFilesSchema.optional(),
  })
  .refine(
    (manifest) =>
      manifest.kind === "files"
        ? manifest.tools.length === 0
        : manifest.tools.length > 0,
    {
      message:
        "a tools satellite offers at least one tool, and a files satellite none",
      path: ["tools"],
    },
  )
  .refine(
    (manifest) =>
      (manifest.kind === "files") === (manifest.files !== undefined),
    {
      message:
        "a files satellite declares files: { writable }, and a tools satellite does not",
      path: ["files"],
    },
  );

export const jobStatusSchema = z.enum([
  "queued",
  "running",
  "done",
  "interrupted",
  "cancelled",
]);

export const satelliteConnectInputSchema = z
  .object({
    manifest: satelliteManifestSchema,
    host: z.string().max(253).optional(),
  })
  .strict();

export const claimInputSchema = z
  .object({
    satellite: satelliteNameSchema,
    capacity: z.number().int().min(0).max(1024),
    waitMs: z.number().int().min(0).max(60_000).optional(),
  })
  .strict();

export const heartbeatInputSchema = z
  .object({
    satellite: satelliteNameSchema,
    running: z.array(z.number().int().positive()).max(1024),
  })
  .strict();

/**
 * UNIT_BOUNDARY_DESCRIPTION: What a worker says when it stops serving. A CLI
 * that predates the registration fence sends the bare name, so both shapes are
 * accepted: the platform cannot tell which registration an old worker served,
 * and it says nothing rather than saying the wrong thing.
 */
export const drainInputSchema = satelliteNameSchema;

/**
 * UNIT_BOUNDARY_DESCRIPTION: The connect, claim and heartbeat of a worker that
 * already knows which registration it served, as procedures of their own for the
 * same reason as the fenced drain: an older server answers that it does not
 * exist rather than reading the call and ignoring the identity it carries, which
 * would let it register a removed name again, or claim and renew the Jobs of a
 * machine that replaced this one. The identity is required in each.
 */
export const connectFencedInputSchema = satelliteConnectInputSchema.extend({
  resume: z.string().uuid(),
});

export const claimFencedInputSchema = claimInputSchema.extend({
  incarnation: z.string().uuid(),
});

export const heartbeatFencedInputSchema = heartbeatInputSchema.extend({
  incarnation: z.string().uuid(),
});

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

export const reportInputSchema = z
  .object({
    satellite: satelliteNameSchema,
    sequence: z.number().int().positive(),
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
  })
  .strict();

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

export const SATELLITE_FILE_MAX_PATH = 1024;
export const SATELLITE_FILE_MAX_DATA_CHARS = 1_572_864;
export const SATELLITE_FILE_MAX_RESULT_BYTES = 1024 * 1024;
export const SATELLITE_FILE_MAX_READ_BYTES = 128 * 1024;
export const SATELLITE_FILE_MAX_READDIR = 256;

/**
 * UNIT_BOUNDARY_DESCRIPTION: The errnos a file operation may end in, and the
 * only vocabulary the mount server translates back to the kernel. A result is
 * dropped rather than reported under a name the server does not know, so a
 * machine cannot make a read fail with something the Agent's tools would read
 * as success.
 */
export const SATELLITE_FILE_ERRNOS = [
  "ENOENT",
  "EACCES",
  "EROFS",
  "EPERM",
  "ESTALE",
  "EHOSTDOWN",
  "EIO",
  "ENOTDIR",
  "EISDIR",
  "EEXIST",
  "ENOTEMPTY",
  "ENOSPC",
  "EXDEV",
  "ENOTSUP",
  "EBUSY",
  "EINVAL",
  "ENAMETOOLONG",
] as const;

export const satelliteFileErrnoSchema = z.enum(SATELLITE_FILE_ERRNOS);
export type SatelliteFileErrno = z.infer<typeof satelliteFileErrnoSchema>;

const filePathSchema = z
  .string()
  .min(1)
  .max(SATELLITE_FILE_MAX_PATH)
  .refine(
    (path) => !path.includes("\0"),
    "a path may not carry a NUL; the segments themselves are checked on the machine",
  );

/**
 * UNIT_BOUNDARY_DESCRIPTION: The bytes a write carries or a read hands back, as
 * base64. Empty is allowed and means what it says: a read at the end of a file
 * answers no bytes, and a write of none is a no-op the kernel may ask for.
 */
const fileDataSchema = z
  .string()
  .max(SATELLITE_FILE_MAX_DATA_CHARS)
  .refine((data) => data === "" || isBase64(data), "data must be base64");

const fileDevSchema = z.number().int().nonnegative();
const fileInoSchema = z.number().int().positive();
const fileModeSchema = z.number().int().nonnegative().max(0o7777);
const fileOffsetSchema = z.number().int().nonnegative();

/**
 * UNIT_BOUNDARY_DESCRIPTION: One file operation an Agent's mount asks the
 * machine for. Strict in both directions: an unknown key is refused rather than
 * dropped, because a field the platform silently forgets is a field the machine
 * silently fills with its own answer. The platform never reads a path's
 * segments — only the machine proves them — but it does bound the path's length,
 * the read's size, the listing's window and the bytes a write may carry, since
 * all of those are stored and relayed before the machine sees them.
 */
export const satelliteFileOpSchema = z.discriminatedUnion("op", [
  z
    .object({
      op: z.literal("lookup"),
      path: filePathSchema,
      parentDev: fileDevSchema.optional(),
      parentIno: fileInoSchema.optional(),
    })
    .strict(),
  z.object({ op: z.literal("getattr"), path: filePathSchema }).strict(),
  z
    .object({
      op: z.literal("readdir"),
      path: filePathSchema,
      offset: fileOffsetSchema.default(0),
      limit: z
        .number()
        .int()
        .positive()
        .max(SATELLITE_FILE_MAX_READDIR)
        .default(SATELLITE_FILE_MAX_READDIR),
    })
    .strict(),
  z
    .object({
      op: z.literal("read"),
      path: filePathSchema,
      offset: fileOffsetSchema,
      size: z.number().int().positive().max(SATELLITE_FILE_MAX_READ_BYTES),
      dev: fileDevSchema,
      ino: fileInoSchema,
    })
    .strict(),
  z.object({ op: z.literal("readlink"), path: filePathSchema }).strict(),
  z
    .object({
      op: z.literal("open"),
      path: filePathSchema,
      write: z.boolean(),
      dev: fileDevSchema.optional(),
      ino: fileInoSchema.optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal("create"),
      path: filePathSchema,
      mode: fileModeSchema,
      exclusive: z.boolean(),
    })
    .strict(),
  z
    .object({
      op: z.literal("write"),
      path: filePathSchema,
      offset: fileOffsetSchema,
      data: fileDataSchema,
      dev: fileDevSchema,
      ino: fileInoSchema,
    })
    .strict(),
  z
    .object({
      op: z.literal("truncate"),
      path: filePathSchema,
      size: fileOffsetSchema,
      dev: fileDevSchema,
      ino: fileInoSchema,
    })
    .strict(),
  z
    .object({
      op: z.literal("setattr"),
      path: filePathSchema,
      mode: fileModeSchema.optional(),
      atimeMs: z.number().int().nonnegative().optional(),
      mtimeMs: z.number().int().nonnegative().optional(),
      dev: fileDevSchema,
      ino: fileInoSchema,
    })
    .strict(),
  z
    .object({
      op: z.literal("mkdir"),
      path: filePathSchema,
      mode: fileModeSchema,
    })
    .strict(),
  z.object({ op: z.literal("rmdir"), path: filePathSchema }).strict(),
  z.object({ op: z.literal("unlink"), path: filePathSchema }).strict(),
  z
    .object({
      op: z.literal("rename"),
      from: filePathSchema,
      to: filePathSchema,
    })
    .strict(),
  z
    .object({
      op: z.literal("symlink"),
      target: z.string().min(1).max(SATELLITE_FILE_MAX_PATH),
      path: filePathSchema,
    })
    .strict(),
  z.object({ op: z.literal("statfs"), path: filePathSchema }).strict(),
]);

/**
 * UNIT_BOUNDARY_DESCRIPTION: Whether an operation changes the tree. A Satellite
 * started without `--write` refuses each of them before the work is queued, so
 * an Agent learns it cannot write from the operation it asked for rather than
 * from a refusal the machine makes a round trip later. `open` carries both: a
 * read is admitted, a write is a change.
 */
const MUTATING_FILE_OPS: readonly string[] = [
  "create",
  "write",
  "truncate",
  "setattr",
  "mkdir",
  "rmdir",
  "unlink",
  "rename",
  "symlink",
];

export type SatelliteFileOp = z.infer<typeof satelliteFileOpSchema>;

export function satelliteFileOpMutates(op: SatelliteFileOp): boolean {
  return op.op === "open" ? op.write : MUTATING_FILE_OPS.includes(op.op);
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: What a worker answers for one file operation. The
 * result is opaque to the platform — only the machine knows what an entry's
 * attributes are — so its size is all that is checked, beside the bytes a read
 * hands back. The registration is required: no file worker predates it, and an
 * answer has to name the machine the operation was queued for or it cannot be
 * told from another machine's. One operation is answered once: the id is the
 * operation's own, and a second answer for it finds nothing to settle.
 */
export const fileResultInputSchema = z
  .object({
    satellite: satelliteNameSchema,
    id: z.string().uuid(),
    incarnation: z.string().uuid(),
    ok: z.boolean(),
    errno: satelliteFileErrnoSchema.optional(),
    result: z.unknown().optional(),
    data: fileDataSchema.optional(),
  })
  .strict()
  .refine((input) => input.ok === (input.errno === undefined), {
    message:
      "a failed operation names its errno, and a successful one does not",
    path: ["errno"],
  })
  .refine(
    (input) =>
      input.result === undefined ||
      JSON.stringify(input.result).length <= SATELLITE_FILE_MAX_RESULT_BYTES,
    `a result must fit in ${SATELLITE_FILE_MAX_RESULT_BYTES} bytes`,
  );

export const satelliteGrantInputSchema = z.object({
  satellite: satelliteNameSchema,
  agentId: z.string().min(1),
});

export function formatJobRef(satellite: string, sequence: number): string {
  return `${satellite}#${sequence}`;
}
