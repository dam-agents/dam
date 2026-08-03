import { z } from "zod";
import { agentSizeSchema } from "../agents/schemas.js";
import { egressPresetSchema } from "../egress-rules/schemas.js";

// Experiments v2 (#2942): the wire contract between the in-pod experiment SDK,
// the api-server, and the live view. Zod here is the source of truth; types.ts
// only infers. The REST payloads ride the per-agent harness surface (waypoint
// attribution — no ids of the caller in any body), the feed rides tRPC and the
// dashboard postMessage bridge.

/** Ceiling for script source captured at plan registration / re-versioning.
 *  Experiment scripts are single files by design; anything bigger belongs in
 *  the workspace, not the trace. */
export const SCRIPT_CONTENT_MAX_BYTES = 256 * 1024;

/** Ceiling for bespoke dashboard HTML captured at plan registration. */
export const DASHBOARD_CONTENT_MAX_BYTES = 512 * 1024;

/** Ceiling for a run's merged custom-data blob (JSON-serialized). */
export const CUSTOM_DATA_MAX_BYTES = 128 * 1024;

/** Message `type` for feed frames pushed into a dashboard iframe via
 *  postMessage. The generated HTML's whole contract is
 *  `addEventListener("message", e => e.data?.type === EXPERIMENT_FEED_MESSAGE_TYPE && render(e.data.feed))`. */
export const EXPERIMENT_FEED_MESSAGE_TYPE = "experiment-feed";

/** One library folder per lineage holds everything platform-managed — the
 *  draft's script + dashboard, every run's script clone and results page —
 *  so the library root never fills with stock artifacts. Folders are flat; this prefix is how the
 *  UI recognizes them and tucks them into its own Experiments section. */
export const EXPERIMENT_FOLDER_PREFIX = "Experiments / ";

export function experimentFolderName(name: string): string {
  return `${EXPERIMENT_FOLDER_PREFIX}${name}`;
}

/** Stage/loop identifiers double as display names — slug-like, SDK-chosen. */
const stageIdSchema = z.string().trim().min(1).max(100);

const spanIdSchema = z.string().min(1).max(200);

const isoTimestampSchema = z.string().datetime({ offset: true });

/** The structure a script declares upfront. Lenient by design: an empty
 *  skeleton is a valid pure-trace experiment, and spans naming undeclared
 *  stages grow the graph as drift rather than erroring. */
export const skeletonSchema = z.object({
  stages: z
    .array(
      z.object({
        id: stageIdSchema,
        /** Stage ids this stage runs after (edges of the graph). */
        after: z.array(stageIdSchema).max(20).default([]),
      }),
    )
    .max(50)
    .default([]),
  loops: z
    .array(
      z.object({
        id: stageIdSchema,
        /** Member stages, iterated together. */
        stages: z.array(stageIdSchema).min(1).max(50),
      }),
    )
    .max(10)
    .default([]),
});

// ---- REST: plan registration -----------------------------------------------

export const planRegisterRequestSchema = z.object({
  name: z.string().trim().min(1).max(200),
  skeleton: skeletonSchema,
  script: z.object({
    /** Pod-local path the harness will execute (`python <path>`). */
    path: z.string().min(1).max(1024),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    content: z.string().max(SCRIPT_CONTENT_MAX_BYTES),
  }),
  /** Bespoke dashboard HTML captured like the script (the SDK's
   *  dashboard_path): the platform creates or re-versions the draft's
   *  dashboard artifact from it. Omitted = keep the existing dashboard, or
   *  attach the stock one on first registration. */
  dashboard: z
    .object({ content: z.string().max(DASHBOARD_CONTENT_MAX_BYTES) })
    .optional(),
});

export const planRegisterResponseSchema = z.object({
  experimentId: z.string(),
});

// ---- REST: trace events ------------------------------------------------------

/** Run mode announcing itself; a changed sha re-versions the Script Artifact
 *  (content must accompany a changed sha). */
const runStartEventSchema = z.object({
  type: z.literal("run-start"),
  scriptSha256: z.string().regex(/^[a-f0-9]{64}$/),
  scriptContent: z.string().max(SCRIPT_CONTENT_MAX_BYTES).optional(),
});

/** Lenient-skeleton path: declares a stage first seen after registration. */
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
  /** Opaque by covenant: captured and charted, never normalized or ranked. */
  score: z.number().finite().optional(),
  /** Artifact Library ids this span produced (candidates, reports). */
  artifactIds: z.array(z.string().min(1)).max(20).optional(),
  attrs: z.record(z.string(), z.unknown()).optional(),
  ts: isoTimestampSchema,
});

/** Run-level custom data (`exp.post_data(...)`): an arbitrary dict merged
 *  into the run's blob and delivered to dashboards as `feed.custom` — best
 *  candidate so far, extra series, whatever the script wants surfaced. */
const customDataEventSchema = z.object({
  type: z.literal("custom-data"),
  data: z.record(z.string(), z.unknown()),
  /** false replaces the blob instead of shallow-merging into it. */
  merge: z.boolean().optional(),
});

/** Liveness ping from the SDK's background heartbeat thread. Accepted like
 *  any batch (bumping the activity clock), stored nowhere. Keeps a healthy
 *  loop from being reaped while a long spawn() or a local computation emits
 *  no trace events. */
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

// ---- REST: completion --------------------------------------------------------

export const finishRequestSchema = z.object({
  status: z.enum(["completed", "failed"]),
  error: z.string().max(2000).optional(),
});

// ---- tRPC inputs -------------------------------------------------------------

export const experimentIdInputSchema = z.object({
  id: z.string().min(1),
});

/** The authoring skill an experiment sandbox's Install Command copies in. Shared
 *  because two sides depend on the same name: the server composes the copy, and
 *  the UI probes `skills.state.standalone` for it to know the setup landed
 *  before running the onboarding greeting. */
export const EXPERIMENT_SKILL_NAME = "dam-experiment";

/** Create an experiment sandbox: an Agent carrying the `experiment` Agent Kind,
 *  set up by an Install Command that copies the authoring skill in from the
 *  image. Mirrors the agent create input minus what this flow decides itself
 *  (the Kind, and the harness image the UI pins). Creating one registers no
 *  Experiment — a draft only ever comes from the script's Plan Registration. */
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
