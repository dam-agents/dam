import type { AgentView } from "../../../types.js";
import type { NotificationItem } from "./notification-types.js";

export type ChannelType =
  | "chat"
  | "slack"
  | "telegram"
  | "schedule"
  | "terminal";

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

export type StateFilter = "any" | "in-progress" | "unread" | "read";

export const STATE_FILTERS: readonly StateFilter[] = [
  "any",
  "in-progress",
  "unread",
  "read",
];

export const STATE_FILTER_LABELS: Record<StateFilter, string> = {
  any: "Any",
  "in-progress": "In progress",
  unread: "Unread",
  read: "Read",
};

export interface NotificationFilters {
  channelTypes: ReadonlySet<ChannelType>;
  state: StateFilter;
}

export function defaultFilters(): NotificationFilters {
  return {
    channelTypes: new Set(CHANNEL_TYPES),
    state: "any",
  };
}

export function isFiltered(filters: NotificationFilters): boolean {
  if (filters.channelTypes.size < CHANNEL_TYPES.length) return true;
  if (filters.state !== "any") return true;
  return false;
}

export function channelTypeFor(
  item: NotificationItem,
  agents: readonly AgentView[],
): ChannelType {
  if (item.type === "approval-tool" || item.type === "approval-network") {
    return "chat";
  }
  if (item.session.scheduleId) return "schedule";
  if (item.session.threadTs) return "slack";
  const agent = agents.find((a) => a.id === item.agentId);
  if (agent?.channels.some((c) => c.type === "slack")) return "slack";
  if (agent?.channels.some((c) => c.type === "telegram")) return "telegram";
  return "chat";
}

function matchesState(item: NotificationItem, state: StateFilter): boolean {
  if (state === "any") return true;
  if (state === "in-progress") return item.type === "running";
  if (state === "unread")
    return (
      item.type === "unread" ||
      item.type === "approval-tool" ||
      item.type === "approval-network"
    );
  return item.type === "read";
}

export function applyFilters(
  items: readonly NotificationItem[],
  filters: NotificationFilters,
  agents: readonly AgentView[],
): NotificationItem[] {
  return items.filter((item) => {
    if (!filters.channelTypes.has(channelTypeFor(item, agents))) return false;
    if (!matchesState(item, filters.state)) return false;
    return true;
  });
}

export function hiddenCount(
  all: readonly NotificationItem[],
  visible: readonly NotificationItem[],
): number {
  return all.length - visible.length;
}
