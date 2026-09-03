import { z } from "zod";

export const PER_FILE_MAX_BYTES = 2 * 1024 * 1024;
export const TOTAL_MAX_BYTES = 200 * 1024 * 1024;
export const MAX_FILES = 5000;
export const MAX_WALK_DEPTH = 64;

export const kbPublishCapsSchema = z.object({
  perFileMaxBytes: z.number().int().positive(),
  totalMaxBytes: z.number().int().positive(),
  maxFiles: z.number().int().positive(),
  maxWalkDepth: z.number().int().positive(),
});

export type KbPublishCaps = z.infer<typeof kbPublishCapsSchema>;
