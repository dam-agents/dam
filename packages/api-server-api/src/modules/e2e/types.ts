import type { z } from "zod";
import type {
  getReceivedPromptsResultSchema,
  resetResultSchema,
  setScriptInputSchema,
} from "./schemas.js";

export type SetScriptInput = z.infer<typeof setScriptInputSchema>;
export type GetReceivedPromptsResult = z.infer<
  typeof getReceivedPromptsResultSchema
>;
export type ResetResult = z.infer<typeof resetResultSchema>;

export interface E2eService {
  setScript(agentId: string, input: SetScriptInput): Promise<ResetResult>;
  getReceivedPrompts(agentId: string): Promise<GetReceivedPromptsResult>;
  reset(agentId: string): Promise<ResetResult>;
}
