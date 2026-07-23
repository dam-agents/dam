import type { z } from "zod";
import type {
  getEnvInputSchema,
  getEnvResultSchema,
  getReceivedPromptsResultSchema,
  performFetchInputSchema,
  performFetchResultSchema,
  receivedPromptSchema,
  resetResultSchema,
  scriptEntrySchema,
  scriptFileSchema,
  setScriptInputSchema,
  spawnInvocationInputSchema,
  spawnInvocationResultSchema,
} from "./schemas.js";

export type ScriptEntry = z.infer<typeof scriptEntrySchema>;
export type ScriptFile = z.infer<typeof scriptFileSchema>;
export type SetScriptInput = z.infer<typeof setScriptInputSchema>;
export type ReceivedPrompt = z.infer<typeof receivedPromptSchema>;
export type GetReceivedPromptsResult = z.infer<
  typeof getReceivedPromptsResultSchema
>;
export type ResetResult = z.infer<typeof resetResultSchema>;
export type GetEnvInput = z.infer<typeof getEnvInputSchema>;
export type GetEnvResult = z.infer<typeof getEnvResultSchema>;
export type PerformFetchInput = z.infer<typeof performFetchInputSchema>;
export type PerformFetchResult = z.infer<typeof performFetchResultSchema>;
export type SpawnInvocationInput = z.infer<typeof spawnInvocationInputSchema>;
export type SpawnInvocationResult = z.infer<typeof spawnInvocationResultSchema>;

export interface ScriptedMockService {
  setScript(input: SetScriptInput): ResetResult;
  getReceivedPrompts(): GetReceivedPromptsResult;
  reset(): ResetResult;
  getEnv(input: GetEnvInput): GetEnvResult;
  performFetch(input: PerformFetchInput): Promise<PerformFetchResult>;
  /** Spawn an Invocation as this agent (the driver) via the harness surface —
   *  the same POST the driver SDK makes from a real agent pod. */
  spawnInvocation(input: SpawnInvocationInput): Promise<SpawnInvocationResult>;
}
