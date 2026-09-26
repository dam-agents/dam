import { z } from "zod";

export const ARTIFACT_API_PORT = 5555;
export const ARTIFACT_API_MAX_BODY_BYTES = 1024 * 1024;
export const ARTIFACT_API_TIMEOUT_MS = 30_000;

const utf8 = new TextEncoder();

export const artifactApiMethodSchema = z.enum([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
]);

export const artifactApiPathSchema = z
  .string()
  .max(8192)
  .refine((path) => path.startsWith("/") && !path.startsWith("//"), {
    message: 'path must start with a single "/"',
  });

export const artifactApiBodySchema = z
  .string()
  .refine(
    (body) => utf8.encode(body).byteLength <= ARTIFACT_API_MAX_BODY_BYTES,
    { message: `body must be at most ${ARTIFACT_API_MAX_BODY_BYTES} bytes` },
  );

export const artifactApiContentTypeSchema = z
  .string()
  .max(256)
  .regex(/^[\x21-\x7e](?:[\t\x20-\x7e]*[\x21-\x7e])?$/, {
    message: "contentType must be a valid header value",
  });

export const artifactApiRequestInputSchema = z
  .object({
    method: artifactApiMethodSchema,
    path: artifactApiPathSchema,
    body: artifactApiBodySchema.optional(),
    contentType: artifactApiContentTypeSchema.optional(),
  })
  .refine((input) => input.method !== "GET" || input.body === undefined, {
    message: "a GET request cannot have a body",
    path: ["body"],
  });

export const artifactApiRelayFailureReasonSchema = z.enum([
  "app-not-listening",
  "timeout",
  "response-too-large",
]);

export const artifactApiRequestResultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    status: z.number().int(),
    contentType: z.string().nullable(),
    body: z.string(),
  }),
  z.object({
    ok: z.literal(false),
    reason: artifactApiRelayFailureReasonSchema,
  }),
]);

export type ArtifactApiRequestInput = z.infer<
  typeof artifactApiRequestInputSchema
>;
export type ArtifactApiRequestResult = z.infer<
  typeof artifactApiRequestResultSchema
>;
