import {
  isAmbientThreadKey,
  SessionType,
  slackChannelIdFromThreadKey,
} from "api-server-api";

export interface ConversationRef {
  type: SessionType;
  threadTs?: string | null;
}

export interface ConversationNames {
  slackByChannelId: ReadonlyMap<string, string>;
  telegramByConversationId: ReadonlyMap<string, string>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Names the Slack channel or Telegram chat a
 * session came from, given the session's type and thread key. The sessions
 * sidebar and the Home feed both show this label; keeping it one function
 * means a thread-key rule changes in one place for both.
 */
export function conversationLabel(
  session: ConversationRef,
  names: ConversationNames,
): string | undefined {
  if (session.type === SessionType.ChannelSlack) {
    const ambient = isAmbientThreadKey(session.threadTs);
    const channelId = slackChannelIdFromThreadKey(session.threadTs);
    const name = channelId ? names.slackByChannelId.get(channelId) : undefined;
    if (!name) return ambient ? "ambient" : undefined;
    return ambient ? `${name} · ambient` : name;
  }
  if (session.type === SessionType.ChannelTelegram)
    return session.threadTs
      ? names.telegramByConversationId.get(session.threadTs)
      : undefined;
  return undefined;
}
