import { z } from "zod";

export const importBundleResultSchema = z.object({
  filesWritten: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
});

export type ImportBundleResult = z.infer<typeof importBundleResultSchema>;
