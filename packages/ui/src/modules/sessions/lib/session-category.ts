import {
  isAmbientThreadKey,
  SessionMode,
  SessionType,
  type SessionView,
} from "api-server-api";

export const SESSION_CATEGORIES = [
  "chats",
  "scheduled",
  "channels",
  "terminal",
] as const;
export type SessionCategory = (typeof SESSION_CATEGORIES)[number];

export const SESSION_CATEGORY_LABELS: Record<SessionCategory, string> = {
  chats: "Chats",
  scheduled: "Scheduled",
  channels: "Channels",
  terminal: "Terminal",
};

export function sessionCategory(session: SessionView): SessionCategory {
  if (session.mode === SessionMode.Terminal) return "terminal";
  if (
    session.type === SessionType.ChannelSlack ||
    session.type === SessionType.ChannelTelegram
  )
    return "channels";
  if (session.type === SessionType.ScheduleCron) return "scheduled";
  return "chats";
}

/**
 * A Slack channel session is either the channel's rolling **ambient** reader
 * (keyed `ambient:<channel>`, where top-level reads-along chatter accrues) or a
 * **thread** the agent got pulled into (its own `thread_ts` session). Returns
 * null for any other session — ambient is a Slack-only mode, so Telegram and
 * non-channel sessions have no such split.
 */
export type SlackSessionKind = "ambient" | "thread";

export function slackSessionKind(
  session: SessionView,
): SlackSessionKind | null {
  if (session.type !== SessionType.ChannelSlack) return null;
  return isAmbientThreadKey(session.threadTs) ? "ambient" : "thread";
}
