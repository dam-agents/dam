import type { AgentView } from "../../../types.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the profile a bound Telegram conversation runs on,
 * looked up by the key its type binds with, so its row reads the same column a
 * Slack row does (D91).
 */
export function conversationProfileId(
  agent: AgentView | undefined,
  conversationId: string,
): string | null {
  const row = (agent?.channels ?? []).find(
    (channel) =>
      (channel as { conversationId?: string }).conversationId ===
      conversationId,
  );
  return row?.profileId ?? null;
}
