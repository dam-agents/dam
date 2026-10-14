import { z } from "zod";

export const CHANGE_SET_PATH_MAX = 4096;

export const compareToSchema = z.enum(["base", "uncommitted"]);

export const pullRequestLinkSchema = z.object({
  number: z.number().int().positive(),
  url: z.string(),
});

export const changeSetRepositorySchema = z.object({
  id: z.string(),
  name: z.string(),
  root: z.string(),
});

export const diffStatSchema = z.object({
  files: z.number().int(),
  additions: z.number().int(),
  deletions: z.number().int(),
});

export const changeSetSchema = z.object({
  path: z.string(),
  repository: changeSetRepositorySchema,
  branch: z.string().nullable(),
  baseRef: z.string().nullable(),
  stat: diffStatSchema,
  commitsAhead: z.number().int(),
  uncommitted: z.boolean(),
  pullRequest: pullRequestLinkSchema.nullable(),
  sessionEditedAt: z.string().nullable(),
  readError: z.string().nullable(),
});

export const changeSetListInputSchema = z.object({
  sessionId: z.string().min(1).max(256).optional(),
});

export const changeSetListSchema = z.object({
  changeSets: z.array(changeSetSchema),
});

export const changeSetDiffInputSchema = z.object({
  path: z.string().min(1).max(CHANGE_SET_PATH_MAX),
  compare: compareToSchema,
});

export const fileChangeStatusSchema = z.enum([
  "added",
  "deleted",
  "modified",
  "renamed",
]);

export const fileDiffSchema = z.object({
  path: z.string(),
  oldPath: z.string().nullable(),
  status: fileChangeStatusSchema,
  additions: z.number().int(),
  deletions: z.number().int(),
  binary: z.boolean(),
  uncommitted: z.boolean(),
  patch: z.string().nullable(),
});

export const changeSetDiffSchema = z.object({
  path: z.string(),
  compare: compareToSchema,
  baseRef: z.string().nullable(),
  files: z.array(fileDiffSchema),
  truncated: z.boolean(),
});

export const sessionRepositorySchema = z.object({
  name: z.string(),
  path: z.string(),
  branch: z.string().nullable(),
  pullRequest: pullRequestLinkSchema.nullable(),
});

export const changesNoticeSchema = z.object({
  topic: z.literal("changes"),
});
