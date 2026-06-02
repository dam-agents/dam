import type { ReceivedPrompt, ScriptEntry, ScriptFile } from "mock-agent-api";

export interface MockState {
  scriptEntries: ScriptEntry[];
  scriptStopReason: string;
  scriptFiles: ScriptFile[];
  receivedPrompts: ReceivedPrompt[];
}

export function createInitialState(): MockState {
  return {
    scriptEntries: [],
    scriptStopReason: "end_turn",
    scriptFiles: [],
    receivedPrompts: [],
  };
}
