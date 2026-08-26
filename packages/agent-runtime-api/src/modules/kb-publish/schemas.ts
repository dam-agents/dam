import { z } from "zod";

import { kbPublishCapsSchema } from "../kb-snapshot/caps.js";

export const kbPublishPlanInputSchema = z.object({
  roots: z.array(z.string().min(1)).max(16),
  caps: kbPublishCapsSchema,
});

export const kbPublishBlobUploadSchema = z.object({
  path: z.string().min(1),
  expectedHash: z.string().min(1),
  putUrl: z.string().min(1),
});

export const kbPublishSegmentMemberSchema = z.object({
  path: z.string().min(1),
  expectedHash: z.string().min(1),
});

export const kbPublishSegmentBuildSchema = z.object({
  bucket: z.number().int().min(0),
  members: z.array(kbPublishSegmentMemberSchema),
  putUrl: z.string().min(1),
});

export const kbPublishExecuteInputSchema = z.object({
  caps: kbPublishCapsSchema,
  bucketCount: z.number().int().min(1),
  blobs: z.array(kbPublishBlobUploadSchema).max(500),
  segments: z.array(kbPublishSegmentBuildSchema).max(64),
});

export type KbPublishPlanInput = z.infer<typeof kbPublishPlanInputSchema>;
export type KbPublishExecuteInput = z.infer<typeof kbPublishExecuteInputSchema>;
