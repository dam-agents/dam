import { z } from "zod";

export const importBundleResultSchema = z.object({
  filesWritten: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
});

export type ImportBundleResult = z.infer<typeof importBundleResultSchema>;

export const IMPORT_REPLACE_HEADER = "x-import-replace";

export const importBundleConflictSchema = z.object({
  error: z.string(),
  conflicts: z.array(z.string()).min(1),
});

export type ImportBundleConflict = z.infer<typeof importBundleConflictSchema>;
