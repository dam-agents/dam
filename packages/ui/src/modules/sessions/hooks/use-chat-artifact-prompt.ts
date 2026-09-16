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
    (prompt: string) => {
      const current = useStore.getState();
      const isChat = match(sessionMode)
        .with(null, () => true)
        .with(SessionMode.Chat, () => true)
        .with(SessionMode.Terminal, () => false)
        .exhaustive(() => false);

      if (
        !isChat ||
        !sessionId ||
        !agentOperable ||
        loadingSession ||
        current.selectedAgent !== agentId ||
        current.sessionId !== sessionId
      )
        return Promise.resolve();
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
