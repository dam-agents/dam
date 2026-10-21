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

export interface StoredActivityFilters {
  types: ChannelType[];
  state: StateFilter;
}

export function serializeActivityFilters(
  filters: ActivityFilters,
): StoredActivityFilters {
  return {
    types: CHANNEL_TYPES.filter((type) => filters.channelTypes.has(type)),
    state: filters.state,
  };
}

// UNIT_BOUNDARY_DESCRIPTION: reads a filter saved by serializeActivityFilters, from storage another version of the UI may have written: types it does not know are dropped, an unknown state is All, and anything that is not a saved filter is the default.
export function parseActivityFilters(raw: unknown): ActivityFilters {
  if (typeof raw !== "object" || raw === null) return defaultActivityFilters();
  const { types, state } = raw as Record<string, unknown>;
  if (!Array.isArray(types) || typeof state !== "string")
    return defaultActivityFilters();
  return {
    channelTypes: new Set(CHANNEL_TYPES.filter((type) => types.includes(type))),
    state: STATE_FILTERS.find((s) => s === state) ?? "any",
  };
}

export function toggleChannelType(
  filters: ActivityFilters,
  type: ChannelType,
): ActivityFilters {
  const next = new Set(filters.channelTypes);
  if (next.has(type)) next.delete(type);
  else next.add(type);
  return { ...filters, channelTypes: next };
}

export function onlyChannelType(
  filters: ActivityFilters,
  type: ChannelType,
): ActivityFilters {
  return { ...filters, channelTypes: new Set([type]) };
}

export function showAllChannelTypes(filters: ActivityFilters): ActivityFilters {
  return { ...filters, channelTypes: new Set(CHANNEL_TYPES) };
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
