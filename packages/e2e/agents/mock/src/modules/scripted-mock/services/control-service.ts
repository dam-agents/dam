import type {
  GetEnvInput,
  GetEnvResult,
  GetReceivedPromptsResult,
  PerformFetchInput,
  PerformFetchResult,
  ReceivedPrompt,
  ScriptedMockService,
  SetScriptInput,
} from "mock-agent-api";
import type { MockState } from "../domain/state.js";

export type ProxyFetch = (
  input: PerformFetchInput,
) => Promise<PerformFetchResult>;

export interface ScriptedMockDeps {
  state: MockState;
  proxyFetch: ProxyFetch;
}

export function createScriptedMockService(
  deps: ScriptedMockDeps,
): ScriptedMockService {
  const { state, proxyFetch } = deps;
  return {
    setScript(input: SetScriptInput) {
      state.scriptEntries = input.entries;
      state.scriptStopReason = input.stopReason;
      state.scriptFiles = input.files ?? [];
      return { ok: true as const };
    },
    getReceivedPrompts(): GetReceivedPromptsResult {
      return { prompts: [...state.receivedPrompts] };
    },
    reset() {
      state.scriptEntries = [];
      state.scriptStopReason = "end_turn";
      state.scriptFiles = [];
      state.receivedPrompts = [];
      return { ok: true as const };
    },
    getEnv(input: GetEnvInput): GetEnvResult {
      return { value: process.env[input.name] };
    },
    performFetch(input: PerformFetchInput): Promise<PerformFetchResult> {
      return proxyFetch(input);
    },
  };
}

export function recordPrompt(state: MockState, prompt: ReceivedPrompt): void {
  state.receivedPrompts.push(prompt);
}
