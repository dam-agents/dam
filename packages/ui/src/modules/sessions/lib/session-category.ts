import {
  isAmbientThreadKey,
  type SessionCategory,
  sessionCategoryOf,
  SessionType,
  type SessionView,
} from "api-server-api";

export type { SessionCategory } from "api-server-api";
export { SESSION_CATEGORIES } from "api-server-api";

export const SESSION_CATEGORY_LABELS: Record<SessionCategory, string> = {
  chats: "Chats",
  experiments: "Experiment runs",
  scheduled: "Scheduled",
  channels: "Channels",
  terminal: "Terminal",
};

export function sessionCategory(session: SessionView): SessionCategory {
  return sessionCategoryOf(session);
}

export type SlackSessionKind = "ambient" | "thread";

export function slackSessionKind(
  session: SessionView,
): SlackSessionKind | null {
  if (session.type !== SessionType.ChannelSlack) return null;
  return isAmbientThreadKey(session.threadTs) ? "ambient" : "thread";
}
