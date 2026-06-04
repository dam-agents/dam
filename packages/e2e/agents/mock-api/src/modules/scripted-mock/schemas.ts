import { z } from "zod";

export const scriptEntrySchema = z
  .object({
    delayMs: z.number().int().nonnegative().optional(),
    sessionUpdate: z.record(z.string(), z.unknown()),
  })
  .strict();

export const scriptFileSchema = z
  .object({
    path: z.string().min(1),
    content: z.string(),
  })
  .strict();

export const setScriptInputSchema = z
  .object({
    entries: z.array(scriptEntrySchema),
    files: z.array(scriptFileSchema).optional(),
    stopReason: z.string().default("end_turn"),
  })
  .strict();

export const receivedPromptSchema = z
  .object({
    sessionId: z.string(),
    receivedAt: z.string(),
    prompt: z.unknown().optional(),
  })
  .strict();

export const getReceivedPromptsResultSchema = z
  .object({
    prompts: z.array(receivedPromptSchema),
  })
  .strict();

export const resetResultSchema = z.object({ ok: z.literal(true) }).strict();

export const getEnvInputSchema = z.object({ name: z.string().min(1) }).strict();

export const getEnvResultSchema = z
  .object({ value: z.string().optional() })
  .strict();

export const performFetchInputSchema = z
  .object({
    url: z.string().url(),
    headers: z.record(z.string(), z.string()).optional(),
  })
  .strict();

export const performFetchResultSchema = z
  .object({
    status: z.number().int(),
    body: z.string(),
  })
  .strict();
