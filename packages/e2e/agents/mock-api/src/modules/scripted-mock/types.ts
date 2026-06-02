import type { z } from "zod";
import type {
  getReceivedPromptsResultSchema,
  receivedPromptSchema,
  resetResultSchema,
  scriptEntrySchema,
  scriptFileSchema,
  setScriptInputSchema,
} from "./schemas.js";

export type ScriptEntry = z.infer<typeof scriptEntrySchema>;
export type ScriptFile = z.infer<typeof scriptFileSchema>;
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
