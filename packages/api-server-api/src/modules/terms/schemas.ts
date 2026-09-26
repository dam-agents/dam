import { z } from "zod";

export const termsDocumentSchema = z.object({
  version: z.string().min(1),
  text: z.string(),
  hash: z.string().min(1),
});

export const termsAcceptInputSchema = z.object({
  version: z.string().min(1),
});
