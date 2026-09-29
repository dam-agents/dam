import type { SessionCategory, SessionListQuery } from "./types.js";

interface QueriedSession {
  sessionId: string;
  mode: string;
  type: string;
  scheduleId?: string | null;
}

export function sessionCategoryOf(session: {
  mode: string;
  type: string;
}): SessionCategory {
  if (session.mode === "terminal") return "terminal";
  if (session.type === "channel_slack" || session.type === "channel_telegram")
    return "channels";
  if (session.type === "schedule_cron") return "scheduled";
  if (session.type === "cli_run") return "runs";
  return "chats";
}

export function sessionMatchesQuery(
  session: QueriedSession,
  query: SessionListQuery,
): boolean {
  return (
    (query.categories === undefined ||
      query.categories.includes(sessionCategoryOf(session))) &&
    (query.sessionId === undefined || session.sessionId === query.sessionId) &&
    (query.scheduleId === undefined || session.scheduleId === query.scheduleId)
  );
}
