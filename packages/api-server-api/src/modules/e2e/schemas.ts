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

export const e2eAgentIdInputSchema = z
  .object({ agentId: z.string().min(1) })
  .strict();

export const e2eSetScriptInputSchema = z
  .object({
    agentId: z.string().min(1),
    script: setScriptInputSchema,
  })
  .strict();
