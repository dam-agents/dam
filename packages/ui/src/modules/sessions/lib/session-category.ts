import type { SessionCategory } from "api-server-api";

export const SESSION_CATEGORY_LABELS: Record<SessionCategory, string> = {
  chats: "Chats",
  scheduled: "Scheduled",
  channels: "Channels",
  runs: "Runs",
  terminal: "Terminal",
};
