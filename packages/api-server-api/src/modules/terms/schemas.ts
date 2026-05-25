import { z } from "zod";

export const termsCurrentSchema = z.object({
  version: z.string().min(1),
  hash: z.string().min(1),
});

export const termsDocumentSchema = z.object({
  version: z.string().min(1),
  text: z.string(),
  hash: z.string().min(1),
});

export const termsAcceptInputSchema = z.object({
  version: z.string().min(1),
});

export const staleAcceptanceSchema = z.object({
  error: z.literal("terms_stale"),
  currentVersion: z.string().min(1),
  currentHash: z.string().min(1),
});

export const termsLatestAcceptanceSchema = z
  .object({
    version: z.string().min(1),
    hash: z.string().min(1),
    acceptedAt: z.date(),
  })
  .nullable();
