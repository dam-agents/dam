import { SessionMode, SessionType, type SessionView } from "api-server-api";

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
