import { A2UI_VERSION } from "api-server-api/chat-forms";
import { useEffect, useRef } from "react";

import { emitToast } from "../../../lib/toast.js";
import type { A2uiConversationState } from "../contexts/a2ui-conversation-context.js";
import { formatRendererMessage } from "../lib/prompts.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the A2UI renderer must answer every callRendererFunction, so the chat sends the rendererFunctionResponse of the newest finished agent message on its own, once per call, and stops after a run of automatic replies so a looping agent cannot keep itself busy.
 */
export function useA2uiAutoReplies(
  state: A2uiConversationState,
  sendPrompt: (prompt: string) => Promise<void>,
): void {
  const sent = useRef(new Set<string>());
  const {
    pendingResponses,
    autoRepliesPaused,
    withRendererMetadata,
    sessionKey,
  } = state;

  useEffect(() => {
    if (autoRepliesPaused) return;
    const keyOf = (functionCallId: string) => `${sessionKey}|${functionCallId}`;
    const fresh = pendingResponses.filter(
      (response) => !sent.current.has(keyOf(response.functionCallId)),
    );
    if (fresh.length === 0) return;
    for (const response of fresh)
      sent.current.add(keyOf(response.functionCallId));
    const prompt = fresh
      .map((response) =>
        formatRendererMessage({
          version: A2UI_VERSION,
          rendererFunctionResponse: response,
        }),
      )
      .join("\n");
    sendPrompt(withRendererMetadata(prompt)).catch(() => {
      for (const response of fresh)
        sent.current.delete(keyOf(response.functionCallId));
      emitToast({
        kind: "error",
        message: "Couldn't send the function result to the agent.",
      });
    });
  }, [
    pendingResponses,
    autoRepliesPaused,
    sendPrompt,
    withRendererMetadata,
    sessionKey,
  ]);
}
