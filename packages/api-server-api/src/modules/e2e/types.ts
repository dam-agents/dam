import type {
  GetReceivedPromptsResult,
  ResetResult,
  SetScriptInput,
} from "mock-agent-api";

export interface E2eService {
  setScript(agentId: string, input: SetScriptInput): Promise<ResetResult>;
  getReceivedPrompts(agentId: string): Promise<GetReceivedPromptsResult>;
  reset(agentId: string): Promise<ResetResult>;
}
