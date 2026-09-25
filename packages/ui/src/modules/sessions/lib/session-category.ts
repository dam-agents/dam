import {
  type SessionCategory,
  sessionCategoryOf,
  type SessionView,
} from "api-server-api";

export type { SessionCategory } from "api-server-api";
export { SESSION_CATEGORIES } from "api-server-api";

export const SESSION_CATEGORY_LABELS: Record<SessionCategory, string> = {
  chats: "Chats",
  scheduled: "Scheduled",
  channels: "Channels",
  runs: "Runs",
  terminal: "Terminal",
};

export function sessionCategory(session: SessionView): SessionCategory {
  return sessionCategoryOf(session);
}
