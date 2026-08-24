import { SessionType } from "api-server-api";

import type { FeedItem } from "./feed-item.js";

export type FeedStatus = "all" | "attention" | "in-progress" | "unread";

export const FEED_STATUSES: readonly FeedStatus[] = [
  "all",
  "attention",
  "in-progress",
  "unread",
];

export const FEED_STATUS_LABELS: Record<FeedStatus, string> = {
  all: "All",
  attention: "Needs attention",
  "in-progress": "In progress",
  unread: "Unread",
};

export type FeedSource = "channels" | "schedules";

export const FEED_SOURCES: readonly FeedSource[] = ["channels", "schedules"];

export const FEED_SOURCE_LABELS: Record<FeedSource, string> = {
  channels: "Channels",
  schedules: "Schedules",
};

export function sourceOf(item: FeedItem): FeedSource | null {
  if (item.kind === "approval") return null;
  switch (item.session.type) {
    case SessionType.ChannelSlack:
    case SessionType.ChannelTelegram:
      return "channels";
    case SessionType.ScheduleCron:
      return "schedules";
    default:
      return null;
  }
}

function matchesStatus(item: FeedItem, status: FeedStatus): boolean {
  switch (status) {
    case "all":
      return true;
    case "attention":
      return item.kind === "approval";
    case "in-progress":
      return item.kind === "in-progress";
    case "unread":
      return item.kind === "unread";
  }
}

export function filterFeed(
  items: readonly FeedItem[],
  status: FeedStatus,
  includedSources: ReadonlySet<FeedSource>,
): FeedItem[] {
  return items.filter((item) => {
    if (!matchesStatus(item, status)) return false;
    const source = sourceOf(item);
    return source === null || includedSources.has(source);
  });
}

export function feedStats(items: readonly FeedItem[]): {
  running: number;
  toReview: number;
} {
  return {
    running: items.filter((i) => i.kind === "in-progress").length,
    toReview: items.filter((i) => i.kind === "unread").length,
  };
}

export interface FeedEmpty {
  title: string;
  message: string;
  tone: "clear" | "filtered";
}

export function emptyStateFor(
  status: FeedStatus,
  options: { allSourcesExcluded: boolean; noRunningAgents: boolean },
): FeedEmpty {
  if (options.allSourcesExcluded) {
    return {
      title: "Nothing included",
      message: "Every source is filtered out.",
      tone: "filtered",
    };
  }
  if (options.noRunningAgents && status !== "attention") {
    return {
      title: "Nothing running",
      message:
        "Unread and in-progress work show up here while an agent is running.",
      tone: "clear",
    };
  }
  switch (status) {
    case "attention":
      return {
        title: "All clear",
        message: "Nothing needs a decision from you.",
        tone: "clear",
      };
    case "in-progress":
      return {
        title: "Nothing running",
        message: "No agent is working right now.",
        tone: "clear",
      };
    case "unread":
    case "all":
      return {
        title: "All clear",
        message: "Nothing waiting for review. You're all caught up.",
        tone: "clear",
      };
  }
}
