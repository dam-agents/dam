import type { A2uiConversation } from "api-server-api/chat-forms";

export const COMPOSER_LOCKED_REASON = "Answer the form above to continue.";

// UNIT_BOUNDARY_DESCRIPTION: the composer locks only while the newest finished reply holds a valid surface that asked for the lock, so a broken form never leaves the user without a way to answer.
export function composerLocked(
  conversation: A2uiConversation,
  liveMessageId: string | null,
): boolean {
  if (liveMessageId === null) return false;
  for (const block of conversation.blocks.values())
    if (block.messageId === liveMessageId && block.errors.length > 0)
      return false;
  for (const surface of conversation.surfaces.values())
    if (
      surface.lastTouchMessageId === liveMessageId &&
      surface.lockComposer &&
      !surface.deleted &&
      !surface.streaming
    )
      return true;
  return false;
}
