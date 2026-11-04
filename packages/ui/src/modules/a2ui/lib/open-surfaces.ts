import type { A2uiConversation } from "api-server-api/chat-forms";

import type { Message } from "../../../types.js";
import { userText } from "./function-replies.js";
import { parseUserText } from "./prompts.js";

interface Answer {
  surfaceId: string;
  at: number;
}

function answers(messages: readonly Message[]): Answer[] {
  return messages.flatMap((message, at) =>
    message.role === "user"
      ? parseUserText(userText(message)).messages.flatMap((rendererMessage) =>
          "action" in rendererMessage
            ? [{ surfaceId: rendererMessage.action.surfaceId, at }]
            : [],
        )
      : [],
  );
}

// UNIT_BOUNDARY_DESCRIPTION: a surface accepts input while the newest finished reply is the agent's, until the user answers it or answers a newer surface after it, so a status reply after a form does not take the form away from the user.
export function openSurfaceIds(
  conversation: A2uiConversation,
  messages: readonly Message[],
  liveMessageId: string | null,
): ReadonlySet<string> {
  const open = new Set<string>();
  if (liveMessageId === null) return open;
  const position = new Map(messages.map((message, at) => [message.id, at]));
  const touchedAt = (surfaceId: string) => {
    const surface = conversation.surfaces.get(surfaceId);
    return surface ? position.get(surface.lastTouchMessageId) : undefined;
  };
  const answered = answers(messages);
  for (const surface of conversation.surfaces.values()) {
    if (surface.deleted || surface.streaming) continue;
    const touched = touchedAt(surface.id);
    if (touched === undefined) continue;
    const closed = answered.some(
      ({ surfaceId, at }) =>
        at > touched &&
        (surfaceId === surface.id || (touchedAt(surfaceId) ?? -1) > touched),
    );
    if (!closed) open.add(surface.id);
  }
  return open;
}
