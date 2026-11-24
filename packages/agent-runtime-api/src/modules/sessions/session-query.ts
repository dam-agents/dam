import type {
  SessionCategory,
  SessionChannelType,
  SessionListQuery,
} from "./types.js";

interface QueriedSession {
  sessionId: string;
  mode: string;
  type: string;
  scheduleId?: string | null;
  continuedScheduleIds?: readonly string[];
  updatedAt?: string | null;
  seenAt?: string | null;
  running?: boolean;
}

export function sessionCategoryOf(session: {
  mode: string;
  type: string;
}): SessionCategory {
  if (session.mode === "terminal") return "terminal";
  if (
    session.type === "channel_slack" ||
    session.type === "channel_telegram" ||
    session.type === "artifact"
  )
    return "channels";
  if (session.type === "schedule_cron" || session.type === "schedule_once")
    return "scheduled";
  if (session.type === "cli_run" || session.type === "invocation")
    return "runs";
  return "chats";
}

export function sessionChannelTypeOf(session: {
  mode: string;
  type: string;
  scheduleId?: string | null;
}): SessionChannelType {
  if (
    session.scheduleId ||
    session.type === "schedule_cron" ||
    session.type === "schedule_once"
  )
    return "schedule";
  if (session.mode === "terminal") return "terminal";
  if (session.type === "channel_slack") return "slack";
  if (session.type === "channel_telegram") return "telegram";
  if (session.type === "artifact") return "artifact";
  return "chat";
}

export function isUnseenActivity(
  activityAt: string | null | undefined,
  seenAt: string | null | undefined,
): boolean {
  if (!activityAt) return false;
  if (!seenAt) return true;
  return Date.parse(activityAt) > Date.parse(seenAt);
}

function hasStatus(
  session: QueriedSession,
  status: NonNullable<SessionListQuery["status"]>,
): boolean {
  switch (status) {
    case "running":
      return session.running === true;
    case "unread":
      return isUnseenActivity(session.updatedAt, session.seenAt);
  }
}

export function sessionMatchesQuery(
  session: QueriedSession,
  query: SessionListQuery,
): boolean {
  return (
    (query.categories === undefined ||
      query.categories.includes(sessionCategoryOf(session))) &&
    (query.channelTypes === undefined ||
      query.channelTypes.includes(sessionChannelTypeOf(session))) &&
    (query.status === undefined || hasStatus(session, query.status)) &&
    (query.sessionId === undefined || session.sessionId === query.sessionId) &&
    (query.scheduleId === undefined ||
      session.scheduleId === query.scheduleId ||
      (session.continuedScheduleIds?.includes(query.scheduleId) ?? false))
  );
}
