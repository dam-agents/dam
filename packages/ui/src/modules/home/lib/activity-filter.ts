import { SessionMode, SessionType } from "api-server-api";

import type { AgentView } from "../../../types.js";
import type { FeedItem } from "./feed-item.js";

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

export type StateFilter = "any" | "attention" | "in-progress" | "unread";

export const STATE_FILTERS: readonly StateFilter[] = [
  "any",
  "attention",
  "in-progress",
  "unread",
];

export const STATE_FILTER_LABELS: Record<StateFilter, string> = {
  any: "All",
  attention: "Needs attention",
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

export function channelTypeFor(
  item: FeedItem,
  agents: readonly AgentView[],
): ChannelType {
  if (item.kind === "approval") return "chat";
  const { session } = item;
  if (session.scheduleId || session.type === SessionType.ScheduleCron)
    return "schedule";
  if (session.mode === SessionMode.Terminal) return "terminal";
  if (session.type === SessionType.ChannelSlack) return "slack";
  if (session.type === SessionType.ChannelTelegram) return "telegram";
  const agent = agents.find((candidate) => candidate.id === item.agentId);
  if (agent?.channels.some((channel) => channel.type === "slack"))
    return "slack";
  if (agent?.channels.some((channel) => channel.type === "telegram"))
    return "telegram";
  return "chat";
}

function matchesState(item: FeedItem, state: StateFilter): boolean {
  switch (state) {
    case "any":
      return true;
    case "attention":
      return item.kind === "approval";
    case "in-progress":
      return item.kind === "in-progress";
    case "unread":
      return item.kind === "unread";
  }
}

export function applyActivityFilters(
  items: readonly FeedItem[],
  filters: ActivityFilters,
  agents: readonly AgentView[],
): FeedItem[] {
  return items.filter(
    (item) =>
      filters.channelTypes.has(channelTypeFor(item, agents)) &&
      matchesState(item, filters.state),
  );
}
