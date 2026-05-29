import type { z } from "zod";
import type {
  getReceivedPromptsResultSchema,
  receivedPromptSchema,
  resetResultSchema,
  scriptEntrySchema,
  setScriptInputSchema,
} from "./schemas.js";

export type ScriptEntry = z.infer<typeof scriptEntrySchema>;
export type SetScriptInput = z.infer<typeof setScriptInputSchema>;
export type ReceivedPrompt = z.infer<typeof receivedPromptSchema>;
export type GetReceivedPromptsResult = z.infer<
  typeof getReceivedPromptsResultSchema
>;
export type ResetResult = z.infer<typeof resetResultSchema>;

export interface ScriptedMockService {
  setScript(input: SetScriptInput): ResetResult;
  getReceivedPrompts(): GetReceivedPromptsResult;
  reset(): ResetResult;
}
