import { SessionMode } from "api-server-api";
import { useCallback } from "react";
import { match } from "ts-pattern";

import { useStore } from "../../../store.js";

export interface GuardedPromptCopy {
  noChat: string;
  conversationChanged: string;
}

export interface GuardedPromptOptions {
  agentId: string | null;
  sessionId: string | null;
  sessionMode: SessionMode | null;
  agentOperable: boolean;
  loadingSession: boolean;
  sendPrompt: (prompt: string) => Promise<void>;
}

export function useGuardedChatPrompt(
  {
    agentId,
    sessionId,
    sessionMode,
    agentOperable,
    loadingSession,
    sendPrompt,
  }: GuardedPromptOptions,
  copy: GuardedPromptCopy,
) {
  const { noChat, conversationChanged } = copy;
  return useCallback(
    async (prompt: string) => {
      const current = useStore.getState();
      const isChat = match(sessionMode)
        .with(null, () => true)
        .with(SessionMode.Chat, () => true)
        .with(SessionMode.Terminal, () => false)
        .exhaustive(() => false);

      if (!isChat || !sessionId) throw new Error(noChat);
      if (current.selectedAgent !== agentId || current.sessionId !== sessionId)
        throw new Error(conversationChanged);
      if (!agentOperable)
        throw new Error(
          "The agent is unavailable. Try again when it is ready for chat.",
        );
      if (loadingSession)
        throw new Error(
          "Wait for the conversation to finish loading, then try again.",
        );
      return sendPrompt(prompt);
    },
    [
      agentId,
      sessionId,
      sessionMode,
      agentOperable,
      loadingSession,
      sendPrompt,
      noChat,
      conversationChanged,
    ],
  );
}
