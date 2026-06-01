import type {
  GetReceivedPromptsResult,
  ReceivedPrompt,
  ScriptedMockService,
  SetScriptInput,
} from "mock-agent-api";
import type { MockState } from "../domain/state.js";

export function createScriptedMockService(
  state: MockState,
): ScriptedMockService {
  return {
    setScript(input: SetScriptInput) {
      state.scriptEntries = input.entries;
      state.scriptStopReason = input.stopReason;
      return { ok: true as const };
    },
    getReceivedPrompts(): GetReceivedPromptsResult {
      return { prompts: [...state.receivedPrompts] };
    },
    reset() {
      state.scriptEntries = [];
      state.scriptStopReason = "end_turn";
      state.receivedPrompts = [];
      return { ok: true as const };
    },
  };
}

export function recordPrompt(state: MockState, prompt: ReceivedPrompt): void {
  state.receivedPrompts.push(prompt);
}
