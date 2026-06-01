import type { ReceivedPrompt, ScriptEntry } from "mock-agent-api";

export interface MockState {
  scriptEntries: ScriptEntry[];
  scriptStopReason: string;
  receivedPrompts: ReceivedPrompt[];
}

export function createInitialState(): MockState {
  return {
    scriptEntries: [],
    scriptStopReason: "end_turn",
    receivedPrompts: [],
  };
}
