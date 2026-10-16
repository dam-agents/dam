import {
  type GuardedPromptCopy,
  type GuardedPromptOptions,
  useGuardedChatPrompt,
} from "./use-guarded-chat-prompt.js";

const FORM_COPY: GuardedPromptCopy = {
  noChat: "Open a chat before using this form.",
  conversationChanged:
    "The conversation changed. Try again from the form's chat.",
};

export function useChatFormPrompt(options: GuardedPromptOptions) {
  return useGuardedChatPrompt(options, FORM_COPY);
}
