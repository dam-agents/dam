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
import { openSurfaceIds } from "../lib/open-surfaces.js";
import { withRendererMetadata as attachMetadata } from "../lib/outgoing.js";
import { sentBackBlocks } from "../lib/sent-back.js";

function lastReply(messages: readonly Message[]): Message | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1)
    if (!messages[index].notice) return messages[index];
  return undefined;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: replays every A2UI block of the loaded Session Transcript in order, so a later agent message can update or delete a surface an earlier message created, and a surface accepts input until the user answers it or a newer one.
 */
export function useA2uiConversation(
  messages: readonly Message[],
  sessionKey: string,
  preferences?: ChatFormPreferences,
): A2uiConversationState {
  const inputs = useMemo(() => collectBlocks(messages), [messages]);
  const conversation = useMemo(() => buildConversation(inputs), [inputs]);
  const sentBack = useMemo(() => sentBackBlocks(messages), [messages]);
  const last = lastReply(messages);
  const liveMessageId =
    last && last.role === "assistant" && !last.streaming ? last.id : null;
  const openSurfaces = useMemo(
    () => openSurfaceIds(conversation, messages, liveMessageId),
    [conversation, messages, liveMessageId],
  );
  const answeredCalls = useMemo(() => answeredCallIds(messages), [messages]);
  const autoRepliesPaused = useMemo(
    () => trailingAutomaticReplies(messages) >= MAX_AUTOMATIC_REPLIES,
    [messages],
  );
  const pending = useMemo(
    () => pendingResponses(conversation, liveMessageId, answeredCalls),
    [conversation, liveMessageId, answeredCalls],
  );
  const withRendererMetadata = useCallback(
    (text: string) =>
      attachMetadata(
        text,
        conversation,
        sessionKey,
        useStore.getState().a2uiEdits,
        preferences,
      ),
    [conversation, sessionKey, preferences],
  );
  return useMemo(
    () => ({
      conversation,
      sessionKey,
      liveMessageId,
      openSurfaces,
      withRendererMetadata,
      answeredCalls,
      pendingResponses: pending,
      autoRepliesPaused,
      sentBack,
    }),
    [
      conversation,
      sessionKey,
      liveMessageId,
      openSurfaces,
      withRendererMetadata,
      answeredCalls,
      pending,
      autoRepliesPaused,
      sentBack,
    ],
  );
}
