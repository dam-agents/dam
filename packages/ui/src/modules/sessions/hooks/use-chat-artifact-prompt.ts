import { SessionMode } from "api-server-api";
import { useCallback } from "react";
import { match } from "ts-pattern";

import { useStore } from "../../../store.js";

interface Options {
  agentId: string | null;
  sessionId: string | null;
  sessionMode: SessionMode | null;
  agentOperable: boolean;
  loadingSession: boolean;
  sendPrompt: (prompt: string) => Promise<void>;
}

export function useChatArtifactPrompt({
  agentId,
  sessionId,
  sessionMode,
  agentOperable,
  loadingSession,
  sendPrompt,
}: Options) {
  const sendArtifactPrompt = useCallback(
    async (prompt: string) => {
      const current = useStore.getState();
      const isChat = match(sessionMode)
        .with(null, () => true)
        .with(SessionMode.Chat, () => true)
        .with(SessionMode.Terminal, () => false)
        .exhaustive(() => false);

      if (!isChat || !sessionId)
        throw new Error("Open a chat before using this artifact's buttons.");
      if (current.selectedAgent !== agentId || current.sessionId !== sessionId)
        throw new Error(
          "The conversation changed. Try again from the artifact's chat.",
        );
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
    ],
  );

  return sendArtifactPrompt;
}
