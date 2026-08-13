import {
  isAmbientThreadKey,
  SessionMode,
  SessionType,
  type SessionView,
} from "api-server-api";

export const SESSION_CATEGORIES = [
  "chats",
  "experiments",
  "scheduled",
  "channels",
  "terminal",
] as const;
export type SessionCategory = (typeof SESSION_CATEGORIES)[number];

export const SESSION_CATEGORY_LABELS: Record<SessionCategory, string> = {
  chats: "Chats",
  experiments: "Experiment runs",
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
  if (session.type === SessionType.ExperimentExecute) return "experiments";
  return "chats";
}

export type SlackSessionKind = "ambient" | "thread";

export function slackSessionKind(
  session: SessionView,
): SlackSessionKind | null {
  if (session.type !== SessionType.ChannelSlack) return null;
  return isAmbientThreadKey(session.threadTs) ? "ambient" : "thread";
}
