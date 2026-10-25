import { z } from "zod";

export const browserStateSchema = z.enum(["starting", "ready", "failed"]);

export const pageStateSchema = z.object({
  url: z.string(),
  title: z.string(),
  loading: z.boolean(),
  canGoBack: z.boolean(),
  canGoForward: z.boolean(),
});

export const tabStateSchema = z.object({
  id: z.string(),
  url: z.string(),
  title: z.string(),
  loading: z.boolean(),
});

export const browserSnapshotSchema = z.object({
  state: browserStateSchema,
  message: z.string().nullable(),
  page: pageStateSchema.nullable(),
  tabs: z.array(tabStateSchema).optional(),
  activeTab: z.string().nullable().optional(),
});

const tabIdSchema = z.string().min(1).max(256);

export const browserTabInputSchema = z.object({
  tab: tabIdSchema,
});

export const browserActionInputSchema = z
  .object({ tab: tabIdSchema.optional() })
  .optional();

export const browserNavigateInputSchema = z.object({
  url: z.string().min(1).max(8192),
  tab: tabIdSchema.optional(),
});
