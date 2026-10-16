import type { ChatFormPreferences } from "api-server-api/chat-forms";
import { useCallback, useMemo } from "react";

import { useStore } from "../../../store.js";
import type { Message } from "../../../types.js";
import type { A2uiConversationState } from "../contexts/a2ui-conversation-context.js";
import { buildConversation } from "../lib/build-conversation.js";
import { collectBlocks } from "../lib/collect-blocks.js";
import {
  answeredCallIds,
  MAX_AUTOMATIC_REPLIES,
  pendingResponses,
  trailingAutomaticReplies,
} from "../lib/function-replies.js";
import { withRendererMetadata as attachMetadata } from "../lib/outgoing.js";

function lastReply(messages: readonly Message[]): Message | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1)
    if (!messages[index].notice) return messages[index];
  return undefined;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: replays every A2UI block of the loaded Session Transcript in order, so a later agent message can update or delete a surface an earlier message created, and only the surface the newest finished message touched accepts input.
 */
export function useA2uiConversation(
  messages: readonly Message[],
  sessionKey: string,
  enabled: boolean,
  preferences?: ChatFormPreferences,
): A2uiConversationState {
  const inputs = useMemo(
    () => (enabled ? collectBlocks(messages) : []),
    [enabled, messages],
  );
  const conversation = useMemo(() => buildConversation(inputs), [inputs]);
  const last = lastReply(messages);
  const liveMessageId =
    last && last.role === "assistant" && !last.streaming ? last.id : null;
  const answeredCalls = useMemo(
    () => (enabled ? answeredCallIds(messages) : new Set<string>()),
    [enabled, messages],
  );
  const autoRepliesPaused = useMemo(
    () =>
      enabled && trailingAutomaticReplies(messages) >= MAX_AUTOMATIC_REPLIES,
    [enabled, messages],
  );
  const pending = useMemo(
    () =>
      enabled
        ? pendingResponses(conversation, liveMessageId, answeredCalls)
        : [],
    [enabled, conversation, liveMessageId, answeredCalls],
  );
  const withRendererMetadata = useCallback(
    (text: string) =>
      enabled
        ? attachMetadata(
            text,
            conversation,
            sessionKey,
            useStore.getState().a2uiEdits,
            preferences,
          )
        : text,
    [enabled, conversation, sessionKey, preferences],
  );
  return useMemo(
    () => ({
      conversation,
      sessionKey,
      liveMessageId,
      withRendererMetadata,
      answeredCalls,
      pendingResponses: pending,
      autoRepliesPaused,
    }),
    [
      conversation,
      sessionKey,
      liveMessageId,
      withRendererMetadata,
      answeredCalls,
      pending,
      autoRepliesPaused,
    ],
  );
}
