import { z } from "zod";

export {
  getEnvResultSchema,
  getReceivedPromptsResultSchema,
  performFetchResultSchema,
  receivedPromptSchema,
  resetResultSchema,
  scriptEntrySchema,
  scriptFileSchema,
  setScriptInputSchema,
} from "api-server-api/e2e-schemas";

export const getEnvInputSchema = z.object({ name: z.string().min(1) }).strict();

export const performFetchInputSchema = z
  .object({
    url: z.string().url(),
    headers: z.record(z.string(), z.string()).optional(),
    timeoutMs: z.number().int().positive().max(40_000).optional(),
  })
  .strict();

export const spawnInvocationInputSchema = z
  .object({
    prompt: z.string().min(1).optional(),
    schema: z.record(z.string(), z.unknown()).optional(),
    script: z.string().min(1).optional(),
    harness: z.string().min(1).optional(),
    image: z.string().min(1).optional(),
    connections: z.array(z.string()).optional(),
    ttlMs: z.number().int().positive().optional(),
  })
  .strict();

export const spawnInvocationResultSchema = z
  .object({ id: z.string().min(1) })
  .strict();
