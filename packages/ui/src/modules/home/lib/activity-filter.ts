import { type AttentionItem, SessionMode, SessionType } from "api-server-api";

export type ChannelType =
  "chat" | "slack" | "telegram" | "schedule" | "terminal";

export const CHANNEL_TYPES: readonly ChannelType[] = [
  "chat",
  "slack",
  "telegram",
  "schedule",
  "terminal",
];

export const CHANNEL_TYPE_LABELS: Record<ChannelType, string> = {
  chat: "Chat",
  slack: "Slack",
  telegram: "Telegram",
  schedule: "Schedule",
  terminal: "Terminal",
};

export type StateFilter = "any" | "needs-attention" | "in-progress" | "unread";

export const STATE_FILTERS: readonly StateFilter[] = [
  "any",
  "needs-attention",
  "in-progress",
  "unread",
];

export const STATE_FILTER_LABELS: Record<StateFilter, string> = {
  any: "All",
  "needs-attention": "Needs attention",
  "in-progress": "In progress",
  unread: "Unread",
};

export interface ActivityFilters {
  channelTypes: ReadonlySet<ChannelType>;
  state: StateFilter;
}

export function defaultActivityFilters(): ActivityFilters {
  return { channelTypes: new Set(CHANNEL_TYPES), state: "any" };
}

export function isFiltered(filters: ActivityFilters): boolean {
  return (
    filters.channelTypes.size < CHANNEL_TYPES.length || filters.state !== "any"
  );
}

export function channelTypeOfSession(
  session: Pick<AttentionItem, "type" | "mode"> & {
    scheduleId?: string | null;
  },
): ChannelType {
  if (
    session.scheduleId ||
    session.type === SessionType.ScheduleCron ||
    session.type === SessionType.ScheduleOnce
  )
    return "schedule";
  if (session.mode === SessionMode.Terminal) return "terminal";
  if (session.type === SessionType.ChannelSlack) return "slack";
  if (session.type === SessionType.ChannelTelegram) return "telegram";
  return "chat";
}
