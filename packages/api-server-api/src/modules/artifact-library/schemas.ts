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

const titleSchema = z.string().trim().min(1, "title is required").max(300);
const fileNameSchema = z.string().trim().min(1).max(255);
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
