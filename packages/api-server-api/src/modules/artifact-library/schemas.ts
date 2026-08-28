import { z } from "zod";

export const artifactKindSchema = z.enum([
  "html",
  "jsx",
  "markdown",
  "code",
  "text",
  "binary",
]);

export const artifactVisibilitySchema = z.enum(["private", "public"]);

export const ARTIFACT_TITLE_MAX_LENGTH = 300;

const titleSchema = z
  .string()
  .trim()
  .min(1, "title is required")
  .max(ARTIFACT_TITLE_MAX_LENGTH);
const fileNameSchema = z.string().trim().min(1).max(255);

export const ARTIFACT_BRIEF_MAX_BYTES = 8 * 1024;

export const ARTIFACT_BRIEF_TOO_BIG_MESSAGE =
  `a brief must fit in ${String(ARTIFACT_BRIEF_MAX_BYTES)} bytes (8 KB) — it rides every request ` +
  "this page ever makes, so it is charged to every turn the page causes, not once";

export function briefFitsCap(brief: string): boolean {
  return new TextEncoder().encode(brief).length <= ARTIFACT_BRIEF_MAX_BYTES;
}

const briefSchema = z
  .string()
  .trim()
  .min(1)
  .refine(briefFitsCap, { message: ARTIFACT_BRIEF_TOO_BIG_MESSAGE });
const expiresInHoursSchema = z
  .number()
  .int()
  .positive()
  .max(24 * 365 * 10);

export const artifactIdInputSchema = z.object({ id: z.string().min(1) });

export const artifactListInputSchema = z.object({
  folderId: z.string().min(1).nullish(),
  agentId: z.string().min(1).optional(),
  search: z.string().trim().max(200).optional(),
});

export const artifactContentInputSchema = z.object({
  id: z.string().min(1),
  version: z.number().int().positive().optional(),
});

export const INLINE_CONTENT_MAX_BYTES = 2 * 1024 * 1024;

const contentOrUploadRef = {
  content: z.string().max(INLINE_CONTENT_MAX_BYTES).optional(),
  uploadRef: z.string().min(1).max(1024).optional(),
};

export const artifactCreateInputSchema = z
  .object({
    title: titleSchema,
    ...contentOrUploadRef,
    fileName: fileNameSchema.optional(),
    kind: artifactKindSchema.optional(),
    contentType: z.string().trim().min(1).max(200).optional(),
    folderId: z.string().min(1).optional(),
    visibility: artifactVisibilitySchema.optional(),
    interactive: z.boolean().optional(),
    ownSession: z.boolean().optional(),
    brief: briefSchema.optional(),
    expiresInHours: expiresInHoursSchema.nullish(),
  })
  .refine((v) => (v.content == null) !== (v.uploadRef == null), {
    message: "provide exactly one of content or uploadRef",
    path: ["content"],
  });

export const artifactUpdateInputSchema = z
  .object({
    id: z.string().min(1),
    title: titleSchema.optional(),
    folderId: z.string().min(1).nullish(),
    ...contentOrUploadRef,
    fileName: fileNameSchema.optional(),
    contentType: z.string().trim().min(1).max(200).optional(),
    brief: briefSchema.optional(),
  })
  .refine((v) => !(v.content != null && v.uploadRef != null), {
    message: "provide at most one of content or uploadRef",
    path: ["content"],
  });

export const artifactSharingInputSchema = z.object({
  id: z.string().min(1),
  visibility: artifactVisibilitySchema.optional(),
  expiresInHours: expiresInHoursSchema.nullish(),
});

export const artifactUploadUrlInputSchema = z.object({
  fileName: fileNameSchema,
});

export const folderCreateInputSchema = z.object({
  name: z.string().trim().min(1, "name is required").max(200),
});

export const folderUpdateInputSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(200).optional(),
});

export const folderIdInputSchema = z.object({ id: z.string().min(1) });

export const artifactRequestStateSchema = z.enum([
  "pending",
  "delivered",
  "answered",
  "failed",
]);

export const artifactRequestTriggerSchema = z.enum(["user", "auto"]);

export const artifactRequestFailureReasonSchema = z.enum([
  "agent_deleted",
  "session_deleted",
  "wake_failed",
  "over_budget",
  "rate_limited",
  "busy",
  "cancelled",
  "expired",
]);

export const artifactRequestRefusalSchema = z.object({
  reason: artifactRequestFailureReasonSchema,
});

export const ARTIFACT_REQUEST_ACTION_MAX_LENGTH = 200;

export const ARTIFACT_REQUEST_PAYLOAD_MAX_BYTES = 16 * 1024;

const artifactRequestPayloadSchema = z
  .record(z.string(), z.unknown())
  .refine(
    (payload) =>
      new TextEncoder().encode(JSON.stringify(payload)).length <=
      ARTIFACT_REQUEST_PAYLOAD_MAX_BYTES,
    { message: `payload exceeds ${ARTIFACT_REQUEST_PAYLOAD_MAX_BYTES} bytes` },
  );

export const artifactRequestCreateInputSchema = z.object({
  artifactId: z.string().min(1),
  action: z.string().trim().min(1).max(ARTIFACT_REQUEST_ACTION_MAX_LENGTH),
  payload: artifactRequestPayloadSchema.optional(),
  trigger: artifactRequestTriggerSchema,
  sessionId: z.string().min(1).max(200).optional(),
});

export const artifactRequestIdInputSchema = z.object({
  requestId: z.string().min(1),
});

export const ARTIFACT_BRIDGE_CONNECT_TYPE = "artifact.connect";
export const ARTIFACT_BRIDGE_REQUEST_TYPE = "artifact.request";
export const ARTIFACT_BRIDGE_STATE_TYPE = "artifact.state";
export const ARTIFACT_BRIDGE_ANSWER_TYPE = "artifact.answer";
export const ARTIFACT_BRIDGE_FAILED_TYPE = "artifact.failed";

export const ARTIFACT_BRIDGE_REF_MAX_LENGTH = 200;

export const artifactRequestProgressSchema = z.enum([
  "sent",
  "waking",
  "queued",
  "running",
]);

export const pageArtifactRequestSchema = z.object({
  type: z.literal(ARTIFACT_BRIDGE_REQUEST_TYPE),
  ref: z.string().min(1).max(ARTIFACT_BRIDGE_REF_MAX_LENGTH),
  action: z.string().trim().min(1).max(ARTIFACT_REQUEST_ACTION_MAX_LENGTH),
  payload: artifactRequestPayloadSchema.optional(),
});
