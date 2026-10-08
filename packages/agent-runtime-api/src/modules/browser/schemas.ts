import { z } from "zod";

export const browserStateSchema = z.enum(["starting", "ready", "failed"]);

export const pageStateSchema = z.object({
  url: z.string(),
  title: z.string(),
  loading: z.boolean(),
  canGoBack: z.boolean(),
  canGoForward: z.boolean(),
});

export const browserSnapshotSchema = z.object({
  state: browserStateSchema,
  message: z.string().nullable(),
  page: pageStateSchema.nullable(),
});

export const browserNavigateInputSchema = z.object({
  url: z.string().min(1).max(8192),
});
