import {
  type GuardedPromptCopy,
  type GuardedPromptOptions,
  useGuardedChatPrompt,
} from "./use-guarded-chat-prompt.js";

const ARTIFACT_COPY: GuardedPromptCopy = {
  noChat: "Open a chat before using this artifact's buttons.",
  conversationChanged:
    "The conversation changed. Try again from the artifact's chat.",
};

export function useChatArtifactPrompt(options: GuardedPromptOptions) {
  return useGuardedChatPrompt(options, ARTIFACT_COPY);
}
