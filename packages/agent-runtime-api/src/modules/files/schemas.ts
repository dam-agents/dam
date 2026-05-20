import { z } from "zod";

export const pathSchema = z.string().min(1);

export const fileReadInputSchema = z.object({ path: pathSchema });

export const fileWriteInputSchema = z.object({
  path: pathSchema,
  content: z.string(),
  expectedMtimeMs: z.number().optional(),
});

export const fileCreateInputSchema = z.object({
  path: pathSchema,
  content: z.string(),
});

export const fileMkdirInputSchema = z.object({ path: pathSchema });

export const fileRenameInputSchema = z.object({
  from: pathSchema,
  to: pathSchema,
  overwrite: z.boolean().optional(),
});

export const fileRemoveInputSchema = z.object({ path: pathSchema });

export const fileUploadInputSchema = z.object({
  path: pathSchema,
  contentBase64: z.string(),
  /** Browser-reported MIME (File.type). Carried in the API for observability
   *  and forward-compat; server-side reads still detect MIME from magic
   *  bytes so we don't need to persist this. */
  contentType: z.string().max(255).optional(),
  overwrite: z.boolean().optional(),
});
